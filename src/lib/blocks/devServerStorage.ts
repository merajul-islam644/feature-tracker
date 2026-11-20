// Dev-server workspace mirror — one row per (user, project, env).
//
// Cloud counterpart. The canonical store is in mcp-server's
// `data/dev-servers/<workspaceId>/` tree, but mcp-server is a separate
// process and doesn't write to blx_* collections — the workspace
// identity (just an id + userId + projectId + envSlug) lives in
// localStorage so the editor knows which scaffold files belong to
// which `(user, project, env)` triple.
//
// Same `lattice.mirror.<feature>.v1` convention as the playwright
// scripts/folders mirrors (`playwrightScriptsStorage.ts`,
// `playwrightFoldersStorage.ts`).

import type { DevServerWorkspace, WorkspaceRoot } from "@/types/dev-server";

function mirrorKey(userId: string, projectId: string, envSlug: string): string {
  return `lattice.mirror.devServer.workspace.${userId}.${projectId}.${envSlug}.v1`;
}

function workspaceRootMirrorKey(userId: string, projectId: string, envSlug: string): string {
  return `lattice.mirror.workspaceRoot.${userId}.${projectId}.${envSlug}.v1`;
}

function readJSON(key: string): unknown {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota / private mode — the in-memory copy still serves this session.
  }
}

function asWorkspace(value: unknown): DevServerWorkspace | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.id !== "string" ||
    typeof v.userId !== "string" ||
    typeof v.projectId !== "string" ||
    typeof v.envSlug !== "string" ||
    typeof v.port !== "number"
  ) {
    return null;
  }
  return {
    id: v.id,
    userId: v.userId,
    projectId: v.projectId,
    envSlug: v.envSlug,
    createdAt: typeof v.createdAt === "string" ? v.createdAt : new Date().toISOString(),
    lastCommand: typeof v.lastCommand === "string" ? v.lastCommand : undefined,
    port: v.port,
  };
}

function asWorkspaceRoot(value: unknown): WorkspaceRoot | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.path !== "string" || v.path.length === 0) return null;
  // `name` is a derived display string; allow anything (folder basenames
  // can have spaces / dots / Unicode). `packageJson` is optional.
  const name = typeof v.name === "string" ? v.name : basename(v.path);
  const packageJson = v.packageJson && typeof v.packageJson === "object"
    ? (() => {
        const p = v.packageJson as Record<string, unknown>;
        const asMap = (x: unknown): Record<string, string> => {
          if (!x || typeof x !== "object") return {};
          const m: Record<string, string> = {};
          for (const [k, val] of Object.entries(x as Record<string, unknown>)) {
            if (typeof val === "string") m[k] = val;
          }
          return m;
        };
        return {
          name: typeof p.name === "string" ? p.name : "",
          version: typeof p.version === "string" ? p.version : "",
          path: typeof p.path === "string" ? p.path : (v.path as string),
          dependencies: asMap(p.dependencies),
          devDependencies: asMap(p.devDependencies),
          peerDependencies: asMap(p.peerDependencies),
        };
      })()
    : null;
  return {
    path: v.path,
    name,
    packageJson,
  };
}

function basename(p: string): string {
  // Trim trailing separators first, then split. Works for both
  // Windows and POSIX paths.
  const trimmed = p.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

/**
 * Synchronous read on mount — returns null when the key is unset.
 * Called from `DevServerContext` so the workspace id is available
 * before the first scaffold write.
 */
export function loadDevServerWorkspace(
  userId: string,
  projectId: string,
  envSlug: string,
): DevServerWorkspace | null {
  const key = mirrorKey(userId, projectId, envSlug);
  return asWorkspace(readJSON(key));
}

export function saveDevServerWorkspace(ws: DevServerWorkspace): void {
  writeJSON(mirrorKey(ws.userId, ws.projectId, ws.envSlug), ws);
}

// ─────────────────────────────────────────────────────────────────────
//  Workspace root — the user-picked local folder that the dev server
//  `cwd` is anchored to. Persisted per (user, project, env) so the
//  "last opened folder" survives reloads. Lives in the same
//  `lattice.mirror.*.v1` family as the workspace id above.
// ─────────────────────────────────────────────────────────────────────

/**
 * Synchronous read on mount. Returns `null` when no folder has been
 * picked yet (or the localStorage row was corrupted). Called from
 * `DevServerContext` so the top-bar File menu can show the current
 * folder name without waiting on a network round-trip.
 */
export function loadWorkspaceRoot(
  userId: string,
  projectId: string,
  envSlug: string,
): WorkspaceRoot | null {
  const key = workspaceRootMirrorKey(userId, projectId, envSlug);
  return asWorkspaceRoot(readJSON(key));
}

export function saveWorkspaceRoot(
  userId: string,
  projectId: string,
  envSlug: string,
  root: WorkspaceRoot | null,
): void {
  const key = workspaceRootMirrorKey(userId, projectId, envSlug);
  if (root === null) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Private mode — best effort.
    }
    return;
  }
  writeJSON(key, root);
}

// ─────────────────────────────────────────────────────────────────────
//  Workspace tabs — the editor's open file list + active tab.
//
//  Scoped per `(user, project, env, folder)` so:
//
//  • Page reload / browser close: tabs come back exactly as they were
//    (the user's stated need — open files stay selected even after
//    closing the browser).
//  • Folder switch (within the same project+env): the new folder
//    starts with its own (separate) tab set. The previous folder's
//    tabs are preserved under that folder's key — close A, switch
//    to B, switch back to A, and A's tabs return.
//  • Project / env switch: a different key, so a different page
//    instance gets a clean slate.
//
//  Same `lattice.mirror.*.v1` family as the workspace id and
//  workspaceRoot above. The folder segment is a short base36 hash so
//  Windows backslashes / spaces don't pollute the key.
// ─────────────────────────────────────────────────────────────────────

export interface WorkspaceTabs {
  openPaths: string[];
  activePath: string | null;
}

// FNV-1a 32-bit hash. Stable across builds, collision-resistant for
// path strings, short in base36 (~7 chars). Same choice the avatar
// palette in ExtensionsManagerPanel.tsx uses for distribution; here
// we want uniqueness, not distribution.
function hashFolderPath(p: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < p.length; i++) {
    h ^= p.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function workspaceTabsMirrorKey(
  userId: string,
  projectId: string,
  envSlug: string,
  folderPath: string,
): string {
  return `lattice.mirror.workspaceTabs.${userId}.${projectId}.${envSlug}.${hashFolderPath(folderPath)}.v1`;
}

function asWorkspaceTabs(value: unknown): WorkspaceTabs | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.openPaths)) return null;
  // Drop non-string entries defensively — a corrupted mirror should
  // never crash the editor.
  const openPaths = v.openPaths.filter((p): p is string => typeof p === "string");
  const rawActive = v.activePath;
  const activePath =
    typeof rawActive === "string" && openPaths.includes(rawActive)
      ? rawActive
      : null;
  return { openPaths, activePath };
}

/**
 * Synchronous read. Returns `null` when no tabs have ever been opened in
 * this folder (or the localStorage row was corrupted).
 */
export function loadWorkspaceTabs(
  userId: string,
  projectId: string,
  envSlug: string,
  folderPath: string,
): WorkspaceTabs | null {
  const key = workspaceTabsMirrorKey(userId, projectId, envSlug, folderPath);
  return asWorkspaceTabs(readJSON(key));
}

export function saveWorkspaceTabs(
  userId: string,
  projectId: string,
  envSlug: string,
  folderPath: string,
  tabs: WorkspaceTabs | null,
): void {
  const key = workspaceTabsMirrorKey(userId, projectId, envSlug, folderPath);
  // Treat empty state as "no tabs" — remove the key so a long-lived
  // session doesn't accumulate stale rows for folders the user
  // visited once and abandoned.
  if (
    tabs === null ||
    (tabs.openPaths.length === 0 && tabs.activePath === null)
  ) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Private mode — best effort.
    }
    return;
  }
  writeJSON(key, tabs);
}

// ─────────────────────────────────────────────────────────────────────
//  Editor zoom — whether the editor column is in fullscreen
//  ("maximized") mode that hides the IDE chrome (page header, Explorer
//  sidebar, status bar, terminal) and renders as a viewport overlay.
//  Scoped per `(user, project, env)` — folder-independent because the
//  zoom toggle is a per-page preference, not a per-folder one.
// ─────────────────────────────────────────────────────────────────────

function workspaceFullscreenMirrorKey(
  userId: string,
  projectId: string,
  envSlug: string,
): string {
  return `lattice.mirror.workspaceFullscreen.${userId}.${projectId}.${envSlug}.v1`;
}

/** Synchronous read. Returns `false` when the row is unset or
 *  corrupted. */
export function loadWorkspaceFullscreen(
  userId: string,
  projectId: string,
  envSlug: string,
): boolean {
  const raw = readJSON(workspaceFullscreenMirrorKey(userId, projectId, envSlug));
  return raw === true;
}

export function saveWorkspaceFullscreen(
  userId: string,
  projectId: string,
  envSlug: string,
  fullscreen: boolean,
): void {
  const key = workspaceFullscreenMirrorKey(userId, projectId, envSlug);
  if (!fullscreen) {
    // Default state — strip the row so DevTools stays clean.
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Private mode — best effort.
    }
    return;
  }
  writeJSON(key, true);
}

// ─────────────────────────────────────────────────────────────────────
//  Terminal panel collapsed state — same (user, project, env) scope
//  as `workspaceFullscreen` above. The terminal panel is a per-page
//  chrome affordance, not a per-folder one, so the folder dimension
//  is intentionally absent. Default state is collapsed (`true`) — the
//  user clicks the chevron to expand; we only persist when they
//  manually expand it so the row is gone for first-time visitors.
// ─────────────────────────────────────────────────────────────────────

function workspaceTerminalCollapsedMirrorKey(
  userId: string,
  projectId: string,
  envSlug: string,
): string {
  return `lattice.mirror.workspaceTerminalCollapsed.${userId}.${projectId}.${envSlug}.v1`;
}

/** Synchronous read. Returns `true` (= collapsed) when the row
 *  is unset or corrupted (default state), `false` (= expanded)
 *  when the user has clicked the chevron at least once. */
export function loadWorkspaceTerminalCollapsed(
  userId: string,
  projectId: string,
  envSlug: string,
): boolean {
  const raw = readJSON(workspaceTerminalCollapsedMirrorKey(userId, projectId, envSlug));
  // We only persist `false` on expand (the save helper strips the
  // row on collapse to keep DevTools clean). So `false` is the only
  // meaningful "expanded" record — anything else (missing,
  // malformed, accidentally written `true`) → default collapsed.
  return raw !== false;
}

export function saveWorkspaceTerminalCollapsed(
  userId: string,
  projectId: string,
  envSlug: string,
  collapsed: boolean,
): void {
  const key = workspaceTerminalCollapsedMirrorKey(userId, projectId, envSlug);
  if (collapsed) {
    // Default state — strip the row so DevTools stays clean.
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Private mode — best effort.
    }
    return;
  }
  writeJSON(key, false);
}