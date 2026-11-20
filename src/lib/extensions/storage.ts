// localStorage helpers for the extension installer. Mirrors the
// `lattice.mirror.<scope>.<id>.v1` pattern used elsewhere in the
// codebase (see `src/lib/blocks/devServerStorage.ts:16-22`).
//
// We key by user id so a second signed-in user on the same browser
// keeps their own extension set. `useExtensions` reads on mount and
// writes on every mutation through the registry.

import type { InstalledExtension, InstalledMap } from "./types";

const KEY_PREFIX = "lattice.mirror.extensions";
const KEY_VERSION = "v1";

function storageKey(userId: string): string {
  return `${KEY_PREFIX}.${userId}.${KEY_VERSION}`;
}

/** Read all installed extensions for a user. Returns an empty map on
 *  any parse error — the caller can show "Install an extension to get
 *  started" without surfacing a quota / corruption toast. */
export function loadExtensions(userId: string): InstalledMap {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as InstalledMap;
  } catch {
    return {};
  }
}

/** Write the entire map back to localStorage. Swallows quota / private-
 *  mode errors silently — the registry will still function in-memory
 *  for this session. */
export function saveExtensions(
  userId: string,
  map: InstalledMap,
): { ok: true } | { ok: false; error: string } {
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(map));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Read a single extension by id. Returns null if missing. */
export function readExtension(
  userId: string,
  id: string,
): InstalledExtension | null {
  const map = loadExtensions(userId);
  return map[id] ?? null;
}

/** Persist a single extension entry (insert or update). */
export function writeExtension(
  userId: string,
  ext: InstalledExtension,
): { ok: true } | { ok: false; error: string } {
  const map = loadExtensions(userId);
  map[ext.id] = ext;
  return saveExtensions(userId, map);
}

/** Remove a single extension entry. */
export function deleteExtension(userId: string, id: string): void {
  const map = loadExtensions(userId);
  if (!(id in map)) return;
  delete map[id];
  saveExtensions(userId, map);
}