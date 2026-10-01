// Thin wrappers over `blocksClient.data.files.*` (Blocks Data Storage).
//
// The files API is the picture-upload system: a presign call creates the
// file record and returns a provider-direct upload URL, then the bytes go
// straight to Azure/S3 — never through the Blocks API host. Both responses
// are `Promise<unknown>` at the SDK level, so every wrapper here validates
// at the boundary (per the blocks-data-storage skill) and returns a
// narrowed shape the hooks can rely on.
//
// Storage config: this project has a single "Default" configuration
// (Azure) — see `blocks storage config list`. `Private` is the safe access
// modifier; downloads still work because `files.get` hands out a
// provider-signed URL.

import { blocksClient } from "./client";

export const STORAGE_CONFIGURATION = "Default";

// Wire shape of `presignedUploadUrl`: `{ uploadUrl, fileId, isSuccess,
// errors? }` (per the blocks-data-storage skill). The file metadata +
// version-1 record is created by this call itself — there is no separate
// registration step.
export interface PresignedUpload {
  uploadUrl: string;
  fileId: string;
}

export async function presignUpload(input: {
  fileName: string;
  contentType: string;
  tags?: string;
}): Promise<PresignedUpload> {
  // No `parentDirectoryId`: profile pictures land in the module's default
  // directory. Creating a dedicated directory would add a lookup-or-create
  // flow per client for no functional gain here.
  const raw = (await blocksClient.data.files.presignedUploadUrl({
    name: input.fileName,
    contentType: input.contentType,
    configurationName: STORAGE_CONFIGURATION,
    accessModifier: "Private",
    tags: input.tags,
  })) as unknown;

  const result = raw as {
    uploadUrl?: string;
    fileId?: string;
    isSuccess?: boolean;
    errors?: Record<string, string>;
  } | null;

  if (!result || typeof result !== "object" || !result.uploadUrl || !result.fileId) {
    throw new Error(
      `Unexpected presign response: ${JSON.stringify(result?.errors ?? raw)}`,
    );
  }
  return { uploadUrl: result.uploadUrl, fileId: result.fileId };
}

// PUT the bytes to the provider-direct URL. This call sends no Blocks auth
// headers by design (the URL itself is the credential) — the SDK adds
// Azure's `x-ms-blob-type: Blockblob` unless overridden.
export async function uploadToPresignedUrl(
  uploadUrl: string,
  file: Blob,
  contentType: string,
): Promise<void> {
  await blocksClient.data.files.uploadToUrl({
    url: uploadUrl,
    body: file,
    contentType: contentType || "application/octet-stream",
  });
}

// `files.get` returns "a download URL plus metadata" as an unknown record.
// The URL key isn't documented, so scan the top level for the common names
// and then one nesting level deep before giving up — defensive parse at
// the boundary rather than trusting a guessed key.
const URL_KEYS = ["downloadUrl", "url", "presignedUrl", "fileUrl"] as const;

function findUrlDeep(value: unknown, depth: number): string | null {
  if (depth < 0 || !value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of URL_KEYS) {
    const v = record[key];
    if (typeof v === "string" && v.startsWith("http")) return v;
  }
  if (depth === 0) return null;
  for (const v of Object.values(record)) {
    const found = findUrlDeep(v, depth - 1);
    if (found) return found;
  }
  return null;
}

export async function fetchFileDownloadUrl(fileId: string): Promise<string> {
  const raw = (await blocksClient.data.files.get(fileId, {
    configurationName: STORAGE_CONFIGURATION,
  })) as unknown;

  // The response may be `{ data: { ... } }`-shaped like the collection
  // calls — scan two levels to cover both.
  const url = findUrlDeep(raw, 2);
  if (!url) {
    throw new Error(`No download URL in files.get response for ${fileId}`);
  }
  return url;
}
