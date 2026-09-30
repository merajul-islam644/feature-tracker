// scripts/verify/verify-20260930T015004Z.mjs
// Test-only script: inserts ONE clearly-marked dummy issue into the Issue
// collection so we can verify the verify.ts → SDK → cloud round-trip works
// end-to-end. The fingerprint + title prefix make this row trivial to find
// and delete from the app's Issues page once the test is done.
//
// Hard markers:
//   title:  "__TEST_DUMMY_20260930T015004Z__ — delete after pipeline check"
//   description: starts with "[TEST DATA]"
//
// Anything that says "__TEST_DUMMY_" is safe to bulk-delete.

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// ── .env loader (no dotenv dep) ──────────────────────────────────────────
async function loadDotenv(path = ".env") {
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
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const REQUIRED_KEYS = [
  "VITE_BLOCKS_API_URL",
  "VITE_BLOCKS_OIDC_URL",
  "VITE_BLOCKS_OIDC_CLIENT_ID",
  "VITE_BLOCKS_KEY",
];

await loadDotenv();
const missing = REQUIRED_KEYS.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`\nMissing ${missing.length} key(s) in .env:`);
  for (const k of missing) console.error(`  ${k}`);
  console.error(`\nAdd them to .env and re-run.`);
  process.exit(1);
}
console.log("✓ config loaded from .env");

const { getBearerToken } = await import("./grab-token.mjs");
const bearerToken = await getBearerToken();
console.log("✓ token acquired");

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

const collection = client.data.collection("Issue", {
  fields: [
    "title",
    "applicationName",
    "url",
    "category",
    "severity",
    "status",
    "description",
    "expected",
    "actual",
    "reproductionStepsJson",
    "evidenceJson",
    "detectedAt",
    "verificationRunId",
    "fingerprint",
    "occurrenceCount",
    "lastSeenAt",
    "seenInRunIdsJson",
    "assignedDeveloperIdsJson",
    "approvedById",
    "CreatedBy",
    "CreatedDate",
    "LastUpdatedBy",
    "LastUpdatedDate",
  ],
});

// ── Fingerprint (must match useIssueTracker.ts:226-253) ─────────────────
function normalizeIssueUrl(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.trim();
  }
}
function normalizeIssueTitle(title) {
  return title.toLowerCase().replace(/\d+/g, "#").trim();
}
function computeIssueFingerprint(issue) {
  const composite = `${normalizeIssueUrl(issue.url)}|${issue.category}|${normalizeIssueTitle(issue.title)}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < composite.length; i++) {
    hash ^= composite.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// ── The single test issue ───────────────────────────────────────────────
const ISSUES_TO_FILE = [
  {
    title: "__TEST_DUMMY_20260930T015004Z__ — delete after pipeline check",
    url: "https://example.test/pipeline-check",
    category: "other",
    severity: "low",
    description:
      "[TEST DATA] Synthetic issue inserted by scripts/verify/verify-20260930T015004Z.mjs " +
      "to verify the verify.ts → @seliseblocks/client SDK → Issue collection round-trip. " +
      "No real defect. Safe to delete from the Issues page; the title prefix __TEST_DUMMY_ " +
      "makes it trivial to bulk-filter.",
    expected:
      "Row appears in the Issues page with title starting with __TEST_DUMMY_.",
    actual: "(pending — this row IS the proof)",
    reproductionSteps: [
      "Run: npx tsx scripts/verify/verify-20260930T015004Z.mjs",
      "Open the app's Issues page",
      "Filter / search for __TEST_DUMMY_",
    ],
    evidence: [
      {
        type: "observation",
        label: "Test script invocation",
        value: "scripts/verify/verify-20260930T015004Z.mjs",
        timestamp: new Date().toISOString(),
      },
    ],
  },
];

const detectedAt = new Date().toISOString();
const verificationRunId = `chat-${detectedAt.replace(/[:.]/g, "-")}`;

console.log(`\nFiling ${ISSUES_TO_FILE.length} test issue(s)…`);
console.log(`verificationRunId: ${verificationRunId}\n`);

const results = [];
for (const issue of ISSUES_TO_FILE) {
  const fingerprint = computeIssueFingerprint(issue);
  const applicationName = (() => {
    try {
      return new URL(issue.url).hostname.replace(/^www\./, "");
    } catch {
      return issue.url;
    }
  })();

  const payload = {
    title: issue.title,
    applicationName,
    url: issue.url,
    category: issue.category,
    severity: issue.severity,
    status: "open",
    description: issue.description,
    expected: issue.expected,
    actual: issue.actual,
    reproductionStepsJson: JSON.stringify(issue.reproductionSteps),
    evidenceJson: JSON.stringify(issue.evidence),
    detectedAt,
    verificationRunId,
    fingerprint,
    occurrenceCount: "1",
    lastSeenAt: detectedAt,
    seenInRunIdsJson: JSON.stringify([verificationRunId]),
  };

  try {
    const result = await collection.create(payload);
    const itemId = result?.data?.insertIssue?.itemId ?? "";
    console.log(`✓ [${issue.severity.toUpperCase()}] ${issue.title}`);
    console.log(`  fingerprint: ${fingerprint}  itemId: ${itemId}\n`);
    results.push({ title: issue.title, fingerprint, itemId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`✗ Failed: ${issue.title}`);
    console.error(`  reason: ${message}\n`);
    results.push({
      title: issue.title,
      fingerprint,
      itemId: null,
      error: message,
    });
  }
}

const summaryPath = join(here, `verify-summary-${verificationRunId}.json`);
writeFileSync(
  summaryPath,
  JSON.stringify({ runId: verificationRunId, results }, null, 2),
);
console.log(`Summary: ${summaryPath}`);

const failures = results.filter((r) => !r.itemId).length;
if (failures > 0) {
  console.error(`\n${failures} of ${results.length} failed to insert.`);
  process.exit(1);
}
console.log(`\nDone — ${results.length} test issue filed.`);
