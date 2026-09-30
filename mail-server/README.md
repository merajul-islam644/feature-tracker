# Lattice mail-server — receive email from anywhere into the /mail inbox

Gives every workspace user a real, routable email address. Anything sent to
a user's address — from Gmail, Outlook, a cron job, another app — lands in
*that user's* `/mail` inbox as a normal message.

## Two ways to get an inbound address

| | **tempmail.lol bridge** (default) | **Cloudflare Email Routing** |
| --- | --- | --- |
| Needs | nothing — free keyless API | a domain you control + Cloudflare |
| Address | service-assigned (`<random>@<tempmail.lol domain>`) | `<name>.<uid6>@<your domain>` |
| Latency | ~20s (poller) | seconds (push) |
| Fit | dev / demo | production |

The bridge is on by default: opening **Get Your Email** calls
`POST /bridge/register` (through the Vite `/api/mail-bridge` proxy), which
creates or reuses a tempmail.lol inbox for that user, mirrors it into
`blx_MailAddresses`, and returns the address. The inbox has **no login** —
creating it returns an unguessable read token, and a 20s poller on this
process pulls new messages and writes them through the same
`insertInboundMail` path the Cloudflare worker uses. Inbox state persists
in `mail-server/.bridge-accounts.json` (gitignored) — addresses stay
stable across restarts, and an expired inbox is rolled automatically
(the address changes; the registry mirror follows).

> Why not mail.tm: it silently deleted our programmatically created
> accounts within the hour and locked logins on the survivors — unusable
> as a mailbox host (verified 2026-09-30).

```
sender (anywhere)
  │ SMTP
  ▼
tempmail.lol inbox (per-user)      ← POST /bridge/register created it
  │ this process polls every 20s
  ▼
insertInboundMail → blx_MailMessages → that user's /mail inbox (15s polling)
```

```
sender (anywhere)
  │ SMTP
  ▼
<name>.<uid6>@<your-domain>      ← per-user address (inboundAddressFor)
  │ Cloudflare Email Routing (catch-all)      raw email
  ▼
Cloudflare Email Worker          ← this repo: cloudflare/email-worker.js
  │ POST /mail/inbound (+ shared secret)
  ▼
mail-server (Cloud Run)          ← this repo: server.mjs
  │ To → userId via the blx_MailAddresses registry
  ▼
blx_MailMessages  →  that user's Lattice /mail inbox (page polls every 15s)
```

## Addresses are per-user and dynamic (Cloudflare path)

- The app derives each user's address as `<name-slug>.<first-6-of-uid>@<domain>`
  (`inboundAddressFor` in `src/lib/blocks/data.ts`; domain from
  `VITE_MAIL_INBOUND_DOMAIN`). The tempmail.lol bridge keeps the registry
  row in sync with whatever address the service assigned.
- Opening the **Get Your Email** dialog registers the address on
  `blx_MailAddresses` (`address → userId`). **An address only routes after
  its first registration** — the receiver bounces unknown mailboxes with a
  404 so Cloudflare retries/bounces upstream.
- The catch-all route is what makes the addresses dynamic: every local part
  on the domain flows to the Worker, and the receiver decides ownership.

## Components

| Path | Role |
| --- | --- |
| `server.mjs` | HTTP receiver: validates the shared secret, resolves To → owner via `blx_MailAddresses` (5-min cache, negative results uncached), inserts one `MailMessage` row per email (Blocks Data gateway, walker-style IAM login + cached bearer). |
| `cloudflare/email-worker.js` | Cloudflare Email Worker: parses the raw message with `postal-mime`, POSTs `{ from, to, subject, text, receivedAt }` to the receiver. |
| `Dockerfile` | Cloud Run container for the receiver. Secrets come from Cloud Run env vars, never the image. |

## Run locally

```bash
cp mail-server/.env.example mail-server/.env.local
# fill MAIL_INBOUND_SECRET (see the file)
node mail-server/server.mjs          # listens on :8788

# smoke test (simulates the Email Worker):
curl -X POST http://localhost:8788/mail/inbound \
  -H "Content-Type: application/json" \
  -H "x-inbound-secret: <secret>" \
  -d '{"from":"Ada <ada@example.com>","to":"meraj.zoarder.41a740@your-domain.com","subject":"Hello","text":"First inbound mail."}'
# → 201 once that address is registered; 404 {unknown mailbox} before.
```

The Blocks tenant values (`VITE_BLOCKS_*`) are read from the repo root
`.env`; the IAM credentials (`Email`, `Password`) and the inbound secret
live in gitignored `mail-server/.env.local` — same loader as
`scripts/walker/auth.mjs` (which reads its own `scripts/walker/.env.local`).

## Deploy the receiver (Cloud Run)

```bash
gcloud builds submit mail-server \
  --tag us-central1-docker.pkg.dev/<PROJECT>/feature-tracker/mail-server

gcloud run deploy lattice-mail-server \
  --image us-central1-docker.pkg.dev/<PROJECT>/feature-tracker/mail-server \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars MAIL_INBOUND_SECRET=<secret>
```

`--allow-unauthenticated` is safe here because every `/mail/inbound`
request must carry `x-inbound-secret`; the value is the gate. Rotate it
by updating the env var and the Worker secret together.

## Attach the Cloudflare side

1. **DNS/MX**: add the domain to Cloudflare (free plan works); Cloudflare
   adds the MX + SPF records for Email Routing automatically when you
   enable it (Email Routing → enable for the domain).
2. **Worker**: from `mail-server/cloudflare/`:
   ```bash
   npm i postal-mime
   npx wrangler login
   npx wrangler secret put INBOUND_URL       # https://<cloud-run-url>/mail/inbound
   npx wrangler secret put INBOUND_SECRET    # same value as MAIL_INBOUND_SECRET
   npx wrangler deploy
   ```
3. **Route**: Cloudflare dashboard → Email Routing → Routes →
   Catch-all → *Send to a Worker* → `lattice-inbound-mail`. The catch-all
   is required — per-user addresses only exist because every local part
   reaches the receiver.
4. Open `/mail` → **Get Your Email** for the user whose address you want
   to test (registers it), then send a test email from any account → it
   appears in their inbox within ~15s (the page polls).

## Notes & limits

- **Body is plain text** (`parsed.text`). HTML-only mail falls back to
  an empty body; attachments are dropped for now.
- **Row-level security**: `blx_MailMessages` (and now `blx_MailAddresses`)
  were created with Public schema access (the platform default on push).
  Tightening them with Custom access + owner-only data-access policies —
  exactly what `blx_Notifications` got — is a deliberate follow-up via
  the Blocks Data UI (the CLI drops the policy rule fields silently).
  Note the registry must stay readable by the receiver's service account,
  so "owner-only" applies to the mail rows; the address registry needs a
  service-account-readable policy.
- **Spam**: public addresses receive spam. Sender allow-listing is an
  easy extension of the receiver if it becomes a problem.

