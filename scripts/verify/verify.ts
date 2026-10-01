/**
 * scripts/verify/verify.ts — Standing instructions for Claude (this model) when the
 * user asks to verify a URL.
 *
 * Sibling files in scripts/verify/:
 *   - grab-token.mjs   — pulls a fresh OIDC bearer from the user's browser cookie store
 *   - list-targets.mjs — fetches VerificationTarget rows from cloud
 *   - verify-<ts>.mjs  — runtime script Claude generates for the user to execute
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHEN TO READ THIS FILE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Two trigger shapes:
 *
 *   (a) User says any of:
 *         "read verify.ts and do your job"
 *         "read verify.ts and start"
 *         "run the verify"
 *         "read scripts/verify folder and do your job"
 *         "read scripts/verify folder and start"
 *         "read scripts/verify/verify.ts and start"
 *         "audit from scripts/verify"
 *       → fetch the queue via `npx tsx scripts/verify/list-targets.mjs` (Bash).
 *         That helper pulls the user's enabled VerificationTarget rows
 *         from cloud. Walk each URL, populate ISSUES_TO_FILE in a fresh
 *         scripts/verify/verify-<timestamp>.mjs, hand off.
 *       → If the user pointed at the folder but not this file, you're
 *         reading the right one — this is the prompt. grab-token.mjs
 *         and list-targets.mjs are imports, not standalone instructions.
 *
 *   (b) User pastes a URL with a verb:
 *         "verify https://example.com"
 *         "audit <URL>"
 *         "find bugs in <URL>"
 *       → use the URL they pasted (single-URL run; no fetch, no queue).
 *
 *   A bare URL ("open https://x.com") is NOT a verify trigger.
 *
 * The queue lives in the app UI (TargetsPage), not in this file. If
 * the queue is empty AND no inline URL was given, ask the user to add
 * a target via the app, or paste a URL inline.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CLAUDE WORKFLOW — follow these steps exactly, in order
 * ════════════════════════════════════════════════════════════════════════════
 *
 * STEP 1 — RESOLVE URLS
 *   NO MANUAL CONFIG in this file. The queue lives in the user's app
 *   UI (TargetsPage, backed by the VerificationTarget cloud collection).
 *   Claude fetches at walk-time via scripts/verify/list-targets.mjs and
 *   filters per the multi-URL branch below.
 *
 *   Resolve URLs in this order:
 *     - If the user pasted a URL inline with the trigger → use that
 *       (single-URL run; no fetch, no prompt).
 *     - Else run `npx tsx scripts/verify/list-targets.mjs` (Bash tool). The
 *       helper reads .env automatically AND pulls a fresh token from
 *       the user's browser cookie store (via grab-token.mjs), fetches
 *       the user's enabled VerificationTarget rows, prints JSON to
 *       stdout. Claude reads the JSON — the bearer token never appears
 *       in stdout, only the target data does.
 *     - Else (no inline URL, no targets in cloud) → ask the user for a
 *       URL, do not start.
 *
 *   Multi-URL branch — Claude MUST ask before processing:
 *     When the fetched list has MORE THAN ONE entry, prompt with
 *     AskUserQuestion (multiSelect: true). Adaptation by count:
 *
 *       ≤3 targets:
 *         - One option per target (label = URL, description = login
 *           status — e.g. "login required (secret-X)" or
 *           "login-free, direct walk").
 *         - "All of the above" as the final option.
 *         → 4 options max, fits the tool's limit.
 *
 *       ≥4 targets:
 *         - "All of the above" + a few high-priority targets.
 *         - The user can pick "Other" to list the exact subset by URL.
 *
 *     - User picks specific URLs → filter the fetched list to that subset.
 *     - User picks "All of the above" → keep the fetched list as-is.
 *     - User picks none / cancels → STOP, no walk.
 *     - User's "Other" answer is a comma-separated list of URLs; match
 *       against the fetched list (substring OK, exact preferred).
 *
 *   For each URL kept, prepend `https://` if the scheme is missing.
 *   Strip a trailing slash. Reject non-http(s) schemes — don't try
 *   `file://`, `ftp://`, or anything else Playwright will choke on.
 *
 *   Per-URL progress: walk URLs ONE AT A TIME in array order. After
 *   each URL completes (success or fail), report the result before
 *   moving to the next. This lets the user interrupt cleanly if one
 *   target is misbehaving and keeps the conversation legible for
 *   multi-target runs.
 *
 * STEP 2 — CLASSIFY EACH URL (login-free vs login-required)
 *   Each fetched target carries its own `credentialId` (set by the
 *   user in the app's TargetsPage). A target is "login-required" iff
 *   its credentialId is non-empty AND that secretId exists in MCP
 *   server's GET /secrets response.
 *
 *   Hard check before proceeding — Claude MUST verify in this order:
 *     (1) Multi-binding is supported. Two or more URLs in the filtered
 *         list may share the same credentialId — that's intentional,
 *         the user bound them that way so one credential can sign into
 *         several applications. No STOP required; treat each URL's
 *         credentialId independently when classifying below.
 *     (2) Every credentialId resolves in MCP server's GET /secrets list.
 *         If a credentialId is unknown, STOP and tell the user "secretId
 *         <X> for <url> not in MCP server — add it via the app's
 *         SecretsPanel first".
 *
 *   Once both checks pass, classify each URL:
 *     - login-required → STEP 3 (delegate to MCP server, ITS OWN secretId)
 *     - login-free     → STEP 4a..4c (use Playwright MCP directly)
 *
 *   For an inline URL with no target record in cloud, default to
 *   login-free (try direct walk first; if the page redirects to
 *   /login, ask the user to register the URL in the app's TargetsPage
 *   with a credential, then re-run).
 *
 * STEP 3 — DELEGATE TO MCP SERVER (login-required targets)
 *   The MCP server at $VERIFY_BACKEND_URL (default http://localhost:8787)
 *   has the encrypted credentials and Playwright. Claude drives it over
 *   HTTP — no password ever leaves the server's process.
 *
 *   (a) Pre-flight: `curl -sf http://localhost:8787/health`. If it 404s
 *       or connection-refuses, tell the user to start the MCP server
 *       (`npm run dev:mcp`) and stop.
 *   (b) List secrets to confirm the secretId exists:
 *         curl -s http://localhost:8787/secrets | jq '.secrets[].id'
 *       If the secretId from CREDENTIALS isn't in the list, tell the
 *       user to add it via the app's SecretsPanel and stop.
 *   (c) Start the run:
 *         RUN_ID=$(curl -sf -X POST http://localhost:8787/verify/runs \
 *           -H 'Content-Type: application/json' \
 *           -d '{
 *             "runId":"chat-<iso>",
 *             "userId":"chat",
 *             "targets":[{
 *               "id":"t1",
 *               "applicationName":"<hostname>",
 *               "url":"<URL>",
 *               "enabled":true,
 *               "credentialId":"<secretId>"
 *             }],
 *             "scope":["all_functionality"],
 *             "device":"desktop"
 *           }' | jq -r .id)
 *       Note: userId is required by the schema but the agent doesn't
 *       consume it — "chat" is a fine sentinel.
 *   (d) Stream SSE events, filter for issue_detected, write JSON:
 *         curl -sN "http://localhost:8787/verify/runs/$RUN_ID/events" \
 *           | node -e '
 *               let buf=""; process.stdin.on("data",c=>buf+=c);
 *               process.stdin.on("end",()=>{
 *                 const out=[];
 *                 for (const line of buf.split("\n")) {
 *                   if (!line.startsWith("data: ")) continue;
 *                   try {
 *                     const env=JSON.parse(line.slice(6));
 *                     if (env?.event?.kind==="issue_detected")
 *                       out.push(env.event);
 *                   } catch {}
 *                 }
 *                 require("fs").writeFileSync(
 *                   `mcp-issues-${process.argv[1]}.json`,
 *                   JSON.stringify(out,null,2));
 *               });
 *             ' "$RUN_ID"
 *       This avoids needing jq in the pipeline and writes
 *       mcp-issues-<RUN_ID>.json atomically on stream close.
 *   (e) Read mcp-issues-<RUN_ID>.json. Each entry maps 1:1 onto the
 *       IssueTemplate below (the MCP agent already fills title, url,
 *       category, severity, description, expected, actual,
 *       reproductionSteps, evidence, detectedAt, applicationName,
 *       verificationRunId). Treat each as a confirmed defect — STEP 5
 *       is just the mapping; no re-classification.
 *   (f) Skip STEP 4 entirely for delegated URLs — the agent did the walk.
 *
 *   MCP server runs headed Chrome on the host. The user will see a real
 *   browser window pop up; that's the preview, not a leak.
 *
 * STEP 4a — NAVIGATE (login-free targets)
 *   Call mcp__playwright__browser_navigate with the URL. Wait for
 *   mcp__playwright__browser_wait_for (time: 2) so JS bundles settle.
 *
 * STEP 4b — INSPECT BASELINE (login-free targets)
 *   Call mcp__playwright__browser_snapshot for the accessibility tree.
 *   Call mcp__playwright__browser_console_messages (level: error).
 *   Call mcp__playwright__browser_network_requests (static: false) to see
 *   4xx/5xx responses (network_errors gate).
 *   Call mcp__playwright__browser_take_screenshot as evidence of the
 *   landing state.
 *
 * STEP 4c — WALK THE APP (login-free targets)
 *   For each interactive element in the snapshot:
 *     - mcp__playwright__browser_click with the ref.
 *     - Re-snapshot. If URL changed and same-origin, that's a sub-page —
 *       keep walking. If URL went cross-origin, navigate back.
 *     - Re-check console + network. If a new error appeared AND it
 *       reproduces on a second click (transient errors don't count), file.
 *   Stop walking when you revisit a URL or have covered the main flows.
 *
 * STEP 5 — CLASSIFY DEFECTS
 *   For each confirmed defect, fill the IssueTemplate below with:
 *     - title: short, ≤120 chars, no embedded volatile numbers like "Button 5"
 *     - url: full URL where the defect was observed
 *     - category: one of the IssueCategory enum (see schema section below)
 *     - severity: critical / high / medium / low
 *     - description: paragraph explaining what went wrong
 *     - expected: what should have happened
 *     - actual: what actually happened
 *     - reproductionSteps: ordered array of actions you took
 *     - evidence: optional array of { type, label, value, timestamp }
 *   For MCP-delegated URLs the agent already filled this — just remap
 *   its payload shape onto IssueTemplate (drop the verificationRunId
 *   override, the runtime script will mint a chat-<ts> one).
 *
 * STEP 6 — COMPUTE FINGERPRINT
 *   For each IssueTemplate, call computeIssueFingerprint(template). The
 *   fingerprint MUST match the formula in useIssueTracker.ts:226-253 so
 *   future re-detections merge into the same row instead of duplicating.
 *
 * STEP 7 — GENERATE SCRIPT
 *   Copy this file to scripts/verify/verify-<ISO-timestamp>.mjs. Replace
 *   the ISSUES_TO_FILE array with the discovered issues. Strip the
 *   TypeScript-only types (or tell the user to run with tsx).
 *   Sibling import (`./grab-token.mjs`) keeps working — both files live
 *   in scripts/verify/.
 *
 * STEP 8 — HAND OFF TO USER
 *   Tell the user:
 *     "Created scripts/verify/verify-<timestamp>.mjs with N issues across M URL(s).
 *      Add the missing keys (script will print them on first run) to .env,
 *      then run:  npx tsx scripts/verify/verify-<timestamp>.mjs
 *      Share the inserted ItemIds back so I can confirm."
 *   DO NOT ask for tokens in chat. The script lists the missing keys
 *   itself; the user pastes real values into .env, not the chat.
 *   Multi-URL runs get a single combined script; one summary JSON covers
 *   everything filed.
 *
 *   For multi-URL runs, also report per-URL results BEFORE generating
 *   the script:
 *     URL #1/3 — mailcraft.slsblx.com: 4 issues detected (1 critical,
 *       2 high, 1 medium). Login OK.
 *     URL #2/3 — iam.seliseblocks.com: 0 issues. Healthy.
 *     URL #3/3 — billing.seliseblocks.com: login failed (credential
 *       mismatch). Skipped.
 *   This goes before the script handoff so the user can decide to
 *   retry a failed target before filing.
 *
 * STEP 9 — FOLLOW UP
 *   User shares ItemIds → report:
 *     • Count filed / count skipped / count failed (per URL)
 *     • Severity breakdown (critical / high / medium / low)
 *     • Category breakdown
 *   If failures: read the script error, fix the script (not the API).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * HARD RULES — never violate, regardless of context (test, dev, prod)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * 1. NEVER run `curl https://blocksapi.slsblx.com/...` from Bash.
 *    AGENTS.md line 64: "Never raw `fetch`/`curl` against
 *    `api.seliseblocks.com`. Use the `blocks` CLI or the
 *    `@seliseblocks/client` SDK." Raw HTTP is the failure mode this rule
 *    exists to prevent — testing doesn't exempt it.
 *
 * 2. NEVER ask the user to paste OIDC tokens or client secrets in chat.
 *    Both list-targets.mjs and the runtime verify script read a fresh
 *    token from the user's browser cookie store via ./grab-token.mjs —
 *    Claude never needs to see or echo one. If the user pastes a token
 *    anyway, treat it as exposed — recommend rotation, do not echo it
 *    back.
 *
 * 3. NEVER write tokens into the generated script. Tokens come from the
 *    browser cookie store at run-time (grab-token.mjs). The script reads
 *    the cookie, uses it, drops it — no on-disk persistence.
 *
 * 4. NEVER hand-write fetch() against the platform. Always go through
 *    @seliseblocks/client. The SDK is the only sanctioned surface.
 *
 * 5. NEVER fabricate issues you didn't observe. If the app loaded fine and
 *    all checks passed, ISSUES_TO_FILE stays empty — the script refuses to
 *    run and tells the user "no defects observed, nothing to file."
 *
 * 6. NEVER click destructive controls (delete / remove / logout). Same
 *    list as mcp-server/src/agent.ts:479-480:
 *       /log\s*out|logoff|sign\s*out|delet|remov|destroy|uninstall|reset|purge|wipe/i
 *
 * 7. NEVER write a plaintext password to verify.ts, the chat, or the
 *    generated verify-*.mjs. The MCP server stores encrypted credentials
 *    in mcp-server/data/secrets.enc (AES-256-GCM) and exposes only the
 *    masked version via GET /secrets. For login-required targets, route
 *    through the MCP server's /verify/runs endpoint (see STEP 3 below)
 *    — it decrypts internally and never returns the password over HTTP.
 *
 * 8. NEVER try to walk a login-required target with browser_navigate.
 *    browser_navigate / browser_click have no access to MCP server's
 *    encrypted secrets, so any "login" Claude attempts would be empty
 *    fields. Login-required targets MUST use the MCP server delegation
 *    path in STEP 3. Claude's own Playwright tools are reserved for
 *    public/login-free URLs.
 *
 * 9. NEVER ask the user to set BLOCKS_BEARER_TOKEN. Tokens are pulled
 *    from the user's browser cookie store at run-time via grab-token.mjs.
 *    The user just needs to be logged into the app in Chrome/Edge and
 *    to close that browser before running the script.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ISSUE SCHEMA — matches CloudIssue in src/lib/blocks/data.ts:1668-1701
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Blocks Data fields are PRIMITIVE-ONLY. JSON-stringify arrays/objects
 * before sending. Empty / null fields: omit entirely (don't send "").
 *
 * Required:
 *   title                 string  ≤120 chars, no volatile numbers
 *   applicationName       string  derive from URL hostname (drop "www.")
 *   url                   string  full URL where observed
 *   category              enum    IssueCategory below
 *   severity              enum    IssueSeverity below
 *   status                string  always "open" for new findings
 *   description           string  paragraph
 *   detectedAt            string  ISO 8601
 *   verificationRunId     string  use "chat-<ISO timestamp>"
 *   fingerprint           string  8-char hex, computed below
 *   occurrenceCount       string  "1" (string, not number)
 *   lastSeenAt            string  ISO 8601
 *   seenInRunIdsJson      string  JSON.stringify(["chat-…"])
 *
 * Optional:
 *   expected              string
 *   actual                string
 *   reproductionStepsJson string  JSON.stringify(string[])
 *   evidenceJson          string  JSON.stringify(Evidence[])
 *
 * IssueCategory enum:
 *   "authentication" | "authorization" | "navigation" | "ui"
 *   | "functional" | "forms" | "api" | "performance"
 *   | "accessibility" | "other"
 *
 * IssueSeverity enum:
 *   "critical" | "high" | "medium" | "low"
 *
 * Evidence type:
 *   { type: "screenshot"|"log"|"network"|"url"|"observation",
 *     label: string, value: string, timestamp?: string }
 *
 * ════════════════════════════════════════════════════════════════════════════
 * FINGERPRINT — MUST match src/hooks/useIssueTracker.ts:226-253
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   fingerprint = FNV-1a-32( normalizeIssueUrl(url)
 *                          + "|" + category
 *                          + "|" + normalizeIssueTitle(title) )
 *
 *   normalizeIssueUrl:   origin + pathname, drop query/hash
 *   normalizeIssueTitle: lowercase + replace digit runs with "#"
 *
 * Re-detections of the same defect will merge into the existing row
 * instead of filing a duplicate. Out-of-sync formula = duplicates.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * BELOW THIS LINE — runnable template the user executes
 * ════════════════════════════════════════════════════════════════════════════
 *
 * After Claude fills ISSUES_TO_FILE, copy this file to
 * scripts/verify/verify-<timestamp>.mjs and run:
 *
 *   npx tsx scripts/verify/verify-<timestamp>.mjs
 *
 * No shell exports needed — the script auto-loads .env on startup (and
 * shell-exported vars win over .env, handy for CI). The bearer token is
 * pulled from your browser cookie store at run-time via grab-token.mjs
 * — you do NOT need BLOCKS_BEARER_TOKEN in .env.
 *
 * ONE THING TO DO BEFORE RUNNING: close Chrome / Edge. Chromium locks
 * its profile directory while running, and grab-token.mjs needs read
 * access. Reopen after the script finishes.
 *
 * The script exits non-zero if any issue failed to insert, so it slots
 * into CI / scheduling without extra plumbing.
 */

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

type IssueCategory =
  | "authentication"
  | "authorization"
  | "navigation"
  | "ui"
  | "functional"
  | "forms"
  | "api"
  | "performance"
  | "accessibility"
  | "other";

type IssueSeverity = "critical" | "high" | "medium" | "low";

type Evidence = {
  type: "screenshot" | "log" | "network" | "url" | "observation";
  label: string;
  value: string;
  timestamp?: string;
};

type IssueTemplate = {
  title: string;
  url: string;
  category: IssueCategory;
  severity: IssueSeverity;
  description: string;
  expected?: string;
  actual?: string;
  reproductionSteps?: string[];
  evidence?: Evidence[];
};

// ────────────────────────────────────────────────────────────────────────────
// .env loader — minimal parser so the script doesn't need a `dotenv` dep.
// ────────────────────────────────────────────────────────────────────────────

async function loadDotenv(path = ".env"): Promise<void> {
  const fs = await import("node:fs");
  if (!fs.existsSync(path)) return;
  const text = fs.readFileSync(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip surrounding quotes (single or double).
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Existing shell-export wins — don't overwrite what's already set.
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Fingerprint helpers — keep in sync with useIssueTracker.ts:226-253
// ────────────────────────────────────────────────────────────────────────────

function normalizeIssueUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.trim();
  }
}

function normalizeIssueTitle(title: string): string {
  return title.toLowerCase().replace(/\d+/g, "#").trim();
}

function computeIssueFingerprint(
  issue: Pick<IssueTemplate, "url" | "category" | "title">,
): string {
  const composite = `${normalizeIssueUrl(issue.url)}|${issue.category}|${normalizeIssueTitle(issue.title)}`;
  // FNV-1a 32-bit
  let hash = 0x811c9dc5;
  for (let i = 0; i < composite.length; i++) {
    hash ^= composite.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function deriveAppName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// ISSUES_TO_FILE — populated by Claude after walking the app. The queue
// and credentials live in the app UI (cloud VerificationTarget rows),
// fetched at STEP 1 via scripts/verify/list-targets.mjs. NO manual config
// in this file.
// ────────────────────────────────────────────────────────────────────────────

const ISSUES_TO_FILE: IssueTemplate[] = [
  // Example — Claude fills real entries here. Remove this comment block
  // before generating the runtime script.
  //
  // {
  //   title: "Login button does not respond to click",
  //   url: "https://example.com/login",
  //   category: "ui",
  //   severity: "high",
  //   description:
  //     "Clicked the login button three times. Network tab shows zero " +
  //     "requests fired. Console is clean. The button visually depresses " +
  //     "but no state change occurs — the form is not submitted.",
  //   expected: "Click POSTs /api/auth/login and navigates to /dashboard.",
  //   actual: "No network activity, no state change, no navigation.",
  //   reproductionSteps: [
  //     "Navigate to /login",
  //     "Fill email with test@example.com",
  //     "Fill password with password123",
  //     "Click 'Sign in' button",
  //   ],
  // },
];

// ────────────────────────────────────────────────────────────────────────────
// Main — runs once per script execution. Validates env, builds client, files.
// ────────────────────────────────────────────────────────────────────────────

type CreateResult = {
  data?: Record<string, { itemId?: string }>;
};
type RunSummary = {
  runId: string;
  results: Array<{
    title: string;
    fingerprint: string;
    itemId: string | null;
    error?: string;
  }>;
};

// All env vars the script needs, in the order they should appear in .env.
// Each entry: [varName, hint shown when missing].
// BLOCKS_BEARER_TOKEN is intentionally absent — it's read from the
// user's browser cookie store at run-time via ./grab-token.mjs.
const REQUIRED_KEYS = [
  ["VITE_BLOCKS_API_URL", "Blocks Data API base URL"],
  [
    "VITE_BLOCKS_OIDC_URL",
    "OIDC discovery URL (.well-known/openid-configuration)",
  ],
  ["VITE_BLOCKS_OIDC_CLIENT_ID", "OIDC client id"],
  ["VITE_BLOCKS_KEY", "Blocks tenant key (xBlocksKey header)"],
] as const;

function printMissingKeys(missing: readonly string[]): void {
  console.error(`\nMissing ${missing.length} key(s) in .env:\n`);
  for (const key of missing) {
    const entry = REQUIRED_KEYS.find(([k]) => k === key);
    const hint = entry ? `  # ${entry[1]}` : "";
    console.error(`  ${key}=${hint}`);
  }
  console.error(
    `\nAdd the keys above to .env (real values are yours to fill in — ` +
      `Claude never sees them). The script auto-loads .env on startup, so ` +
      `no shell exports are needed.\n\n` +
      `BLOCKS_BEARER_TOKEN is NOT required — the script reads a fresh token\n` +
      `from your browser cookie store at run-time (see grab-token.mjs).`,
  );
}

async function main(): Promise<void> {
  // Auto-load .env first. Existing shell exports still win (handy for CI).
  await loadDotenv();

  // Read the same VITE_BLOCKS_* names the app uses (see src/lib/blocks/config.ts).
  // The VITE_ prefix is a Vite convention; in Node we read the env var names
  // verbatim. Adjust if you've renamed them.
  const values = Object.fromEntries(
    REQUIRED_KEYS.map(([k]) => [k, process.env[k]]),
  );
  const missing = REQUIRED_KEYS.map(([k]) => k).filter((k) => !values[k]);

  if (missing.length > 0) {
    printMissingKeys(missing);
    process.exit(1);
  }

  if (ISSUES_TO_FILE.length === 0) {
    console.error(
      "ISSUES_TO_FILE is empty. Either the app passed all checks (good!) " +
        "or Claude didn't walk it yet. If you intended to file issues, " +
        "have Claude populate the array first.",
    );
    process.exit(1);
  }

  console.log("✓ config loaded from .env");
  console.log("✓ grabbing bearer token from browser cookie store…");

  // Pull a fresh token from the user's browser profile. CLOSE Chrome
  // before running — Chromium locks the profile directory.
  const { getBearerToken } = await import("./grab-token.mjs");
  const bearerToken = await getBearerToken();
  console.log("✓ token acquired");

  // Dynamic import so the file also runs as plain ESM (.mjs) without TS toolchain.
  const { createBlocksClient } = await import("@seliseblocks/client");

  const client = createBlocksClient({
    apiUrl: values.VITE_BLOCKS_API_URL as string,
    oidc: {
      clientId: values.VITE_BLOCKS_OIDC_CLIENT_ID as string,
      url: values.VITE_BLOCKS_OIDC_URL as string,
    },
    xBlocksKey: values.VITE_BLOCKS_KEY as string,
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

  const detectedAt = new Date().toISOString();
  const verificationRunId = `chat-${detectedAt.replace(/[:.]/g, "-")}`;

  console.log(
    `Filing ${ISSUES_TO_FILE.length} issue(s) to ${values.VITE_BLOCKS_API_URL}`,
  );
  console.log(`verificationRunId: ${verificationRunId}\n`);

  const results: RunSummary["results"] = [];
  for (const issue of ISSUES_TO_FILE) {
    const fingerprint = computeIssueFingerprint(issue);
    const applicationName = deriveAppName(issue.url);

    const payload = {
      title: issue.title,
      applicationName,
      url: issue.url,
      category: issue.category,
      severity: issue.severity,
      status: "open" as const,
      description: issue.description,
      expected: issue.expected,
      actual: issue.actual,
      reproductionStepsJson: issue.reproductionSteps
        ? JSON.stringify(issue.reproductionSteps)
        : undefined,
      evidenceJson: issue.evidence ? JSON.stringify(issue.evidence) : undefined,
      detectedAt,
      verificationRunId,
      fingerprint,
      occurrenceCount: "1",
      lastSeenAt: detectedAt,
      seenInRunIdsJson: JSON.stringify([verificationRunId]),
    };

    try {
      const result = (await collection.create(payload)) as CreateResult;
      // SDK shape: { data: { insertIssue: { itemId } } } — same envelope
      // as the in-app useCreateIssue (see src/lib/blocks/hooks.ts:114-123).
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

  // Persist a summary so the user can map ItemIds back to titles later.
  // Write next to the script (scripts/verify/) so all verify artifacts
  // land in the same folder regardless of CWD.
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const summaryPath = path.join(
    here,
    `verify-summary-${verificationRunId}.json`,
  );
  const summary: RunSummary = { runId: verificationRunId, results };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`\nSummary written to ${summaryPath}`);

  const failures = results.filter((r) => !r.itemId).length;
  if (failures > 0) {
    console.error(
      `\n${failures} of ${results.length} issue(s) failed to insert.`,
    );
    process.exit(1);
  }
  console.log(`\nDone — ${results.length} issue(s) filed.`);
}

main().catch((err) => {
  console.error("Script crashed:", err);
  process.exit(1);
});
