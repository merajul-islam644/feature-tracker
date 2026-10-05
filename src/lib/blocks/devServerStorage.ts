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