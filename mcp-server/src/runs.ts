// Run state store + SSE event tail.
//
// Per spec §6 step 5: the agent loop appends events to a per-run log
// and the frontend GETs them as SSE. The store also owns idempotency
// (spec §7): duplicate Start with the same scope + same enabled
// targets returns the existing run id instead of starting a second
// agent loop on the same browser context.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunEvent, RunKind, StartVerificationRequest, VerificationCheckId } from "./types.js";

export interface RunRecord {
  id: string;
  userId: string;
  // "verification" = AI agent walk. "playwright" = user-authored script.
  // Every row carries one — the discriminator drives the History badge
  // and the runScript branch in agent.ts. Stamp-only on v1 rows loaded
  // from a pre-existing runs-store.json (see loadStore migration below).
  kind: RunKind;
  status: "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
  scope: VerificationCheckId[];
  targetIds: string[];
  targetNames: Record<string, string>;
  // Set on Playwright runs only; the History row uses it instead of
  // "X checks" when rendering the subtitle.
  scriptName?: string;
  startedAt: string;
  completedAt?: string;
  events: RunEvent[];
  // Monotonic cursor — SSE tail uses this to resume after disconnect.
  cursor: number;
  // Subscribers waiting for new events.
  waiters: Array<() => void>;
  // Cooperative cancellation. The /stop endpoint sets this so the agent
  // loop can bail out at its next check boundary instead of walking the
  // whole target list as a zombie after the UI already said "cancelled".
  stopRequested: boolean;
}

const runs = new Map<string, RunRecord>();

// ────────────────────────────────────────────────────────────────────────────
//  Persistence — run history survives restarts.
//
//  The store used to be purely in-memory, so a server restart lost every
//  run record: SSE replay 404'd, the UI's "last run" state had nothing to
//  reconnect to, and run history was gone. Records now persist to a JSON
//  file (debounced while a run is streaming events, synchronous when a
//  run settles) and reload on boot. Only the most recent MAX_PERSISTED
//  runs are kept so the file can't grow unbounded.
// ────────────────────────────────────────────────────────────────────────────

const STORE_PATH = process.env.RUNS_STORE_PATH ?? join(process.cwd(), "runs-store.json");
const MAX_PERSISTED_RUNS = 50;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

type PersistedRun = Omit<RunRecord, "waiters" | "stopRequested">;

function serialize(): string {
  // Most recent runs only — keeps the file bounded and the pruning
  // below deterministic.
  const recs = [...runs.values()].slice(-MAX_PERSISTED_RUNS);
  const persisted: PersistedRun[] = recs.map(({ waiters: _w, stopRequested: _s, ...rest }) => rest);
  return JSON.stringify({ version: 2, runs: persisted });
}

function pruneToCap(): void {
  if (runs.size <= MAX_PERSISTED_RUNS) return;
  // Drop the OLDEST settled runs first; never drop an active one to
  // satisfy the cap (an active run is always the newest anyway).
  // Without this, `serialize()` would write a transient snapshot
  // with `MAX_PERSISTED + N` rows, and a crash before the next save
  // would leave the on-disk file over the cap.
  const ids = [...runs.keys()];
  for (const id of ids) {
    if (runs.size <= MAX_PERSISTED_RUNS) break;
    const r = runs.get(id);
    if (!r) continue;
    if (r.status === "queued" || r.status === "running" || r.status === "paused") continue;
    runs.delete(id);
  }
}

function saveStoreNow(): void {
  pruneToCap();
  try {
    writeFileSync(STORE_PATH, serialize(), "utf8");
  } catch {
    // Unwritable path / disk full — history is best-effort, never let
    // it take a live run down.
  }
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveStoreNow();
  }, 1_500);
}

// Validate one event in a persisted run. A truncated file (disk full
// mid-write, antivirus scan, kill -9) can leave a half-written JSON
// document where the events array is well-formed but one of its
// elements is a partial object. Loading it back and forwarding it
// through the SSE envelope would throw on JSON.stringify later, taking
// the live event stream down with it. Drop the malformed event with
// a synthetic terminal `run_failed` so the run still surfaces as
// failed-but-read instead of wedging the consumer.
function isValidEvent(ev: unknown): ev is RunEvent {
  if (!ev || typeof ev !== "object") return false;
  const k = (ev as { kind?: unknown }).kind;
  if (k !== "console_log" && k !== "screenshot_taken" && k !== "run_completed" && k !== "run_failed") {
    return false;
  }
  const obj = ev as { runId?: unknown; ts?: unknown; message?: unknown; level?: unknown };
  if (typeof obj.runId !== "string") return false;
  if (k === "console_log" || k === "screenshot_taken") {
    if (typeof obj.ts !== "number") return false;
  }
  if (k === "console_log") {
    if (typeof obj.message !== "string") return false;
    if (obj.level !== "log" && obj.level !== "info" && obj.level !== "warn" && obj.level !== "error") {
      return false;
    }
  }
  if (k === "screenshot_taken") {
    if (typeof (obj as { storageRef?: unknown }).storageRef !== "string") return false;
    if (typeof (obj as { label?: unknown }).label !== "string") return false;
  }
  if (k === "run_failed") {
    if (typeof (obj as { reason?: unknown }).reason !== "string") return false;
  }
  return true;
}

function loadStore(): void {
  try {
    const raw = readFileSync(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as { version?: number; runs?: PersistedRun[] };
    if (!Array.isArray(parsed?.runs)) return;
    for (const p of parsed.runs) {
      if (!p?.id || !Array.isArray(p.events)) continue;
      const settled =
        p.status === "completed" || p.status === "failed" || p.status === "cancelled";
      // Per-event validation — drop malformed entries silently. A
      // half-written JSON file can produce a structurally-valid
      // events array whose last element is `{}`; loading it as-is
      // would make every later SSE serialize throw.
      const cleanEvents = p.events.filter(isValidEvent);
      const dropped = p.events.length - cleanEvents.length;
      runs.set(p.id, {
        ...p,
        // v1 → v2 migration: legacy files predate the kind field. They were
        // all produced by the verification walk, so stamp "verification".
        // v2 files already carry kind, so this is a no-op overwrite for them.
        kind: "verification" as RunKind,
        scriptName: undefined,
        waiters: [],
        // A run that was mid-flight when the process died can never
        // finish — mark it failed so SSE clients get a terminal event
        // instead of a stream that never ends.
        stopRequested: false,
        status: settled ? p.status : "failed",
        events: cleanEvents,
        cursor: cleanEvents.length,
        ...(settled
          ? {}
          : {
              completedAt: new Date().toISOString(),
              events: [
                ...cleanEvents,
                {
                  kind: "run_failed" as const,
                  runId: p.id,
                  reason:
                    dropped > 0
                      ? `The verification server restarted mid-run; ${dropped} event(s) were lost to a partial write. Start a fresh run to re-verify.`
                      : "The verification server restarted mid-run. Start a fresh run to re-verify.",
                },
              ],
              cursor: cleanEvents.length + 1,
            }),
      });
    }
  } catch {
    // Missing file on first boot, or corrupted content — start empty.
  }
}

loadStore();

// List runs for the history endpoint — newest first, without the event
// log (that's what /verify/runs/:id/events replays).
export function listRuns(limit = 25): Array<
  Pick<
    RunRecord,
    "id" | "userId" | "kind" | "scriptName" | "status" | "scope" | "startedAt" | "completedAt"
  > & {
    targetNames: RunRecord["targetNames"];
    eventCount: number;
  }
> {
  return [...runs.values()]
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      userId: r.userId,
      kind: r.kind,
      scriptName: r.scriptName,
      status: r.status,
      scope: r.scope,
      targetNames: r.targetNames,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      eventCount: r.events.length,
    }));
}

// Flush pending history on shutdown so the last run's settled state
// isn't lost to the debounce window. SIGINT is the Ctrl-C path;
// SIGTERM is the platform's "please stop" signal that the OS
// delivers on container teardown — both need the same flush, and
// `process.exit(0)` is the explicit contract that turns the
// async `writeFileSync` into a synchronous one.
function flushAndExit(code: number): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    saveStoreNow();
  }
  process.exit(code);
}
process.on("SIGINT", () => flushAndExit(0));
process.on("SIGTERM", () => flushAndExit(0));

// Unhandled rejections / exceptions can fire mid-`writeFileSync` and
// leave a partial `runs-store.json` on disk. Without these, a
// crash leaves the in-memory events intact but loses the
// debounced-on-disk snapshot. Logging to stderr here is the
// best we can do without taking the live run down — the next
// process start will read whatever the OS flushed, with a clean
// fail-state in `loadStore`'s try/catch.
process.on("unhandledRejection", (reason) => {
  console.error("[runs] unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[runs] uncaughtException:", err);
  flushAndExit(1);
});

// Idempotency map: hash(enabledTargets + scope) -> existing runId.
// Capped so it doesn't grow unbounded — only the most recent 16 keys
// are kept (matches the spec's "concurrent runs are queued" posture).
const idempotency = new Map<string, string>();
const idempotencyOrder: string[] = [];
const IDEMPOTENCY_CAP = 16;

export function startRun(req: StartVerificationRequest): { id: string; replay: boolean } {
  // Script-only runs send neither targets nor scope (the XOR is enforced
  // by the zod refine). Default both to [] so the downstream helpers
  // never see undefined; verification runs always pass arrays.
  const targets = req.targets ?? [];
  const scope = req.scope ?? [];
  const enabledTargets = targets.filter((t) => t.enabled);
  const scopeKey = [...scope].sort().join("|");
  const targetsKey = enabledTargets
    .map((t) => `${t.id}:${t.credentialId ?? ""}`)
    .sort()
    .join(",");
  // Idempotency key includes the run kind + (for scripts) the
  // script's display name AND its current body. Without the body
  // segment, editing a script and re-running would hit the
  // "replay" path and re-execute the old version — the user
  // expects their edits to actually run. The name is kept so two
  // scripts with the same body but different filenames don't
  // collide; the body is what gives us the "this run is
  // distinguishable from the previous one" signal.
  const kindKey = req.script
    ? `script:${req.script.name}:${createHash("sha256").update(req.script.code).digest("hex")}`
    : "verification";
  const hash = createHash("sha256")
    .update(`${req.userId}|${kindKey}|${targetsKey}|${scopeKey}`)
    .digest("hex");

  const existing = idempotency.get(hash);
  if (existing) {
    const rec = runs.get(existing);
    if (rec && (rec.status === "running" || rec.status === "queued" || rec.status === "paused")) {
      return { id: existing, replay: true };
    }
    // Existing run is already settled (completed/failed/cancelled). Treat
    // this Start as a fresh one — fall through and allocate a new id, and
    // overwrite the idempotency key so the next Start with the same shape
    // also gets a fresh run.
    idempotency.delete(hash);
    const idx = idempotencyOrder.indexOf(hash);
    if (idx >= 0) idempotencyOrder.splice(idx, 1);
  }

  const id = req.runId || `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const targetNames: Record<string, string> = {};
  for (const t of enabledTargets) targetNames[t.id] = t.applicationName;

  const rec: RunRecord = {
    id,
    userId: req.userId,
    kind: req.script ? "playwright" : "verification",
    scriptName: req.script?.name,
    status: "queued",
    scope: req.scope,
    targetIds: enabledTargets.map((t) => t.id),
    targetNames,
    startedAt: new Date().toISOString(),
    events: [],
    cursor: 0,
    waiters: [],
    stopRequested: false,
  };
  runs.set(id, rec);
  scheduleSave();

  idempotency.set(hash, id);
  idempotencyOrder.push(hash);
  if (idempotencyOrder.length > IDEMPOTENCY_CAP) {
    const drop = idempotencyOrder.shift();
    if (drop) idempotency.delete(drop);
  }
  return { id, replay: false };
}

export function getRun(id: string): RunRecord | undefined {
  return runs.get(id);
}

// Ask the agent loop for this run to stop at its next check boundary.
// The /stop endpoint still emits its own terminal event + status flip
// immediately (so SSE clients end promptly); this flag is what actually
// interrupts the Playwright work instead of letting it run to completion
// invisibly.
export function requestStop(id: string): void {
  const r = runs.get(id);
  if (!r) return;
  r.stopRequested = true;
  notifyWaiters(id);
  scheduleSave();
}

export function setStatus(
  id: string,
  status: RunRecord["status"],
  extras?: { completedAt?: string },
): void {
  const r = runs.get(id);
  if (!r) return;
  r.status = status;
  if (extras?.completedAt) r.completedAt = extras.completedAt;
  notifyWaiters(id);
  // Terminal statuses flush synchronously — the debounce window is fine
  // mid-run, but a settled run should be on disk before the process
  // could go away.
  if (status === "completed" || status === "failed" || status === "cancelled") saveStoreNow();
  else scheduleSave();
}

export function appendEvent(id: string, event: RunEvent): void {
  const r = runs.get(id);
  if (!r) return;
  r.events.push(event);
  r.cursor++;
  notifyWaiters(id);
  // Events stream at high cadence during a run — debounced so the
  // write cost stays flat instead of one fsync per event.
  scheduleSave();
}

function notifyWaiters(id: string) {
  const r = runs.get(id);
  if (!r) return;
  const waiters = r.waiters.splice(0, r.waiters.length);
  for (const w of waiters) {
    try {
      w();
    } catch {
      // ignore — waiters handle their own errors via Promise rejection
    }
  }
}

export function eventsAfter(id: string, since: number): RunEvent[] {
  const r = runs.get(id);
  if (!r) return [];
  return r.events.slice(since);
}

export async function waitForEvents(id: string, since: number, timeoutMs = 30_000): Promise<RunEvent[]> {
  const r = runs.get(id);
  if (!r) return [];
  if (r.cursor > since) return r.events.slice(since);
  return new Promise<RunEvent[]>((resolve) => {
    const timer = setTimeout(() => {
      const idx = r.waiters.indexOf(wake);
      if (idx >= 0) r.waiters.splice(idx, 1);
      resolve([]);
    }, timeoutMs);
    const wake = () => {
      clearTimeout(timer);
      resolve(r.events.slice(since));
    };
    r.waiters.push(wake);
  });
}
