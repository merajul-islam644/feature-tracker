// Shared storage layer for the two notepad tools. Each tool keeps a
// separate `localStorage` key so opening Plain Text never disturbs
// Excel and vice-versa. The on-disk shape for both tools is an array
// of pads — one entry per user-created pad — keyed by `id`. Earlier
// versions of these pages used a single-object shape; the loaders
// here migrate those legacy payloads forward transparently so users
// who created a pad before the list view landed don't lose their
// work.

const TEXT_KEY = "lattice.notepad.text.v1";
const EXCEL_KEY = "lattice.notepad.excel.v1";

export interface TextPad {
  id: string;
  name: string;
  body: string;
  /** Wall-clock ms when the pad was first created. Used for sort
   *  order in the list view (newest at the bottom). */
  createdAt: number;
}

export interface ExcelPad {
  id: string;
  name: string;
  /** One row per element; cells are plain strings to avoid type
   *  coercion surprises (a user typing "1" shouldn't auto-become
   *  the number 1 with leading-zero loss). */
  grid: string[][];
  createdAt: number;
}

/** Monotonic-ish id. Combines `Date.now()` (base36) with a short
 *  random suffix so two pads created in the same millisecond don't
 *  collide. Not cryptographically secure — just unique enough for a
 *  per-browser scratchpad. */
export function genPadId(): string {
  return `pad_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function readJSON(key: string): unknown {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    return JSON.parse(raw);
  } catch {
    // Corrupted JSON / quota — fall through to "no data".
    return null;
  }
}

function writeJSON(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota / private mode — swallow; the in-memory state still
    // works for the current session.
  }
}

function isStringMatrix(value: unknown): value is string[][] {
  return (
    Array.isArray(value) &&
    value.every((row) => Array.isArray(row) && row.every((c) => typeof c === "string"))
  );
}

// Default 3×3 blank grid used both for new pads and as a fallback
// when a legacy payload has a malformed grid.
function blankGrid(): string[][] {
  return Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ""));
}

/**
 * Read all text pads from localStorage, migrating any legacy single-
 * object or bare-string payload to the current array shape. Returns
 * an empty array when the key is missing or unrecoverable.
 */
export function loadTextPads(): TextPad[] {
  const parsed = readJSON(TEXT_KEY);
  if (parsed === null) return [];

  // Current shape: array of pads.
  if (Array.isArray(parsed)) {
    const out: TextPad[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object" || !("body" in item)) continue;
      const p = item as { id?: unknown; name?: unknown; body?: unknown; createdAt?: unknown };
      out.push({
        id: typeof p.id === "string" ? p.id : genPadId(),
        name: typeof p.name === "string" ? p.name : "",
        body: typeof p.body === "string" ? p.body : "",
        createdAt:
          typeof p.createdAt === "number" ? p.createdAt : Date.now(),
      });
    }
    return out;
  }

  // Legacy single-object shape: { name, body }.
  if (typeof parsed === "object" && "body" in parsed) {
    const p = parsed as { name?: unknown; body?: unknown };
    return [
      {
        id: genPadId(),
        name: typeof p.name === "string" ? p.name : "",
        body: typeof p.body === "string" ? p.body : "",
        createdAt: Date.now(),
      },
    ];
  }

  // Legacy bare-string shape: just the body.
  if (typeof parsed === "string") {
    return [{ id: genPadId(), name: "", body: parsed, createdAt: Date.now() }];
  }

  return [];
}

export function saveTextPads(pads: TextPad[]): void {
  writeJSON(TEXT_KEY, pads);
}

/** Same as loadTextPads but for the Excel grid list. */
export function loadExcelPads(): ExcelPad[] {
  const parsed = readJSON(EXCEL_KEY);
  if (parsed === null) return [];

  // Current shape: array of pads.
  if (Array.isArray(parsed)) {
    const out: ExcelPad[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object" || !("grid" in item)) continue;
      const p = item as { id?: unknown; name?: unknown; grid?: unknown; createdAt?: unknown };
      out.push({
        id: typeof p.id === "string" ? p.id : genPadId(),
        name: typeof p.name === "string" ? p.name : "",
        grid: isStringMatrix(p.grid) ? p.grid : blankGrid(),
        createdAt:
          typeof p.createdAt === "number" ? p.createdAt : Date.now(),
      });
    }
    return out;
  }

  // Legacy single-object shape: { name, grid }.
  if (typeof parsed === "object" && "grid" in parsed) {
    const p = parsed as { name?: unknown; grid?: unknown };
    return [
      {
        id: genPadId(),
        name: typeof p.name === "string" ? p.name : "",
        grid: isStringMatrix(p.grid) ? p.grid : blankGrid(),
        createdAt: Date.now(),
      },
    ];
  }

  // Legacy bare-array shape: just the grid.
  if (isStringMatrix(parsed)) {
    return [{ id: genPadId(), name: "", grid: parsed, createdAt: Date.now() }];
  }

  return [];
}

export function saveExcelPads(pads: ExcelPad[]): void {
  writeJSON(EXCEL_KEY, pads);
}
