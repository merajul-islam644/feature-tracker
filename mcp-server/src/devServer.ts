// Dev-server sandbox — long-running `npm run dev` children.
//
// Spec contract:
//   • One child process per (workspaceId, port). Multiple dev servers
//     per workspace are allowed (isolated ports).
//   • Output is line-split, ANSI-stripped, and pushed as `devserver_log`
//     SSE events. Direct template is `runSpecScript` in `agent.ts` — the
//     same line-splitter + 500ms stop-poll + SIGTERM policy is reused.
//   • Readiness is detected by polling `http://127.0.0.1:<port>/` every
//     500ms up to 30s. On 2xx/3xx/4xx → `status: "ready"`; on 5xx
//     timeout → `status: "failed"` with a `devserver_error` event.
//   • SIGINT walks the `devServers` map and SIGTERMs each child —
//     mirrors `runs.ts:177-184`. Without this, killing mcp-server
//     orphans the Node child on `127.0.0.1:<port>`.
//
// What's *not* here:
//   • HTTP route handlers — those live in `index.ts`.
//   • Reverse proxy — `/dev-server/:workspaceId/:port/proxy/*` is in
//     `index.ts` and streams `fetch()` body back through `reply.raw`.
//   • File CRUD for the workspace — that's a tiny wrapper around
//     `node:fs/promises` kept inline in `index.ts` for the routes.

import { spawn, type ChildProcess } from "node:child_process";
import * as fsp from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR } from "./secrets.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DEV_SERVERS_DIR = join(DATA_DIR, "dev-servers");

export type DevServerStatus =
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
  id: string;          // composite "<workspaceId>:<port>"
  workspaceId: string;
  port: number;
  child: ChildProcess | null;
  status: DevServerStatus;
  command: string;
  args: string[];
  cwd: string;
  startedAt: string;
  readyAt?: string;
  lastExitCode?: number | null;
  stderrTail: string[];
  // Local cursor — index in `events` array.
  cursor: number;
  stopRequested: boolean;
  events: DevServerEvent[];
  waiters: Array<() => void>;
}

export const devServers = new Map<string, DevServerRecord>();

export function workspaceRoot(workspaceId: string): string {
  // workspaceId is sanitized in the route layer (alnum + dash + colon
  // already by then) but defense-in-depth: reject anything weird here.
  const safe = workspaceId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(DEV_SERVERS_DIR, safe);
}

// Composite id — keeps a single Map but allows multiple ports per
// workspace. Idempotent: re-running `startDevServer` with the same
// (workspaceId, port) returns the existing record.
export function devServerId(workspaceId: string, port: number): string {
  return `${workspaceId}:${port}`;
}

export function getDevServer(id: string): DevServerRecord | undefined {
  return devServers.get(id);
}

export function listDevServers(): DevServerRecord[] {
  return [...devServers.values()];
}

// Append + advance cursor + notify any long-poll waiters (mirrors
// `runs.ts:appendEvent` + `notifyWaiters`).
export function appendDevServerLog(id: string, event: DevServerEvent): void {
  const rec = devServers.get(id);
  if (!rec) return;
  rec.events.push(event);
  rec.cursor = rec.events.length;
  for (const w of rec.waiters.splice(0)) w();
}

export function eventsAfter(id: string, since: number): DevServerEvent[] {
  const rec = devServers.get(id);
  if (!rec) return [];
  return rec.events.slice(Math.max(0, since));
}

// Long-poll cooperative wait — mirror of `runs.ts:waitForEvents`. The
// SSE tail uses 1_500ms; this resolves immediately if there's already
// data past `since`.
export function waitForDevServerEvents(
  id: string,
  since: number,
  timeoutMs = 30_000,
): Promise<DevServerEvent[]> {
  return new Promise((resolve) => {
    const rec = devServers.get(id);
    if (!rec) return resolve([]);
    if (rec.cursor > since) return resolve(rec.events.slice(since));
    const w = () => {
      clearTimeout(t);
      const r = devServers.get(id);
      resolve(r ? r.events.slice(since) : []);
    };
    const t = setTimeout(() => {
      const idx = rec.waiters.indexOf(w);
      if (idx >= 0) rec.waiters.splice(idx, 1);
      const r = devServers.get(id);
      resolve(r ? r.events.slice(since) : []);
    }, timeoutMs);
    rec.waiters.push(w);
  });
}

// Path-traversal guard for file routes. Reject anything that escapes
// the workspace root via `..`, absolute paths, or symlink resolution.
// Mirrors `evidence.ts:67`.
export function safeResolve(workspaceId: string, relPath: string): string | null {
  if (relPath.includes("..") || relPath.includes("\\")) return null;
  const root = workspaceRoot(workspaceId);
  const full = resolve(root, relPath);
  // `resolve` already collapses `..`, so the prefix check is enough.
  if (!(full === root || full.startsWith(root + "/") || full.startsWith(root + "\\"))) {
    return null;
  }
  return full;
}

// ─────────────────────────────────────────────────────────────────────
//  User-folder primitives — read/write/delete/rename inside the
//  folder the user picked via the OS dialog (`pickFolder`). These
//  target the user's local disk, NOT the per-workspace sandbox, so
//  edits land in their actual project tree (VS Code-style).
//
//  `workspaceId` is included in the route signature so the API
//  client can keep a single set of URLs; the backend only uses it
//  for logging / route-collision avoidance. Path-traversal is
//  enforced via `safeResolveUserFolder` against the user's picked
//  `root`.
// ─────────────────────────────────────────────────────────────────────

/** Reject paths that escape `root` via `..` or contain separator
 *  characters that aren't forward slashes. `root` is an absolute
 *  path returned by `pickNativeFolder`; `target` is the relative
 *  path the user passed. Returns the resolved absolute path, or
 *  `null` on rejection. */
export function safeResolveUserFolder(root: string, target: string): string | null {
  if (target.includes("..") || target.includes("\\") || target.includes("\0")) return null;
  const absRoot = resolve(root);
  const full = resolve(absRoot, target);
  // Same prefix check as `safeResolve` — `resolve` collapses `..`,
  // so this is enough to prove we stayed inside the picked root.
  if (!(full === absRoot || full.startsWith(absRoot + "/") || full.startsWith(absRoot + "\\"))) {
    return null;
  }
  return full;
}

export interface FileNode {
  name: string;
  /** Path relative to the picked `root`, forward slashes. */
  path: string;
  kind: "file" | "dir";
  children?: FileNode[];
}

const HIDDEN_DIRS = new Set(["node_modules", ".git"]);
const MAX_TREE_DEPTH = 8;
const MAX_TREE_ENTRIES = 5_000; // hard cap — protects the route from massive trees

/** Recursive directory walk. Hides `node_modules` and `.git`. Stops
 *  on cycles via a `realpath` Set. Caps depth + entry count so a
 *  pathological tree (10K files) doesn't lock the route. */
export async function walkTree(root: string, maxDepth = MAX_TREE_DEPTH): Promise<FileNode[]> {
  const absRoot = resolve(root);
  const stat = await fsp.stat(absRoot).catch(() => null);
  if (!stat || !stat.isDirectory()) return [];

  const visited = new Set<string>();
  let entryCount = 0;

  async function walk(dir: string, relBase: string, depth: number): Promise<FileNode[]> {
    if (depth >= maxDepth) return [];
    const real = await fsp.realpath(dir).catch(() => dir);
    if (visited.has(real)) return [];
    visited.add(real);

    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    const out: FileNode[] = [];
    // Stable order — directories first, then files; alphabetical within kind.
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const e of entries) {
      if (entryCount >= MAX_TREE_ENTRIES) break;
      // Skip hidden directories — VS Code's Explorer does the same.
      if (e.isDirectory() && HIDDEN_DIRS.has(e.name)) continue;
      const abs = join(dir, e.name);
      const rel = relBase ? `${relBase}/${e.name}` : e.name;
      entryCount++;
      if (e.isDirectory()) {
        const children = await walk(abs, rel, depth + 1);
        out.push({ name: e.name, path: rel, kind: "dir", children });
      } else if (e.isFile()) {
        out.push({ name: e.name, path: rel, kind: "file" });
      }
    }
    return out;
  }

  return walk(absRoot, "", 0);
}

/** Recursive delete. Throws if the path doesn't exist or is outside
 *  `root`. */
export async function safeDeleteUserFolder(root: string, target: string): Promise<void> {
  const safe = safeResolveUserFolder(root, target);
  if (!safe) throw new Error("bad path");
  const stat = await fsp.stat(safe).catch(() => null);
  if (!stat) throw new Error("not found");
  if (stat.isDirectory()) {
    await fsp.rm(safe, { recursive: true, force: false });
  } else {
    await fsp.unlink(safe);
  }
}

/** Rename or move. Refuses if `newPath` exists. */
export async function safeRenameUserFolder(
  root: string,
  oldTarget: string,
  newTarget: string,
): Promise<void> {
  const safeOld = safeResolveUserFolder(root, oldTarget);
  const safeNew = safeResolveUserFolder(root, newTarget);
  if (!safeOld || !safeNew) throw new Error("bad path");
  const exists = await fsp.stat(safeNew).catch(() => null);
  if (exists) throw new Error("destination exists");
  // Ensure parent of new exists — rename can create parents on POSIX
  // but Windows refuses if intermediate dirs are missing. Idempotent.
  const newParent = dirname(safeNew);
  await fsp.mkdir(newParent, { recursive: true });
  await fsp.rename(safeOld, safeNew);
}

/** Make a directory (mkdir -p). */
export async function safeMkdirUserFolder(root: string, target: string): Promise<void> {
  const safe = safeResolveUserFolder(root, target);
  if (!safe) throw new Error("bad path");
  await fsp.mkdir(safe, { recursive: true });
}

// ANSI-CSI stripper — Vite, CRA, npm, esbuild all emit cursor-up +
// clear-line escapes during progress reporting. Without this, lines
// would leak into the terminal panel as raw escape garbage. Copy of
// `agent.ts:913-914`.
const ANSI_CSI = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const stripAnsi = (s: string) => s.replace(ANSI_CSI, "");

function makeLineSplitter() {
  let buf = "";
  return (chunk: string): string[] => {
    buf += chunk;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? "";
    return lines.filter((l) => l.length > 0).map(stripAnsi);
  };
}

// `startDevServer` is the canonical entry — idempotent on (workspaceId,
// port). If a record already exists for that id and is in
// starting/ready/running, returns it unchanged. If it's exited/failed,
// reuses the record (so the SSE history survives across restarts).
export async function startDevServer(opts: {
  workspaceId: string;
  port: number;
  command: string;
  args: string[];
}): Promise<DevServerRecord> {
  const id = devServerId(opts.workspaceId, opts.port);
  const existing = devServers.get(id);
  if (existing && (existing.status === "starting" || existing.status === "ready" || existing.status === "running")) {
    return existing;
  }

  // Reuse the record across restart attempts (so SSE replay includes
  // history). Reset fields that don't survive a restart.
  const rec: DevServerRecord = existing ?? {
    id,
    workspaceId: opts.workspaceId,
    port: opts.port,
    child: null,
    status: "starting",
    command: opts.command,
    args: opts.args,
    cwd: workspaceRoot(opts.workspaceId),
    startedAt: new Date().toISOString(),
    stderrTail: [],
    cursor: 0,
    stopRequested: false,
    events: [],
    waiters: [],
  };
  rec.command = opts.command;
  rec.args = opts.args;
  rec.cwd = workspaceRoot(opts.workspaceId);
  rec.startedAt = new Date().toISOString();
  rec.readyAt = undefined;
  rec.lastExitCode = undefined;
  rec.stderrTail = [];
  rec.status = "starting";
  rec.stopRequested = false;
  devServers.set(id, rec);

  // Ensure workspace dir exists — idempotent.
  await fsp.mkdir(rec.cwd, { recursive: true });

  appendDevServerLog(id, {
    id,
    kind: "devserver_log",
    level: "stdout",
    message: `$ ${opts.command} ${opts.args.join(" ")}`,
    ts: Date.now(),
  });

  const isWin = process.platform === "win32";
  const child = spawn(opts.command, opts.args, {
    cwd: rec.cwd,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    // Windows: npm is a .cmd batch shim — needs a shell to find it
    // through PATHEXT resolution reliably. Same flag `runSpecScript`
    // uses (`agent.ts:889`).
    shell: isWin,
  });
  rec.child = child;

  // Cooperative stop poll — 500ms granularity matches
  // `runSpecScript`. SIGTERM only; we never SIGKILL because that
  // orphans Chromium / esbuild children the dev server may have
  // spawned. Worst case the process is a few hundred ms late to clean
  // up, which is acceptable for an in-app dev server.
  const stopPoller = setInterval(() => {
    if (rec.stopRequested && child.exitCode === null) {
      try {
        child.kill("SIGTERM");
      } catch {
        // Already exited — the close handler will fire next tick.
      }
    }
  }, 500);

  const stdoutSplitter = makeLineSplitter();
  const stderrSplitter = makeLineSplitter();

  const pushStderr = (chunk: Buffer) => {
    for (const line of stderrSplitter(chunk.toString("utf8"))) {
      rec.stderrTail.push(line);
      if (rec.stderrTail.length > 200) rec.stderrTail = rec.stderrTail.slice(-200);
      appendDevServerLog(id, {
        id,
        kind: "devserver_log",
        level: "stderr",
        message: line,
        ts: Date.now(),
      });
    }
  };

  child.stdout.on("data", (chunk: Buffer) => {
    for (const line of stdoutSplitter(chunk.toString("utf8"))) {
      appendDevServerLog(id, {
        id,
        kind: "devserver_log",
        level: "stdout",
        message: line,
        ts: Date.now(),
      });
    }
  });
  child.stderr.on("data", pushStderr);

  // Readiness poller — fetch `/` on the dev server's port. 2xx, 3xx,
  // and 4xx all mean "the server is listening and answering HTTP" —
  // we only care about reachability, not whether the page is healthy.
  // 5xx timeout flips to `failed` with the stderr tail as the reason.
  let readinessResolved = false;
  const readinessStart = Date.now();
  const readinessPoll = async () => {
    if (readinessResolved) return;
    if (rec.stopRequested) return;
    try {
      const res = await fetch(`http://127.0.0.1:${opts.port}/`, {
        // 2s cap so the poller's per-stay track doesn't hang on a
        // half-open socket.
        signal: AbortSignal.timeout(2_000),
      });
      // Any HTTP response means the port is bound. Even a 500 from
      // the dev server (e.g. Vite mid-compile) means it's alive.
      if (res.status > 0) {
        readinessResolved = true;
        rec.status = "ready";
        rec.readyAt = new Date().toISOString();
        appendDevServerLog(id, {
          id,
          kind: "devserver_ready",
          port: opts.port,
          ts: Date.now(),
        });
      }
    } catch {
      // Not yet listening — retry unless we've blown the budget.
      if (Date.now() - readinessStart > 30_000 && !readinessResolved) {
        readinessResolved = true;
        rec.status = "failed";
        appendDevServerLog(id, {
          id,
          kind: "devserver_error",
          message: `port ${opts.port} did not respond within 30s. stderr tail:\n${rec.stderrTail.slice(-20).join("\n")}`,
          ts: Date.now(),
        });
      }
    }
  };
  const readinessTimer = setInterval(() => void readinessPoll(), 500);

  const exitCode: number | null = await new Promise((resolve) => {
    child.on("close", (code) => resolve(code));
    child.on("error", (err) => {
      pushStderr(Buffer.from(`spawn error: ${err.message}`));
    });
  });

  clearInterval(stopPoller);
  clearInterval(readinessTimer);

  rec.lastExitCode = exitCode;
  // Status narrowing — cast through the union because `rec` was set to
  // `"starting"` two paragraphs up and TS doesn't see the runtime
  // reassignments from the readiness poller.
  const liveStatus = rec.status as DevServerStatus;
  if (liveStatus === "ready" || liveStatus === "running" || liveStatus === "starting") {
    rec.status = exitCode === 0 ? "exited" : "failed";
  }
  appendDevServerLog(id, {
    id,
    kind: "devserver_exit",
    code: exitCode,
    reason: exitCode === 0
      ? "process exited"
      : (rec.stopRequested
        ? "stopped by user"
        : `process exited with code ${exitCode ?? "?"}`),
    ts: Date.now(),
  });

  return rec;
}

export async function stopDevServer(opts: { workspaceId: string; port: number }): Promise<void> {
  const id = devServerId(opts.workspaceId, opts.port);
  const rec = devServers.get(id);
  if (!rec) return;
  rec.stopRequested = true;
  if (!rec.child || rec.child.exitCode !== null) return;
  try {
    rec.child.kill("SIGTERM");
  } catch {
    // Already gone.
  }
  // Wait up to 5s for graceful exit before the route returns. Most
  // dev servers (Vite, Next, webpack) shut down in <1s on SIGTERM.
  const t0 = Date.now();
  while (Date.now() - t0 < 5_000) {
    if (!rec.child || rec.child.exitCode !== null) return;
    await new Promise((r) => setTimeout(r, 100));
  }
}

// SIGINT handler — registered by `index.ts` once on boot. Walks the
// map and SIGTERMs each child so `npm run dev` doesn't outlive its
// parent (which would orphan the bound port). Mirrors `runs.ts:177-184`.
export function shutdownAllDevServers(): void {
  for (const rec of devServers.values()) {
    rec.stopRequested = true;
    if (rec.child && rec.child.exitCode === null) {
      try {
        rec.child.kill("SIGTERM");
      } catch {
        // Already gone.
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
//  Native folder picker
//
//  VS Code-style "Open Folder" — surfaces the OS's native folder
//  chooser instead of the browser's `webkitdirectory` (which is
//  read-only and slow on huge trees). Implemented per-platform:
//
//   • Windows: PowerShell + System.Windows.Forms.FolderBrowserDialog.
//     .NET dialog is the standard answer; `cscript`/`mshta` variants
//     either need elevation or have been deprecated. The script
//     prints the chosen path on stdout, the error on stderr.
//   • macOS:   AppleScript via `osascript` (Finder chooser).
//   • Linux:   `zenity --file-selection --directory` first, then
//              `kdialog --getopenfilename` as a fallback.
//
//  On headless / failed cases, returns `null` so the UI can fall back
//  to a text input ("Type the absolute path") — better than throwing.
// ─────────────────────────────────────────────────────────────────────

interface NativePickResult {
  picked: string | null;
  /** Set when the platform shim couldn't even start (no PowerShell,
   *  no zenity, …) — the UI shows the text-input fallback. */
  reason?: "no_gui" | "spawn_failed" | "cancelled";
}

const WIN_PICKER_PS = [
  // Print chosen path on stdout (empty if cancelled), error on stderr.
  "Add-Type -AssemblyName System.Windows.Forms |",
  "Out-Null;",
  "$f = New-Object System.Windows.Forms.FolderBrowserDialog;",
  "$f.Description = 'Select a folder to open in Lattice';",
  "$f.ShowNewFolderButton = $false;",
  "$r = $f.ShowDialog();",
  "if ($r -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }",
].join(" ");

const MAC_PICKER_AS = [
  'set chosenFolder to choose folder with prompt "Select a folder to open in Lattice"',
  "POSIX path of chosenFolder",
].join("\n");

async function pickNativeFolder(): Promise<NativePickResult> {
  const isWin = process.platform === "win32";
  const isMac = process.platform === "darwin";

  return new Promise((resolve) => {
    const tryFinish = (r: NativePickResult) => {
      // Don't resolve twice (some platforms can fire `error` and `close`).
      if (settled) return;
      settled = true;
      resolve(r);
    };
    let settled = false;

    let cmd: string;
    let args: string[];
    if (isWin) {
      cmd = "powershell.exe";
      args = ["-NoProfile", "-NonInteractive", "-Command", WIN_PICKER_PS];
    } else if (isMac) {
      cmd = "osascript";
      args = ["-e", MAC_PICKER_AS];
    } else {
      // Linux — try zenity, then kdialog.
      cmd = "zenity";
      args = ["--file-selection", "--directory", "--title=Open Folder in Lattice"];
    }

    let child: ChildProcess;
    try {
      child = spawn(cmd, args, {
        stdio: ["ignore", "pipe", "pipe"],
        // PowerShell on Windows is .exe, no shell needed. osascript
        // and zenity don't either.
      });
    } catch (err) {
      tryFinish({ picked: null, reason: "spawn_failed" });
      return;
    }

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (b: Buffer) => { stdout += b.toString("utf8"); });
    child.stderr?.on("data", (b: Buffer) => { stderr += b.toString("utf8"); });

    // Linux: if zenity is missing, try kdialog.
    child.on("error", () => {
      if (!isWin && !isMac) {
        const kd = spawn("kdialog", ["--getopenfilename", "."], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        let kdOut = "";
        let kdSettled = false;
        kd.stdout?.on("data", (b: Buffer) => { kdOut += b.toString("utf8"); });
        kd.on("error", () => { if (!kdSettled) { kdSettled = true; tryFinish({ picked: null, reason: "no_gui" }); } });
        kd.on("close", (code) => {
          if (kdSettled) return;
          kdSettled = true;
          if (code === 0 && kdOut.trim().length > 0) {
            tryFinish({ picked: kdOut.trim() });
          } else {
            tryFinish({ picked: null, reason: code === 0 ? "cancelled" : "no_gui" });
          }
        });
      } else {
        tryFinish({ picked: null, reason: "spawn_failed" });
      }
    });

    child.on("close", (code) => {
      if (settled) return;
      const out = stdout.trim();
      // PowerShell: empty stdout + OK code = cancel. osascript: same.
      if (code === 0 && out.length > 0) {
        tryFinish({ picked: out });
      } else {
        tryFinish({
          picked: null,
          reason: code === 0 ? "cancelled" : "no_gui",
        });
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────────
//  Package.json inspection
//
//  Reads and minimally validates the `package.json` at the chosen
//  path. Returns `null` when the file is missing or the JSON is
//  malformed so the UI can show a "no package.json found" state
//  without a thrown error. Strips the workspace-root boundary from
//  any returned path (not used today, but safe by construction).
// ─────────────────────────────────────────────────────────────────────

export interface PackageJsonSummary {
  name: string;
  version: string;
  path: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
}

const MAX_PACKAGE_JSON_BYTES = 1_000_000; // 1MB — caps pathological files

async function readPackageJson(folder: string): Promise<PackageJsonSummary | null> {
  // Reject obvious traversal — defense-in-depth even though this
  // endpoint is called only with paths the user just picked.
  if (folder.includes("..") || folder.includes("\0")) return null;
  const stat = await fsp.stat(folder).catch(() => null);
  if (!stat || !stat.isDirectory()) return null;

  const pkgPath = join(folder, "package.json");
  const pkgStat = await fsp.stat(pkgPath).catch(() => null);
  if (!pkgStat || !pkgStat.isFile()) return null;
  if (pkgStat.size > MAX_PACKAGE_JSON_BYTES) return null;

  const raw = await fsp.readFile(pkgPath, "utf8").catch(() => null);
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const name = typeof obj.name === "string" ? obj.name : "";
  const version = typeof obj.version === "string" ? obj.version : "";

  const asStringMap = (v: unknown): Record<string, string> => {
    if (!v || typeof v !== "object") return {};
    const m: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === "string") m[k] = val;
    }
    return m;
  };

  return {
    name,
    version,
    path: folder,
    dependencies: asStringMap(obj.dependencies),
    devDependencies: asStringMap(obj.devDependencies),
    peerDependencies: asStringMap(obj.peerDependencies),
  };
}

// Public aliases used by `index.ts` routes.
export const pickFolder = pickNativeFolder;
export const inspectPackage = readPackageJson;

// `readPackageJson` returns null both for "folder missing" and "folder
// exists but no package.json" — the /dev-server/inspect-package route
// pairs it with this check so the client can tell the two apart (a
// stored workspace root that no longer exists must be cleared, while a
// valid folder without a package.json is legitimately openable).
export async function folderExists(folder: string): Promise<boolean> {
  if (folder.includes("..") || folder.includes("\0")) return false;
  const stat = await fsp.stat(folder).catch(() => null);
  return !!stat?.isDirectory();
}