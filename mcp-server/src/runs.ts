// Run state store + SSE event tail.
//
// Per spec §6 step 5: the agent loop appends events to a per-run log
// and the frontend GETs them as SSE. The store also owns idempotency
// (spec §7): duplicate Start with the same scope + same enabled
// targets returns the existing run id instead of starting a second
// agent loop on the same browser context.

import { createHash } from "node:crypto";
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
}

const runs = new Map<string, RunRecord>();

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
  };
  runs.set(id, rec);

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
}

export function appendEvent(id: string, event: RunEvent): void {
  const r = runs.get(id);
  if (!r) return;
  r.events.push(event);
  r.cursor++;
  notifyWaiters(id);
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
