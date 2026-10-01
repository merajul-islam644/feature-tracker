// scripts/migrate-env-schema.mjs
//
// Schema v2.1 migration — env identity backfill. Idempotent: safe to re-run;
// every step finds its already-done work and skips it.
//
// What it does, in order:
//   1. Reads blocks/data/schemas/*.json to learn each schema's
//      requiredOn:"Both" fields (PATCHes must echo them — the requiredOn:3
//      lesson; a partial echo VALIDATION_ERRORs).
//   2. Seeds the four canonical Environment rows (dev/stg/prod/uat) for every
//      project that is missing any of them.
//   3. Expands Project.customEnvs into real Environment rows (kind "custom",
//      order past the canonical four) and applies Project.envLabelOverrides
//      onto the matching rows' labels.
//   4. Seeds the 11 builtin VerificationCheck rows for every environment
//      (enabled = recommended) that doesn't have them yet.
//   5. Stamps `environmentId` onto every legacy row that has a
//      (projectId, envSlug) but no env id yet:
//        Feature / VerificationTarget / Secret / Issue — resolved from the
//          (projectId, envSlug) map;
//        Flow — ALWAYS copied from its parent Feature (hierarchy rule);
//        SecretBinding — same pair resolution, sentinel rows skipped.
//   6. REPORTS (does not write) the `__active__::` sentinel SecretBinding
//      rows so the operator can move the active env into
//      UserPreference.activeEnvironmentId per user.
//
// Run with:
//   node scripts/migrate-env-schema.mjs --dry-run     # read-only plan (default)
//   node scripts/migrate-env-schema.mjs --apply       # write back
//
// PREREQUISITE: deploy the updated schemas first (blx_Environments +
// blx_VerificationChecks new collections, `environmentId` / `targetId` /
// `activeEnvironmentId` field additions) — before the deploy every read of
// the new fields comes back empty and every write of them 400s.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ── .env loader (matches backfill-env-scope.mjs) ──────────────────────────
function loadDotenv(path = ".env") {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotenv();

const REQUIRED_KEYS = [
  "VITE_BLOCKS_API_URL",
  "VITE_BLOCKS_OIDC_URL",
  "VITE_BLOCKS_OIDC_CLIENT_ID",
  "VITE_BLOCKS_KEY",
];
const missing = REQUIRED_KEYS.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(
    `\nMissing ${missing.length} key(s) in .env: ${missing.join(", ")}\n`,
  );
  process.exit(1);
}

const apply = process.argv.includes("--apply");
const dryRun = !apply;

// ── Bearer token (same as backfill-env-scope.mjs) ──────────────────────────
let bearerToken;
try {
  const grabModule = await import("./verify/grab-token.mjs");
  bearerToken = await grabModule.getBearerToken();
} catch (err) {
  console.error(err.message);
  process.exit(2);
}

const { createBlocksClient } = await import("@seliseblocks/client");
const client = createBlocksClient({
  apiUrl: process.env.VITE_BLOCKS_API_URL,
  oidc: {
    clientId: process.env.VITE_BLOCKS_OIDC_CLIENT_ID,
    url: process.env.VITE_BLOCKS_OIDC_URL,
  },
  xBlocksKey: process.env.VITE_BLOCKS_KEY,
  accessToken: () => Promise.resolve(bearerToken),
});

// ── Schema-driven requiredOn:"Both" lists (for PATCH echo) ─────────────────
const SCHEMAS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "blocks",
  "data",
  "schemas",
);

function bothFields(schemaName) {
  try {
    const json = JSON.parse(
      readFileSync(join(SCHEMAS_DIR, `${schemaName}.json`), "utf8"),
    );
    return json.fields
      .filter((f) => f.requiredOn === "Both")
      .map((f) => f.name);
  } catch {
    // Unknown schema — no echo list. Writes will carry only the patch, which
    // the gateway may reject with VALIDATION_ERROR; the step reports it.
    return [];
  }
}

const BOTH = Object.fromEntries(
  ["Feature", "Flow", "VerificationTarget", "Secret", "Issue", "SecretBinding"]
    .map((name) => [name, bothFields(name)]),
);

// ── Collection refs ────────────────────────────────────────────────────────
// `environmentId` MUST be in the selector: the gateway drops filter fields
// that aren't selected, and the idempotency check reads the column back.
const FIELDS = [
  "id",
  "ItemId",
  "title",
  "name",
  "applicationName",
  "url",
  "projectId",
  "envSlug",
  "environmentId",
  "featureId",
  "status",
  "enabled",
  "detectedAt",
  "bindingsJson",
  "CreatedBy",
  "CreatedDate",
  "LastUpdatedDate",
];

function collection(name, extraFields = []) {
  return client.data.collection(name, {
    fields: [...FIELDS, ...extraFields],
  });
}

async function listAll(name, extraFields = []) {
  const raw = await collection(name, extraFields).list({
    pageNo: 1,
    pageSize: 500,
  });
  const envelope = raw && typeof raw === "object" ? raw : {};
  return Array.isArray(envelope.data?.items) ? envelope.data.items :
    Array.isArray(envelope.items) ? envelope.items : [];
}

const isBlank = (v) => v === null || v === undefined || v === "";
const norm = (v) => String(v ?? "").trim().toLowerCase();

// Echo helper: a PATCH must carry every requiredOn:"Both" column or the
// gateway rejects it. Merge the patch on top of the row's current values.
function echoPatch(schemaName, row, patch) {
  const out = { ...patch };
  for (const f of BOTH[schemaName] ?? []) {
    if (out[f] === undefined) out[f] = row[f] ?? "";
  }
  return out;
}

// ── Builtin check catalog (mirrors src/data/issueTrackerConstants.ts) ──────
const BUILTIN_CHECKS = [
  { id: "page_load", label: "Page Load", description: "Pages respond and render without crashing.", recommended: true },
  { id: "navigation", label: "Navigation", description: "Links and routes reach their destinations.", recommended: true },
  { id: "buttons", label: "Buttons", description: "Clickable controls trigger their handlers.", recommended: true },
  { id: "forms", label: "Forms", description: "Inputs submit and validate correctly.", recommended: true },
  { id: "broken_links", label: "Broken Links", description: "No anchor or asset links return 404.", recommended: true },
  { id: "console_errors", label: "Console Errors", description: "No uncaught errors logged to the browser console.", recommended: true },
  { id: "network_errors", label: "Network Errors", description: "No failed XHR / fetch requests in critical paths.", recommended: true },
  { id: "authentication", label: "Authentication", description: "Login / logout flows succeed with valid credentials.", recommended: true },
  { id: "accessibility", label: "Accessibility", description: "Basic a11y: labels, contrast, keyboard reach.", recommended: false },
  { id: "performance", label: "Performance", description: "Pages reach interactive under threshold.", recommended: false },
  { id: "all_functionality", label: "All Functionality", description: "Walks every reachable page and exercises links, buttons, and forms across the whole app.", recommended: false },
];

const CANONICAL_ENVS = [
  { slug: "dev", label: "Dev", kind: "dev", order: "0" },
  { slug: "stg", label: "Stg", kind: "stg", order: "10" },
  { slug: "prod", label: "Prod", kind: "prod", order: "20" },
  { slug: "uat", label: "UAT", kind: "uat", order: "30" },
];

// ── Plan accumulator ───────────────────────────────────────────────────────
const plan = [];
let writes = 0;
function add(schemaName, itemId, label, patch) {
  writes++;
  plan.push({ schemaName, itemId, label, patch });
}
async function write(entry, row) {
  const c = collection(entry.schemaName);
  await c.update(entry.itemId, echoPatch(entry.schemaName, row, entry.patch));
}

// ── Main ───────────────────────────────────────────────────────────────────
console.log(
  `\nEnv-schema migration: ${apply ? "APPLY (will write)" : "DRY-RUN (read-only)"}\n`,
);

// Projects — customEnvs + envLabelOverrides ride along for step 3.
process.stdout.write("Loading projects… ");
const projects = await listAll("Project", ["customEnvs", "envLabelOverrides"]);
console.log(`${projects.length} project(s)`);

// Step 2+3 — Environment rows.
process.stdout.write("Loading environments… ");
const envRows = await listAll("Environment");
console.log(`${envRows.length} row(s)`);

let envCreates = 0;
const envLabelPatches = [];
const customEnvCreates = [];

for (const p of projects) {
  const projectId = p.ItemId ?? p.id;
  if (!projectId) continue;
  const mine = envRows.filter((e) => e.projectId === projectId);

  // 2. Canonical four.
  for (const seed of CANONICAL_ENVS) {
    if (mine.some((e) => norm(e.slug) === seed.slug)) continue;
    envCreates++;
    plan.push({
      create: "Environment",
      label: `${p.name ?? projectId}/${seed.slug}`,
      payload: { projectId, ...seed, color: "" },
    });
  }

  // 3a. customEnvs expansion — kind "custom", order past the max.
  let overrides = {};
  try {
    overrides = p.envLabelOverrides ? JSON.parse(p.envLabelOverrides) : {};
  } catch { /* corrupt blob — skip label overrides for this project */ }
  let customs = [];
  try {
    customs = p.customEnvs ? JSON.parse(p.customEnvs) : [];
  } catch { /* corrupt blob — skip expansion for this project */ }
  let maxOrder = mine.reduce((m, e) => Math.max(m, Number(e.order ?? 0) || 0), 30);
  for (const c of Array.isArray(customs) ? customs : []) {
    const slug = norm(c?.slug);
    if (!slug) continue;
    if (CANONICAL_ENVS.some((s) => s.slug === slug)) continue;
    if (mine.some((e) => norm(e.slug) === slug)) continue;
    maxOrder += 10;
    customEnvCreates.push(
      `  + ${p.name ?? projectId}/${slug}${c.label ? ` (${c.label})` : ""}`,
    );
    plan.push({
      create: "Environment",
      label: `${p.name ?? projectId}/${slug}`,
      payload: {
        projectId,
        slug,
        label: c.label || slug,
        color: c.color || "",
        order: String(maxOrder),
        kind: "custom",
      },
    });
  }

  // 3b. envLabelOverrides → label patch on the matching env row.
  for (const [slug, label] of Object.entries(overrides)) {
    const row = envRows.find(
      (e) => e.projectId === projectId && norm(e.slug) === norm(slug),
    );
    if (!row || !label || row.label === label) continue;
    envLabelPatches.push(`  ~ ${p.name ?? projectId}/${slug}: "${row.label}" → "${label}"`);
    plan.push({
      schemaName: "Environment",
      itemId: row.ItemId,
      label: `${p.name ?? projectId}/${slug} label`,
      patch: { label },
      row,
    });
  }
}

// Newly created envs (from the plan) join the id map so step 5 can stamp
// rows pointing at a custom env that didn't exist as a row until now.
const envIdByKey = new Map(); // `${projectId}::${slug}` → ItemId
for (const e of envRows) {
  if (e.projectId && e.slug) {
    envIdByKey.set(`${e.projectId}::${norm(e.slug)}`, e.ItemId);
  }
}
let nextCustomId = 1;
for (const entry of plan) {
  if (entry.create !== "Environment") continue;
  const key = `${entry.payload.projectId}::${norm(entry.payload.slug)}`;
  if (!envIdByKey.has(key)) {
    envIdByKey.set(key, `<<new:${nextCustomId++}>> ${entry.label}`);
  }
}

// Step 4 — builtin checks per env.
process.stdout.write("Loading verification checks… ");
let checkRows = [];
try {
  checkRows = await listAll("VerificationCheck");
} catch (err) {
  console.log(`read failed (${err.message}) — blx_VerificationChecks deployed?`);
}
console.log(`${checkRows.length} row(s)`);

let checkCreates = 0;
const envsWithoutChecks = envRows.filter(
  (e) => e.projectId && e.ItemId &&
    !checkRows.some((c) => c.environmentId === e.ItemId),
);
for (const env of envsWithoutChecks) {
  for (const check of BUILTIN_CHECKS) {
    if (
      checkRows.some(
        (c) =>
          c.environmentId === env.ItemId &&
          norm(c.checkId) === check.id,
      )
    ) continue;
    checkCreates++;
    plan.push({
      create: "VerificationCheck",
      label: `${env.slug}/${check.id}`,
      payload: {
        projectId: env.projectId,
        environmentId: env.ItemId,
        source: "builtin",
        checkId: check.id,
        label: check.label,
        description: check.description,
        recommended: String(check.recommended),
        enabled: String(check.recommended),
      },
    });
  }
}

// Step 5 — stamp environmentId.
process.stdout.write("Loading legacy rows… ");
const [features, flows, targets, secrets, issues, bindings] = await Promise.all([
  listAll("Feature"),
  listAll("Flow"),
  listAll("VerificationTarget"),
  listAll("Secret"),
  listAll("Issue"),
  listAll("SecretBinding"),
]);
console.log(
  `${features.length} feature(s), ${flows.length} flow(s), ${targets.length} target(s), ` +
    `${secrets.length} secret(s), ${issues.length} issue(s), ${bindings.length} binding(s)`,
);

function resolveEnvId(row) {
  const key = `${row.projectId}::${norm(row.envSlug)}`;
  return envIdByKey.get(key) ?? null;
}

const skipped = [];
function stamp(schemaName, row, label) {
  if (isBlank(row.environmentId) && !isBlank(row.projectId) && !isBlank(row.envSlug)) {
    const envId = resolveEnvId(row);
    if (!envId || envId.startsWith("<<new:")) {
      if (!isBlank(row.projectId) && !envId) {
        skipped.push(`  ? ${schemaName} "${label}" — no Environment row for (${row.projectId}, ${row.envSlug})`);
      }
      return; // <<new:>> ids resolve once --apply creates the env rows; re-run finishes
    }
    plan.push({
      schemaName,
      itemId: row.ItemId,
      label,
      patch: { environmentId: envId },
      row,
    });
  }
}

features.forEach((f) => stamp("Feature", f, f.title ?? f.ItemId));
// Flows ALWAYS inherit the parent feature's environmentId — never resolved
// from the flow's own slug (the hierarchy rule).
const featureEnvById = new Map(
  features.map((f) => [f.ItemId, f.environmentId || resolveEnvId(f)]),
);
for (const fl of flows) {
  if (!isBlank(fl.environmentId)) continue;
  const parentEnv = featureEnvById.get(fl.featureId);
  if (isBlank(parentEnv) || String(parentEnv).startsWith("<<new:")) {
    if (!fl.featureId) skipped.push(`  ? Flow "${fl.title ?? fl.ItemId}" — no featureId`);
    continue;
  }
  plan.push({
    schemaName: "Flow",
    itemId: fl.ItemId,
    label: fl.title ?? fl.ItemId,
    patch: { environmentId: parentEnv },
    row: fl,
  });
}
targets.forEach((t) => stamp("VerificationTarget", t, t.applicationName ?? t.ItemId));
secrets.forEach((s) => stamp("Secret", s, s.name ?? s.ItemId));
issues.forEach((i) => stamp("Issue", i, i.title ?? i.ItemId));

// SecretBinding — same pair resolution; `__active__::` sentinel rows are
// NOT touched (step 6 reports them).
const sentinelRows = [];
for (const b of bindings) {
  if (b.projectId === "__active__") {
    sentinelRows.push(b);
    continue;
  }
  stamp("SecretBinding", b, `bindings ${b.ItemId}`);
}

// ── Report ─────────────────────────────────────────────────────────────────
const creates = plan.filter((p) => p.create);
const patches = plan.filter((p) => !p.create);
const byKind = {};
for (const entry of creates) byKind[entry.create] = (byKind[entry.create] ?? 0) + 1;

console.log(`\nPlan: ${creates.length} create(s), ${patches.length} patch(es)`);
for (const [kind, n] of Object.entries(byKind)) console.log(`  create ${kind}: ${n}`);
const patchBySchema = {};
for (const entry of patches) {
  patchBySchema[entry.schemaName] = (patchBySchema[entry.schemaName] ?? 0) + 1;
}
for (const [schema, n] of Object.entries(patchBySchema)) {
  console.log(`  patch ${schema}.environmentId: ${n}`);
}
if (customEnvCreates.length) {
  console.log(`\nCustom env expansion (from Project.customEnvs):`);
  console.log(customEnvCreates.join("\n"));
}
if (envLabelPatches.length) {
  console.log(`\nLabel overrides (from Project.envLabelOverrides):`);
  console.log(envLabelPatches.join("\n"));
}
if (sentinelRows.length) {
  console.log(
    `\n⚠ ${sentinelRows.length} SecretBinding __active__:: sentinel row(s) found — ` +
      `NOT migrated automatically. The active env moves to ` +
      `UserPreference.activeEnvironmentId (per user). Set it from the app ` +
      `(env switcher) per user, then delete the sentinel row(s):`,
  );
  for (const b of sentinelRows) {
    console.log(`  - ${b.ItemId}: bindingsJson=${b.bindingsJson ?? "(empty)"}`);
  }
}
if (skipped.length) {
  console.log(`\nSkipped (no resolvable env row — check these manually):`);
  console.log(skipped.slice(0, 20).join("\n"));
  if (skipped.length > 20) console.log(`  … and ${skipped.length - 20} more`);
}

if (dryRun) {
  console.log(
    `\nDry-run complete. ${plan.length} operation(s) planned, nothing written.` +
      `\nRe-run with --apply to commit.`,
  );
  process.exit(0);
}

// ── Apply ──────────────────────────────────────────────────────────────────
console.log(`\nWriting…`);
let ok = 0;
let failed = 0;

// Creates first — patches may point at env rows that don't exist yet.
for (const entry of creates) {
  try {
    await collection(entry.create).create(entry.payload);
    ok++;
  } catch (err) {
    failed++;
    console.error(`  ✗ create ${entry.create} "${entry.label}": ${err.message}`);
  }
}
for (const entry of patches) {
  try {
    await write(entry, entry.row);
    ok++;
  } catch (err) {
    failed++;
    console.error(`  ✗ ${entry.schemaName}/${entry.itemId} (${entry.label}): ${err.message}`);
  }
}

console.log(`\nDone. OK: ${ok}, Failed: ${failed}`);
if (String(plan.some((p) => p.patch?.environmentId)?.patch?.environmentId ?? "").startsWith("<<new:")) {
  console.log(
    "Some patches referenced not-yet-created env rows — re-run the script once more to finish them.",
  );
}
console.log("");
process.exit(failed > 0 ? 1 : 0);
