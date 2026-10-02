# Lattice — Verify Any App End-to-End

## Purpose

Lattice is an Issue Tracker that runs a verification agent against URLs the user adds as targets. Each target is one application. For every target, walk every reachable route, every interactive element, every form, every state — and file a defect for every real issue you observe.

The skill is **app-agnostic**. It works for any URL the user adds — a Blocks dev tenant URL, a third-party SaaS, an internal admin tool, a static marketing page. Nothing in this skill hardcodes a particular host, path, or known defect. The defect-detection patterns are generic UI / API / auth / performance checks.

## When to use

- The user adds a new target URL and asks to verify it.
- The user says "walk this app", "verify every page", "find issues", "issue খুঁজে বের করো", "প্রতিটা route check করো".
- A new deploy lands and the user wants the target re-walked.
- The user wants to extend coverage (more routes, more flows) on an existing target.

If the user only wants one specific page or one specific defect, this skill is overkill — do that ad-hoc and skip the loop.

## Non-negotiable rules (from the user)

These are **hard** — every one came from explicit user feedback. Violating any of them ends the session badly.

1. **Don't shortcut by inferring from HTML or source.** Actually visit the URL in a real browser, click every button, fill every form, observe every network response. "I read the source, this looks broken" is not verification.
2. **Don't guess.** If you haven't observed a defect with your own tools, it does not exist. "Probably", "likely", "should be" do not count.
3. **Don't insert without double verification.** Every Issue row in the cloud must correspond to a defect you observed **twice** — once when found, once on an immediate re-check (user directive 2026-10-02: no permission-wait between the two). Confirmed on the re-check → insert right away via the Issue insert API; not confirmed → it never existed, move on.
4. **Delete wrong inserts immediately.** If you inserted a defect and it later turns out to be wrong (false positive, you read the page wrong, the agent's failure mode was its own bug, not the app's), find it and delete it. Don't leave it and "explain later".
5. **Complete one target before moving to the next.** Don't start target B while target A is half-walked. The user will catch this and be angry.
6. **404 / can't-login = walk-stopper, not theme defect.** If a target URL returns 404, 5xx, or you can't reach the login form, stop, file an issue titled "Cannot reach <target> — login unreachable" with severity high (double-checked per rule 3 — a reload is the re-check), report it in one line, and wait for direction. Don't go looking for cosmetic bugs on a page that doesn't load.
7. **Reply in Bangla.** Code, paths, branches, function names, env slugs, error messages stay in English. Only the prose around them is Bangla.
8. **Ask before destructive actions — but inserts are no longer one.** Deleting issues, cancelling a running verify run, restarting the MCP server — these require user confirmation. Issue **inserts do not wait for permission** (user directive, 2026-10-02): double-check per rule 3, then file immediately. Reading pages, clicking buttons, navigating is fine.
9. **No screenshot spam.** Don't take screenshots to "show" the user what you see — they don't need a slideshow of every page. Use snapshots (`browser_snapshot`) and `browser_evaluate` to read state. Screenshots only when the user explicitly asks or when an evidence artefact needs to be saved.
10. **Stop the moment you find a leak, do not work around it.** If you discover the password is exposed in a log, response, SSE event, or file, STOP and tell the user. Don't paper over it, don't "use it just this once".
11. **Start working silently.** The verify/walk command IS the start command. No preamble, no plan recital, no restating the task, no "let me first explain my approach". Your first ACTION is the pre-flight session gate (below); your first WORDS are either nothing or the one-line gate verdict. Speak only when blocked, or when presenting found defects (user directive, 2026-10-02 — the agent used to talk a lot before starting).
12. **Talk less, never ask ajebaje questions.** Narration is not work (user directive, 2026-10-02). No running commentary, no restating what you're about to do, no asking permission for anything these rules already allow. The ONLY question allowed is a real blocker — one line, exactly what is missing (environmentId, target, secret, binding, login, MCP server down) — then wait. Everything else you decide yourself and act. Defects found, inserts filed, and session recoveries are reported in the end-of-target summary, not narrated mid-walk.

## Environment model (schema v2.1)

Every project env is a row in `blx_Environments`. **`ItemId` is the env's identity**; `slug` is a renameable display cache (URL segment), never a stable key. Projects start with ZERO envs — the user adds each one (canonical kind `dev`/`stg`/`prod`/`uat`, or `custom`) via Add Environment.

Everything env-scoped points at the row:

- Targets / Secrets / SecretBindings / Issues carry `environmentId` (the ItemId) alongside the legacy `projectId`+`envSlug` pair. **Scope reads by `environmentId`** — a slug rename must never orphan a walk's data.
- Verification scope is per-env rows in `blx_VerificationChecks` — one row per check per env (`source: "builtin"` mirrors the 11-id catalog; `source: "custom"` carries a `custom_`-prefixed `checkId`; `enabled` is the user's selection). The legacy `localStorage.lattice.verification-checks.v1` blob is stale — do not read it.
- The active env is `UserPreference.activeEnvironmentId` for the logged-in user (one-way write from the app; cross-device). The old `lattice.mirror.active-env.v1` mirror and the `__active__::` SecretBinding sentinel are gone.

Rule of thumb: resolve the env row first (`fetchEnvironments` → match by id, slug, or the active preference), then use its `id` everywhere.

## Setup — one target at a time

### 0. Session bootstrap (programmatic only)

Walker never navigates the Lattice UI to read configuration. **All reads go through APIs** — Environments, Checks, Targets, Secrets, and Bindings are pulled by the helpers under `scripts/walker/`, never by walking the Lattice SPA.

**Required `.env` keys** (project root):

- `VITE_BLOCKS_API_URL` — Blocks Data API base URL (e.g. `https://blocksapi.slsblx.com`)
- `VITE_BLOCKS_OIDC_URL` — OIDC discovery URL (e.g. `https://iam.seliseblocks.com`)
- `VITE_BLOCKS_OIDC_CLIENT_ID` — OIDC client id (public, safe to read)
- `VITE_BLOCKS_KEY` — Blocks tenant key (public, safe to read)

**IAM credential is NOT an .env key.** The walker's login lives in the MCP server's encrypted secret store under the reserved name **`IAM Walker Login`** (email + password). `auth.mjs`'s `iamCredential()` resolves it: `GET /secrets` → match the name → `GET /secrets/:id` (loopback-only — non-local peers are refused before the id is looked up). The MCP server must be running (default `http://127.0.0.1:8787`, override with `MCP_SERVER_URL`). A deprecated `Email`/`Password` env fallback still exists but warns loudly — the store is the source. Never print the password; `iamCredential()` and the login fetch keep it in process memory only.

No bearer token is read from the user. **Walker logs in itself** via the OIDC password-equivalent endpoint, with the credential from `iamCredential()`:

```
POST https://iam.seliseblocks.com/api/auth/login?tenant_id=<VITE_BLOCKS_KEY>
Content-Type: application/json

{ "username": "<iamCredential().email>", "password": "<iamCredential().password>" }
```

Response: `200 { access_token, expires_in: 12540, … }` — a bearer JWT, no PKCE / code exchange, no cookie jar required. The IAM session cookie that `BLOCKS_BEARER_TOKEN` previously piggy-backed on is irrelevant for this path.

**Walker never**:

- Scans Chrome profiles for cookies (`grab-token.mjs`'s job when run by the user manually — the walker does not invoke it).
- Reads `~/.bash_history`, `~/.zsh_history`, environment dumps, or any other filesystem artifact for credential harvesting.
- Opens the Lattice UI to read `localStorage` mirrors — those are a user-mist fallback only when the cloud is genuinely 401'ing.

**Walker bootstrap in order:**

1. **Load `.env`.** Use the inline dotenv loader at the top of `scripts/walker/auth.mjs`, or `import { config } from 'dotenv'; config({ path: '.env' })`. Verify the four `VITE_BLOCKS_*` keys exist. If missing, list them and ask the user to add to `.env`. The IAM credential comes from the MCP secret store (`iamCredential()`), not `.env` — see the note above.
2. **Pick a scope.** Resolve it from the cloud — never from a browser mirror. `const envs = await fetchEnvironments(client, { projectId });` gives the project's env rows; `const activeEnvironmentId = await fetchActiveEnvironmentId(client);` gives the user's cross-device preference. Match the env row by id (preference) or by the slug the user named. If the user named neither a project nor an env and the preference is empty, ask which env to walk — do not infer.
3. **Login programmatically.** `import { walkerClient } from "./scripts/walker/auth.mjs"; const client = await walkerClient();`. `walkerClient()` builds an SDK whose `accessToken` callback re-logs in when the cached token is within 60s of expiry (~3.5h lifetime), re-resolving the credential from the MCP secret store each time. No manual refresh step.
4. **Environments + scope.** `import { fetchEnvironments, fetchVerificationChecks } from "./scripts/walker/data.mjs";` — `fetchEnvironments(client, { projectId })` returns `{id, slug, label, kind, order}` rows (`id` = Environment ItemId, the identity); `fetchVerificationChecks(client, { projectId, environmentId })` returns the per-env scope rows `{checkId, source, label, enabled}` — the `enabled: true` set IS the walk's scope.
5. **Targets.** `import { fetchTargets } from "./scripts/walker/data.mjs"; const targets = await fetchTargets(client, { projectId, environmentId });`. Each row has `{id, url, applicationName, environmentId, credentialId, enabled, lastVerifiedAt, lastStatus}`.
6. **Secrets metadata.** `import { fetchSecrets } from "./scripts/walker/data.mjs"; const secrets = await fetchSecrets(client, { projectId, environmentId });`. Each row has `{id, name, email, passwordMasked}` — masked only, no plaintext (skill rule 10).
7. **Bindings (secretId → targetId[]).** `import { fetchSecretBindings } from "./scripts/walker/data.mjs"; const { bindings } = await fetchSecretBindings(client, { projectId, environmentId });`. Returns the parsed `bindingsJson` map.

Steps 2–7 collapse into one call when the scope is already known: `const ctx = await loadWalkerContext({ projectId, envSlug });` (or `{ projectId, environmentId }`, or bare to use the active preference). It resolves the env row itself and returns `{env, environments, targets, secrets, secretBindings, checks}`.

**Hard rules for bootstrap:**

- **Never navigate the Lattice UI.** Walker reads everything through the cloud SDK and MCP server. No `browser_navigate` to `https://dbeegi.slsblx.com/...`, no DOM scraping, no `localStorage` mirror reads in stdio browser. The user opens Lattice themselves if they want.
- **Config reads are API-only; the walk itself is browser work.** Reading Environments/Checks/Targets/Secrets/Bindings goes through the `scripts/walker/` helpers — never through Lattice UI navigation or DOM scraping. Walking the TARGET app is the opposite: the stdio browser is the primary surface (see Pre-flight + Walk loop) — navigate to the target, self-login with the bound secret, walk its UI. The MCP server's `POST /verify/runs` headed agent is only the fallback (Walk loop Option C).
- **Never type a password as a tool argument.** A plaintext password must never enter the LLM context (rule 10). The ONLY permitted password path in the stdio browser is the loopback fill recipe (Pre-flight → "Login with the bound secret"): `browser_evaluate` fetches the bound credential from the MCP store and fills the form inside the page, returning only ok/failed. The MCP server's `/verify/runs` headed agent has its own internal fill path.
- **Never invent a token.** If the MCP secret store has no `IAM Walker Login` secret (or the store is down) and no env fallback resolves, walker stops and asks.
- **If a step fails**, surface the message to the user, do not retry in a loop.

For every target the user adds:

1. **The user adds the target.** In the Lattice UI: Projects → pick the project → pick the env → Targets page → "Add URL" with display name + URL. The target shows up in the list with id, url, enabled toggle.
2. **If the target needs login, the user adds a credential.** Secrets page → "+ Add Secret" with name + email + password + binding to the target via the secret-target dropdown. The secret is stored in `mcp-server/data/secrets.enc` (AES-256-GCM). The cloud only sees `passwordMasked`. Like targets, each secret row has an **Enabled/Disable toggle** — disabled secrets stay listed but the scope gate skips them (and their bindings). The actual password never leaves the MCP server's process except through the **loopback-only** `GET /secrets/:id` — exactly two legitimate consumers: the walker's own IAM login, and the loopback fill recipe inside the target page (Pre-flight). Anything non-local is refused before the id is looked up, and the classifier will block any attempt to exfiltrate it as **Credential Exploration**.
3. **The user picks verification scope.** Scopes page — checkbox grid covering `page_load`, `navigation`, `buttons`, `forms`, `broken_links`, `console_errors`, `network_errors`, `authentication`, `accessibility`, `performance`, `all_functionality` (plus any custom checks they defined). Under v2.1 each toggle is a per-env row in `blx_VerificationChecks` — tester-only UI, saved straight to the cloud.
4. **Walker reads the configuration.** Everything through `scripts/walker/data.mjs`: env row via `fetchEnvironments`, scope via `fetchVerificationChecks` (env-scoped by `environmentId`), targets/secrets/bindings via their helpers. No UI navigation, no `localStorage` mirrors.

If any of these is missing, ask the user to set it up. Don't fabricate bindings.

#### Reading configuration when the Lattice UI is unreachable

The walker does **not** read Lattice configuration through a browser. All of it comes through `scripts/walker/data.mjs` helpers, which use the cloud SDK. There is no fallback to `localStorage` mirrors in the stdio browser — that path is gone.

```js
// Walker script (no browser)
import { walkerClient } from "./scripts/walker/auth.mjs";
import {
  fetchEnvironments,
  fetchVerificationChecks,
  fetchTargets,
  fetchSecrets,
  fetchSecretBindings,
  loadWalkerContext,
} from "./scripts/walker/data.mjs";
const client = await walkerClient();
const environments = await fetchEnvironments(client, { projectId });
const checks = await fetchVerificationChecks(client, {
  projectId,
  environmentId,
});
const targets = await fetchTargets(client, { projectId, environmentId });
const secrets = await fetchSecrets(client, { projectId, environmentId });
const { bindings } = await fetchSecretBindings(client, {
  projectId,
  environmentId,
});
// …or one-shot: const ctx = await loadWalkerContext({ projectId, envSlug });
```

If the cloud SDK returns 401 even after auto-login, the only dynamic action is `forceRefresh()` from `scripts/walker/auth.mjs`. If that also fails, walker stops and asks the user to check the `IAM Walker Login` secret (MCP store + server health).

#### Configuration fetch — full decision tree

Walk this in order. Stop at the first path that yields `[{id, url, applicationName, environmentId, credentialId, enabled}]`.

1. **API helpers** (`fetchEnvironments`, `fetchVerificationChecks`, `fetchTargets`, `fetchSecrets`, `fetchSecretBindings` — or the one-shot `loadWalkerContext` — from `scripts/walker/data.mjs`). Always first. If it works, walker gets full config without opening any tab. Done.
2. **`list-targets.mjs`** (`node scripts/verify/list-targets.mjs`). User runs this manually when they want a CLI view; walker does **not** invoke it. It scans Chrome profiles for an `access_token` cookie and queries `VerificationTarget`. Survives only when the cookie is still alive.
3. **Lattice UI in stdio browser** (legacy, discouraged). `browser_navigate` to `/projects/<id>/<env>/targets`, scrape the DOM, read `localStorage.lattice.mirror.secretBindings.v1` via `browser_evaluate`. **Walker never does this.** The user opens Lattice in their own browser if they want this view.
4. **Nothing works.** Walker has no config. Stop and ask the user to check the MCP server and the `IAM Walker Login` secret, then rerun the helpers.

#### Requesting login from the user — concrete template

When the credential can't be resolved, walker cannot fabricate, guess, or walk. Use exactly this template (translated into the user's preferred language):

> Walker cannot resolve its IAM login. To unblock:
>
> 1. Make sure the MCP server is running (`GET http://127.0.0.1:8787/health`).
> 2. Open the Lattice **Secrets** page and add a secret named exactly **`IAM Walker Login`** with your IAM email + password (the same account you use in the app).
> 3. Re-run the walker — it resolves the credential from the store and re-logins via `/api/auth/login` automatically.
>
> Targets fetched this way include `id`, `url`, `applicationName`, `environmentId`, `credentialId`, `enabled` — the full set needed for the walk loop.

Do not silently invent a target list. Do not walk URLs from old chat history. Do not skip the configuration step.

If the user can't or won't add the secret, walker stops. There is no `BLOCKS_BEARER_TOKEN` path (that was the cookie-jar approach, long gone) and `.env` credentials are deprecated — the store is the source.

## Architecture — know this cold

The MCP server (`mcp-server/src/index.ts`) holds the encrypted secret store. The only function that decrypts is `resolveCredentialForTarget(id)` in `mcp-server/src/secrets.ts`. It returns `{email, password}` inside the MCP server's process, and over the wire through exactly one door: **`GET /secrets/:id`, loopback-only** (non-local peers get 403 before the id is looked up) — the walker's IAM login and the verify agent's own fills are the only legitimate consumers. The password is then handed directly to Playwright's `fill()` (`mcp-server/src/agent.ts`):

```
const cred = resolveCredentialForTarget(credentialId);  // internal
await passwordInput.fill(cred.password);                 // into Playwright, never into a response
```

No SSE event, evidence file, run-event payload, or test script returns the plaintext password, and no non-loopback peer can fetch it. The rule that matters is unchanged: **the agent's LLM context never sees it.** If you find yourself wanting to print, log, or paste the password — stop. The classifier will block that as **Credential Exploration** anyway.

Two Playwright instances are in play. Do not confuse them.

| Instance                                                       | Started by                                                 | Used for                                                                                                                                                       | Password access                                                   |
| -------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| stdio `@playwright/mcp@0.0.82` (via `playwrightMcp.ts` bridge) | Claude Code startup                                        | `browser_navigate`, `browser_click`, `browser_snapshot`, `browser_evaluate`, `browser_fill_form`, `browser_tabs`, etc. — the interactive session the user sees | Only via the loopback fill recipe (Pre-flight): `browser_evaluate` fetches the bound credential INSIDE the page — the plaintext never reaches the model. Typing a password as a tool argument is forbidden (rule 10). |
| MCP server's own Playwright (`mcp-server/src/agent.ts`)        | `POST /verify/runs` or `mcp-server/scripts/debug-login.ts` | The verification agent — drives a **headed** Chrome window the user sees on the host                                                                           | Yes — `resolveCredentialForTarget` runs in this process           |

The user's standing instruction is **the existing stdio browser session is the primary surface**. Don't kick off `/verify/runs` to "open a browser" — it opens a _second_ headed browser window. Use the existing stdio browser; open a new tab in it (`browser_tabs action=new`) to reach the target URL.

For login-required flows inside the stdio browser, the primary mechanism is the **loopback fill recipe** (Pre-flight → Login with the bound secret): the page itself fetches the credential from the loopback MCP store and fills the form, so the password never enters the model's context. The MCP verification agent's headed browser (Walk loop Option C) is the fallback only when the recipe cannot run and the user opts into a second browser.

## Walker helpers — `scripts/walker/`

Two ESM modules make the walker self-sufficient without `BLOCKS_BEARER_TOKEN` or `list-targets.mjs`:

### `scripts/walker/auth.mjs`

Programmatic login + self-healing client. Resolves the IAM credential from the MCP secret store (`IAM Walker Login`), caches the access_token to disk, re-login when within 60s of expiry.

```js
import {
  walkerConfig, // { iam, apiUrl, oidcUrl, clientId, redirectUri, tenant, email, password }
  iamCredential, // async () => {email, password, source} — MCP store first, env fallback deprecated
  IAM_SECRET_NAME, // "IAM Walker Login" — the reserved secret name
  freshAccessToken, // async () => token — use as `accessToken: freshAccessToken`
  walkerClient, // async () => Blocks SDK with self-refreshing token
  forceRefresh, // async () => fresh token — drop cache, re-login
} from "./scripts/walker/auth.mjs";

const client = await walkerClient();
```

- The token cache is `.walker-token-cache.json` (JSON: `{access_token, expires_at}`). Exists at project root, written only by this module. Never committed.
- `walkerConfig()` reads `VITE_BLOCKS_*` from `.env`. `iamCredential()` resolves the login from the MCP store (`GET /secrets` → `IAM Walker Login` → loopback-only `GET /secrets/:id`); the `Email`/`Password` env keys are a deprecated fallback that warns. No `BLOCKS_BEARER_TOKEN` key is read.

### `scripts/walker/data.mjs`

API-only reads for the six cloud collections the walker needs. Backed by `client.data.collection(...)` against `Environment`, `VerificationCheck`, `UserPreference`, `VerificationTarget`, `Secret`, and `SecretBinding`. No Lattice UI navigation.

```js
import {
  fetchEnvironments, // (client, { projectId }) => [{id, slug, label, kind, order}]
  fetchVerificationChecks, // (client, { projectId, environmentId }) => [{checkId, source, label, enabled}]
  fetchActiveEnvironmentId, // (client) => activeEnvironmentId ("" when unset)
  fetchTargets, // (client, { projectId, environmentId, enabledOnly? }) => [{id, url, applicationName, …}]
  fetchSecrets, // (client, { projectId, environmentId }) => [{id, name, email, passwordMasked, …}]
  fetchSecretBindings, // (client, { projectId, environmentId }) => {id, bindings: {secretId: [targetId]}, updatedBy}
  loadWalkerContext, // one-shot: client + env row + all four env-scoped reads
} from "./scripts/walker/data.mjs";
```

- **Filter rule (v2.1):** env-scoped reads filter by `environmentId` when known, else by the legacy `{projectId, envSlug}` pair when **both** are truthy. Empty-string scopes are dropped (the gateway matches `""` literally and returns 0 rows). Without a scope, the call returns every row the user can read.
- **Field selectors must include every filtered column** (`environmentId`, or `projectId` + `envSlug`) or the gateway silently drops the rows — see `data-gateway-filter-rule` memory.
- **No password on the wire.** `fetchSecrets` returns `passwordMasked` only; there is no `password` field.

### When to fall back to `list-targets.mjs`

`scripts/verify/list-targets.mjs` still works — it scans Chrome profiles for an `access_token` cookie and queries `VerificationTarget` directly. **Walker does not invoke it**; only the user runs it manually when their cookie-based session is alive and they want a quick CLI view. The walker prefers the API path because it survives expired sessions and works in any environment (CI, fresh VM, headless).

### Where the browser is allowed — and where it never is

The distinction every earlier draft of this skill got wrong. Two different apps, two different doctrines:

- **Lattice (the tracker) — API only.** Walker never navigates the Lattice UI, never DOM-scrapes it, never reads its `localStorage` mirrors. Environments, Checks, Targets, Secrets, Bindings all come through `fetchTargets` / `fetchSecrets` / `fetchSecretBindings` / `loadWalkerContext` — even when the UI would be faster.
- **The target app — the stdio browser IS the primary surface** (user's standing instruction). After the pre-flight gates pass, walker opens a tab, checks the session, self-logins with the bound secret (loopback fill recipe), and walks every route itself. This walk IS the verification — user directive 2026-10-02, replacing the old "walker never touches a target URL" stance.
- **Passwords never enter model context in either case.** API reads mask them (`passwordMasked`); browser fills go through the loopback recipe inside the page. Typing a credential as a tool argument is always a rule-10 violation.

## Pre-flight — scope gate + session gate (always the first actions, before any walking or talking)

Run the gates in silence, in order. Your first message is whichever gate fails (exactly one line), or nothing at all when every gate passes — then you are already walking.

**Scope gate — everything hangs off the bootstrap prompt's `environmentId` (user directive, 2026-10-02). All reads through `loadWalkerContext({ projectId, environmentId })`, never the UI:**

1. **projectId + environmentId — both, verbatim.** The Bootstrap prompt pins both ("use these ids verbatim — do not re-resolve"); copied from an env page they always arrive together. If the user just said "verify" with no prompt, self-resolve BEFORE asking anything: bare `loadWalkerContext()` reads `UserPreference.activeEnvironmentId` and resolves that env's project — walk it without a question. Active preference also empty → ONE line: "কোন project আর environment verify করব বলুন — অথবা env পেজ থেকে Bootstrap prompt কপি করে দিন।" Stop. Do not guess.
2. **Targets in that env scope?** `ctx.targets` (use the `enabled` ones). None → one line: "এই environment-এ কোনো target নেই — Targets পেজে Add URL দিয়ে target যোগ করুন।" Stop.
3. **Secrets in that env scope?** `ctx.secrets` (use the `enabled` ones — a disabled secret is skipped, and any binding it holds is skipped with it). None → one line: "কোনো secret যোগ করা নেই — Secrets পেজে secret যোগ করে ওই target URL-এর সাথে bind করুন।" Stop.
4. **An enabled secret bound to the target?** `ctx.secretBindings` must map some **enabled** secretId to this target's id (or the target row's `credentialId` points at an enabled secret). Bound only to a disabled secret → one line: "bound secret টা disabled — Secrets পেজে Enable করুন।" Stop.
5. **All gates pass → navigate to the target. Immediately.** No confirmation question, no summary.

**Session gate — only after the scope gate passes.** Open the target URL and snapshot. Authenticated surface renders → start walking. Lands on a login screen → log in yourself with the recipe below (gate 4 guarantees the bound credential). The stored credential itself fails → one line: "store করা credential দিয়ে লগইন হচ্ছে না — Secrets পেজে মিলিয়ে নিন", stop.

**Never ask for credentials, never print them.** Bound secrets resolve through the MCP store; nothing sensitive is ever echoed, logged, or pasted.

### Login with the bound secret — the loopback fill recipe

The app being verified usually needs login. Use the bound credential WITHOUT the plaintext ever entering context (rule 10). The MCP server allows CORS from any origin, so the page itself can fetch it from loopback:

```js
// browser_evaluate — runs INSIDE the page; secretId comes from gate 4.
// Returns only a status string — the credential values never come back.
async () => {
  const res = await fetch("http://127.0.0.1:8787/secrets/<secretId>");
  if (!res.ok) return "store unreachable (" + res.status + ")";
  const { email, password } = await res.json();
  const set = (el, v) => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const emailEl = document.querySelector('input[type=email], input[name*="email" i], input[name*="user" i]');
  const passEl = document.querySelector('input[type=password]');
  if (!emailEl || !passEl) return "login form not found";
  set(emailEl, email);
  set(passEl, password);
  return "filled";
}
```

Then `browser_click` the submit button and snapshot the result. The password travels store → page directly; the model only ever sees "filled". If login fails, report "login failed" — never the values. If the MCP server isn't running, that is the one case where you ask the user (start the server, then retry once).

### Mid-walk session expiry

App sessions are short-lived — expect the stdio browser session to die mid-walk (login redirects or 401 storms on pages that worked minutes ago):

- **Re-login yourself with the bound secret** (recipe above) and resume immediately — no permission-wait, and never re-walk pages already verified (user directive, 2026-10-02).
- **Issue inserts never block.** They ride the walker API client, whose `accessToken` callback re-logins within 60s of token expiry (see `scripts/walker/auth.mjs`) — a dead target-app session cannot stop a filing.
- Only when the stored credential itself stops working: one line to the user ("session শেষ, আর stored credential দিয়েও লগইন হচ্ছে না — Secrets পেজে মিলিয়ে নিন"), pause UI walking, resume on their confirmation.
- The IAM login returns an `access_token` (~3.5h lifetime) and **no separate refresh token** — the client's silent re-login *is* the refresh.

## Walk loop (per target)

For each target URL the user has configured:

### 1. Reach the target

Open a new tab in the stdio browser (`browser_tabs action=new url=<target url>`). Wait for the page to settle. Then, on every reachable route:

1. `browser_snapshot` — read the accessibility tree. Note every interactive element: buttons, links, inputs, selects, checkboxes, role=button, role=link, role=tab.
2. `browser_evaluate` to read `document.body.innerText`, `localStorage`, `sessionStorage`, `document.cookie`, and any global state.
3. `browser_console_messages level=error` — capture every error.
4. `browser_network_requests static=true` — capture every >=400 response, CORS failures, failed fetches, redirects, OIDC endpoints.
5. **Click every visible button and link** unless it would log you out, navigate off-target, or trigger a destructive mutation you cannot revert.
6. **Fill every form**: type a value into each input, click submit, observe the result. Submitting with invalid data tests validation feedback — does the page show inline errors, or silently swallow them?
7. **Resize / theme / language**: change the theme button, switch language, resize the viewport. Theme button is a frequent broken control across many apps — verify on every target.
8. **Repeat until you reach a terminal state** (logged in, dead-end error page, modal that won't close).

#### Generic defect detection patterns

Apply these to **every** target — not just one. They generalize across any web app.

| Pattern                                                                                                | How to detect                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Heading text concat bug (multiple words smashed together in DOM, visual reading relies on CSS spacing) | Compare `h.innerText`, `h.textContent`, `h.innerHTML`. If `innerText` and `textContent` are both no-whitespace strings of multiple CapitalizedWords (e.g. `Signintocontinuetoyourapplication`), but `innerHTML` is a chain of `<span class="inline-block">` siblings with `margin-right` for visual spacing — that's the bug. Screen readers, copy/paste, search, all broken. |
| Theme toggle appears to no-op                                                                          | Check `localStorage.<theme-key>`, `sessionStorage.<theme-key>`, `document.cookie`, `document.documentElement.className`, `getComputedStyle(document.body).backgroundColor`. Theme may persist in cookie instead of localStorage — checking only one source yields false positives.                                                                                            |
| Console 401 on cold load                                                                               | On every fresh visit, the page issues an unauthenticated `GET /api/auth/me` (or similar) that returns 401. The 401 is logged to console.                                                                                                                                                                                                                                      |
| OIDC PKCE empty code_challenge                                                                         | After clicking "Log in", inspect the redirect URL. If `code_challenge=` (empty) appears alongside `code_challenge_method=S256`, the token exchange will return 400 from the IdP.                                                                                                                                                                                              |
| Duplicate list items in DOM                                                                            | Compare the count of list cards/rows in the DOM against the section header's claim (e.g. header says "10 services" but DOM has 20 cards). Use `browser_evaluate` to walk the section and count occurrences.                                                                                                                                                                   |
| Form submit with no feedback                                                                           | Submit empty/invalid data. If no inline error appears, no toast, no validation message — and the button stays disabled with no explanation — user is stuck.                                                                                                                                                                                                                   |
| Forgot-password button stuck disabled                                                                  | Type a syntactically valid email. If the submit button stays disabled and no error message is shown, the form is not reacting to input.                                                                                                                                                                                                                                       |
| Broken typo in user-facing label                                                                       | Read every visible label and verify spelling and casing. Common offenders: "Worflow Engine", "Recieved", "Sucessfully", doubled words ("the the"), missing spaces.                                                                                                                                                                                                            |
| Slow page load                                                                                         | Capture network timing in `browser_network_requests`. >5s for a typical SPA initial load is a candidate performance defect.                                                                                                                                                                                                                                                   |
| Broken link / dead CTA                                                                                 | Click every link. Track the resulting URL. Any 404, redirect-loop, or dead-end (`/` after `sign-out`) is a defect.                                                                                                                                                                                                                                                            |
| Empty state visible while loading                                                                      | Empty-state text renders while the data fetch is still in-flight. The walker mis-reads the page as empty if it trusts the empty-state alone.                                                                                                                                                                                                                                  |
| Validation feedback shown too briefly                                                                  | Inline error appears on submit but disappears within ~100ms with no replacement. User can't read it.                                                                                                                                                                                                                                                                          |
| Modal without close                                                                                    | Triggering an action opens a modal that has no X, no Cancel, no backdrop-click-to-close. User trapped.                                                                                                                                                                                                                                                                        |
| Form labels not associated with inputs                                                                 | `<label>` element exists but no `for=` linking it to the input. Click on label doesn't focus the input.                                                                                                                                                                                                                                                                       |
| Network request with sensitive payload to a wrong origin                                               | Form data (email, password, PII) sent over plain HTTP, or to a different origin than the page.                                                                                                                                                                                                                                                                                |
| Cookie not set with Secure / SameSite                                                                  | After login, inspect `Set-Cookie` headers. Missing `Secure` or `SameSite` on session cookie is a security defect (severity depends on context).                                                                                                                                                                                                                               |
| Required field marked optional (or vice versa)                                                         | Submit a form missing what the schema considers required; if the server returns 400 but the UI doesn't show the error, the validation is broken.                                                                                                                                                                                                                              |
| 5xx response on a happy-path click                                                                     | Any >=500 response during normal navigation, form submission, or page load.                                                                                                                                                                                                                                                                                                   |

Add new patterns to this list as you discover them across targets — but **always verify** before reporting a pattern as a defect on a specific target.

#### Snap and walk recipes — copy-paste these patterns

These came from gaps the walker hit on real pages. Use them as-is.

**Ref staleness.** After any state change (click, navigation, theme menu open, modal open), every `ref=eN` from the previous snapshot is invalidated. Re-snapshot before clicking. Don't chain clicks across snapshots.

**Click timeout fallback.** When `browser_click` on a link times out (5s), read the link's `href` from the snapshot and `browser_navigate` directly to that URL. Don't keep retrying the click.

**Theme persistence — check ALL storage, not just localStorage.** A previous walker filed a false-positive "theme button broken" because it only checked `localStorage.ft-theme`. The theme actually worked via cookie.

```js
const before = {
  ls: localStorage.getItem("ft-theme"),
  cookies: document.cookie,
  html: document.documentElement.className,
  bodyBg: getComputedStyle(document.body).backgroundColor,
};
// Open the theme menu (click "Change theme"), then click "Dark" / "Light"
const after = {
  ls: localStorage.getItem("ft-theme"),
  cookies: document.cookie,
  html: document.documentElement.className,
  bodyBg: getComputedStyle(document.body).backgroundColor,
};
// If docClass changed OR bodyBg changed → theme button works → NOT a defect
```

**Forcing React state update when input is filled but the form doesn't react.** When typing in a `<input>` doesn't enable a disabled submit button (or doesn't clear an error), the React controller may have missed the event. Bypass with the native setter:

```js
const nativeSetter = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype,
  "value",
).set;
nativeSetter.call(input, "test@example.com");
input.dispatchEvent(new Event("input", { bubbles: true }));
input.dispatchEvent(new Event("blur", { bubbles: true }));
// Now re-check the submit button state and any error message
```

**Two login affordances on a public landing.** The public landing often has both a "Log in" button AND a separate "Sign in" link at the page bottom. Both route to the IdP. Walk both — sometimes one is broken and the other works.

**Click + Tab to trigger blur.** Some forms run validation on `onBlur` instead of `onChange`. After typing, `browser_press_key key=Tab` to leave the field, then check error message and submit-button state.

**Login-required routes — three paths, in this order:**

- **Option A (preferred) — self-login with the bound secret.** The pre-flight scope gate guarantees a bound credential before you ever got here. Use the loopback fill recipe (Pre-flight section) in the same stdio tab and continue into the post-login pages. No user round-trip.
- **Option B — ask the user to log in.** Fallback for the session gate's failure case only: the bound credential itself failed (wrong/expired secret). One line, wait for the user to fix the secret or log in, then continue in the stdio tab.
- **Option C — kick off a verify run.** `POST /verify/runs` with the target's URL + credentialId + scope list. Stream SSE (`GET /verify/runs/<id>/events`) to watch the agent walk. Parse `kind: "issue_detected"` events into Issue rows. **Opens a second headed browser** — confirm with the user first.

### 2. Catalogue defects

For each defect you observed, capture:

| Field               | Value                                                                            |
| ------------------- | -------------------------------------------------------------------------------- |
| `applicationName`   | Display name from the Targets list for this env                                  |
| `url`               | The exact URL where the defect was reproduced                                    |
| `category`          | One of: `authentication`, `performance`, `accessibility`, `api`, `ui`, `other`   |
| `severity`          | `critical` / `high` / `medium` / `low`                                           |
| `status`            | `open`                                                                           |
| `title`             | Short, specific — `<observed symptom> on <route>`                                |
| `description`       | What you saw, including exact error strings, console messages, network responses |
| `expected`          | What the page should have done                                                   |
| `actual`            | What it did instead                                                              |
| `reproductionSteps` | Ordered list of clicks/types that reproduce                                      |
| `evidence`          | Console / network payloads with timestamps                                       |
| `detectedAt`        | ISO timestamp at the moment of observation                                       |
| `verificationRunId` | `manual-<env>-<ISO timestamp>` if walking by hand, or the agent's runId          |

### 3. Double-check, then insert immediately (no permission-wait)

When a defect is found: **re-observe it right away** — re-click, re-submit, re-read the network/console for the same symptom (user directive 2026-10-02: "duibar check debe"). Confirmed on the second observation → file it **immediately** via the Issue insert API below. Do NOT wait for user approval — rule 8 no longer lists inserts as destructive. Not confirmed on the re-check → it never existed; move on.

**Duplicate guard — never insert the same issue twice.** Before `collection.create()`, query the Issue collection with the flat filter `{fingerprint: <fp>}` scoped to the env (`environmentId` too — both fields must be in the collection's `fields` selector, `data-gateway-filter-rule`). A hit means the defect is **already filed**: this is a re-encounter, not a new issue — update the existing row instead (`occurrenceCount` +1 cast to **string**, `lastSeenAt` = now, append this runId to `seenInRunIdsJson`) and move on. Two rows for one defect is an insert bug.

**Update your own inserts anytime.** Walking a later functionality may reveal an already-filed issue needs correcting — better repro steps, new evidence, wrong severity. Update the row immediately, no permission-wait. Echo **every** field of the row on the update (`issue-tracker-update-requiredon-3-echo`: cloud marks fields `requiredOn: 3`, and the SDK resolves VALIDATION_ERROR silently — so verify `acknowledged` + `totalImpactedData` in the response, never trust a silent throw).

**Delete your own wrong inserts immediately.** A later observation may prove an issue you filed is flat-out wrong (false positive, misread page). Delete it right away (rule 4) — no permission round-trip — and note the deletion in the end-of-target summary. Issues you did **not** insert yourself are not yours to delete; those need the user.

File via the SDK mutation `collection.create()` against the Issue collection (`src/lib/blocks/data.ts` — `secretsCollection` is for secrets; the Issue collection is the sibling one used by `useIssueTracker.ts`). The fingerprint field MUST be computed using the FNV-1a formula at `useIssueTracker.ts:226-253` — reuse it, don't reinvent.

Keep a running list of what you filed and show it when the target's walk ends — transparency in the summary, not a permission gate mid-walk.

### 4. Move to the next target

After every reachable route on the current target is walked and every double-checked defect is filed, switch to the next target in the env. Never start the next target's walk until the current target's Issues page reflects your inserts and you've shown the filed list to the user.

## Issue insert API (cloud SDK)

The Issue collection lives in the same SDK client used by `useIssueTracker.ts`. Schemas and field selectors are in `src/lib/blocks/data.ts`. **Concrete end-to-end insert pattern:**

1. Load `.env` via `walkerConfig()` from `scripts/walker/auth.mjs` — the four `VITE_BLOCKS_*` keys are the required ones. The IAM credential is NOT an `.env` key: `walkerClient()` resolves it from the MCP secret store (`iamCredential()`) on every login.
2. `const client = await walkerClient();` — produces an SDK whose `accessToken` callback self-refreshes via `/api/auth/login`. No `BLOCKS_BEARER_TOKEN`, no `grab-token.mjs`, no Chrome profile scan.
3. Open the Issue collection with `client.data.collection("Issue", { fields: [<full field list>] })`. The full list is at the top of `scripts/verify/verify-20260930T015004Z.mjs`.
4. For each defect, compute the fingerprint, then **duplicate-guard**: query `where: ["fingerprint", "eq", "<fp>"]` (+ env scope) — an existing row means re-encounter: update `occurrenceCount`/`lastSeenAt`/`seenInRunIdsJson` instead of creating. Only a genuinely new fingerprint gets `collection.create(payload)`.
5. Write a summary JSON next to the script with each `itemId` (you'll need them for deletion).

Required fields for the `Issue` row: `title`, `applicationName`, `url`, `category`, `severity`, `status`, `description`, `expected`, `actual`, `reproductionStepsJson`, `evidenceJson`, `detectedAt`, `verificationRunId`, `fingerprint`, `occurrenceCount`, `lastSeenAt`, `seenInRunIdsJson`, `assignedDeveloperIdsJson`, `approvedById`, `CreatedBy`, `CreatedDate`, `LastUpdatedBy`, `LastUpdatedDate`. **Echo the env scope on every row (v2.1):** `projectId`, `envSlug`, and `environmentId` (the Environment ItemId) — plus `targetId` when you know which target row the defect came from (hard link that survives URL edits). Missing scope fields drop the issue out of the env's Issues view, and updates must echo every field (`issue-tracker-update-requiredon-3-echo`). Cast `occurrenceCount` to **string** (`"1"`), not number — the cloud stores it as text.

The fingerprint formula (mirror exactly, do not rewrite):

```ts
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
```

## Issue deletion (for wrong inserts)

Use the `deleteIssue` mutation. Filter by `fingerprint` or by exact `title`. **Your own wrong inserts: delete immediately** — rule 4 and the 2026-10-02 no-permission-wait directive apply to cleanup of your own mistakes; note the deletion in the summary. **Issues you did not insert: confirm with the user first** — those are someone else's rows, and the delete is destructive in cloud.

```ts
await issueCollection.delete({ id: "<issueItemId>" });
```

To find the itemId, list the env's Issues page (`/projects/<projectId>/<envSlug>/issues` in the Lattice UI — each row exposes its id on hover or in the row's payload) and read the row's id field. Or query the cloud with a `where: ["fingerprint", "eq", "<fp>"]` filter — `data-gateway-filter-rule` memory says the field must be flat `{field:value}` AND in the collection's `fields` selector.

**False-positive discipline.** When you find a defect on the current target, verify it with the recipe in the defect detection table — not by reading HTML. If you can't reproduce it within ~10s of manipulation, it isn't a defect.

## Memory references

These memories are load-bearing for this skill — read them on resume.

- [bangla-preferred](../MEMORY.md) — Bangla replies, English code.
- [data-gateway-filter-rule](../MEMORY.md) — flat `{field:value}` filters, every field in the `fields` selector.
- [access-token-must-be-undefined](../MEMORY.md) — `accessToken: () => Promise.resolve(undefined)` is mandatory in some contexts (NOT for the insert path — see Issue insert API above).
- [deployment-gap-defensive-reads](../MEMORY.md) — `blx_*` schemas 400 if not deployed; the four fallback hooks each have a localStorage mirror.
- [secret-edit-form-dynamic-ids](../MEMORY.md) — input ids are `secret-edit-name-<rowUuid>` / `secret-edit-email-<rowUuid>` after Edit click.
- [commit-needs-permission](../MEMORY.md) — stage freely to preview, but ask before commit/push/reset/clean.
- [issue-tracker-update-requiredon-3-echo](../MEMORY.md) — cloud marks projectId+envSlug `requiredOn: 3`; hooks must echo them on update.
- [env-schema-v21-rollout](../MEMORY.md) — env identity = `Environment.ItemId`; slug is a renameable display cache; scope lives in per-env `blx_VerificationChecks` rows; active env in `UserPreference.activeEnvironmentId`.

## What this skill is NOT for

- Reading or fixing Lattice's own source code (that's regular Blocks work).
- Walking a UAT/PROD env **unless the user pinned it** — the Bootstrap prompt's `environmentId` IS the explicit OK. Never choose UAT/PROD on your own; dev/custom envs the user pinned are walked freely.
- Walking the Blocks-IAM or Blocks-Data admin panels (different scope — add those as targets instead).
- Running `npm run build`, Vite, or any CI/deploy task.

If the user wants one of those, hand off to the relevant Blocks skill (`blocks-iam-users`, `blocks-data-storage`, etc.).
