# Lattice — Verify Any App End-to-End

Lattice is an Issue Tracker; a verification agent walks target URLs and files a defect for every real issue. App-agnostic — any URL, generic UI/API/auth/perf checks. Use for "walk this app" / "verify every page" / "find issues" / re-walks. One specific page → ad-hoc, skip this loop.

## Hard rules (user directives — violating any ends the session badly)

1. Never infer from HTML/source — visit in a real browser, click, fill, observe network.
2. Don't guess — unobserved defects don't exist.
3. Double verification before insert — observe twice (re-check immediately, no permission-wait). Confirmed → insert at once; not → it never existed.
4. Delete your own wrong inserts immediately; issues you did NOT insert are not yours to delete — ask.
5. Finish one target before starting the next.
6. 404/5xx/can't-login = walk-stopper — file "Cannot reach <target> — login unreachable" (high, reload is the re-check), one line, wait.
7. Reply in Bangla; code, paths, slugs, error strings stay English.
8. Destructive actions (deletes, cancel run, MCP restart) need confirmation; **inserts don't** — double-check, file immediately. Reading/clicking/navigating is always fine.
9. No screenshot spam — `browser_snapshot` + `browser_evaluate`; screenshots only on explicit ask.
10. Password anywhere it shouldn't be → STOP and tell the user; never print/type a password as a tool argument.
11. Start silently — first action is gate 1; first words are the one-line gate verdict or nothing.
12. Talk less — the only question is a real blocker (env/target/secret/binding/login/MCP down), one line, then wait. Findings go in the end-of-target summary.

## Environment model (v2.1)

`Environment.ItemId` is the identity; `slug` is a renameable URL cache. Targets/Secrets/Bindings/Issues carry `environmentId` — scope every read by it. Walk scope = per-env `blx_VerificationChecks` rows, `enabled: true` set (the `localStorage.lattice.verification-checks.v1` blob is stale). Active env = `UserPreference.activeEnvironmentId`.

## Bootstrap — API-only, never the Lattice UI

`.env`: `VITE_BLOCKS_API_URL`, `VITE_BLOCKS_OIDC_URL`, `VITE_BLOCKS_OIDC_CLIENT_ID`, `VITE_BLOCKS_KEY`. IAM credential is NOT an env key — secret **`IAM Walker Login`** in the MCP secret store (`http://127.0.0.1:8787`, override `MCP_SERVER_URL`; must be running). `iamCredential()` (`scripts/walker/auth.mjs`) resolves it loopback-only; store is the only source.

```js
import { walkerClient } from "./scripts/walker/auth.mjs"; // SDK, auto re-login (~3.5h token)
import { loadWalkerContext } from "./scripts/walker/data.mjs";
const ctx = await loadWalkerContext({ projectId, environmentId }); // or {projectId, envSlug} / bare = active pref
// ctx = { env, environments, targets, secrets, secretBindings, checks } — env-scoped
```

Filters are flat `{field:value}` and every filtered column must be in the collection's `fields` selector. Secrets return `passwordMasked` only. Unresolvable credential → stop: check MCP health, Secrets page → add `IAM Walker Login`, retry once. Never invent targets from chat history.

**Two browsers:** stdio `@playwright/mcp` (browser\_\* tools) is the PRIMARY surface — new tab per target; the plaintext password reaches it only via the loopback recipe below. The MCP server's `/verify/runs` agent is a fallback that opens a second headed window — confirm first.

## Pre-flight — scope gate (silent; first message = the failed gate, one line) + session gate

1. projectId + environmentId verbatim from the Bootstrap prompt; no prompt → bare `loadWalkerContext()` walks the active-preference env without asking; both empty → "কোন project আর environment verify করব বলুন — অথবা env পেজ থেকে Bootstrap prompt কপি করে দিন।" Stop.
2. No enabled target in `ctx.targets` → "এই environment-এ কোনো target নেই — Targets পেজে Add URL দিয়ে target যোগ করুন।" Stop.
3. No enabled secret in `ctx.secrets` → "কোনো secret যোগ করা নেই — Secrets পেজে secret যোগ করে ওই target URL-এর সাথে bind করুন।" Stop.
4. No enabled secret bound to the target (`ctx.secretBindings` / `credentialId`) → "bound secret টা disabled — Secrets পেজে Enable করুন।" Stop.
5. All pass → navigate to the target immediately, no confirmation.

**Session gate:** authenticated → walk; login screen → self-login (recipe below); stored credential fails → "store করা credential দিয়ে লগইন হচ্ছে না — Secrets পেজে মিলিয়ে নিন", stop.

```js
// browser_evaluate — runs INSIDE the page; secretId from gate 4. Status only, values never return.
async () => {
  const res = await fetch("http://127.0.0.1:8787/secrets/<secretId>");
  if (!res.ok) return "store unreachable (" + res.status + ")";
  const { email, password } = await res.json();
  const set = (el, v) => {
    Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const e = document.querySelector(
    'input[type=email], input[name*="email" i], input[name*="user" i]',
  );
  const p = document.querySelector("input[type=password]");
  if (!e || !p) return "login form not found";
  set(e, email);
  set(p, password);
  return "filled";
};
```

Then click submit and snapshot; report "login failed", never values. Mid-walk session death → re-login with the recipe, resume, never re-walk verified pages; inserts never block (walker client re-logins itself).

## Walk loop (per target, new stdio tab)

Every reachable route: snapshot → evaluate (`innerText`, storage, cookies, globals) → console errors → network ≥400/CORS/redirects/OIDC → click every button/link (except logout, off-target, irreversible) → submit every form valid + invalid → theme/language/resize. Repeat to terminal state.

Defect patterns to check everywhere: heading words concatenated in `innerText`/`textContent` (CSS-span spacing); theme toggle no-op (check ALL storage — cookie-only persistence is a false-positive trap); console 401 on cold load; empty `code_challenge=` with `method=S256` in the login redirect; duplicate list items vs header count; form submit with no feedback; forgot-password stuck disabled; label typos; >5s load; broken links/dead CTAs; empty state during fetch; validation error vanishing <100ms; modal without close; `<label>` without `for=`; sensitive payload over HTTP/wrong origin; session cookie without Secure/SameSite; server 400 silent in UI; 5xx on happy path.

Recipes: refs die on any state change — re-snapshot before each click; click timeout → read `href`, navigate directly; React input not reacting → native setter + `input`/`blur` events (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set`); two login affordances → walk both; blur-validated forms → press Tab then re-check.

## Defects — double-check, insert, move on

Capture: `applicationName`, exact `url`, `category` (`authentication|performance|accessibility|api|ui|other`), `severity`, `status:"open"`, specific `title`, `description` (exact strings), `expected`, `actual`, `reproductionSteps`, `evidence` (timestamps), `detectedAt`, `verificationRunId` (`manual-<env>-<ISO>`).

Insert via `walkerClient()` → `client.data.collection("Issue", {fields:[full list — top of scripts/verify/verify-20260930T015004Z.mjs]})`. Required: all captured fields above as `reproductionStepsJson`/`evidenceJson`, plus `fingerprint`, `occurrenceCount` (**string** `"1"`), `lastSeenAt`, `seenInRunIdsJson`, `assignedDeveloperIdsJson`, `approvedById`, `CreatedBy/CreatedDate/LastUpdatedBy/LastUpdatedDate`, and the env scope `projectId`+`envSlug`+`environmentId` (+`targetId` when known) — missing scope drops it from the env view. **Duplicate guard:** query `fingerprint` eq + env scope first — hit = re-encounter, update existing row (occurrenceCount+1, lastSeenAt, append runId), never a second row. **Updates echo every field** (`requiredOn: 3`; SDK fails silently — check `acknowledged`+`totalImpactedData`). Fingerprint = FNV-1a 32-bit over `origin+pathname|category|title.toLowerCase().replace(/\d+/g,"#")` — copy the exact function from `useIssueTracker.ts:226-253`, don't rewrite. Delete wrong own inserts via `issueCollection.delete({id})`; find id by fingerprint query.

End of target: show the filed list in one block, then the next enabled target. Never half-walk.

Memory on resume: [bangla-preferred], [data-gateway-filter-rule], [deployment-gap-defensive-reads], [secret-edit-form-dynamic-ids], [commit-needs-permission], [issue-tracker-update-requiredon-3-echo], [env-schema-v21-rollout] (all under `../MEMORY.md`).

Not for: Lattice's own source; UAT/PROD unless pinned (the prompt's `environmentId` IS the pin — never choose UAT/PROD yourself); Blocks-IAM/Data admin panels; builds/CI/deploy.
