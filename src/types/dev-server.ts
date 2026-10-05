// Dev-server sandbox — types shared between the workspace panel,
// the API client, and the localStorage mirror.
//
// Mirror of `mcp-server/src/devServer.ts` (DevServerRecord + DevServerEvent).
// Don't drift: every `kind` here is referenced by the SSE consumer in
// `devServerApi.subscribeEvents`.

export type DevServerStatus =
  | "idle"
  | "starting"
  | "ready"
  | "running"
  | "exited"
  | "failed";

export interface DevServerEvent {
  kind: "devserver_log" | "devserver_ready" | "devserver_exit" | "devserver_error";
  id: string;
  ts: number;
  level?: "stdout" | "stderr";
  message?: string;
  port?: number;
  code?: number | null;
  reason?: string;
}

export interface DevServerRecord {
  id: string;
  workspaceId: string;
  port: number;
  status: DevServerStatus;
  command: string;
  args: string[];
  cwd: string;
  startedAt: string;
  readyAt?: string;
  lastExitCode?: number | null;
  stderrTail?: string[];
  cursor?: number;
}

/**
 * One workspace per (userId, projectId, envSlug). The id is generated
 * once on first scaffold and persisted to localStorage; on subsequent
 * mounts the same id is reused so file paths on disk stay stable.
 */
export interface DevServerWorkspace {
  id: string;
  userId: string;
  projectId: string;
  envSlug: string;
  createdAt: string;
  /** Last command issued — used by StatusBar / restart suggestions. */
  lastCommand?: string;
  /** Port the most-recent dev server bound to; default 5183. */
  port: number;
}

/**
 * Parsed-from-stderr problem row — surfaces in the Problems tab. We
 * extract file:line:col from common Vite / webpack / Rollup frames.
 * Out of scope: full source-map trace.
 */
export interface Problem {
  id: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  ts: number;
}

// ─────────────────────────────────────────────────────────────────────
//  Workspace root — the local folder the user picked via the
//  "Open Folder" flow. Anchors the dev server's `cwd` and seeds the
//  Configure drawer's "Workspace dependencies" subsection.
//
//  `path` is the absolute on-disk path returned by the native
//  folder dialog (Windows: PowerShell FolderBrowserDialog,
//  macOS: AppleScript, Linux: zenity). `name` is the display
//  string for the top-bar (basename of the path).
//  `packageJson` is `null` when the picked folder has no
//  package.json — the UI shows "no package.json found" instead
//  of an error.
// ─────────────────────────────────────────────────────────────────────

export interface PackageJsonSummary {
  name: string;
  version: string;
  path: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
}

export interface WorkspaceRoot {
  path: string;
  name: string;
  packageJson: PackageJsonSummary | null;
}

// ─────────────────────────────────────────────────────────────────────
//  File tree — the shape returned by the mcp-server `/dev-server/:wsId/list`
//  endpoint. Anchored at the user's picked folder; `path` is the
//  forward-slash-joined relative path, used as the row's identity in the
//  explorer UI. `kind: "dir"` carries a recursive `children` array; the
//  backend caps depth + entry count so a hostile folder can't OOM the
//  route (see `devServer.ts:walkTree`).
// ─────────────────────────────────────────────────────────────────────

export interface FileNode {
  name: string;
  /** Forward-slash-joined path relative to the picked `root`. */
  path: string;
  kind: "file" | "dir";
  children?: FileNode[];
}