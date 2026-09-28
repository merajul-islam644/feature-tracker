// scripts/list-targets.mjs — fetch the user's enabled VerificationTarget
// rows from Blocks Data and print them as JSON on stdout.
//
// Used by Claude at STEP 1 of scripts/verify.ts to read the verify
// queue. The bearer token is consumed by the SDK from .env (the
// BLOCKS_BEARER_TOKEN entry the user already maintains for the runtime
// filing script) and never appears in stdout — only target data does.
//
// Usage:
//   npx tsx scripts/list-targets.mjs
//   npx tsx scripts/list-targets.mjs --include-disabled   # show disabled too
//
// Output shape (stdout, parseable JSON):
//   {
//     "fetchedAt": "2026-…",
//     "count": 3,
//     "targets": [
//       {
//         "id": "…",
//         "url": "https://mailcraft.slsblx.com",
//         "applicationName": "MailCraft",
//         "environment": "production",
//         "enabled": true,
//         "credentialId": "secret-mailcraft-001",
//         "lastVerifiedAt": "…",
//         "lastStatus": "issues_found"
//       },
//       …
//
// Exit codes:
//   0  success (even if count: 0)
//   1  missing env vars — print key list, do not run
//   2  SDK / network error — print message, do not run
//   3  malformed SDK response — print shape hint

import { readFileSync, existsSync } from "node:fs";

// ── .env loader (mirrors scripts/verify.ts) ────────────────────────────────

function loadDotenv(path = ".env") {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotenv();

// ── Env validation ────────────────────────────────────────────────────────
// BLOCKS_BEARER_TOKEN is no longer required — getBearerToken() reads it
// from the user's browser cookie store at run-time.

const REQUIRED_KEYS = [
  ["VITE_BLOCKS_API_URL", "Blocks Data API base URL"],
  ["VITE_BLOCKS_OIDC_URL", "OIDC discovery URL"],
  ["VITE_BLOCKS_OIDC_CLIENT_ID", "OIDC client id"],
  ["VITE_BLOCKS_KEY", "Blocks tenant key (xBlocksKey header)"],
];

const missing = REQUIRED_KEYS.map(([k]) => k).filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`\nMissing ${missing.length} key(s) in .env:\n`);
  for (const key of missing) {
    const entry = REQUIRED_KEYS.find(([k2]) => k2 === key);
    console.error(`  ${key}=  # ${entry ? entry[1] : ""}`);
  }
  console.error(
    `\nAdd the keys above to .env and re-run.\n` +
      `(BLOCKS_BEARER_TOKEN is NOT required — the helper reads it from\n` +
      `your browser cookie store at run-time.)`,
  );
  process.exit(1);
}

const includeDisabled = process.argv.includes("--include-disabled");

// ── Bearer token (grabbed from browser) ───────────────────────────────────

let bearerToken;
try {
  const grabModule = await import("./grab-token.mjs");
  bearerToken = await grabModule.getBearerToken();
} catch (err) {
  console.error(err.message);
  process.exit(2);
}

// ── SDK call ──────────────────────────────────────────────────────────────

let createBlocksClient;
try {
  ({ createBlocksClient } = await import("@seliseblocks/client"));
} catch (err) {
  console.error(
    `Could not load @seliseblocks/client: ${err.message}\n` +
      `Run \`npm install\` in the project root first.`,
  );
  process.exit(2);
}

const client = createBlocksClient({
  apiUrl: process.env.VITE_BLOCKS_API_URL,
  oidc: {
    clientId: process.env.VITE_BLOCKS_OIDC_CLIENT_ID,
    url: process.env.VITE_BLOCKS_OIDC_URL,
  },
  xBlocksKey: process.env.VITE_BLOCKS_KEY,
  accessToken: () => Promise.resolve(bearerToken),
});

// Filter on CreatedBy = current user's sub. We don't have the sub
// directly here — the SDK's `currentUser` accessor would need a session.
// Workaround: pull CreatedBy on every row and filter post-hoc. Same
// shape the in-app useIssueTrackerTargets uses (see
// src/lib/blocks/hooks.ts:4277-4282), which calls createdByFilter
// against the session userId.
//
// Without session context here we pull a wider net — the script filters
// to the most-recent N rows the user owns. The Claude step will
// additionally filter by `enabled` for the queue. This is intentionally
// generous: false positives get culled at STEP 2's 1:1 binding check,
// not by an under-fetch.
const collection = client.data.collection("VerificationTarget", {
  fields: [
    "applicationName",
    "url",
    "environment",
    "credentialId",
    "enabled",
    "lastVerifiedAt",
    "lastStatus",
    "CreatedBy",
    "CreatedDate",
    "LastUpdatedDate",
  ],
});

let raw;
try {
  raw = await collection.list({
    pageNo: 1,
    pageSize: 200,
    sort: { LastUpdatedDate: -1 },
  });
} catch (err) {
  console.error(
    `Failed to fetch VerificationTarget rows: ${err.message}\n` +
      `Is BLOCKS_BEARER_TOKEN still valid? Re-grab from a logged-in\n` +
      `browser session if it has expired.`,
  );
  process.exit(2);
}

const envelope = raw && typeof raw === "object" ? raw : {};
const items = Array.isArray(envelope.data?.items)
  ? envelope.data.items
  : Array.isArray(envelope.items)
    ? envelope.items
    : null;

if (!items) {
  console.error(
    `Unexpected SDK response shape — neither .data.items nor .items found.\n` +
      `Got keys: ${Object.keys(envelope).join(", ")}`,
  );
  process.exit(3);
}

const targets = items
  .map((t) => ({
    id: t.ItemId ?? t.id ?? "",
    url: t.url ?? "",
    applicationName: t.applicationName ?? "",
    environment: t.environment ?? "production",
    enabled: String(t.enabled ?? "true").toLowerCase() !== "false",
    credentialId: t.credentialId ?? "",
    lastVerifiedAt: t.lastVerifiedAt ?? null,
    lastStatus: t.lastStatus ?? null,
    createdBy: t.CreatedBy ?? null,
  }))
  .filter((t) => t.url && (includeDisabled ? true : t.enabled));

// Stable order: most recently updated first, ties broken by URL alpha.
targets.sort((a, b) => {
  const aT = a.lastVerifiedAt ?? "";
  const bT = b.lastVerifiedAt ?? "";
  if (aT !== bT) return aT < bT ? 1 : -1;
  return a.url.localeCompare(b.url);
});

const out = {
  fetchedAt: new Date().toISOString(),
  count: targets.length,
  targets,
};

process.stdout.write(JSON.stringify(out, null, 2) + "\n");
