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
import type { RunEvent, StartVerificationRequest, VerificationCheckId } from "./types.js";

export interface RunRecord {
  id: string;
  userId: string;
  status: "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
  scope: VerificationCheckId[];
  targetIds: string[];
  targetNames: Record<string, string>;
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
  return JSON.stringify({ version: 1, runs: persisted });
}

function pruneToCap(): void {
  if (runs.size <= MAX_PERSISTED_RUNS) return;
  // Drop the OLDEST settled runs first; never drop an active one to
  // satisfy the cap (an active run is always the newest anyway).
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

function loadStore(): void {
  try {
    const raw = readFileSync(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as { runs?: PersistedRun[] };
    if (!Array.isArray(parsed?.runs)) return;
    for (const p of parsed.runs) {
      if (!p?.id || !Array.isArray(p.events)) continue;
      const settled =
        p.status === "completed" || p.status === "failed" || p.status === "cancelled";
      runs.set(p.id, {
        ...p,
        waiters: [],
        // A run that was mid-flight when the process died can never
        // finish — mark it failed so SSE clients get a terminal event
        // instead of a stream that never ends.
        stopRequested: false,
        status: settled ? p.status : "failed",
        ...(settled
          ? {}
          : {
              completedAt: new Date().toISOString(),
              events: [
                ...p.events,
                {
                  kind: "run_failed" as const,
                  runId: p.id,
                  reason:
                    "The verification server restarted mid-run. Start a fresh run to re-verify.",
                },
              ],
              cursor: p.events.length + 1,
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
  Pick<RunRecord, "id" | "userId" | "status" | "scope" | "startedAt" | "completedAt"> & {
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
      status: r.status,
      scope: r.scope,
      targetNames: r.targetNames,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      eventCount: r.events.length,
    }));
}

// Flush pending history on shutdown so the last run's settled state
// isn't lost to the debounce window.
process.on("SIGINT", () => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    saveStoreNow();
  }
  process.exit(0);
});

// Idempotency map: hash(enabledTargets + scope) -> existing runId.
// Capped so it doesn't grow unbounded — only the most recent 16 keys
// are kept (matches the spec's "concurrent runs are queued" posture).
const idempotency = new Map<string, string>();
const idempotencyOrder: string[] = [];
const IDEMPOTENCY_CAP = 16;

export function startRun(req: StartVerificationRequest): { id: string; replay: boolean } {
  const enabledTargets = req.targets.filter((t) => t.enabled);
  const scopeKey = [...req.scope].sort().join("|");
  const targetsKey = enabledTargets
    .map((t) => `${t.id}:${t.credentialId ?? ""}`)
    .sort()
    .join(",");
  const hash = createHash("sha256").update(`${req.userId}|${targetsKey}|${scopeKey}`).digest("hex");

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
