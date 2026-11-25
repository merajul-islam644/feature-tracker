// Persistent project memory for the embedded AI panel — localStorage,
// keyed per project (same scheme as chat sessions). These are DURABLE
// facts the AI should know across sessions: project conventions, user
// preferences, past decisions. Every entry is injected into the system
// prompt on every turn, so the AI walks into each chat already knowing
// the project — never starting from zero.

export type AiMemoryEntry = {
  id: string;
  /** The fact, one sentence-ish. */
  text: string;
  createdAt: number;
};

const KEY_PREFIX = "wb-ai-memory.v1:";
const MAX_ENTRIES = 50;
const MAX_TEXT = 400;
/** System-prompt budget for the whole memory block. */
export const MEMORY_PROMPT_CAP = 4_000;

function storageKey(projectId: string): string {
  return `${KEY_PREFIX}${projectId}`;
}

export function loadMemory(projectId: string): AiMemoryEntry[] {
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is AiMemoryEntry =>
        !!entry &&
        typeof entry.id === "string" &&
        typeof entry.text === "string" &&
        typeof entry.createdAt === "number",
    );
  } catch {
    return [];
  }
}

function saveMemory(projectId: string, entries: AiMemoryEntry[]): AiMemoryEntry[] {
  const cleaned = entries.slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(storageKey(projectId), JSON.stringify(cleaned));
  } catch {
    // quota / private mode — in-memory only for this session
  }
  return cleaned;
}

/** Add one fact. Exact duplicates are ignored (the AI sometimes
 *  re-saves what it already knows); newest first; capped. */
export function addMemory(projectId: string, text: string): AiMemoryEntry[] {
  const trimmed = text.trim().slice(0, MAX_TEXT);
  if (!trimmed) return loadMemory(projectId);
  const existing = loadMemory(projectId);
  if (existing.some((entry) => entry.text.toLowerCase() === trimmed.toLowerCase())) {
    return existing;
  }
  return saveMemory(
    projectId,
    [{ id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text: trimmed, createdAt: Date.now() }, ...existing],
  );
}

export function removeMemory(projectId: string, id: string): AiMemoryEntry[] {
  return saveMemory(projectId, loadMemory(projectId).filter((entry) => entry.id !== id));
}

/** The system-prompt block — one bullet per fact, capped. Empty string
 *  when the project has no memory yet. */
export function memoryPromptBlock(entries: AiMemoryEntry[]): string {
  if (entries.length === 0) return "";
  const lines: string[] = [];
  let used = 0;
  for (const entry of entries) {
    const line = `- ${entry.text}`;
    if (used + line.length > MEMORY_PROMPT_CAP) break;
    lines.push(line);
    used += line.length;
  }
  return lines.join("\n");
}
