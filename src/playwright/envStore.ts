/**
 * Browser-side `.env` store.
 *
 * The repo browser exposes a "Secrets · .env" panel with structured
 * key/value inputs. We persist each entry in localStorage under a
 * single key, expose them to Playwright snippets as a global named
 * `env` -- so a snippet can write `env.GITHUB_TOKEN` instead of
 * hardcoding a token into source.
 *
 * Why localStorage: secrets are per-browser, not per-session.
 * Tab close / refresh / re-open should not lose them.
 *
 * Why not IndexedDB / a real keystore: this is a developer tooling
 * surface inside a single-user starter app. localStorage is enough
 * scope for "values that the same browser can read back later" --
 * the threat model doesn't include cross-site exfiltration.
 */

const ENV_STORAGE_KEY = "blocks-app:env";

export type EnvEntry = { id: string; key: string; value: string };

/**
 * Parse `.env` text into a flat key/value record.
 *
 * Accepted shape (one entry per non-empty, non-comment line):
 *
 *   # comment
 *   KEY=value
 *   KEY="quoted value with spaces"
 *   KEY='single-quoted'
 *   KEY=               # empty value
 *
 * - Lines starting with `#` (after trimming) are skipped.
 * - Empty lines are skipped.
 * - The first `=` splits key from value.
 * - Surrounding single or double quotes are stripped from the value.
 * - Keys must match `/^[A-Za-z_][A-Za-z0-9_]*$/`. Anything else is
 *   skipped silently -- typos shouldn't take down the whole parse.
 *
 * Kept for the Playwright runner -- it still gets a flat record.
 */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!text) return out;
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2) {
      const first = value[0]!;
      const last = value[value.length - 1]!;
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1);
      }
    }
    out[key] = value;
  }
  return out;
}

/** Read the persisted env entries. Tolerates legacy text-shaped blobs. */
export function loadEntries(): EnvEntry[] {
  if (typeof window === "undefined") return [];
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(ENV_STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not valid JSON — treat the raw string as a legacy `.env` text
    // blob (pre-JSON-entries era) and import its lines.
    const record = parseEnv(raw);
    return Object.entries(record).map(([key, value]) => ({ id: makeId(), key, value }));
  }
  if (Array.isArray(parsed)) {
    return parsed
      .filter((item): item is EnvEntry =>
        item && typeof item === "object" && typeof item.key === "string" && typeof item.value === "string"
      )
      .map((item) => ({ id: typeof item.id === "string" ? item.id : makeId(), key: item.key, value: item.value }));
  }
  // Parsed JSON but the wrong shape (object / number / null) — the
  // value is structurally a JSON document, so it cannot also be a
  // legacy `.env` text dump. Treat as corrupt and return empty
  // rather than handing `parseEnv` a JSON string and silently
  // producing an empty record.
  return [];
}

/** Persist env entries. Silently ignores quota / private-mode failures. */
export function saveEntries(entries: EnvEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ENV_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // ignore
  }
}

/** Read the persisted env entries as a flat Record for the runner. */
export function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of loadEntries()) {
    if (!entry.key) continue;
    out[entry.key] = entry.value;
  }
  return out;
}

/** Wipe the persisted env entries. */
export function clearEnv(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ENV_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Stable, sortable id used as React key. Not cryptographic. */
function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}