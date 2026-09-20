// Encrypted secret store — spec §4.
//
// Passwords are never written to disk in plaintext. On first boot we
// look up `MCP_SECRET_KEY` (64 hex chars). If it's not set we generate
// a fresh one and persist it to `./data/.master.key` mode 0600. In
// production this should come from a KMS / Vault, but for the
// in-repo verifier we use file-based AES-256-GCM.
//
// File layout (./data/secrets.enc):
//   { "v": 1, "iv": "<hex>", "tag": "<hex>", "data": "<base64-cipher>" }
//
// Plaintext payload (before encryption) is:
//   { secrets: [ { id, name, email, password, createdAt, updatedAt } ] }
//
// `app_get_credential` decodes the password in memory only and hands
// it directly to Playwright's `fill()` — the agent's LLM context
// never sees it.

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = join(__dirname, "..", "data");
export const SECRETS_FILE = join(DATA_DIR, "secrets.enc");
const MASTER_KEY_FILE = join(DATA_DIR, ".master.key");

interface StoredSecret {
  id: string;
  name: string;
  email: string;
  password: string;
  createdAt: string;
  updatedAt: string;
}

interface EncryptedFile {
  v: number;
  iv: string;
  tag: string;
  data: string;
}

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadOrCreateMasterKey(): Buffer {
  ensureDataDir();
  const fromEnv = process.env.MCP_SECRET_KEY;
  if (fromEnv) {
    const buf = Buffer.from(fromEnv, "hex");
    if (buf.length !== 32) {
      throw new Error("MCP_SECRET_KEY must be 64 hex chars (32 bytes).");
    }
    return buf;
  }
  if (existsSync(MASTER_KEY_FILE)) {
    const hex = readFileSync(MASTER_KEY_FILE, "utf8").trim();
    const buf = Buffer.from(hex, "hex");
    if (buf.length !== 32) throw new Error(".master.key is corrupt — delete it to regenerate.");
    return buf;
  }
  const fresh = randomBytes(32);
  writeFileSync(MASTER_KEY_FILE, fresh.toString("hex"), { encoding: "utf8" });
  try {
    chmodSync(MASTER_KEY_FILE, 0o600);
  } catch {
    // Windows ignores POSIX mode bits — fine.
  }
  return fresh;
}

let MASTER_KEY: Buffer | null = null;
function masterKey(): Buffer {
  if (!MASTER_KEY) MASTER_KEY = loadOrCreateMasterKey();
  return MASTER_KEY;
}

function readFile(): StoredSecret[] {
  if (!existsSync(SECRETS_FILE)) return [];
  const raw = readFileSync(SECRETS_FILE, "utf8");
  try {
    const enc = JSON.parse(raw) as EncryptedFile;
    if (enc.v !== 1) throw new Error(`Unknown secrets.enc version: ${enc.v}`);
    const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(enc.iv, "hex"));
    decipher.setAuthTag(Buffer.from(enc.tag, "hex"));
    const plain = Buffer.concat([decipher.update(Buffer.from(enc.data, "base64")), decipher.final()]);
    return JSON.parse(plain.toString("utf8")) as StoredSecret[];
  } catch (err) {
    throw new Error(
      `Could not decrypt ${SECRETS_FILE}. Is MCP_SECRET_KEY set correctly? (${(err as Error).message})`,
    );
  }
}

function writeFile(secrets: StoredSecret[]) {
  ensureDataDir();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(secrets), "utf8")), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload: EncryptedFile = {
    v: 1,
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    data: enc.toString("base64"),
  };
  writeFileSync(SECRETS_FILE, JSON.stringify(payload, null, 2), { encoding: "utf8" });
  try {
    chmodSync(SECRETS_FILE, 0o600);
  } catch {
    // ignore on Windows
  }
}

function hashId(seed: string): string {
  return "sec_" + createHash("sha256").update(seed).digest("hex").slice(0, 16);
}

function mask(password: string): string {
  if (!password) return "";
  if (password.length <= 2) return "*".repeat(password.length);
  return password[0] + "*".repeat(Math.max(password.length - 2, 4)) + password[password.length - 1];
}

export function listSecrets() {
  return readFile().map((s) => ({
    id: s.id,
    name: s.name,
    email: s.email,
    hasPassword: Boolean(s.password),
    passwordLength: s.password.length,
    passwordMasked: mask(s.password),
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }));
}

export function createSecret(input: {
  name: string;
  email: string;
  password: string;
}) {
  const now = new Date().toISOString();
  const secrets = readFile();
  const id = hashId(`${input.name}:${input.email}:${now}`);
  secrets.push({
    id,
    name: input.name,
    email: input.email,
    password: input.password,
    createdAt: now,
    updatedAt: now,
  });
  writeFile(secrets);
  return {
    id,
    name: input.name,
    email: input.email,
    hasPassword: true,
    passwordLength: input.password.length,
    passwordMasked: mask(input.password),
    createdAt: now,
    updatedAt: now,
  };
}

export function deleteSecret(id: string): boolean {
  const secrets = readFile();
  const next = secrets.filter((s) => s.id !== id);
  if (next.length === secrets.length) return false;
  writeFile(next);
  return true;
}

// Spec §4 table: the credential is passed straight to the Playwright
// context, not returned over a tool-use channel. Returned here only for
// the internal login flow — never for logging.
export function resolveCredentialForTarget(
  credentialId: string,
): { email: string; password: string } | undefined {
  const secrets = readFile();
  const match = secrets.find((s) => s.id === credentialId);
  if (!match) return undefined;
  return { email: match.email, password: match.password };
}
