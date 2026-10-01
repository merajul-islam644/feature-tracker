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

// ── Bearer token ───────────────────────────────────────────────────────────
// Preferred: the browser session (verify/grab-token.mjs). Fallback: the
// walker's programmatic IAM login (walker/auth.mjs — creds live in the
// gitignored scripts/walker/.env.local, same source dev-walk uses). Both
// produce a bearer for the same tenant (VITE_BLOCKS_KEY).
let bearerToken;
let tokenSource = "browser";
try {
  const grabModule = await import("./verify/grab-token.mjs");
  bearerToken = await grabModule.getBearerToken();
} catch {
  console.error("[token] no browser cookie — using walker IAM login fallback");
  tokenSource = "walker";
  const walker = await import("./walker/auth.mjs");
  bearerToken = await walker.freshAccessToken();
}

const { createBlocksClient } = await import("@seliseblocks/client");
const client = createBlocksClient({
  apiUrl: process.env.VITE_BLOCKS_API_URL,
  oidc: {
    clientId: process.env.VITE_BLOCKS_OIDC_CLIENT_ID,
    url: process.env.VITE_BLOCKS_OIDC_URL,
    // Required outside a browser (the SDK throws without it in node) —
    // same callback the app itself uses; walker/auth.mjs does the same.
    redirectUri: "https://dbeegi.slsblx.com/login/callback",
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

// Field names straight from the authored schema JSONs — the source of truth
// we pushed to the tenant, so these are guaranteed-valid projection columns.
function schemaFieldNames(schemaName) {
  try {
    const json = JSON.parse(
      readFileSync(join(SCHEMAS_DIR, `${schemaName}.json`), "utf8"),
    );
    return json.fields.map((f) => f.name);
  } catch {
    return [];
  }
}

const ALL_STAMPED_SCHEMAS = [
  "Project",
  "Environment",
  "VerificationCheck",
  "Feature",
  "Flow",
  "VerificationTarget",
  "Secret",
  "Issue",
  "SecretBinding",
];

// ── Collection refs ────────────────────────────────────────────────────────
// Per-schema selectors — the gateway rejects a projection naming a field
// another schema owns ("Field `title` does not exist on type `Project`"),
// so every collection lists exactly its own columns. We select ALL of the
// schema's fields (not just the ones we stamp): the gateway validates every
// update against the live schema's required-on-update fields, and those
// required columns must ride along on the echo (see echoPatch).
const SELECTORS = Object.fromEntries(
  ALL_STAMPED_SCHEMAS.map((name) => [name, ["ItemId", ...schemaFieldNames(name)]]),
);

function collection(name) {
  return client.data.collection(name, { fields: SELECTORS[name] ?? ["ItemId"] });
}

async function listAll(name) {
  const raw = await collection(name).list({
    pageNo: 1,
    pageSize: 500,
  });
  const envelope = raw && typeof raw === "object" ? raw : {};
  // The SDK wraps lists GraphQL-style: { data: { get<Plural>: { items } } }.
  // Walk one level under `data` and take the first object with an items
  // array, so a gateway envelope change can't zero every collection again.
  const d = envelope.data;
  if (Array.isArray(d?.items)) return d.items;
  if (Array.isArray(envelope.items)) return envelope.items;
  if (d && typeof d === "object") {
    for (const v of Object.values(d)) {
      if (v && typeof v === "object" && Array.isArray(v.items)) return v.items;
    }
  }
  return [];
}

const isBlank = (v) => v === null || v === undefined || v === "";
const norm = (v) => String(v ?? "").trim().toLowerCase();

// Echo helper: a PATCH must carry every requiredOn:"Both" column or the
// gateway rejects it. Merge the patch on top of the row's current values.
function echoPatch(schemaName, row, patch) {
  // The gateway validates every update against the LIVE schema's
  // required-on-update fields — a set far broader than any local "Both" list
  // (Feature needs status; Secret needs email+passwordMasked; Issue needs
  // applicationName/url/category/severity/…). Missing any one of them fails
  // the whole mutation with VALIDATION_ERROR while the SDK still resolves,
  // so echo EVERY column the row read back with; the patch always wins.
  void schemaName;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === "ItemId") continue;
    out[k] = v ?? "";
  }
  return { ...out, ...patch };
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

// ── Main ───────────────────────────────────────────────────────────────────
console.log(
  `\nEnv-schema migration: ${apply ? "APPLY (will write)" : "DRY-RUN (read-only)"}\n`,
);

// Projects — customEnvs + envLabelOverrides ride along for step 3.
process.stdout.write("Loading projects… ");
const projects = await listAll("Project");
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
// Placeholder values carry their env key so the apply phase can swap in
// the real ItemId right after the create lands (single-pass apply).
const envIdByKey = new Map(); // `${projectId}::${slug}` → ItemId | `<<envkey:…>>`
for (const e of envRows) {
  if (e.projectId && e.slug) {
    envIdByKey.set(`${e.projectId}::${norm(e.slug)}`, e.ItemId);
  }
}
for (const entry of plan) {
  if (entry.create !== "Environment") continue;
  const key = `${entry.payload.projectId}::${norm(entry.payload.slug)}`;
  if (!envIdByKey.has(key)) envIdByKey.set(key, `<<envkey:${key}>>`);
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
  if (!isBlank(row.environmentId) || isBlank(row.projectId) || isBlank(row.envSlug)) {
    return;
  }
  const envId = resolveEnvId(row);
  if (!envId) {
    skipped.push(
      `  ? ${schemaName} "${label}" — no Environment row for (${row.projectId}, ${row.envSlug})`,
    );
    return;
  }
  // envId may be a `<<envkey:…>>` placeholder for an env this same run is
  // about to create — the apply phase resolves it to the real ItemId.
  plan.push({
    schemaName,
    itemId: row.ItemId,
    label,
    patch: { environmentId: envId },
    row,
  });
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
  if (!parentEnv) {
    skipped.push(
      fl.featureId
        ? `  ? Flow "${fl.title ?? fl.ItemId}" — parent feature has no resolvable env`
        : `  ? Flow "${fl.title ?? fl.ItemId}" — no featureId`,
    );
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

// Pull the new ItemId out of an insert envelope
// ({ data: { insert<Schema>: { acknowledged, itemId, … } } }).
function extractItemId(response) {
  const d = response?.data;
  if (d && typeof d === "object") {
    for (const v of Object.values(d)) {
      if (v && typeof v === "object" && typeof v.itemId === "string") {
        return v.itemId;
      }
    }
  }
  return null;
}

const envKeyOf = (payload) => `${payload.projectId}::${norm(payload.slug)}`;
const createdEnvIds = new Map(); // env key → real ItemId, filled as creates land
const patchResponses = [];

// Creates first — patches may point at env rows that don't exist yet.
for (const entry of creates) {
  try {
    const resp = await collection(entry.create).create(entry.payload);
    if (entry.create === "Environment") {
      const itemId = extractItemId(resp);
      if (itemId) createdEnvIds.set(envKeyOf(entry.payload), itemId);
    }
    ok++;
  } catch (err) {
    failed++;
    console.error(`  ✗ create ${entry.create} "${entry.label}": ${err.message}`);
  }
}

// Swap `<<envkey:…>>` placeholders for real ids — env rows this run just
// created win; rows that already existed are in envIdByKey.
function resolveVal(v) {
  if (typeof v === "string" && v.startsWith("<<envkey:") && v.endsWith(">>")) {
    const key = v.slice("<<envkey:".length, -2);
    return createdEnvIds.get(key) ?? envIdByKey.get(key) ?? null;
  }
  return v;
}

for (const entry of patches) {
  try {
    const patch = Object.fromEntries(
      Object.entries(entry.patch).map(([k, v]) => [k, resolveVal(v)]),
    );
    if (Object.values(patch).some((v) => v === null || v === undefined)) {
      failed++;
      console.error(
        `  ✗ ${entry.schemaName}/${entry.itemId} (${entry.label}): env row still missing — re-run the script`,
      );
      continue;
    }
    const resp = await collection(entry.schemaName).update(
      entry.itemId,
      echoPatch(entry.schemaName, entry.row, patch),
    );
    ok++;
    // The gateway reports per-mutation outcome inside the payload
    // (acknowledged/message/totalImpactedData) WITHOUT a GraphQL error, so
    // the SDK resolves silently even when nothing was written. Capture the
    // raw shapes for the diagnosis section below.
    const d = resp?.data;
    const payload =
      d && typeof d === "object"
        ? Object.values(d).find((v) => v && typeof v === "object")
        : null;
    patchResponses.push({
      schemaName: entry.schemaName,
      itemId: entry.itemId,
      payload,
      raw: resp,
    });
  } catch (err) {
    failed++;
    console.error(`  ✗ ${entry.schemaName}/${entry.itemId} (${entry.label}): ${err.message}`);
  }
}

// Per-schema ack/impact tally + raw payload of any suspicious write, so a
// silent no-op (ack=true but 0 rows impacted, or ack=false) is visible.
const tally = {};
for (const r of patchResponses) {
  const t = (tally[r.schemaName] ??= { ack: 0, notAck: 0, zeroImpact: 0, sample: null });
  if (r.payload?.acknowledged === true) t.ack++;
  else t.notAck++;
  if (Number(r.payload?.totalImpactedData ?? 0) === 0) t.zeroImpact++;
  if (!t.sample && (r.payload?.acknowledged !== true || Number(r.payload?.totalImpactedData ?? 0) === 0)) {
    t.sample = r;
  }
}
for (const [schema, t] of Object.entries(tally)) {
  console.log(
    `  ${schema}: ack=${t.ack} notAck=${t.notAck} zeroImpact=${t.zeroImpact}`,
  );
  if (t.sample) {
    console.log(`    sample: ${JSON.stringify(t.sample.raw ?? t.sample)?.slice(0, 600)}`);
  }
}

console.log(`\nDone. OK: ${ok}, Failed: ${failed}`);
if (failed > 0) {
  console.log("Fix the failures above and re-run — the script is idempotent.");
}
console.log("");
process.exit(failed > 0 ? 1 : 0);
