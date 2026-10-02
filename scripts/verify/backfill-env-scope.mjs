// scripts/verify/backfill-env-scope.mjs
//
// One-shot migration: find every row in VerificationTarget / Secret / Issue /
// Feature whose projectId + envSlug are both NULL (pre-commit-2206831 data)
// and ask the operator which (projectId, envSlug) to stamp onto them.
//
// Run with:
//   npx tsx scripts/verify/backfill-env-scope.mjs --dry-run     # list only
//   npx tsx scripts/verify/backfill-env-scope.mjs --apply       # write back
//
// `--apply` is REQUIRED to mutate. Without it, the script only reads.
//
// Interactive: the script reads your known projects from cloud and shows
// you a numbered list. You pick the (projectId, envSlug) once and every
// legacy row gets stamped with that pair. If you have rows that span
// multiple (project, env) tuples, run the script multiple times — each
// run writes ONE assignment.
//
// Reads from the same env (.env) and browser cookie store as
// list-targets.mjs. Make sure your browser is closed before running.

import { readFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

// ── .env loader (matches list-targets.mjs) ────────────────────────────────
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
  console.error(`\nMissing ${missing.length} key(s) in .env: ${missing.join(", ")}\n`);
  process.exit(1);
}

const apply = process.argv.includes("--apply");
const dryRun = !apply;

// ── Bearer token (same as list-targets.mjs) ────────────────────────────────
let bearerToken;
try {
  const grabModule = await import("./grab-token.mjs");
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

// ── Collection refs ────────────────────────────────────────────────────────
const COLLECTIONS = ["VerificationTarget", "Secret", "Issue", "Feature"];
const FIELDS = [
  "id",
  "ItemId",
  "applicationName",
  "name",
  "title",
  "url",
  "projectId",
  "envSlug",
  "CreatedBy",
  "CreatedDate",
  "LastUpdatedDate",
];

// ── Helpers ────────────────────────────────────────────────────────────────
async function listLegacyRows(name) {
  const collection = client.data.collection(name, { fields: FIELDS });
  const raw = await collection.list({ pageNo: 1, pageSize: 500 });
  const envelope = raw && typeof raw === "object" ? raw : {};
  const items =
    Array.isArray(envelope.data?.items) ? envelope.data.items :
    Array.isArray(envelope.items) ? envelope.items : [];
  // Legacy = both projectId AND envSlug are null/undefined/empty.
  return items.filter((r) => {
    const pid = r.projectId ?? null;
    const env = r.envSlug ?? null;
    return (pid === null || pid === undefined || pid === "") &&
           (env === null || env === undefined || env === "");
  });
}

async function listProjects() {
  const collection = client.data.collection("Project", {
    fields: ["id", "name", "status"],
  });
  const raw = await collection.list({ pageNo: 1, pageSize: 100 });
  const envelope = raw && typeof raw === "object" ? raw : {};
  const items =
    Array.isArray(envelope.data?.items) ? envelope.data.items :
    Array.isArray(envelope.items) ? envelope.items : [];
  return items.map((p) => ({
    id: p.ItemId ?? p.id ?? "",
    name: p.name ?? "(unnamed)",
  }));
}

async function patchRow(name, itemId, patch) {
  const collection = client.data.collection(name, { fields: FIELDS });
  // Blocks Data SDK exposes an update via mutation; the portable shape
  // varies by gateway version. The schema allows updating individual
  // primitive fields, and `projectId` / `envSlug` are simple strings.
  // We use the SDK's generic update path:
  //
  // NOTE (enabled field, 2026-10-02): once Secret.json's `enabled` column
  // (requiredOn "Both") is deployed, this patch-only update will 400 on
  // Secret rows with VALIDATION_ERROR — every required column must ride
  // along. migrate-env-schema.mjs's echoPatch is the reference pattern;
  // re-derive from it if this one-shot ever needs to run again.
  return collection.update(itemId, patch);
}

// ── Main ───────────────────────────────────────────────────────────────────
console.log(`\nBackfill: ${apply ? "APPLY (will write)" : "DRY-RUN (read-only)"}\n`);

const rl = createInterface({ input, output });
let totalLegacy = 0;
const allLegacy = {};

for (const name of COLLECTIONS) {
  process.stdout.write(`Scanning ${name}… `);
  let rows;
  try {
    rows = await listLegacyRows(name);
  } catch (err) {
    console.error(`failed: ${err.message}`);
    continue;
  }
  console.log(`${rows.length} legacy row(s)`);
  allLegacy[name] = rows;
  totalLegacy += rows.length;
}

if (totalLegacy === 0) {
  console.log("\nNo legacy rows found — nothing to backfill.\n");
  process.exit(0);
}

console.log(`\nTotal legacy rows: ${totalLegacy}`);
for (const name of COLLECTIONS) {
  const rows = allLegacy[name];
  if (rows.length === 0) continue;
  console.log(`\n${name}:`);
  for (const r of rows.slice(0, 10)) {
    const label = r.applicationName || r.name || r.title || "(unnamed)";
    console.log(`  - ${r.ItemId ?? r.id}  ${label}`);
  }
  if (rows.length > 10) console.log(`  … and ${rows.length - 10} more`);
}

const projects = await listProjects();
if (projects.length === 0) {
  console.error("\nNo projects found — create a project first via the app UI.\n");
  process.exit(1);
}

console.log("\nAvailable projects:");
projects.forEach((p, i) => console.log(`  [${i + 1}] ${p.name}  (${p.id})`));

const envChoices = ["dev", "stg", "uat", "prod"];
console.log("\nAvailable env slugs: " + envChoices.join(", ") + ", or any custom slug you've added.");

const projectIdxStr = await rl.question("\nPick project (number): ");
const projectIdx = parseInt(projectIdxStr, 10) - 1;
if (Number.isNaN(projectIdx) || projectIdx < 0 || projectIdx >= projects.length) {
  console.error("Invalid project index.");
  process.exit(1);
}
const projectId = projects[projectIdx].id;

const envSlug = (await rl.question("Pick envSlug: ")).trim();
if (!envSlug) {
  console.error("envSlug required.");
  process.exit(1);
}

rl.close();

console.log(`\nWill stamp every legacy row above with projectId=${projectId}, envSlug=${envSlug}.`);
if (!apply) {
  console.log("\nRe-run with --apply to commit. Nothing was written.");
  process.exit(0);
}

console.log("\nWriting…");
let patched = 0;
let failed = 0;
for (const name of COLLECTIONS) {
  for (const row of allLegacy[name]) {
    const itemId = row.ItemId ?? row.id;
    if (!itemId) continue;
    try {
      await patchRow(name, itemId, { projectId, envSlug });
      patched++;
      console.log(`  ✓ ${name}/${itemId}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${name}/${itemId}: ${err.message}`);
    }
  }
}

console.log(`\nDone. Patched: ${patched}, Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
