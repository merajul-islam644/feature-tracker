// Zip read/write helpers using fflate. Each extension zip is stored as
// base64 in localStorage so we can reconstruct the iframe srcDoc on
// every render without keeping the original Blob around.
//
// fflate's unzipSync returns a `Record<path, Uint8Array>` (or string
// if a `decode` filter is passed). We use the Uint8Array form so
// binary entries (images, fonts) round-trip, then decode text entries
// to UTF-8 ourselves — keeps the manifest parse path type-safe.

import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import type { ExtensionManifest } from "./types";

// Re-export fflate primitives so callers don't need to add fflate as
// a project-level dependency just to read entries directly. Used by
// `ExtensionIframeView` to rebuild srcDoc from a stored zip.
export { unzipSync, strFromU8 };

export interface ZipFile {
  /** Always uses forward slashes, no leading slash. */
  path: string;
  /** Raw bytes (text or binary). */
  data: Uint8Array;
}

/** Decode a single ArrayBuffer (the result of FileReader.readAsArrayBuffer)
 *  to a `Record<path, Uint8Array>` zip entry map. */
export function unzipBuffer(buf: ArrayBuffer): Record<string, Uint8Array> {
  // fflate wants a Uint8Array view of the buffer.
  return unzipSync(new Uint8Array(buf));
}

/** Read one entry as a UTF-8 string. Returns null if the entry is
 *  missing or the bytes are not valid text. */
export function readEntryAsString(
  entries: Record<string, Uint8Array>,
  path: string,
): string | null {
  const bytes = entries[path];
  if (!bytes) return null;
  try {
    return strFromU8(bytes);
  } catch {
    return null;
  }
}

/** Read one entry as a UTF-8 string. Throws if missing — caller has
 *  already validated `manifest.main` points to an existing entry. */
export function requireEntryAsString(
  entries: Record<string, Uint8Array>,
  path: string,
): string {
  const text = readEntryAsString(entries, path);
  if (text === null) {
    throw new Error(`Missing or invalid UTF-8 entry: ${path}`);
  }
  return text;
}

/** Build a zip from an entry map. Used only by debug / dev tooling;
 *  runtime installs accept a user-provided file, never synthesize one. */
export function buildZip(entries: Record<string, string>): Uint8Array {
  const binaryEntries: Record<string, Uint8Array> = {};
  for (const [path, text] of Object.entries(entries)) {
    binaryEntries[path] = strToU8(text);
  }
  return zipSync(binaryEntries);
}

/** Convert an ArrayBuffer to base64 (no line breaks). */
export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  // Process in 0x8000 chunks to avoid `btoa` argument-limit on large
  // buffers (some browsers cap string length at ~512 MB but the call
  // itself is expensive on big inputs).
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

/** Convert a base64 string to bytes (reverse of arrayBufferToBase64). */
export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Read a `manifest.json` entry from an unzipped map and parse it.
 *  Returns either the manifest or a human-readable error message. */
export function readManifest(
  entries: Record<string, Uint8Array>,
): { ok: true; manifest: ExtensionManifest } | { ok: false; error: string } {
  const raw = readEntryAsString(entries, "manifest.json");
  if (raw === null) {
    return { ok: false, error: "manifest.json missing from zip" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      error: `manifest.json is not valid JSON: ${(err as Error).message}`,
    };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "manifest.json must be a JSON object" };
  }
  return { ok: true, manifest: parsed as ExtensionManifest };
}