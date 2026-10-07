// Pure in-memory + localStorage registry for installed extensions.
//
// Holds the active list of `InstalledExtension`s and exposes mutators
// (`install`, `uninstall`, `enable`, `disable`) plus a pub/sub so
// React components can re-render on changes. The pub/sub keeps the
// registry framework-free — `ExtensionsContext` subscribes once and
// pushes state into a `useSyncExternalStore`.

import type { ExtensionManifest, InstalledExtension } from "./types";
import {
  ID_PATTERN,
  MAX_ZIP_SIZE_BYTES,
  VERSION_PATTERN,
} from "./types";
import {
  arrayBufferToBase64,
  readManifest,
  unzipBuffer,
} from "./zip";
import {
  deleteExtension,
  loadExtensions,
  saveExtensions,
  writeExtension,
} from "./storage";

// ─── Validation ───────────────────────────────────────────────────────

export interface ValidationOk {
  ok: true;
  manifest: ExtensionManifest;
}
export interface ValidationErr {
  ok: false;
  error: string;
}

/** Strict manifest validation. Called on install before any storage
 *  write — guarantees we never persist a half-baked extension. */
export function validateManifest(
  manifest: ExtensionManifest,
  entries: Record<string, Uint8Array>,
): ValidationOk | ValidationErr {
  if (!manifest.id || typeof manifest.id !== "string") {
    return { ok: false, error: "Manifest missing `id`." };
  }
  if (!ID_PATTERN.test(manifest.id)) {
    return {
      ok: false,
      error:
        "`id` must be kebab-case, start with a letter/digit, and contain only letters, digits, and dashes.",
    };
  }
  if (!manifest.name || typeof manifest.name !== "string") {
    return { ok: false, error: "Manifest missing `name`." };
  }
  if (!manifest.version || typeof manifest.version !== "string") {
    return { ok: false, error: "Manifest missing `version`." };
  }
  if (!VERSION_PATTERN.test(manifest.version)) {
    return {
      ok: false,
      error: "`version` must be semver (x.y.z).",
    };
  }
  if (!manifest.main || typeof manifest.main !== "string") {
    return { ok: false, error: "Manifest missing `main` (entry HTML path)." };
  }
  // `main` must be a relative path that points to an existing entry —
  // disallow `..` (zip-slip) and absolute paths.
  if (
    manifest.main.startsWith("/") ||
    manifest.main.includes("..") ||
    /^[a-zA-Z]:[\\/]/.test(manifest.main)
  ) {
    return {
      ok: false,
      error: "`main` must be a relative path inside the zip (no `..`, no absolute paths).",
    };
  }
  if (!entries[manifest.main]) {
    return {
      ok: false,
      error: `Entry file \`${manifest.main}\` not found in zip.`,
    };
  }
  // Panel ids must be unique within the manifest.
  const panelIds = new Set<string>();
  for (const panel of manifest.contributes?.panels ?? []) {
    if (!panel.id) {
      return { ok: false, error: "Panel contribution missing `id`." };
    }
    if (panelIds.has(panel.id)) {
      return {
        ok: false,
        error: `Duplicate panel id \`${panel.id}\` in manifest.`,
      };
    }
    panelIds.add(panel.id);
  }
  // Command ids must be unique within the manifest.
  const commandIds = new Set<string>();
  for (const cmd of manifest.contributes?.commands ?? []) {
    if (!cmd.id) {
      return { ok: false, error: "Command contribution missing `id`." };
    }
    if (commandIds.has(cmd.id)) {
      return {
        ok: false,
        error: `Duplicate command id \`${cmd.id}\` in manifest.`,
      };
    }
    commandIds.add(cmd.id);
  }
  return { ok: true, manifest };
}

// ─── Install pipeline ─────────────────────────────────────────────────

export type InstallResult =
  | { ok: true; extension: InstalledExtension }
  | { ok: false; error: string };

/** Validate + persist a new extension. Reads the file as ArrayBuffer,
 *  unzips, validates the manifest, base64-encodes the zip, and writes
 *  the entry to localStorage. */
export async function installFromFile(
  file: File,
  userId: string,
): Promise<InstallResult> {
  if (file.size > MAX_ZIP_SIZE_BYTES) {
    return {
      ok: false,
      error: `Extension too large (${formatBytes(file.size)}, max ${formatBytes(MAX_ZIP_SIZE_BYTES)}).`,
    };
  }
  const buf = await file.arrayBuffer();
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipBuffer(buf);
  } catch (err) {
    return {
      ok: false,
      error: `Could not read zip: ${(err as Error).message}`,
    };
  }
  const manifestResult = readManifest(entries);
  if (!manifestResult.ok) {
    return { ok: false, error: manifestResult.error };
  }
  const validation = validateManifest(manifestResult.manifest, entries);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }
  // Reject re-install of the same id (user must uninstall first) —
  // avoids silent overwrites where the active iframe keeps a stale
  // manifest in flight.
  const existing = loadExtensions(userId);
  if (existing[validation.manifest.id]) {
    return {
      ok: false,
      error: `Extension \`${validation.manifest.id}\` is already installed. Uninstall it first to reinstall.`,
    };
  }
  const extension: InstalledExtension = {
    id: validation.manifest.id,
    manifest: validation.manifest,
    enabled: true,
    installedAt: new Date().toISOString(),
    zipBase64: arrayBufferToBase64(buf),
  };
  const save = writeExtension(userId, extension);
  if (!save.ok) {
    return { ok: false, error: `Storage write failed: ${save.error}` };
  }
  return { ok: true, extension };
}

// ─── Mutators (after install) ─────────────────────────────────────────

export function uninstallExtension(userId: string, id: string): void {
  deleteExtension(userId, id);
}

export function setExtensionEnabled(
  userId: string,
  id: string,
  enabled: boolean,
): { ok: true } | { ok: false; error: string } {
  const map = loadExtensions(userId);
  const ext = map[id];
  if (!ext) return { ok: false, error: `Extension \`${id}\` not found.` };
  const updated: InstalledExtension = { ...ext, enabled };
  const result = writeExtension(userId, updated);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}

// ─── Pub/sub registry ─────────────────────────────────────────────────

type Listener = () => void;

class ExtensionRegistry {
  private byUser = new Map<string, InstalledExtension[]>();
  /** Stable empty array so getSnapshot returns the same reference
   *  when nothing is installed — required by useSyncExternalStore. */
  private readonly EMPTY: InstalledExtension[] = [];
  private listeners = new Set<Listener>();

  /** Load (or reload from localStorage) the list for a user. Returns
   *  the loaded list so callers can seed React state. */
  load(userId: string): InstalledExtension[] {
    const map = loadExtensions(userId);
    const list = Object.values(map);
    this.byUser.set(userId, list);
    this.emit();
    return list;
  }

  /** Current snapshot for a user. */
  list(userId: string): InstalledExtension[] {
    return this.byUser.get(userId) ?? this.EMPTY;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Called by ExtensionsContext after a successful install / uninstall
   *  / enable / disable — we re-read from localStorage so storage is
   *  always the source of truth. */
  refresh(userId: string): InstalledExtension[] {
    return this.load(userId);
  }

  /** Find one extension by id (across users — registry is in-memory
   *  cache; look up directly when needed). */
  get(userId: string, id: string): InstalledExtension | null {
    return this.list(userId).find((ext) => ext.id === id) ?? null;
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

// Module-level singleton — same shape as `themeStore` /
// `projectsViewStore` (zustand-free, just a closure).
export const extensionRegistry = new ExtensionRegistry();

// ─── Helpers ──────────────────────────────────────────────────────────

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}