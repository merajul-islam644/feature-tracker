// One-time migration: move the walker's IAM login from
// scripts/walker/.env.local into the MCP server's encrypted secret store
// under the reserved name "IAM Walker Login" (scripts/walker/auth.mjs'
// iamCredential() resolves it from there). Idempotent — re-runs upsert the
// same secret row. Prints nothing sensitive: no password, no email.
import { readFileSync, existsSync } from "node:fs";

const ENV_LOCAL = new URL("../walker/.env.local", import.meta.url);
const STORE = process.env.MCP_SERVER_URL ?? "http://127.0.0.1:8787";
const NAME = "IAM Walker Login";

function loadEnvLocal() {
  if (!existsSync(ENV_LOCAL)) return {};
  const out = {};
  for (const line of readFileSync(ENV_LOCAL, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

const env = loadEnvLocal();
if (!env.Email || !env.Password) {
  console.error('No Email/Password in scripts/walker/.env.local — nothing to migrate.');
  process.exit(1);
}

// Upsert under the existing row's id when the name already exists, so
// re-runs update in place instead of piling up duplicates.
const list = await fetch(`${STORE}/secrets`).then((r) => r.json());
const existing = (list.secrets ?? []).find((s) => s.name === NAME);
const r = await fetch(`${STORE}/secrets`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    ...(existing?.id ? { id: existing.id } : {}),
    name: NAME,
    email: env.Email,
    password: env.Password,
  }),
});
if (!r.ok) {
  console.error(`store write failed: ${r.status}`);
  process.exit(1);
}
const j = await r.json();
console.log(
  `migrated: secret id ${String(j.id).slice(0, 8)}… name "${NAME}"` +
    (existing ? " (updated in place)" : " (created)") +
    ' — source .env.local untouched; empty it when ready.',
);
