// mail-server/server.mjs
//
// Inbound mail receiver for the Lattice mailbox.
//
// Pipeline:
//   anyone, from anywhere (Gmail/Outlook/…)
//     → the recipient's per-user address <name>.<uid6>@<domain>
//       (Cloudflare Email Routing catch-all on the inbound domain)
//     → Email Worker parses the raw message (postal-mime)
//     → POST /mail/inbound here (shared-secret header)
//     → To resolved against the blx_MailAddresses registry
//     → one row in blx_MailMessages (userId = the address owner)
//     → the /mail inbox shows it within ~15s (the page polls).
//
// Auth to the Blocks Data gateway follows the walker pattern
// (scripts/walker/auth.mjs): IAM password login → cached bearer with
// expiry → self-refreshing `accessToken` on the SDK client. A 401 mid
// insert drops the cache and retries once.
//
// Env (reads the repo root .env, then mail-server/.env.local overrides):
//   VITE_BLOCKS_API_URL        Blocks API base (default blocksapi.slsblx.com)
//   VITE_BLOCKS_KEY            tenant key (x-blocks-key)
//   VITE_BLOCKS_OIDC_*         OIDC client config for the SDK
//   Email / Password           service account used for inserts
//   MAIL_INBOUND_SECRET        shared secret the Email Worker must send
//   PORT                       listen port (default 8788)

import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createBlocksClient } from "@seliseblocks/client";

// --- env -------------------------------------------------------------------

function loadDotenv(path) {
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
    )
      value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotenv(new URL("../.env", import.meta.url));
loadDotenv(new URL("./.env.local", import.meta.url));

const cfg = {
  apiUrl: process.env.VITE_BLOCKS_API_URL ?? "https://blocksapi.slsblx.com",
  iam: "https://iam.seliseblocks.com",
  tenant: process.env.VITE_BLOCKS_KEY ?? "",
  oidcUrl: process.env.VITE_BLOCKS_OIDC_URL ?? "",
  clientId: process.env.VITE_BLOCKS_OIDC_CLIENT_ID ?? "",
  devHost: process.env.VITE_BLOCKS_DEV_HOST ?? "dbeegi.slsblx.com",
  devPort: process.env.VITE_BLOCKS_DEV_PORT ?? "",
  email: process.env.Email ?? "",
  password: process.env.Password ?? "",
  secret: process.env.MAIL_INBOUND_SECRET ?? "",
  port: Number(process.env.PORT ?? 8788),
};

// --- Blocks client (walker auth pattern) ------------------------------------

let cachedToken = null;
let cachedExpiry = 0;

async function freshAccessToken() {
  if (cachedToken && Date.now() / 1000 < cachedExpiry - 60) return cachedToken;
  const r = await fetch(
    cfg.iam + "/api/auth/login?tenant_id=" + cfg.tenant,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: cfg.email, password: cfg.password }),
    },
  );
  if (!r.ok) throw new Error(`IAM login failed: ${r.status} ${await r.text()}`);
  const j = await r.json();
  cachedToken = j.access_token;
  cachedExpiry = Math.floor(Date.now() / 1000) + (j.expires_in ?? 3600);
  return cachedToken;
}

async function forceRefresh() {
  cachedToken = null;
  cachedExpiry = 0;
  return freshAccessToken();
}

let client = null;
function getClient() {
  if (!client) {
    client = createBlocksClient({
      apiUrl: cfg.apiUrl,
      oidc: {
        clientId: cfg.clientId,
        url: cfg.oidcUrl,
        redirectUri: `https://${cfg.devHost}${cfg.devPort ? ":" + cfg.devPort : ""}/login/callback`,
      },
      xBlocksKey: cfg.tenant,
      accessToken: freshAccessToken,
    });
  }
  return client;
}

// Every column the app's `mailMessagesCollection` selects — a row written
// here must round-trip through the same projection the /mail page reads.
const MAIL_FIELDS = [
  "userId",
  "fromId",
  "fromName",
  "fromEmail",
  "toName",
  "subject",
  "body",
  "readAt",
  "CreatedBy",
  "CreatedDate",
  "LastUpdatedBy",
  "LastUpdatedDate",
];

// --- helpers ----------------------------------------------------------------

function safeEqual(a, b) {
  const ab = Buffer.from(String(a ?? ""));
  const bb = Buffer.from(String(b ?? ""));
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** `"Name" <a@b.c>` | `Name <a@b.c>` | `a@b.c` → { name, email } */
function parseFrom(value) {
  const s = String(value ?? "").trim();
  const m = /^(.*?)\s*<([^>]+)>\s*$/.exec(s);
  if (m) {
    const name = m[1].trim().replace(/^"|"$/g, "");
    const email = m[2].trim();
    return { name: name || email, email };
  }
  return { name: s, email: s };
}

function readBody(req, limitBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function insertInboundMail(row) {
  const col = getClient().data.collection("MailMessage", { fields: MAIL_FIELDS });
  try {
    return await col.create(row);
  } catch (err) {
    // Bearer may have expired mid-flight (the cache only proactively
    // refreshes near expiry) — one forced re-login + retry.
    const status = err?.httpStatusCode ?? err?.response?.status ?? 0;
    if (status !== 401) throw err;
    await forceRefresh();
    return await getClient().data.collection("MailMessage", { fields: MAIL_FIELDS }).create(row);
  }
}

// Columns the app's `mailAddressesCollection` selects — the registry
// read must mirror the same projection the registration wrote through.
const MAIL_ADDRESS_FIELDS = ["address", "userId", "userName"];

// address → userId, cached briefly so a burst of mail doesn't mean a
// gateway query per message. Negative results aren't cached: a user
// registers by opening the dialog, so a miss can become a hit at any time.
const ownerCache = new Map();
const OWNER_CACHE_TTL_MS = 5 * 60 * 1000;

function extractRows(resp) {
  const d = resp?.data ?? resp ?? {};
  if (Array.isArray(d)) return d;
  if (Array.isArray(d.items)) return d.items;
  if (Array.isArray(d.rows)) return d.rows;
  // The gateway nests paged payloads under a `get<Plural>` key:
  // `{ data: { getMailAddresses: { items, totalCount } } }` — same
  // shape `unwrapPaged` unwraps in the app. Take the first value
  // that actually carries items.
  for (const v of Object.values(d)) {
    if (v && typeof v === "object" && Array.isArray(v.items)) return v.items;
  }
  return [];
}

async function resolveOwner(toAddress) {
  const key = String(toAddress ?? "").trim().toLowerCase();
  if (!key) return null;
  const hit = ownerCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.userId;
  const lookup = () =>
    getClient()
      .data.collection("MailAddress", { fields: MAIL_ADDRESS_FIELDS })
      .list({ filter: { address: key }, pageNo: 1, pageSize: 5 });
  let resp;
  try {
    resp = await lookup();
  } catch (err) {
    // Same expired-bearer story as insertInboundMail — one forced
    // re-login + retry before giving up.
    const status = err?.httpStatusCode ?? err?.response?.status ?? 0;
    if (status !== 401) throw err;
    await forceRefresh();
    resp = await lookup();
  }
  const row = extractRows(resp).find(
    (r) => String(r?.address ?? "").trim().toLowerCase() === key,
  );
  if (!row?.userId) return null;
  ownerCache.set(key, {
    userId: row.userId,
    expires: Date.now() + OWNER_CACHE_TTL_MS,
  });
  return row.userId;
}

// --- tempmail.lol bridge ------------------------------------------------------
//
// Gives every user a real, routable mailbox WITHOUT owning a domain.
// `POST /bridge/register` creates a tempmail.lol inbox (free, keyless
// public API) and a 20s poller fetches new messages and writes them into
// blx_MailMessages through the same insertInboundMail path the Cloudflare
// worker uses. Inbox state persists in .bridge-accounts.json (gitignored)
// so addresses + tokens survive restarts.
//
// Why tempmail.lol and not mail.tm: mail.tm proved hostile to
// programmatic accounts — it silently deleted ours within the hour and
// locked logins on accounts it kept (verified empirically 2026-09-30).
// tempmail.lol has no login at all: creating an inbox returns an
// unguessable read token, so the whole password/auth failure class is
// gone. Trade-off: the local part is service-assigned, not name-derived.
// Swap this for the Cloudflare Email Routing path (see README) when a
// real domain enters the picture.

const TMBASE = "https://api.tempmail.lol/v2";
const BRIDGE_FILE = new URL("./.bridge-accounts.json", import.meta.url);
const bridge = new Map(); // address → { address, token, userId, userName, seenIds }

function loadBridge() {
  try {
    if (!existsSync(BRIDGE_FILE)) return;
    for (const row of JSON.parse(readFileSync(BRIDGE_FILE, "utf8"))) {
      bridge.set(row.address, row);
    }
  } catch (err) {
    console.warn("[bridge] state load failed:", err?.message ?? err);
  }
}

function saveBridge() {
  try {
    writeFileSync(BRIDGE_FILE, JSON.stringify([...bridge.values()], null, 2));
  } catch (err) {
    console.warn("[bridge] state save failed:", err?.message ?? err);
  }
}

async function tml(path, opts = {}) {
  const r = await fetch(TMBASE + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });
  if (r.status === 429) {
    // tempmail.lol free tier is rate-limited — back off once and retry.
    await new Promise((s) => setTimeout(s, 1500));
    return tml(path, opts);
  }
  return r;
}

/** Create an inbox: { address, token } — the token is the only credential. */
async function createInbox() {
  const r = await tml("/inbox/create", { method: "POST" });
  if (!r.ok) {
    throw new Error(`tempmail.lol inbox create failed: ${r.status}`);
  }
  return r.json();
}

/** Poll an inbox: { emails: [...], expired: bool }. */
async function fetchInbox(token) {
  const r = await tml(`/inbox?token=${encodeURIComponent(token)}`);
  if (!r.ok) {
    throw new Error(`tempmail.lol inbox read failed: ${r.status}`);
  }
  return r.json();
}

/** Best-effort mirror of the registration into blx_MailAddresses. */
async function registerCloudAddress(address, userId, userName) {
  const col = getClient().data.collection("MailAddress", {
    fields: MAIL_ADDRESS_FIELDS,
  });
  const resp = await col.list({ filter: { address }, pageNo: 1, pageSize: 5 });
  const exists = extractRows(resp).some(
    (r) => String(r?.address ?? "").toLowerCase() === address,
  );
  if (exists) return;
  await col.create({ address, userId, userName });
}

function stripHtml(html) {
  if (!html) return "";
  const raw = Array.isArray(html) ? html.join("\n") : String(html);
  return raw
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

const BRIDGE_POLL_MS = 20_000;
let bridgePolling = false;

function decodeQuotedPrintable(s) {
  // tempmail.lol hands over HTML-only mail as the raw quoted-printable
  // payload (=3D, =2C, soft line breaks) — undo it before stripping tags.
  // Bytes are reassembled first so multi-byte UTF-8 (=C3=BC, =E2=80=99)
  // decodes as whole characters, not latin-1 mojibake.
  if (!s.includes("=")) return s;
  const clean = s.replace(/=\r?\n/g, "");
  const bytes = [];
  for (let i = 0; i < clean.length; i++) {
    const hex = clean.slice(i + 1, i + 3);
    if (clean[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(clean.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

/** Stable identity for a polled email: prefer the service id, else a
 * content hash. The `date` field is re-stamped between fetches, so a
 * date-based key re-delivered the same mail after a server restart. */
function mailFingerprint(m) {
  if (m.id != null) return String(m.id);
  const h = createHash("sha1");
  h.update(String(m.from ?? ""));
  h.update("|");
  h.update(String(m.subject ?? ""));
  h.update("|");
  h.update(String(m.body ?? "").slice(0, 1024));
  return h.digest("hex");
}

async function pollAccount(acct) {
  const state = await fetchInbox(acct.token);
  if (state.expired) {
    // tempmail.lol retires inboxes eventually — roll a fresh one for the
    // user so they keep receiving. The address changes; the registry
    // mirror follows so the app shows the new address next fetch.
    console.warn(`[bridge] inbox expired — rolling a new one for ${acct.userId}`);
    const fresh = await createInbox();
    acct.address = fresh.address;
    acct.token = fresh.token;
    acct.seenIds = [];
    bridge.set(acct.address, acct);
    saveBridge();
    try {
      await registerCloudAddress(acct.address, acct.userId, acct.userName);
    } catch {
      /* mirror is best-effort */
    }
    return pollAccount(acct);
  }
  const seen = new Set(acct.seenIds ?? []);
  for (const m of state.emails ?? []) {
    const id = mailFingerprint(m);
    if (seen.has(id)) continue;
    const fromEmail =
      typeof m.from === "string" ? m.from : (m.from?.address ?? "");
    const fromName =
      typeof m.from === "string" ? "" : (m.from?.name ?? fromEmail);
    // Keep the decoded original — HTML mail stays HTML so the app's
    // reader can render it in its sandboxed frame with clickable links.
    const body =
      decodeQuotedPrintable(String(m.body ?? "")) ||
      String(m.html ?? "") ||
      "(this mail had no readable body)";
    await insertInboundMail({
      userId: acct.userId,
      fromId: fromEmail || `inbound_${randomUUID()}`,
      fromName: fromName || fromEmail || "Unknown sender",
      fromEmail,
      toName: acct.address,
      subject: String(m.subject ?? "").trim() || "(no subject)",
      body,
      readAt: "",
    });
    seen.add(id);
    console.log(
      `[bridge] delivered ${fromEmail || "?"} → ${acct.address}: ${String(m.subject ?? "").slice(0, 50)}`,
    );
  }
  acct.seenIds = [...seen].slice(-200);
  saveBridge();
}

async function pollBridge() {
  if (bridgePolling || bridge.size === 0) return;
  bridgePolling = true;
  try {
    for (const acct of bridge.values()) {
      try {
        await pollAccount(acct);
      } catch (err) {
        console.warn("[bridge] poll failed:", acct.address, err?.message ?? err);
      }
    }
  } finally {
    bridgePolling = false;
  }
}

loadBridge();

// --- server -----------------------------------------------------------------

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

  if (req.method === "GET" && pathname === "/healthz") {
    return json(res, 200, {
      ok: true,
      configured: Boolean(cfg.secret && cfg.email && cfg.tenant),
      registryMode: true,
      bridge: { accounts: bridge.size, pollMs: BRIDGE_POLL_MS },
    });
  }

  // Bridge register — called by the app (via the Vite dev proxy) when a
  // user opens the "Get Your Email" dialog. Idempotent per userId: the
  // persisted inbox wins, so the address stays stable across sessions.
  if (req.method === "POST" && pathname === "/bridge/register") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      return json(res, 400, { ok: false, error: `invalid JSON body: ${err.message}` });
    }
    const userId = String(body.userId ?? "").trim();
    const userName = String(body.userName ?? "").trim();
    if (!userId) {
      return json(res, 400, { ok: false, error: "userId is required" });
    }
    try {
      let acct = [...bridge.values()].find((a) => a.userId === userId);
      if (!acct) {
        const inbox = await createInbox();
        acct = {
          address: inbox.address,
          token: inbox.token,
          userId,
          userName,
          seenIds: [],
        };
        bridge.set(acct.address, acct);
        saveBridge();
      }
      // The cloud registry row is a mirror for the app's records — the
      // bridge's own map is the routing truth while it runs.
      try {
        await registerCloudAddress(acct.address, userId, userName);
      } catch (err) {
        console.warn("[bridge] registry mirror failed:", err?.message ?? err);
      }
      console.log(`[bridge] registered ${acct.address} → ${userId}`);
      return json(res, 200, { ok: true, address: acct.address });
    } catch (err) {
      console.error("[bridge] register failed:", err?.message ?? err);
      return json(res, 502, {
        ok: false,
        error: "bridge register failed",
        message: err?.message ?? String(err),
      });
    }
  }

  if (req.method !== "POST" || pathname !== "/mail/inbound") {
    return json(res, 404, { ok: false, error: "not found" });
  }

  // --- /mail/inbound below ---

  if (!cfg.secret || !cfg.email || !cfg.tenant) {
    return json(res, 500, {
      ok: false,
      error:
        "server not configured — need MAIL_INBOUND_SECRET and Blocks tenant/credentials",
    });
  }

  if (!safeEqual(req.headers["x-inbound-secret"], cfg.secret)) {
    return json(res, 401, { ok: false, error: "bad inbound secret" });
  }

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    return json(res, 400, { ok: false, error: `invalid JSON body: ${err.message}` });
  }

  const from = parseFrom(body.from);
  const subject = String(body.subject ?? "").trim() || "(no subject)";
  const text = String(body.text ?? "");
  // The recipient's address decides the owner. `Name <a@b.c>` and bare
  // `a@b.c` both parse; no To at all falls back to the legacy fixed owner.
  const toAddress = parseFrom(body.to).email;

  let ownerUid = null;
  try {
    ownerUid = await resolveOwner(toAddress);
  } catch (err) {
    console.error("[inbound] registry lookup failed:", err?.message ?? err);
    return json(res, 502, { ok: false, error: "registry lookup failed" });
  }
  if (!ownerUid) {
    // Strict registry mode: an address routes only after its owner has
    // opened the "Get Your Email" dialog once. Unknown mailboxes bounce
    // (Cloudflare retries, then bounces upstream) instead of dumping
    // into a catch-all owner's inbox.
    console.warn(`[inbound] no registry row for ${toAddress || "(no To)"} — bouncing`);
    return json(res, 404, {
      ok: false,
      error: `unknown mailbox: ${toAddress || "(no recipient)"}`,
    });
  }

  try {
    const resp = await insertInboundMail({
      userId: ownerUid,
      fromId: from.email || `inbound_${randomUUID()}`,
      fromName: from.name || from.email || "Unknown sender",
      fromEmail: from.email,
      toName: String(body.to ?? ""),
      subject: subject.slice(0, 500),
      body: text,
      readAt: "",
    });
    const item = resp?.data ?? resp;
    const id =
      item?.ItemId ?? item?.itemId ?? item?.data?.ItemId ?? null;
    console.log(
      `[inbound] stored mail from ${from.email || "?"} → ${ownerUid} via ${toAddress || "?"} (${id}): ${subject.slice(0, 60)}`,
    );
    return json(res, 201, { ok: true, id });
  } catch (err) {
    console.error("[inbound] insert failed:", err?.message ?? err);
    return json(res, 502, { ok: false, error: "gateway insert failed" });
  }
});

server.listen(cfg.port, () => {
  console.log(`mail-server listening on :${cfg.port}`);
  if (!cfg.secret) {
    console.warn("warning: MAIL_INBOUND_SECRET not set — /mail/inbound will refuse requests");
  }
  console.log(
    `[bridge] ${bridge.size} account(s) loaded; polling every ${BRIDGE_POLL_MS / 1000}s`,
  );
  setInterval(() => void pollBridge(), BRIDGE_POLL_MS);
  void pollBridge();
});
