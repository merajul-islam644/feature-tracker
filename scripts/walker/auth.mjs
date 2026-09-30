// scripts/walker/auth.mjs
//
// Dynamic, self-refreshing IAM authentication.
// Reads credentials from .env, performs programmatic login via the OIDC
// password-equivalent endpoint, caches the access_token to disk, and
// returns a callback suitable for the SDK's `accessToken` field.
//
// Why this exists:
//   - The cookie-only hosted-login flow has no caller-owned bearer to
//     forward (the IAM session is a Secure+HttpOnly cookie on the IdP).
//   - Walker scripts must run without ever opening the Lattice UI.
//   - Tokens expire (~3.5h). This module re-logs in when within 60s of
//     expiry, so a long-running walker session stays alive.

import { readFileSync, existsSync, writeFileSync } from "node:fs";

const CACHE_FILE = ".walker-token-cache.json";

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
    ) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function walkerConfig() {
  loadDotenv();
  // Personal credentials live next to this file (.env.local, gitignored),
  // not in the shared root .env — same override order as mail-server.
  loadDotenv(new URL("./.env.local", import.meta.url));
  const host = process.env.VITE_BLOCKS_DEV_HOST;
  const port = process.env.VITE_BLOCKS_DEV_PORT;
  return {
    iam: "https://iam.seliseblocks.com",
    apiUrl: process.env.VITE_BLOCKS_API_URL,
    oidcUrl: process.env.VITE_BLOCKS_OIDC_URL,
    clientId: process.env.VITE_BLOCKS_OIDC_CLIENT_ID,
    redirectUri: host
      ? `https://${host}${port ? ":" + port : ""}/login/callback`
      : "https://dbeegi.slsblx.com/login/callback",
    tenant: process.env.VITE_BLOCKS_KEY,
    email: process.env.Email,
    password: process.env.Password,
  };
}

let cachedToken = null;
let cachedExpiry = 0;

function loadCache() {
  try {
    if (!existsSync(CACHE_FILE)) return;
    const j = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
    if (j.access_token && j.expires_at) {
      cachedToken = j.access_token;
      cachedExpiry = j.expires_at;
    }
  } catch {}
}
function persistCache() {
  writeFileSync(
    CACHE_FILE,
    JSON.stringify({ access_token: cachedToken, expires_at: cachedExpiry }, null, 2),
  );
}
loadCache();

/** Async token resolver — call as `accessToken: freshAccessToken` in the SDK. */
export async function freshAccessToken() {
  if (cachedToken && Date.now() / 1000 < cachedExpiry - 60) return cachedToken;
  const cfg = walkerConfig();
  const r = await fetch(cfg.iam + "/api/auth/login?tenant_id=" + cfg.tenant, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: cfg.email, password: cfg.password }),
  });
  if (!r.ok) throw new Error(`login failed: ${r.status} ${await r.text()}`);
  const j = await r.json();
  cachedToken = j.access_token;
  cachedExpiry = Math.floor(Date.now() / 1000) + (j.expires_in ?? 3600);
  persistCache();
  return cachedToken;
}

/** Build a Blocks SDK client whose `accessToken` self-refreshes. */
export async function walkerClient() {
  const { createBlocksClient } = await import("@seliseblocks/client");
  const cfg = walkerConfig();
  return createBlocksClient({
    apiUrl: cfg.apiUrl,
    oidc: { clientId: cfg.clientId, url: cfg.oidcUrl, redirectUri: cfg.redirectUri },
    xBlocksKey: cfg.tenant,
    accessToken: freshAccessToken,
  });
}

/** Force a fresh login (drops cache, re-logs in). */
export async function forceRefresh() {
  cachedToken = null;
  cachedExpiry = 0;
  if (existsSync(CACHE_FILE)) writeFileSync(CACHE_FILE, "{}");
  return freshAccessToken();
}