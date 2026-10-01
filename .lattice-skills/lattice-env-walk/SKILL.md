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
3. **Don't insert without verification.** Every Issue row in the cloud must correspond to a defect you actually saw. If the user said it is OK in a specific case, fine; otherwise ask.
4. **Delete wrong inserts immediately.** If you inserted a defect and it later turns out to be wrong (false positive, you read the page wrong, the agent's failure mode was its own bug, not the app's), find it and delete it. Don't leave it and "explain later".
5. **Complete one target before moving to the next.** Don't start target B while target A is half-walked. The user will catch this and be angry.
6. **404 / can't-login = walk-stopper, not theme defect.** If a target URL returns 404, 5xx, or you can't reach the login form, stop, file an issue titled "Cannot reach <target> — login unreachable" with severity high, and ask the user before continuing. Don't go looking for cosmetic bugs on a page that doesn't load.
7. **Reply in Bangla.** Code, paths, branches, function names, env slugs, error messages stay in English. Only the prose around them is Bangla.
8. **Ask before destructive actions.** Inserting issues, deleting issues, cancelling a running verify run, restarting MCP server — these all require user confirmation or an explicit prior go-ahead in the current session. Reading pages, clicking buttons, navigating is fine.
9. **No screenshot spam.** Don't take screenshots to "show" the user what you see — they don't need a slideshow of every page. Use snapshots (`browser_snapshot`) and `browser_evaluate` to read state. Screenshots only when the user explicitly asks or when an evidence artefact needs to be saved.
10. **Stop the moment you find a leak, do not work around it.** If you discover the password is exposed in a log, response, SSE event, or file, STOP and tell the user. Don't paper over it, don't "use it just this once".

## Setup — one target at a time

### 0. Session bootstrap (programmatic only)

Walker never navigates the Lattice UI to read configuration. **All reads go through APIs** — Targets, Secrets, and Bindings are pulled by the helpers under `scripts/walker/`, never by walking the Lattice SPA.

**Required `.env` keys** (project root):

- `VITE_BLOCKS_API_URL` — Blocks Data API base URL (e.g. `https://blocksapi.slsblx.com`)
- `VITE_BLOCKS_OIDC_URL` — OIDC discovery URL (e.g. `https://iam.seliseblocks.com`)
- `VITE_BLOCKS_OIDC_CLIENT_ID` — OIDC client id (public, safe to read)
- `VITE_BLOCKS_KEY` — Blocks tenant key (public, safe to read)
- `Email` — IAM login email (per-user: ask whoever is running the skill for theirs, same as the password — never assume one specific person's)
- `Password` — IAM login password (used for programmatic login, see step 3)

No bearer token is read from the user. **Walker logs in itself** via the OIDC password-equivalent endpoint:

```
POST https://iam.seliseblocks.com/api/auth/login?tenant_id=<VITE_BLOCKS_KEY>
Content-Type: application/json

{ "username": "<Email>", "password": "<Password>" }
```

Response: `200 { access_token, expires_in: 12540, … }` — a bearer JWT, no PKCE / code exchange, no cookie jar required. The IAM session cookie that `BLOCKS_BEARER_TOKEN` previously piggy-backed on is irrelevant for this path.

**Walker never**:

- Scans Chrome profiles for cookies (`grab-token.mjs`'s job when run by the user manually — the walker does not invoke it).
- Reads `~/.bash_history`, `~/.zsh_history`, environment dumps, or any other filesystem artifact for credential harvesting.
- Opens the Lattice UI to read `localStorage` mirrors — those are a user-mist fallback only when the cloud is genuinely 401'ing.

**Walker bootstrap in order:**

1. **Load `.env`.** Use the inline dotenv loader at the top of `scripts/walker/auth.mjs`, or `import { config } from 'dotenv'; config({ path: '.env' })`. Verify the four `VITE_BLOCKS_*` keys + `Email` + `Password` exist. If missing, list them and ask the user to add to `.env`.
2. **Pick a scope.** Read `localStorage.lattice.mirror.active-env.v1` from the Lattice origin (the user's browser; not opened by walker) for `{projectId, envSlug}`. If empty, infer from the first VerificationTarget's `environment` field after fetching.
3. **Login programmatically.** `import { walkerClient } from "./scripts/walker/auth.mjs"; const client = await walkerClient();`. `walkerClient()` builds an SDK whose `accessToken` callback re-logs in when the cached token is within 60s of expiry (~3.5h lifetime) and refreshes from `.env`. No manual refresh step.
4. **Targets.** `import { fetchTargets } from "./scripts/walker/data.mjs"; const targets = await fetchTargets(client, { projectId, envSlug });`. Each row has `{id, url, applicationName, environment, credentialId, enabled, lastVerifiedAt, lastStatus}`.
5. **Secrets metadata.** `import { fetchSecrets } from "./scripts/walker/data.mjs"; const secrets = await fetchSecrets(client, { projectId, envSlug });`. Each row has `{id, name, email, passwordMasked}` — masked only, no plaintext (skill rule 10).
6. **Bindings (secretId → targetId[]).** `import { fetchSecretBindings } from "./scripts/walker/data.mjs"; const { bindings } = await fetchSecretBindings(client, { projectId, envSlug });`. Returns the parsed `bindingsJson` map.

**Hard rules for bootstrap:**

- **Never navigate the Lattice UI.** Walker reads everything through the cloud SDK and MCP server. No `browser_navigate` to `https://dbeegi.slsblx.com/...`, no DOM scraping, no `localStorage` mirror reads in stdio browser. The user opens Lattice themselves if they want.
- **Walker never opens a browser tab for any target URL.** `browser_tabs action=new url=<targetUrl>` is **not** a walker primitive. The walker does not open, walk, or screenshot target apps in any browser. Verification of the target app's UI is the MCP server's `POST /verify/runs` headed-browser agent — gated behind explicit user consent (skill rule 8).
- **Never auto-fill passwords.** Walker does not log in to anything. The MCP server's `/verify/runs` endpoint is the only mechanism that handles passwords, and that's gated behind explicit user consent (skill rule 8).
- **Never invent a token.** If `.env` has no valid `Email`/`Password`, walker stops and asks.
- **If a step fails**, surface the message to the user, do not retry in a loop.

For every target the user adds:

1. **The user adds the target.** In the Lattice UI: Projects → pick the project → pick the env → Targets page → "Add URL" with display name + URL. The target shows up in the list with id, url, enabled toggle.
2. **If the target needs login, the user adds a credential.** Secrets page → "+ Add Secret" with name + email + password + binding to the target via the secret-target dropdown. The secret is stored in `mcp-server/data/secrets.enc` (AES-256-GCM). The cloud only sees `passwordMasked`. The actual password never leaves the MCP server's process — there is no API endpoint that returns it, and the classifier will block any attempt to extract it as **Credential Exploration**.
3. **The user picks verification scope.** Scopes page — checkbox grid covering `page_load`, `navigation`, `buttons`, `forms`, `broken_links`, `console_errors`, `network_errors`, `authentication`, `accessibility`, `performance`, `all_functionality`. Saved to `lattice.verification-checks.v1`. Use these for both the agent run and the manual walk.
4. **Walker reads the configuration.** Read targets from `/projects/<projectId>/<envSlug>/targets`; read bindings from `localStorage.lattice.mirror.secretBindings.v1`; read scope from `localStorage.lattice.verification-checks.v1`.

If any of these is missing, ask the user to set it up. Don't fabricate bindings.

#### Reading configuration when the Lattice UI is unreachable

The walker does **not** read Lattice configuration through a browser. All of it comes through `scripts/walker/data.mjs` helpers, which use the cloud SDK. There is no fallback to `localStorage` mirrors in the stdio browser — that path is gone.

```js
// Walker script (no browser)
import { walkerClient } from "./scripts/walker/auth.mjs";
import {
  fetchTargets,
  fetchSecrets,
  fetchSecretBindings,
} from "./scripts/walker/data.mjs";
const client = await walkerClient();
const targets = await fetchTargets(client, { projectId, envSlug });
const secrets = await fetchSecrets(client, { projectId, envSlug });
const { bindings } = await fetchSecretBindings(client, { projectId, envSlug });
```

If the cloud SDK returns 401 even after auto-login, the only dynamic action is `forceRefresh()` from `scripts/walker/auth.mjs`. If that also fails, walker stops and asks the user to verify `.env` `Email`/`Password`.

#### Configuration fetch — full decision tree

Walk this in order. Stop at the first path that yields `[{id, url, applicationName, environment, credentialId, enabled}]`.

1. **API helpers** (`fetchTargets`, `fetchSecrets`, `fetchSecretBindings` from `scripts/walker/data.mjs`). Always first. If it works, walker gets full config without opening any tab. Done.
2. **`list-targets.mjs`** (`node scripts/verify/list-targets.mjs`). User runs this manually when they want a CLI view; walker does **not** invoke it. It scans Chrome profiles for an `access_token` cookie and queries `VerificationTarget`. Survives only when the cookie is still alive.
3. **Lattice UI in stdio browser** (legacy, discouraged). `browser_navigate` to `/projects/<id>/<env>/targets`, scrape the DOM, read `localStorage.lattice.mirror.secretBindings.v1` via `browser_evaluate`. **Walker never does this.** The user opens Lattice in their own browser if they want this view.
4. **Nothing works.** Walker has no config. Stop and ask the user to verify `.env` `Email`/`Password` and rerun the helpers.

#### Requesting login from the user — concrete template

When path 4 hits, walker cannot fabricate, guess, or walk. Use exactly this template (translated into the user's preferred language):

> Walker cannot read target URLs because `.env` has no working `Email`/`Password` for programmatic IAM login. To unblock:
>
> 1. Open `.env` in the project root.
> 2. Confirm the four `VITE_BLOCKS_*` keys + `Email` + `Password` are present and correct.
> 3. Re-run the walker (it will re-login via `/api/auth/login` automatically).
>
> Targets fetched this way include `id`, `url`, `applicationName`, `environment`, `credentialId`, `enabled` — the full set needed for the walk loop.

Do not silently invent a target list. Do not walk URLs from old chat history. Do not skip the configuration step.

If the user can't or won't put credentials in `.env`, walker stops. There is no `BLOCKS_BEARER_TOKEN` path anymore — that was the cookie-jar approach and is no longer supported by the walker.

## Architecture — know this cold

The MCP server (`mcp-server/src/index.ts`) holds the encrypted secret store. The only function that decrypts is `resolveCredentialForTarget(id)` in `mcp-server/src/secrets.ts:191`. It returns `{email, password}` **only inside the MCP server's process**. The password is then handed directly to Playwright's `fill()` (`mcp-server/src/agent.ts:1049`):

```
const cred = resolveCredentialForTarget(credentialId);  // internal
await passwordInput.fill(cred.password);                 // into Playwright, never into a response
```

There is no HTTP endpoint, SSE event, evidence file, run-event payload, or test script that returns the plaintext password over the wire. The comment in `secrets.ts:15` says it explicitly: _"the agent's LLM context never sees it."_ If you find yourself searching for "the API call that gives me the password", stop — it does not exist by design. The classifier will block this search as **Credential Exploration** anyway.

Two Playwright instances are in play. Do not confuse them.

| Instance                                                       | Started by                                                 | Used for                                                                                                                                                       | Password access                                                   |
| -------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| stdio `@playwright/mcp@0.0.82` (via `playwrightMcp.ts` bridge) | Claude Code startup                                        | `browser_navigate`, `browser_click`, `browser_snapshot`, `browser_evaluate`, `browser_fill_form`, `browser_tabs`, etc. — the interactive session the user sees | None. Filling a password field from this session fails or no-ops. |
| MCP server's own Playwright (`mcp-server/src/agent.ts`)        | `POST /verify/runs` or `mcp-server/scripts/debug-login.ts` | The verification agent — drives a **headed** Chrome window the user sees on the host                                                                           | Yes — `resolveCredentialForTarget` runs in this process           |

The user's standing instruction is **the existing stdio browser session is the primary surface**. Don't kick off `/verify/runs` to "open a browser" — it opens a _second_ headed browser window. Use the existing stdio browser; open a new tab in it (`browser_tabs action=new`) to reach the target URL.

For login-required flows inside the stdio browser, the only mechanism is the MCP verification agent's headed browser. The agent fills the password in its own process and drives the visible window. The user can interact with that window too — the agent and the user share one browser session per run.

## Walker helpers — `scripts/walker/`

Two ESM modules make the walker self-sufficient without `BLOCKS_BEARER_TOKEN` or `list-targets.mjs`:

### `scripts/walker/auth.mjs`

Programmatic login + self-healing client. Read credentials from `.env`, cache the access_token to disk, re-login when within 60s of expiry.

```js
import {
  walkerConfig, // { iam, apiUrl, oidcUrl, clientId, redirectUri, tenant, email, password }
  freshAccessToken, // async () => token — use as `accessToken: freshAccessToken`
  walkerClient, // async () => Blocks SDK with self-refreshing token
  forceRefresh, // async () => fresh token — drop cache, re-login
} from "./scripts/walker/auth.mjs";

const client = await walkerClient();
```

- The token cache is `.walker-token-cache.json` (JSON: `{access_token, expires_at}`). Exists at project root, written only by this module. Never committed.
- `walkerConfig()` reads `VITE_BLOCKS_*`, `Email`, `Password` from `.env`. No `BLOCKS_BEARER_TOKEN` key is read.

### `scripts/walker/data.mjs`

API-only reads for the three cloud collections the walker needs. Backed by `client.data.collection(...)` against `VerificationTarget`, `Secret`, and `SecretBinding`. No Lattice UI navigation.

```js
import {
  fetchTargets, // (client, { projectId, envSlug, enabledOnly? }) => [{id, url, applicationName, …}]
  fetchSecrets, // (client, { projectId, envSlug }) => [{id, name, email, passwordMasked, …}]
  fetchSecretBindings, // (client, { projectId, envSlug }) => {id, bindings: {secretId: [targetId]}, updatedBy}
  loadWalkerContext, // one-shot: client + all three for the given scope
} from "./scripts/walker/data.mjs";
```

- **Filter rule:** `filter: {projectId, envSlug}` is only sent when **both** are truthy. Empty-string scopes are dropped (the gateway matches `""` literally and returns 0 rows). Without a scope, the call returns every row the user can read.
- **Field selectors must include `projectId` and `envSlug`** for the gateway to honor the filter — see `data-gateway-filter-rule` memory.
- **No password on the wire.** `fetchSecrets` returns `passwordMasked` only; there is no `password` field.

### When to fall back to `list-targets.mjs`

`scripts/verify/list-targets.mjs` still works — it scans Chrome profiles for an `access_token` cookie and queries `VerificationTarget` directly. **Walker does not invoke it**; only the user runs it manually when their cookie-based session is alive and they want a quick CLI view. The walker prefers the API path because it survives expired sessions and works in any environment (CI, fresh VM, headless).

### Walker never opens browser tabs

A load-bearing rule, repeated here because every earlier draft of this skill drifted back into browser navigation:

- **Walker does not call `browser_navigate`, `browser_tabs action=new url=<targetUrl>`, or any other browser tool.** No tab opens for any target URL, ever.
- Walker reads config through `fetchTargets` / `fetchSecrets` / `fetchSecretBindings` (API) — not through DOM scraping in the stdio browser.
- Walker does **not** walk target app UIs. Walking target apps is the MCP server's `POST /verify/runs` headed-browser agent. Walker only files the defects the MCP server reports, via the Issue insert API.
- The user's stdio browser session stays untouched unless the user opens something themselves.

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

**Login-required routes — two paths:**

- **Option A — ask the user to log in.** The user fills the password in the headed browser the verify agent runs (or in their own browser); you then continue walking post-login pages in the stdio browser. The stdio browser does not share session cookies with the verify agent's browser by default, so prefer this when you only need to read post-login pages.
- **Option B — kick off a verify run.** `POST /verify/runs` with the target's URL + credentialId + scope list. Stream SSE (`GET /verify/runs/<id>/events`) to watch the agent walk. Parse `kind: "issue_detected"` events into Issue rows. **Opens a second headed browser** — confirm with the user first.

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

### 3. Confirm with the user before inserting

Present each defect to the user as a short list. Use `AskUserQuestion` for per-defect OK, OR list them in chat and wait for the user's "OK to insert all" / "skip X, insert Y" reply. Never batch-insert defects the user hasn't seen.

If the user says "yes, insert all", file them via the SDK mutation `collection.create()` against the Issue collection (`src/lib/blocks/data.ts` — `secretsCollection` is for secrets; the Issue collection is the sibling one used by `useIssueTracker.ts`). The fingerprint field MUST be computed using the FNV-1a formula at `useIssueTracker.ts:226-253` — reuse it, don't reinvent.

### 4. Move to the next target

After every reachable route on the current target is walked and every approved defect is filed, switch to the next target in the env. Never start the next target's walk until the current target's Issues page reflects your inserts and you've shown them to the user.

## Issue insert API (cloud SDK)

The Issue collection lives in the same SDK client used by `useIssueTracker.ts`. Schemas and field selectors are in `src/lib/blocks/data.ts`. **Concrete end-to-end insert pattern:**

1. Load `.env` via `walkerConfig()` from `scripts/walker/auth.mjs` (VITE_BLOCKS_API_URL, VITE_BLOCKS_OIDC_URL, VITE_BLOCKS_OIDC_CLIENT_ID, VITE_BLOCKS_KEY, Email, Password are the required keys).
2. `const client = await walkerClient();` — produces an SDK whose `accessToken` callback self-refreshes via `/api/auth/login`. No `BLOCKS_BEARER_TOKEN`, no `grab-token.mjs`, no Chrome profile scan.
3. Open the Issue collection with `client.data.collection("Issue", { fields: [<full field list>] })`. The full list is at the top of `scripts/verify/verify-20260930T015004Z.mjs`.
4. For each defect, compute the fingerprint using the formula below, build the payload, call `collection.create(payload)`.
5. Write a summary JSON next to the script with each `itemId` (you'll need them for deletion).

Required fields for the `Issue` row: `title`, `applicationName`, `url`, `category`, `severity`, `status`, `description`, `expected`, `actual`, `reproductionStepsJson`, `evidenceJson`, `detectedAt`, `verificationRunId`, `fingerprint`, `occurrenceCount`, `lastSeenAt`, `seenInRunIdsJson`, `assignedDeveloperIdsJson`, `approvedById`, `CreatedBy`, `CreatedDate`, `LastUpdatedBy`, `LastUpdatedDate`. Cast `occurrenceCount` to **string** (`"1"`), not number — the cloud stores it as text.

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

Use the `deleteIssue` mutation. Filter by `fingerprint` or by exact `title`. Confirm with the user before deletion — even for an issue you inserted by mistake, the delete is destructive in cloud.

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

## What this skill is NOT for

- Reading or fixing Lattice's own source code (that's regular Blocks work).
- Inserting defects into UAT/PROD without an explicit user OK — UAT/PROD are user-facing; blind inserts are destructive.
- Walking the Blocks-IAM or Blocks-Data admin panels (different scope — add those as targets instead).
- Running `npm run build`, Vite, or any CI/deploy task.

If the user wants one of those, hand off to the relevant Blocks skill (`blocks-iam-users`, `blocks-data-storage`, etc.).
