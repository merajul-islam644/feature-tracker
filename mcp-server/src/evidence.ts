// Evidence store — spec §6 step 7.
//
// Artifacts (screenshots, console logs, HAR files) live on disk under
// `./data/evidence/`. Each file gets a random `ref` (16 hex chars).
// The MCP server returns `storageRef` (just the ref) to the frontend
// in `RunEvent.evidence`; the frontend prepends `/api/evidence/` to
// resolve the URL.
//
// Authorization is enforced in `routes.ts` — see `requireRunOwnership`.

import { createHash, randomBytes } from "node:crypto";
import { writeFileSync, existsSync, mkdirSync, statSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { DATA_DIR } from "./secrets.js";

export const EVIDENCE_DIR = join(DATA_DIR, "evidence");

export type EvidenceMime =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "text/plain"
  | "application/json";

const MIME_BY_EXT: Record<string, EvidenceMime> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".log": "text/plain",
  ".txt": "text/plain",
  ".json": "application/json",
  ".har": "application/json",
};

function ensureEvidenceDir() {
  if (!existsSync(EVIDENCE_DIR)) mkdirSync(EVIDENCE_DIR, { recursive: true });
}

export function saveEvidence(
  bytes: Buffer | string,
  opts: { mime?: EvidenceMime; extension?: string; runId: string; label: string },
): { ref: string; url: string } {
  ensureEvidenceDir();
  const ext = opts.extension ?? ".bin";
  const ref = randomBytes(8).toString("hex");
  const filename = `${opts.runId}_${ref}${ext}`;
  const fullPath = join(EVIDENCE_DIR, filename);
  if (typeof bytes === "string") {
    writeFileSync(fullPath, bytes, "utf8");
  } else {
    writeFileSync(fullPath, bytes);
  }
  // Stable hash for client-side caching.
  return {
    ref: filename,
    url: `/api/evidence/${filename}`,
  };
}

export function resolveEvidence(filename: string): {
  buffer: Buffer;
  mime: EvidenceMime;
  size: number;
} | undefined {
  // Path-traversal guard — reject anything that tries to escape EVIDENCE_DIR.
  if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) return undefined;
  const fullPath = join(EVIDENCE_DIR, filename);
  if (!existsSync(fullPath)) return undefined;
  const stat = statSync(fullPath);
  if (!stat.isFile()) return undefined;
  const ext = extname(filename).toLowerCase();
  const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";
  return { buffer: readFileSync(fullPath), mime, size: stat.size };
}

// Stable hash for cache headers.
export function fingerprint(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}
