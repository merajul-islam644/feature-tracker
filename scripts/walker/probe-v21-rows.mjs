// scripts/walker/probe-v21-rows.mjs — READ-ONLY probe: Project / Environment /
// VerificationCheck / UserPreference row counts after the v2.1 deploy+migration.
// Run: node scripts/walker/probe-v21-rows.mjs
import { walkerClient } from "./auth.mjs";

const PROJECT_FIELDS = ["ItemId", "name", "status", "CreatedBy", "CreatedDate", "LastUpdatedDate"];
const ENV_FIELDS = ["ItemId", "projectId", "slug", "label", "kind", "order", "CreatedBy"];
const CHECK_FIELDS = ["ItemId", "projectId", "environmentId", "checkId", "label", "enabled", "source", "recommended"];
const PREF_FIELDS = ["ItemId", "userId", "device", "activeSession", "activeEnvironmentId", "customChecksJson"];

async function listAll(client, name, fields) {
  const col = client.data.collection(name, { fields });
  const r = await col.list({ pageNo: 1, pageSize: 200 });
  const d = r.data ?? {};
  const key = Object.keys(d).find((k) => d[k]?.items) ?? "";
  const node = key ? d[key] : {};
  return { items: node.items ?? [], totalCount: node.totalCount ?? "?" };
}

const client = await walkerClient();

const projects = await listAll(client, "Project", PROJECT_FIELDS);
console.log(`Project rows: ${projects.items.length} (totalCount=${projects.totalCount})`);
for (const p of projects.items) console.log(`  - ${p.ItemId} name=${JSON.stringify(p.name)} status=${p.status}`);

const envs = await listAll(client, "Environment", ENV_FIELDS);
console.log(`\nEnvironment rows: ${envs.items.length} (totalCount=${envs.totalCount})`);
for (const e of envs.items) console.log(`  - ${e.projectId}/${e.slug} kind=${e.kind} order=${e.order}`);

const checks = await listAll(client, "VerificationCheck", CHECK_FIELDS);
console.log(`\nVerificationCheck rows: ${checks.items.length} (totalCount=${checks.totalCount})`);

const prefs = await listAll(client, "UserPreference", PREF_FIELDS);
console.log(`\nUserPreference rows: ${prefs.items.length} (totalCount=${prefs.totalCount})`);
for (const p of prefs.items)
  console.log(`  - user=${p.userId} device=${JSON.stringify(p.device)} activeEnvId=${p.activeEnvironmentId ?? "(null)"}`);

// --- damage map ---
const MORE = [
  ["Feature", ["ItemId", "projectId", "name", "environmentId"]],
  ["Flow", ["ItemId", "projectId", "featureId", "name", "environmentId"]],
  ["VerificationTarget", ["ItemId", "projectId", "envSlug", "url"]],
  ["Secret", ["ItemId", "projectId", "envSlug", "name"]],
  ["SecretBinding", ["ItemId", "projectId", "envSlug"]],
  ["Issue", ["ItemId", "projectId", "envSlug", "title"]],
];
for (const [name, fields] of MORE) {
  try {
    const r = await listAll(client, name, fields);
    console.log(`${name}: ${r.items.length} (totalCount=${r.totalCount})`);
  } catch (e) {
    console.log(`${name}: ERROR ${String(e).slice(0, 120)}`);
  }
}
