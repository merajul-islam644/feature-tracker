// Per-(projectId, envSlug) binding store — `Secret → targetIds[]`.
//
// Why this exists: the Blocks Data gateway's ruleGroup for VerificationTarget
// silently strips `credentialId` from update mutations on env-scoped rows
// (projectId + envSlug set). Legacy unscoped rows still accept the field,
// which is why the chat/Issue Tracker UI shows "Not bound to any target"
// even after a successful addSecret flow. See memory
// `verification-target-credentialid-rulegroup-strip` for the same server-side
// pattern in another collection — the ruleGroup drops fields the rule
// doesn't allow.
//
// Storage choice (v2): the canonical binding map lives in
// `blx_SecretBindings` (one row per `(projectId, envSlug)`, `bindingsJson`
// carries `JSON.stringify(Record<secretId, targetId[]>)`). The cloud write
// is still attempted so when the ruleGroup is relaxed the canonical store
// stays in sync — until then we read+write through here.
//
// A `lattice.mirror.secretBindings.v1` mirror under the same shape is
// written synchronously on each save so cold-boot reads it before the
// cloud query resolves.
//
// Scope: bindings are keyed per (projectId, envSlug) so two open projects
// never see each other's bindings.

const MIRROR_KEY = "lattice.mirror.secretBindings.v1";

// Per-scope binding map: secretId → targetId[].
export type SecretBindings = Record<string, string[]>;
// Top-level storage: scopeKey → SecretBindings. Loosely typed at the
// top layer because TypeScript widens `Record<string, X>` to `X` when
// the key type matches — see https://github.com/microsoft/TypeScript/issues/13050.
type MirrorShape = Record<string, SecretBindings>;

function emptyMirror(): MirrorShape {
  return {};
}

function readMirror(): MirrorShape {
  if (typeof window === "undefined") return emptyMirror();
  try {
    const raw = window.localStorage.getItem(MIRROR_KEY);
    if (!raw) return emptyMirror();
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return emptyMirror();
    return parsed as MirrorShape;
  } catch {
    return emptyMirror();
  }
}

function writeMirror(state: MirrorShape): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MIRROR_KEY, JSON.stringify(state));
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

function readScopeMirror(
  state: MirrorShape,
  key: string,
): SecretBindings {
  const entry = state[key];
  if (!entry || typeof entry !== "object") return {};
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
  return readScopeMirror(readMirror(), scopeKey(scope));
}

export function writeMirrorBinding(
  scope: { projectId: string; envSlug: string } | null | undefined,
  secretId: string,
  targetIds: string[],
): void {
  if (!scope) return;
  const all = readMirror();
  const key = scopeKey(scope);
  const next: SecretBindings = { ...readScopeMirror(all, key) };
  if (targetIds.length === 0) {
    delete next[secretId];
  } else {
    next[secretId] = [...targetIds];
  }
  all[key] = next;
  writeMirror(all);
}

/**
 * Replace the entire binding map for a scope in the localStorage mirror.
 * Used by callers that already hold the full map (e.g. the
 * `useSaveSecretBindings` cloud hook's optimistic update).
 */
export function writeMirrorBindings(
  scope: { projectId: string; envSlug: string } | null | undefined,
  bindings: SecretBindings,
): void {
  if (!scope) return;
  const all = readMirror();
  all[scopeKey(scope)] = bindings;
  writeMirror(all);
}

// Stable equality for two binding maps. Order within the target-id arrays
// is ignored — `["t1","t2"]` and `["t2","t1"]` describe the same binding
// and would otherwise make the cloud-sync effect at `useIssueTracker.ts:461`
// bump `bindingVersion` on every round-trip, which re-fires the cloud
// write effect at `:490`, which invalidates `useSecretBindings`, which
// refetches with a fresh `LastUpdatedDate`, which fires `:461` again —
// the binding feedback loop. See the verification report from 2026-09-29.
//
// Returns true when both maps have the same secretIds, each with the
// same target-id set (order-independent). Empty vs missing is treated as
// equal — `readBindings` always returns `{}` for an unknown scope, so an
// empty cloud row and an absent local row are the same state.
export function bindingsEqual(a: SecretBindings, b: SecretBindings): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!(k in b)) return false;
    const aIds = a[k];
    const bIds = b[k];
    if (!Array.isArray(aIds) || !Array.isArray(bIds)) return false;
    if (aIds.length !== bIds.length) return false;
    const aSet = new Set(aIds);
    for (const id of bIds) {
      if (!aSet.has(id)) return false;
    }
  }
  return true;
}

export function setBinding(
  scope: { projectId: string; envSlug: string } | null | undefined,
  secretId: string,
  targetIds: string[],
): void {
  writeMirrorBinding(scope, secretId, targetIds);
}

export function removeBinding(
  scope: { projectId: string; envSlug: string } | null | undefined,
  secretId: string,
): void {
  writeMirrorBinding(scope, secretId, []);
}
