// Per-(projectId, envSlug) binding store — `Secret → targetIds[]`.
//
// Why this exists: the Blocks Data gateway's ruleGroup for VerificationTarget
// silently strips `credentialId` from update mutations on env-scoped rows
// (projectId + envSlug set). Legacy unscoped rows still accept the field,
// which is why the chat/Issue Tracker UI shows "Not bound to any target"
// even after a successful addSecret flow. See memory
// `blx-notifications-server-enforcement` for the same server-side pattern
// in another collection — the ruleGroup drops fields the rule doesn't allow.
//
// Until the ruleGroup is relaxed server-side, we mirror the binding
// relationship in localStorage so the UI stays consistent. The cloud write
// is still attempted (so when the ruleGroup is fixed the canonical store
// stays in sync), but reads derive from this mirror first.
//
// Scope: bindings are keyed per (projectId, envSlug) so two open projects
// never see each other's bindings.

const STORAGE_KEY = "lattice.secret-bindings.v1";

// Per-scope binding map: secretId → targetId[].
export type SecretBindings = Record<string, string[]>;
// Top-level storage: scopeKey → SecretBindings. Loosely typed at the
// top layer because TypeScript widens `Record<string, X>` to `X` when
// the key type matches — see https://github.com/microsoft/TypeScript/issues/13050.
type StorageShape = Record<string, SecretBindings>;

function emptyShell(): StorageShape {
  return {};
}

function readAll(): StorageShape {
  if (typeof window === "undefined") return emptyShell();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyShell();
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return emptyShell();
    return parsed as StorageShape;
  } catch {
    // Corrupt JSON — start fresh. Surviving partial state isn't worth
    // crashing the page over.
    return emptyShell();
  }
}

function writeAll(state: StorageShape): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded / private mode — best effort.
  }
}

function scopeKey(
  scope: { projectId: string; envSlug: string } | null | undefined,
): string {
  if (!scope) return "__none__";
  return `${scope.projectId}::${scope.envSlug}`;
}

function readScope(state: StorageShape, key: string): SecretBindings {
  const entry = state[key];
  if (!entry || typeof entry !== "object") return {};
  // Narrow each value to string[] in case a corrupt entry slipped through.
  const result: SecretBindings = {};
  for (const [secretId, ids] of Object.entries(entry)) {
    if (Array.isArray(ids)) {
      result[secretId] = ids.filter((x): x is string => typeof x === "string");
    }
  }
  return result;
}

export function readBindings(
  scope: { projectId: string; envSlug: string } | null | undefined,
): SecretBindings {
  return readScope(readAll(), scopeKey(scope));
}

export function writeBinding(
  scope: { projectId: string; envSlug: string } | null | undefined,
  secretId: string,
  targetIds: string[],
): void {
  if (!scope) return;
  const all = readAll();
  const key = scopeKey(scope);
  const next: SecretBindings = { ...readScope(all, key) };
  if (targetIds.length === 0) {
    delete next[secretId];
  } else {
    next[secretId] = [...targetIds];
  }
  all[key] = next;
  writeAll(all);
}

export function setBinding(
  scope: { projectId: string; envSlug: string } | null | undefined,
  secretId: string,
  targetIds: string[],
): void {
  writeBinding(scope, secretId, targetIds);
}

export function removeBinding(
  scope: { projectId: string; envSlug: string } | null | undefined,
  secretId: string,
): void {
  writeBinding(scope, secretId, []);
}
