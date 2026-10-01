# Issue Tracker MCP server

Real Playwright-driven verification agent for the Issue Tracker. Mirrors
`prompt/Issue-Tracker-MCP-Design.md` step 5–7.

## Install

```sh
cd mcp-server
npm install
npx playwright install chromium
```

The Playwright Chromium binary is ~150MB and only downloads on first
install. Without it, `testConnection` and `runAgent` will error on
launch.

## Run

```sh
npm run dev          # tsx watch, hot reload on save
# or
npm run start        # one-shot
```

The server listens on `:8787` by default. Override with `MCP_PORT=…`.

The Vite dev server proxies `/api/verify/*`, `/api/secrets`, and
`/api/evidence/*` to it. No code change needed — the existing
`verifyProxy()` in `vite.config.ts` already forwards those paths;
`VERIFY_BACKEND_URL=http://localhost:8787` is its new default.

## Smoke

```sh
npm run smoke
```

Boots the server, exercises the secrets API end-to-end, kills the
process. Exits non-zero on any failure.

## What it does

| Endpoint                       | What happens                                                    |
|--------------------------------|-----------------------------------------------------------------|
| `POST /verify/test`            | One-shot probe — opens Chromium, optionally logs in, returns `{ urlReachable, loginSuccessful }`. |
| `POST /verify/runs`            | Starts a run. Idempotent on `(userId, targets, scope)`. Background agent loop writes `RunEvent`s into an in-memory store. |
| `GET /verify/runs/:id/events`  | SSE tail — replays buffered events, then streams new ones via 1.5s long-poll wakeups. |
| `POST /verify/runs/:id/stop`   | Marks the run `cancelled` and emits `run_failed`.               |
| `GET /secrets`                 | List secrets — `passwordMasked` only; plaintext is encrypted at rest. |
| `POST /secrets`                | Encrypts the password (`aes-256-gcm`) and writes to `./data/secrets.enc`. |
| `DELETE /secrets/:id`          | Removes from the encrypted file.                                |
| `GET /evidence/:filename`      | Streams an evidence file. Filename prefix must match the supplying `runId`. |

## Security notes

- Passwords are written to disk only inside `secrets.enc` (AES-256-GCM with a per-install master key in `./data/.master.key`). Set `MCP_SECRET_KEY` (64 hex chars) to a known value across restarts.
- Spec §7 lists KMS/Vault as the production posture; this in-repo build uses file-based encryption as a placeholder.
- Evidence filenames are prefixed with the supplying `runId`. `/evidence/:filename?runId=…` requires the prefix to match.
- The agent's LLM context never sees plaintext passwords — `resolveCredentialForTarget` returns the password straight to Playwright's `fill()`.
- `browser_navigate` is restricted to the configured target URLs (no free-form URL navigation).
- Reusable browser contexts are explicitly avoided — one fresh context per run (auth state is dropped on completion).

## What's intentionally NOT here yet

- KMS/Vault-backed master key (spec §4).
- Browser pool with persistent warm contexts.
- Real-time stream of `RunEvent`s into the AI Assistant chat.
- Anthropic computer-use tool (we use Playwright primitives).
