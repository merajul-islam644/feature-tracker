// scripts/walker/data.mjs
//
// API-only read helpers the walker uses instead of navigating the UI.
// Backed by the same Blocks Data collections the app reads through
// (schema v2.1 — env identity is Environment.ItemId):
//   - Environment      → env rows {slug, label, kind, order} for a project
//   - VerificationCheck→ per-env scope rows {checkId, source, enabled}
//   - UserPreference   → activeEnvironmentId (the walker's active env)
//   - VerificationTarget → list of {url, environmentId, credentialId, …}
//   - Secret            → list of {name, email, passwordMasked, …}
//   - SecretBinding     → {secretId → targetId[]} JSON map
//
// Scoping rule (v2.1): every env-scoped row carries BOTH the legacy
// (projectId, envSlug) pair and `environmentId`. The env-scoped reads here
// filter by `environmentId` when the caller has it — env identity that
// survives slug renames — and fall back to (projectId, envSlug) otherwise,
// matching src/lib/blocks/hooks.ts. Whichever filter is sent, its fields
// MUST be in the collection's `fields` selector or the gateway silently
// drops the rows (data-gateway-filter-rule).
//
// Usage:
//   const { walkerClient, currentUserId } = await import("./auth.mjs");
//   const { fetchEnvironments, fetchVerificationChecks, fetchTargets } =
//     await import("./data.mjs");
//   const client = await walkerClient();
//   const envs = await fetchEnvironments(client, { projectId });
//   const checks = await fetchVerificationChecks(client, { projectId, environmentId });

import { walkerConfig, currentUserId } from "./auth.mjs";

const ENVIRONMENT_FIELDS = [
  "ItemId",
  "projectId",
  "slug",
  "label",
  "color",
  "order",
  "kind",
  "CreatedDate",
  "LastUpdatedDate",
];

const VERIFICATION_CHECK_FIELDS = [
  "ItemId",
  "projectId",
  "environmentId",
  "source",
  "checkId",
  "label",
  "description",
  "recommended",
  "enabled",
  "CreatedDate",
  "LastUpdatedDate",
];

const TARGET_FIELDS = [
  "ItemId",
  "applicationName",
  "url",
  "environment",
  "credentialId",
  "enabled",
  "lastVerifiedAt",
  "lastStatus",
  "projectId",
  "envSlug",
  "environmentId",
  "CreatedBy",
  "CreatedDate",
  "LastUpdatedDate",
];

const SECRET_FIELDS = [
  "ItemId",
  "projectId",
  "envSlug",
  "environmentId",
  "name",
  "email",
  "passwordMasked",
  "enabled",
  "CreatedBy",
  "CreatedDate",
  "LastUpdatedDate",
];

const SECRET_BINDING_FIELDS = [
  "ItemId",
  "projectId",
  "envSlug",
  "environmentId",
  "bindingsJson",
  "updatedBy",
  "LastUpdatedDate",
];

// Flat `{field: value}` only — operator objects are silently dropped by the
// gateway, and every field sent here is present in the selectors above.
function scopeFilter({ projectId, envSlug, environmentId } = {}) {
  if (environmentId) return { environmentId };
  if (projectId && envSlug) return { projectId, envSlug };
  return undefined;
}

/** Paginated list → flat items, via a shape fn picking the collection's
 * payload (`d?.getVerificationTargets ?? d`). */
async function listAll(col, listArgs, shape) {
  const items = [];
  let page = 1;
  while (true) {
    const r = await col.list({ ...listArgs, pageNo: page });
    const d = shape(r.data);
    items.push(...(d?.items ?? []));
    if (!d?.hasNextPage) break;
    page++;
  }
  return items;
}

/** Scope a paginated read: v2.1 `environmentId` filter first; when that
 * comes back empty but the caller has the legacy pair too, retry with
 * (projectId, envSlug) — pre-migration rows carry only the pair, with an
 * empty `environmentId`, and the strict filter silently matches nothing. */
async function listScoped(col, base, shape, scope) {
  const { projectId, envSlug, environmentId } = scope;
  const filter = scopeFilter(scope);
  let items = await listAll(col, filter ? { ...base, filter } : base, shape);
  if (items.length === 0 && environmentId && projectId && envSlug) {
    items = await listAll(
      col,
      { ...base, filter: { projectId, envSlug } },
      shape,
    );
  }
  return items;
}

/** Pull the project's env rows (blx_Environments). Ordered by `order` —
 * canonical kinds seed 0/10/20/30, customs trail. `id` is the Environment
 * ItemId — the identity every env-scoped row points at. */
export async function fetchEnvironments(client, { projectId } = {}) {
  const col = client.data.collection("Environment", {
    fields: ENVIRONMENT_FIELDS,
  });
  const items = [];
  let page = 1;
  while (true) {
    const list_args = { pageNo: page, pageSize: 100, sort: { order: 1 } };
    if (projectId) list_args.filter = { projectId };
    const r = await col.list(list_args);
    const page_items = r.data?.getEnvironments?.items ?? r.data?.items ?? [];
    items.push(...page_items);
    if (!r.data?.getEnvironments?.hasNextPage) break;
    page++;
  }
  return items.map((e) => ({
    id: e.ItemId,
    projectId: e.projectId ?? "",
    slug: e.slug ?? "",
    label: e.label ?? e.slug ?? "",
    color: e.color ?? "",
    order: Number(e.order) || 0,
    kind: e.kind ?? "custom",
    createdAt: e.CreatedDate ?? null,
  }));
}

/** Pull the per-env verification scope rows (blx_VerificationChecks).
 * One row per check per env: `source: "builtin"` mirrors the 11-id catalog,
 * `source: "custom"` carries a `custom_`-prefixed checkId. `enabled` is the
 * user's per-env selection — the walker's scope list. Replaces the legacy
 * `localStorage.lattice.verification-checks.v1` blob. */
export async function fetchVerificationChecks(
  client,
  { projectId, environmentId } = {},
) {
  const col = client.data.collection("VerificationCheck", {
    fields: VERIFICATION_CHECK_FIELDS,
  });
  const items = [];
  let page = 1;
  while (true) {
    const list_args = { pageNo: page, pageSize: 200, sort: { CreatedDate: 1 } };
    if (projectId && environmentId)
      list_args.filter = { projectId, environmentId };
    const r = await col.list(list_args);
    const page_items =
      r.data?.getVerificationChecks?.items ?? r.data?.items ?? [];
    items.push(...page_items);
    if (!r.data?.getVerificationChecks?.hasNextPage) break;
    page++;
  }
  return items.map((c) => ({
    id: c.ItemId,
    projectId: c.projectId ?? "",
    environmentId: c.environmentId ?? "",
    source: c.source === "custom" ? "custom" : "builtin",
    checkId: c.checkId ?? "",
    label: c.label ?? "",
    description: c.description ?? "",
    recommended: String(c.recommended ?? "false").toLowerCase() === "true",
    enabled: String(c.enabled ?? "false").toLowerCase() === "true",
  }));
}

/** Active env preference for the logged-in walker user (UserPreference.
 * activeEnvironmentId — the v2.1 replacement for the `__active__::` sentinel
 * SecretBinding row and the lattice.mirror.active-env.v1 mirror). Returns
 * "" when unset or unresolvable; callers fall back to asking the user. */
export async function fetchActiveEnvironmentId(client) {
  const userId = currentUserId();
  if (!userId) return "";
  const col = client.data.collection("UserPreference", {
    fields: ["ItemId", "userId", "activeEnvironmentId"],
  });
  const r = await col.list({ pageNo: 1, pageSize: 10, filter: { userId } });
  const items = r.data?.getUserPreferences?.items ?? r.data?.items ?? [];
  const row = items.find((p) => p.userId === userId) ?? items[0];
  return row?.activeEnvironmentId ?? "";
}

/** Pull all targets for an env — paginated, optionally enabled-only.
 * Scope by `environmentId` (preferred, rename-safe) or legacy
 * (projectId, envSlug). If neither resolves, lists every target the user
 * can read. */
export async function fetchTargets(
  client,
  { projectId, envSlug, environmentId, enabledOnly = true } = {},
) {
  const col = client.data.collection("VerificationTarget", {
    fields: TARGET_FIELDS,
  });
  const items = await listScoped(
    col,
    { pageSize: 100, sort: { LastUpdatedDate: -1 } },
    (d) => d?.getVerificationTargets ?? d,
    { projectId, envSlug, environmentId },
  );
  const out = items.map((t) => ({
    id: t.ItemId,
    applicationName: t.applicationName ?? "",
    url: t.url ?? "",
    environment: t.environment ?? "production",
    credentialId: t.credentialId ?? "",
    enabled: String(t.enabled ?? "true").toLowerCase() !== "false",
    lastVerifiedAt: t.lastVerifiedAt ?? null,
    lastStatus: t.lastStatus ?? null,
    projectId: t.projectId ?? "",
    envSlug: t.envSlug ?? "",
    environmentId: t.environmentId ?? "",
    createdBy: t.CreatedBy ?? null,
  }));
  return enabledOnly ? out.filter((t) => t.enabled) : out;
}

/** Pull all secrets for an env. Returns masked passwords only — the real
 * password never leaves the MCP server's process (skill rule 10). */
export async function fetchSecrets(
  client,
  { projectId, envSlug, environmentId } = {},
) {
  const col = client.data.collection("Secret", { fields: SECRET_FIELDS });
  const items = await listScoped(
    col,
    { pageSize: 100, sort: { CreatedDate: -1 } },
    (d) => d?.getSecrets ?? d,
    { projectId, envSlug, environmentId },
  );
  return items.map((s) => ({
    id: s.ItemId,
    projectId: s.projectId ?? "",
    envSlug: s.envSlug ?? "",
    environmentId: s.environmentId ?? "",
    name: s.name ?? "",
    email: s.email ?? "",
    passwordMasked: s.passwordMasked ?? "",
    // Same wire quirk as VerificationTarget.enabled — stored "true"/"false"
    // as a string; legacy rows pre-date the field.
    enabled: String(s.enabled ?? "true").toLowerCase() !== "false",
    createdBy: s.CreatedBy ?? null,
    createdAt: s.CreatedDate ?? null,
  }));
}

/** Pull the secret→target bindings JSON map for an env. */
export async function fetchSecretBindings(
  client,
  { projectId, envSlug, environmentId } = {},
) {
  const col = client.data.collection("SecretBinding", {
    fields: SECRET_BINDING_FIELDS,
  });
  const items = await listScoped(
    col,
    { pageSize: 10 },
    (d) => d?.getSecretBindings ?? d,
    { projectId, envSlug, environmentId },
  );
  if (items.length === 0) {
    return { id: "", bindings: {}, updatedBy: null };
  }
  const row = items[0];
  let bindings_map = {};
  try {
    bindings_map = JSON.parse(row.bindingsJson ?? "{}");
  } catch {
    bindings_map = {};
  }
  return {
    id: row.ItemId ?? "",
    bindings: bindings_map,
    updatedBy: row.updatedBy ?? null,
  };
}

/** One-shot helper: walker config + client + the env-scoped everything for
 * the given scope. Resolves the env row itself: pass the project id plus
 * either an `environmentId` or an env `slug` (or nothing → active-env
 * preference; if that is empty too, the returned `env` is null and the
 * caller should ask the user which env to walk). */
export async function loadWalkerContext({
  projectId,
  envSlug,
  environmentId,
} = {}) {
  const cfg = walkerConfig();
  const { walkerClient } = await import("./auth.mjs");
  const client = await walkerClient();

  const environments = projectId
    ? await fetchEnvironments(client, { projectId })
    : [];
  let activeEnvironmentId = environmentId ?? "";
  if (!activeEnvironmentId && !envSlug && projectId) {
    // No explicit scope — try the user's cross-device preference.
    activeEnvironmentId = await fetchActiveEnvironmentId(client);
  }
  const env =
    environments.find((e) => e.id === activeEnvironmentId) ??
    (envSlug ? environments.find((e) => e.slug === envSlug) : undefined) ??
    null;

  const scope = {
    projectId,
    envSlug: envSlug ?? env?.slug,
    environmentId: environmentId ?? env?.id,
  };
  const [targets, secrets, secretBindings, checks] = await Promise.all([
    fetchTargets(client, scope),
    fetchSecrets(client, scope),
    fetchSecretBindings(client, scope),
    // Scope rows only resolve once the env row is known — otherwise the
    // read would return every env's checks. Skip on unresolved env.
    env ? fetchVerificationChecks(client, scope) : Promise.resolve([]),
  ]);
  return {
    config: cfg,
    client,
    env,
    environments,
    activeEnvironmentId: env?.id ?? activeEnvironmentId,
    targets,
    secrets,
    secretBindings,
    checks,
  };
}
