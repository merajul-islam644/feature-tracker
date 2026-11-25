// Persistence for the embedded AI panel's chat sessions — localStorage,
// keyed per project. Sessions survive reloads and can be restored,
// switched and deleted from the panel's menu (the way real AI chat
// panels keep a conversation history).

export type ChatEntry =
  | {
      role: "user";
      text: string;
      /** Arrival time (epoch ms) — rendered under the bubble. */
      ts?: number;
    }
  | {
      role: "assistant";
      text: string;
      streaming?: boolean;
      /** Arrival time (epoch ms) — first delta (or finalize) moment. */
      ts?: number;
      /** Whole-turn wall time on the FINAL bubble of a send. */
      durationMs?: number;
    }
  | { role: "activity"; text: string }
  /** Collapsible "Thought" row — the model's interim plan text. */
  | { role: "thought"; text: string; seconds: number };

export type AiHistoryEntry = { role: "user" | "assistant"; content: string };

export type AiSession = {
  id: string;
  /** Auto-titled from the first user prompt. */
  title: string;
  createdAt: number;
  updatedAt: number;
  entries: ChatEntry[];
  history: AiHistoryEntry[];
};

const KEY_PREFIX = "wb-ai-sessions.v1:";
const MAX_SESSIONS = 20;
const MAX_ENTRIES = 200;

function storageKey(projectId: string): string {
  return `${KEY_PREFIX}${projectId}`;
}

export function loadSessions(projectId: string): AiSession[] {
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (session): session is AiSession =>
          typeof session?.id === "string" &&
          typeof session?.title === "string" &&
          Array.isArray(session?.entries),
      )
      .slice(0, MAX_SESSIONS);
  } catch {
    return [];
  }
}

export function saveSessions(projectId: string, sessions: AiSession[]): void {
  try {
    localStorage.setItem(
      storageKey(projectId),
      JSON.stringify(sessions.slice(0, MAX_SESSIONS)),
    );
  } catch {
    // quota / private mode — in-memory only for this session
  }
}

export function newSessionId(): string {
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function titleFromPrompt(prompt: string): string {
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  return trimmed.length > 42 ? `${trimmed.slice(0, 42)}…` : trimmed || "New chat";
}

/** Trim a session's entry list so ancient chats can't blow the quota. */
function clampEntries(session: AiSession): AiSession {
  return session.entries.length > MAX_ENTRIES
    ? { ...session, entries: session.entries.slice(session.entries.length - MAX_ENTRIES) }
    : session;
}

export function upsertSession(projectId: string, session: AiSession): AiSession[] {
  const sessions = loadSessions(projectId).filter((entry) => entry.id !== session.id);
  const next = [{ ...clampEntries(session), updatedAt: Date.now() }, ...sessions];
  // Drop welcome-only husks: panel mounts create a 1-entry session that
  // would otherwise become the "newest" and hijack every restore.
  const cleaned = next.filter((entry) => entry.entries.some((e) => e.role === "user"));
  saveSessions(projectId, cleaned);
  return cleaned;
}

export function deleteSession(projectId: string, sessionId: string): AiSession[] {
  const sessions = loadSessions(projectId).filter((entry) => entry.id !== sessionId);
  saveSessions(projectId, sessions);
  return sessions;
}
