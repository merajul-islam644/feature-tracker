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
//  LSP diagnostics (Phase 1: TypeScript). Mirrors the server shape in
//  `mcp-server/src/lsp.ts` — one entry per publishDiagnostics push,
//  paths relative to the workspace root (forward slashes).
// ─────────────────────────────────────────────────────────────────────

export interface LspDiagnostic {
  path: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  message: string;
  /** LSP severity: 1=Error 2=Warning 3=Information 4=Hint. */
  severity: number;
  code?: string | number;
  source?: string;
}

export type LspDiagnosticEvent =
  | { kind: "snapshot"; files: Record<string, LspDiagnostic[]>; ts: number }
  | { kind: "publish"; path: string; diagnostics: LspDiagnostic[]; ts: number };

// ─── LSP Phase 2 feature payloads ───────────────────────────────────
// All paths are root-relative (forward slashes) — the backend rewrites
// the protocol's file:// URIs before the panel ever sees them.

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

/** A definition/reference hit: which file, which span. */
export interface LspLocation {
  path: string;
  range: LspRange;
}

/** Hover payload — `contents` is whatever MarkupContent/string shape
 *  the server produced; the editor renders it as preformatted text. */
export interface LspHover {
  contents: unknown;
  range?: LspRange | null;
}

/** Hierarchical document symbol (tls with hierarchicalDocumentSymbol-
 * Support). `location` is present only if the server negotiated down
 * to the flat SymbolInformation shape. */
export interface LspDocumentSymbol {
  name: string;
  detail?: string;
  /** LSP SymbolKind enum (5=Class, 6=Method, 12=Function, …). */
  kind: number;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[];
  location?: LspLocation;
  containerName?: string;
}

/** One edit inside a rename WorkspaceEdit (protocol TextEdit). */
export interface LspTextEdit {
  range: LspRange;
  newText: string;
}

/** Normalized rename result — keyed by root-relative path. */
export interface LspWorkspaceEdit {
  changes: Record<string, LspTextEdit[]>;
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

// ─────────────────────────────────────────────────────────────────────
//  Interactive shell — type-only surface for the WorkspacePage
//  terminal panel. The actual socket is owned by `TerminalPanel`
//  (so it can call xterm.write directly); the context exposes only
//  the data + commands the panel needs.
//
//  One PTY per open terminal panel. Closing the panel or unmounting
//  WorkspacePage tears down the WebSocket and SIGTERMs the child.
// ─────────────────────────────────────────────────────────────────────

export type TerminalPhase =
  | "idle" // not connected yet
  | "connecting" // WS upgrade in flight
  | "connected" // PTY spawned; xterm is live
  /** Transient WS drop — PTY is still alive on mcp-server, auto-
   *  reconnect in flight. No `[Process exited]` banner; the next
   *  `started` frame flips back to `connected`. */
  | "reconnecting"
  | "exited"; // shell exited; shows last exit code

export interface TerminalStatus {
  phase: TerminalPhase;
  /** Filled in once the server sends `{type: "started"}`. */
  shell?: string;
  cwd?: string;
  /** Last exit code, set when `phase === "exited"`. */
  exitCode?: number | null;
  /** Human-readable reason if the connection never opened
   *  (network error, spawn failure, etc.). */
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────
//  File watcher — streamed from mcp-server via the
//  `/dev-server/:wsId/watch?root=…` SSE endpoint. Reflects
//  chokidar's add/change/unlink/addDir/unlinkDir surface verbatim
//  so consumers can drive tree UIs directly off `kind`. `absPath`
//  is included for callers that want to re-stat the file; the
//  frontend mostly uses `path` (forward-slash, root-relative).
// ─────────────────────────────────────────────────────────────────────

export type WatchEventKind =
  | "add"
  | "change"
  | "unlink"
  | "addDir"
  | "unlinkDir";

export interface WatchEvent {
  kind: WatchEventKind;
  /** Forward-slash path relative to the watched root. */
  path: string;
  /** Absolute on-disk path — handy when re-stat-ing. */
  absPath: string;
  /** `Date.now()` at emit. */
  ts: number;
}

// ─────────────────────────────────────────────────────────────────────
//  Project-wide search — POST /dev-server/:wsId/search. Mirrors
//  ripgrep's `{path, line, column}` triple so the frontend can
//  render "Open File" links and navigate to the match position.
// ─────────────────────────────────────────────────────────────────────

export interface SearchResult {
  path: string;
  line: number;
  column: number;
  preview: string;
}

export interface SearchResponse {
  results: SearchResult[];
  count: number;
  /** True when the route hit `maxResults` and the UI should show
   *  "refine your query" instead of "showing all matches". */
  truncated: boolean;
}

// ─────────────────────────────────────────────────────────────────────
//  Terminal shell picker — the dropdown menu next to the terminal
//  panel header lets the user switch between PowerShell 7, Git
//  Bash, cmd.exe, etc. The catalogue lives server-side because
//  `whichSync` needs `process.env.PATH` (which the browser can't
//  see) — the route returns one descriptor per known shell with
//  `available` flagging whether the binary was found.
//
//  `id` is the stable identifier sent over the WS `shellId`
//  query param on reconnect. Don't rename — old panels keep
//  working as long as the catalog stays additive.
// ─────────────────────────────────────────────────────────────────────

export interface ShellDescriptor {
  /** Stable id — what we send in `?shellId=…`. */
  id: string;
  /** Same as `id`; exposed separately so the route can decode it
   *  without type-cast acrobatics. */
  shellId: string;
  /** User-facing label, e.g. "PowerShell 7" / "Git Bash". */
  label: string;
  /** False when the binary isn't on PATH. Dropdown disables
   *  the entry but keeps it visible so the user knows it exists. */
  available: boolean;
  /** Absolute path on disk — handy for a "Git Bash →
   *  C:\Program Files\Git\bin\bash.exe" hover-tooltip. */
  resolvedPath: string | null;
}

// ─────────────────────────────────────────────────────────────────────
//  Terminal instance — one tab in the WorkspacePage terminal panel.
//  Each instance is a separate PTY keyed by `(workspaceId, cwd, id)`,
//  so two tabs in the same folder are independent shells (env vars /
//  cwd / running processes do NOT share).
//
//  `id` is generated on `[+]` (`term-<base36 timestamp>`) and persisted
//  to localStorage so refresh keeps the tab identity. `label` is
//  what the tab strip renders. `shellId` mirrors the per-tab
//  `selectedShellId` (separate from the global shell pref).
// ─────────────────────────────────────────────────────────────────────

export interface TerminalInstance {
  /** Stable per-tab id — used in PTY key + localStorage scrollback key. */
  id: string;
  /** User-visible label, e.g. "Term 1" / "Backend" / "Watch". */
  label: string;
  /** Per-tab shell preference; null = use the default shell. */
  shellId: string | null;
}