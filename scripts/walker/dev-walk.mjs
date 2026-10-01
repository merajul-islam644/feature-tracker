// scripts/walker/dev-walk.mjs
//
// Autonomous DEV walk orchestrator:
//   1. POST /verify/runs on the local MCP server (:8787) for the Dev OS
//      target. The agent fills the credential in its own process and
//      drives the headed browser. We never touch the password.
//   2. Subscribe to /verify/runs/:id/events (SSE) and tail issue_detected
//      events.
//   3. Auto-insert every issue_detected payload to the cloud Issue
//      collection. No per-defect confirmation — per user directive:
//      "Override .env, insert all".
//
// Run:  node scripts/walker/dev-walk.mjs
//
// Env reads (already done by walkerConfig):
//   VITE_BLOCKS_API_URL, VITE_BLOCKS_OIDC_URL, VITE_BLOCKS_OIDC_CLIENT_ID,
//   VITE_BLOCKS_KEY, Email, Password
// The walker token cache (.walker-token-cache.json) is used; re-login
// happens automatically if within 60s of expiry.

import { walkerClient } from "./auth.mjs";

const MCP = "http://localhost:8787";

// Dev OS target (projectId=a7191279, envSlug=dev). Hard-coded because this
// script is a one-shot DEV walker; other envs would have their own orchestrator.
const TARGET = {
  id: "dbd2945a-a9a2-41aa-96c3-598337957f7f",
  applicationName: "Dev OS",
  url: "https://dev-os.blocksdevelopers.com/login",
  enabled: true,
  credentialId: "bb12747b-ad8f-419b-b6a3-95bd1202ab9c",
};

const PROJECT_ID = "a7191279-f01b-46c8-b342-0ea44b7a1d1a";
const ENV_SLUG = "dev";

const SCOPE = [
  "page_load",
  "navigation",
  "buttons",
  "forms",
  "broken_links",
  "console_errors",
  "network_errors",
  "authentication",
  "accessibility",
  "performance",
  "all_functionality",
];

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

function deriveApplicationName(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

async function main() {
  // 1) Bootstrap walker (re-login if token expired) — confirm `.env` is
  //    intact. walkerClient() returns an SDK whose accessToken self-refreshes.
  const client = await walkerClient();
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
      "projectId",
      "envSlug",
    ],
  });

  // 2) Pull existing issues for this scope, build fp → {itemId, ...} map
  //    so each new detection UPDATES the existing row instead of creating
  //    a duplicate (Issue schema says "Same defect re-detected across runs
  //    matches here instead of creating a duplicate row" — but the SDK has
  //    no upsert, we have to drive update() ourselves).
  const fpMap = new Map(); // fingerprint -> { itemId, occurrenceCount, seenInRunIds }
  {
    let page = 1;
    while (true) {
      const r = await collection.list({
        pageNo: page,
        pageSize: 100,
        filter: { projectId: PROJECT_ID, envSlug: ENV_SLUG },
      });
      const items = r.data?.getIssues?.items ?? [];
      for (const it of items) {
        if (it.fingerprint && !fpMap.has(it.fingerprint)) {
          let seenIds = [];
          try { seenIds = JSON.parse(it.seenInRunIdsJson ?? "[]"); } catch {}
          fpMap.set(it.fingerprint, {
            itemId: it.ItemId,
            occurrenceCount: parseInt(it.occurrenceCount ?? "1", 10) || 1,
            seenInRunIds: seenIds,
          });
        }
      }
      if (!r.data?.getIssues?.hasNextPage) break;
      page++;
    }
  }
  console.log(`[walk] existing fp map size: ${fpMap.size}`);

  // 3) Kick the verify run. runId embeds the ISO timestamp so it's unique
  //    and readable in the run list.
  const detectedAt = new Date().toISOString();
  const runId = `dev-walk-${detectedAt.replace(/[:.]/g, "-")}`;
  console.log(`[walk] kicking run ${runId}`);

  const startResp = await fetch(`${MCP}/verify/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      runId,
      userId: "41a74053-2c79-4fd5-aab3-90abce656a1d",
      targets: [TARGET],
      scope: SCOPE,
      device: "desktop",
    }),
  });
  if (!startResp.ok) {
    const text = await startResp.text();
    throw new Error(`start run failed ${startResp.status}: ${text}`);
  }
  const startJson = await startResp.json();
  console.log(`[walk] start:`, startJson);

  // 3) Tail SSE.
  const tailResp = await fetch(`${MCP}/verify/runs/${runId}/events`);
  if (!tailResp.ok) throw new Error(`tail failed ${tailResp.status}`);
  const reader = tailResp.body.getReader();
  const dec = new TextDecoder();

  let buf = "";
  let currentRunStatus = "running";
  const insertedIds = [];
  const failedInserts = [];

  const insertQueue = [];
  let inserting = false;
  async function drainInserts() {
    if (inserting) return;
    inserting = true;
    while (insertQueue.length) {
      const payload = insertQueue.shift();
      try {
        const fp = computeIssueFingerprint(payload);
        const applicationName = payload.applicationName || deriveApplicationName(payload.url);
        const insertPayload = {
          title: payload.title,
          applicationName,
          url: payload.url,
          category: payload.category || "other",
          severity: payload.severity || "medium",
          status: payload.status || "open",
          description: payload.description || "",
          expected: payload.expected || "",
          actual: payload.actual || "",
          reproductionStepsJson: JSON.stringify(payload.reproductionSteps || []),
          evidenceJson: JSON.stringify(payload.evidence || []),
          detectedAt: payload.detectedAt || detectedAt,
          verificationRunId: payload.verificationRunId || runId,
          fingerprint: fp,
          occurrenceCount: "1",
          lastSeenAt: payload.detectedAt || detectedAt,
          seenInRunIdsJson: JSON.stringify([payload.verificationRunId || runId]),
          projectId: PROJECT_ID,
          envSlug: ENV_SLUG,
        };
        const r = await collection.create(insertPayload);
        const itemId = r?.data?.insertIssue?.itemId ?? "(no itemId)";
        insertedIds.push({ title: payload.title, fp, itemId });
        console.log(`[walk] inserted: [${insertPayload.severity}] ${payload.title}  fp=${fp}  id=${itemId}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failedInserts.push({ title: payload.title, error: msg });
        console.error(`[walk] insert FAILED: ${payload.title} :: ${msg}`);
      }
    }
    inserting = false;
  }

  while (currentRunStatus === "running" || currentRunStatus === "queued") {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop();
    for (const p of parts) {
      for (const line of p.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const j = JSON.parse(line.slice(6).trim());
        if (j.type === "done") {
          currentRunStatus = "closed";
          break;
        }
        const ev = j.event || j;
        if (ev.kind === "issue_detected" && ev.payload) {
          console.log(`[walk] issue_detected: [${ev.payload.severity}] ${ev.payload.title}`);
          insertQueue.push(ev.payload);
          drainInserts();
        } else if (ev.kind === "run_completed" || ev.kind === "run_failed") {
          console.log(`[walk] ${ev.kind}: ${JSON.stringify(ev)}`);
          currentRunStatus = ev.kind === "run_completed" ? "completed" : "failed";
        } else if (ev.kind === "target_completed" || ev.kind === "target_started") {
          console.log(`[walk] ${ev.kind}: ${ev.applicationName || ev.targetId}  status=${ev.status || ""}`);
        } else if (ev.kind === "target_progress") {
          // Too noisy — skip
        }
      }
      if (currentRunStatus !== "running" && currentRunStatus !== "queued") break;
    }
  }
  await drainInserts();

  console.log("\n[walk] SUMMARY");
  console.log(`  runId: ${runId}`);
  console.log(`  inserted: ${insertedIds.length}`);
  for (const i of insertedIds) console.log(`    - ${i.title}  fp=${i.fp}  id=${i.itemId}`);
  console.log(`  failed: ${failedInserts.length}`);
  for (const f of failedInserts) console.log(`    - ${f.title}  :: ${f.error}`);
}

main().catch((err) => {
  console.error("[walk] FATAL:", err);
  process.exit(1);
});