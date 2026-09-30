// scripts/walker/data.mjs
//
// API-only read helpers the walker uses instead of navigating the UI.
// Backed by the same Blocks Data collections the app reads through:
//   - VerificationTarget → list of {url, environment, credentialId, …}
//   - Secret            → list of {name, email, passwordMasked, …}
//   - SecretBinding     → {secretId → targetId[]} JSON map
//
// All three are scoped by (projectId, envSlug); the walker passes the
// active env's scope and lets the server narrow the result set — same
// shape as src/lib/blocks/hooks.ts:5280..5348.
//
// Usage:
//   const { walkerClient } = await import("./auth.mjs");
//   const { fetchTargets, fetchSecrets, fetchSecretBindings } =
//     await import("./data.mjs");
//   const client = await walkerClient();
//   const targets = await fetchTargets(client, { projectId, envSlug });

import { walkerConfig } from "./auth.mjs";

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
  "CreatedBy",
  "CreatedDate",
  "LastUpdatedDate",
];

const SECRET_FIELDS = [
  "ItemId",
  "projectId",
  "envSlug",
  "name",
  "email",
  "passwordMasked",
  "CreatedBy",
  "CreatedDate",
  "LastUpdatedDate",
];

const SECRET_BINDING_FIELDS = [
  "ItemId",
  "projectId",
  "envSlug",
  "bindingsJson",
  "updatedBy",
  "LastUpdatedDate",
];

/** Pull all targets for a (projectId, envSlug) — paginated, optionally enabled-only.
 * If projectId/envSlug are both falsy, lists every target the user can read. */
export async function fetchTargets(client, { projectId, envSlug, enabledOnly = true } = {}) {
  const col = client.data.collection("VerificationTarget", { fields: TARGET_FIELDS });
  const items = [];
  let page = 1;
  while (true) {
    const list_args = { pageNo: page, pageSize: 100, sort: { LastUpdatedDate: -1 } };
    if (projectId && envSlug) list_args.filter = { projectId, envSlug };
    const r = await col.list(list_args);
    const page_items = r.data?.getVerificationTargets?.items ?? r.data?.items ?? [];
    items.push(...page_items);
    if (!r.data?.getVerificationTargets?.hasNextPage) break;
    page++;
  }
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
    createdBy: t.CreatedBy ?? null,
  }));
  return enabledOnly ? out.filter((t) => t.enabled) : out;
}

/** Pull all secrets for a (projectId, envSlug). Returns masked passwords only — real password never leaves the user's browser. */
export async function fetchSecrets(client, { projectId, envSlug } = {}) {
  const col = client.data.collection("Secret", { fields: SECRET_FIELDS });
  const items = [];
  let page = 1;
  while (true) {
    const list_args = { pageNo: page, pageSize: 100, sort: { CreatedDate: -1 } };
    if (projectId && envSlug) list_args.filter = { projectId, envSlug };
    const r = await col.list(list_args);
    const page_items = r.data?.getSecrets?.items ?? r.data?.items ?? [];
    items.push(...page_items);
    if (!r.data?.getSecrets?.hasNextPage) break;
    page++;
  }
  return items.map((s) => ({
    id: s.ItemId,
    projectId: s.projectId ?? "",
    envSlug: s.envSlug ?? "",
    name: s.name ?? "",
    email: s.email ?? "",
    passwordMasked: s.passwordMasked ?? "",
    createdBy: s.CreatedBy ?? null,
    createdAt: s.CreatedDate ?? null,
  }));
}

/** Pull the secret→target bindings JSON map for a (projectId, envSlug). */
export async function fetchSecretBindings(client, { projectId, envSlug } = {}) {
  const col = client.data.collection("SecretBinding", { fields: SECRET_BINDING_FIELDS });
  const list_args = { pageNo: 1, pageSize: 10 };
  if (projectId && envSlug) list_args.filter = { projectId, envSlug };
  const r = await col.list(list_args);
  const items = r.data?.getSecretBindings?.items ?? r.data?.items ?? [];
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
    projectId: row.projectId ?? "",
    envSlug: row.envSlug ?? "",
    bindings: bindings_map,
    updatedBy: row.updatedBy ?? null,
  };
}

/** One-shot helper: walker config + client + all three fetches for the given scope. */
export async function loadWalkerContext({ projectId, envSlug } = {}) {
  const cfg = walkerConfig();
  const { walkerClient } = await import("./auth.mjs");
  const client = await walkerClient();
  const [targets, secrets, secretBindings] = await Promise.all([
    fetchTargets(client, { projectId, envSlug }),
    fetchSecrets(client, { projectId, envSlug }),
    fetchSecretBindings(client, { projectId, envSlug }),
  ]);
  return {
    config: cfg,
    client,
    targets,
    secrets,
    secretBindings,
  };
}