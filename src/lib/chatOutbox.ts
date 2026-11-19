// Chat-message outbox — a localStorage safety net for the data gateway's
// transient failures.
//
// Every chat message is persisted fire-and-forget (the send path must not
// block on the cloud), so when the gateway is in one of its
// ERR_HTTP2_PROTOCOL_ERROR storms the row is silently lost — and an entire
// agent session's history can fail to persist, leaving nothing to restore
// after a reload (observed live 2026-10-09: the DataGuard build session's
// whole thread vanished; totalCount=0 on a session the panel had rendered
// hundreds of rows for earlier the same morning). Failed writes enqueue
// here; a lazy 60s drain retries them until the cloud takes them, and any
// successful send flushes the queue first so ordering roughly holds.
//
// Best-effort by design: quota errors / private-mode simply mean the
// outbox is empty and the loss window returns. Capped at 500 entries so a
// long outage can't grow the key unbounded.

const KEY = "lattice.chatOutbox.v1";
const MAX_ENTRIES = 500;

export interface OutboxEntry {
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  actionsJson: string;
  ts: number;
}

export function readOutbox(): OutboxEntry[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeOutbox(entries: OutboxEntry[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // private mode / quota — the outbox just stays empty
  }
}

export function enqueueOutbox(entry: OutboxEntry): void {
  writeOutbox([...readOutbox(), entry]);
}

/** Take everything currently queued (the queue is cleared atomically). */
export function dequeueAll(): OutboxEntry[] {
  const all = readOutbox();
  if (all.length > 0) writeOutbox([]);
  return all;
}
