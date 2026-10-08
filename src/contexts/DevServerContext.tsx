// Dev-server sandbox state — workspace identity, per-port server
// records, file-dirty tracking, and parsed-from-stderr problems.
//
// Lifted to a context for the same reasons as
// `PlaywrightInstallerContext`: the workspace editor (tabs, status
// bar, terminal, preview), the Configure drawer (Start / Stop
// buttons), and the file-saving path (`Cmd+S`, dirty tab indicators)
// read and write the same per-(user, project, env) workspace, and
// without lifting them every consumer would carry its own (workspace
// id, server record) snapshot and double-spawn children.
//
// Lifecycle:
//   • On mount: `ensureWorkspace` synthesises a stable id from
//     `(userId, projectId, envSlug)` and persists it to localStorage.
//   • On `startDevServer`: subscribe to the SSE tail for that port;
//     records enter the `servers` Map; events go into `problems`
//     when they carry stack frames, into the terminal panel when
//     they carry stdout/stderr.
//   • On `saveFile`: 500ms debounce; last write wins; flush on
//     tab close and `beforeunload`.
//
// All network methods live in the API client; this context owns
// state, scheduling, and subscriptions, and exposes a minimal
// imperative surface (`start`/`stop`/`save`/`flush`) so the panel
// can stay declarative.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { devServerApi } from "@/services/devServerApi";
import {
  loadDevServerWorkspace,
  loadWorkspaceRoot,
  saveDevServerWorkspace,
  saveWorkspaceRoot,
} from "@/lib/blocks/devServerStorage";
import type {
  DevServerEvent,
  DevServerRecord,
  DevServerWorkspace,
  FileNode,
  LspDiagnostic,
  Problem,
  SearchResponse,
  WatchEvent,
  WatchEventKind,
  WorkspaceRoot,
} from "@/types/dev-server";
import { toast } from "sonner";

interface PendingSave {
  path: string;
  content: string;
  /** Resolves when the PUT 200s (or rejects on failure). */
  done: Promise<void>;
  resolve: () => void;
  reject: (err: Error) => void;
}

interface DevServerContextValue {
  /** Always non-null inside the provider — initialised on mount. */
  workspace: DevServerWorkspace | null;
  /** Whether the backend sandbox flag is on. When false the editor
   *  still mounts but every action throws — Configure drawer hides
   *  the "Start dev server" affordance. */
  enabled: boolean;

  /** Per-port server records. Multiple ports per workspace allowed
   *  (composite id). Cleared on workspace change. */
  servers: Map<number, DevServerRecord>;
  /** Rolling list of `devserver_error` events — the Problems tab. */
  problems: Problem[];

  /** Language-server diagnostics (Phase 1: TypeScript) keyed by
   *  root-relative path. Entries with an empty array mean "this file
   *  is clean as of the last publish". Feed for the Problems panel
   *  and the CodeMirror lint gutter. */
  lspDiagnostics: Record<string, LspDiagnostic[]>;
  /** False after the LSP subscription exhausts its reconnect budget
   *  (binary missing / route absent) — the Problems panel shows a
   *  hint instead of an empty list. */
  lspOnline: boolean;

  /** Folder the user picked via "Open Folder". `null` when no
   *  folder has been opened in this session (or the persisted one
   *  no longer exists — the top bar's re-validate path on mount
   *  clears stale entries). `packageJson` is `null` when the
   *  picked folder has no `package.json` — the UI still mounts but
   *  hides the "Workspace dependencies" subsection. */
  workspaceRoot: WorkspaceRoot | null;

  // ─── VS Code-style file management on the user's picked folder ───

  /** Recursive tree of the picked folder. `null` until the first
   *  `refreshTree()` call lands. The route hides `node_modules` and
   *  `.git` and caps entry count server-side (see
   *  `mcp-server/src/devServer.ts:walkTree`). */
  tree: FileNode[] | null;
  /** Re-fetch the tree from the backend. Cheap-ish (one round-trip)
   *  — call after every mutation, plus on tab focus to catch
   *  out-of-band edits. No-ops when no folder is open. */
  refreshTree: () => Promise<void>;

  /** Read a file from the picked folder. Returns `null` on 404
   *  (file was deleted out from under us). Throws on network
   *  failure so the caller can toast. */
  readUserFile: (path: string) => Promise<string | null>;
  /** Write a file to the picked folder. 1MB server-side cap; throws
   *  on disk failure. Caller should `refreshTree()` on success —
   *  this method does NOT auto-refresh so batched writes can settle
   *  before the next network round-trip. */
  writeUserFile: (path: string, content: string) => Promise<void>;
  /** Make a directory at the given relative path. mkdir -p. */
  createUserFolder: (path: string) => Promise<void>;
  /** Delete a file or recursive directory. Throws on ENOENT so the
   *  caller can decide between silent-tree-refresh (already gone)
   *  and a louder error. */
  deleteUserPath: (path: string) => Promise<void>;
  /** Rename a file or directory. Refuses if `newPath` already exists
   *  on disk — the caller surfaces the server's error message. */
  renameUserPath: (oldPath: string, newPath: string) => Promise<void>;

  startDevServer: (opts: {
    port: number;
    command: string;
    args: string[];
  }) => Promise<void>;
  stopDevServer: (port: number) => Promise<void>;

  /** Debounced 500ms; last-write-wins per (path). Resolves when the
   *  PUT lands. */
  saveFile: (path: string, content: string) => Promise<void>;
  /** Force any pending writes to flush synchronously. Used on tab
   *  close so a dirty `Cmd+S` doesn't get lost. */
  flushPending: () => Promise<void>;

  /** Reload file content from disk. Used when the workspace was
   *  re-attached after mcp-server restart (file edits made
   *  elsewhere should still be visible). */
  readFile: (path: string, port?: number) => Promise<string | null>;

  /**
   * Open the OS native folder dialog, parse the picked folder's
   * `package.json`, and persist both to localStorage. Toast on
   * success / cancel / no-GUI. Throws only on hard network failure.
   */
  openFolder: () => Promise<void>;
  /**
   * Skip the dialog and use `path` directly. Used by the "Type the
   * absolute path" fallback when the native shim is unavailable
   * (headless server, missing zenity, etc.). Re-validates the path
   * with `inspectPackage` so a stale / deleted folder doesn't leak
   * into the UI.
   */
  setWorkspaceRoot: (
    path: string,
  ) => Promise<{ ok: boolean; message: string }>;
  /** Forget the picked folder. Clears localStorage + state. */
  closeFolder: () => void;

  // ─── File watcher — external-edit detection. ─────────────────────────────
  /**
   * Subscribe to chokidar events from the picked root. Fires once per
   * add / change / unlink / addDir / unlinkDir. The context owns the
   * underlying SSE tail (one chokidar handle per workspaceRoot) and
   * fans events out to every subscriber.
   *
   * Events for paths the editor JUST wrote (within the last 3s) are
   * filtered out — the save → disk → chokidar round-trip would
   * otherwise echo back as "external change" and trip the
   * conflict-detect prompt. The window is intentionally generous
   * because chokidar's awaitWriteFinish can delay the event by up
   * to 200ms past the actual write.
   */
  subscribeToWatcher: (
    cb: (event: WatchEvent) => void,
  ) => () => void;
  /** True while the SSE tail is healthy. Flips to false after the
   *  reconnect budget burns (5×; the consumer can use it for a
   *  "watcher offline" hint in the status bar). */
  watcherOnline: boolean;

  // ─── Project-wide search — POST /dev-server/:wsId/search. ─────────────
  /**
   * Recursive grep over the picked folder. Mirrors ripgrep's
   * `{path, line, column}` shape so consumers can render results
   * directly as `(file:line:col)` and navigate on click.
   */
  search: (opts: {
    query: string;
    caseSensitive?: boolean;
    wholeWord?: boolean;
    regex?: boolean;
    includeGlobs?: string[];
    excludeGlobs?: string[];
    maxResults?: number;
  }) => Promise<SearchResponse>;
}

const DevServerContext = createContext<DevServerContextValue | null>(null);

interface ProviderProps {
  userId: string;
  projectId: string;
  envSlug: string;
  children: ReactNode;
}

const SAVE_DEBOUNCE_MS = 500;

function workspaceKey(userId: string, projectId: string, envSlug: string): string {
  return `${userId}|${projectId}|${envSlug}`;
}

// Pull `file:line:col` from common Vite / esbuild / Rollup frames.
// Conservative; ignores lines we can't confidently parse.
function parseProblem(message: string): Omit<Problem, "id" | "ts"> | null {
  // Vite: `✘ [ERROR] Could not resolve "./App" in src/main.jsx:42`
  const m = /^\s*(?:✘|✗|Error|error)?\s*(?:\[ERROR\]\s*)?(.+?)\s+in\s+(.+?):(\d+)(?::(\d+))?/u.exec(message);
  if (m) {
    return {
      message: m[1].trim(),
      file: m[2],
      line: Number(m[3]),
      column: m[4] ? Number(m[4]) : undefined,
    };
  }
  return null;
}

export function DevServerProvider({
  userId,
  projectId,
  envSlug,
  children,
}: ProviderProps) {
  // Workspace identity — load on mount, save on first write. The id
  // survives across page reloads so files stay on disk.
  //
  // The id is keyed by the `(user, project, env)` triple plus a short
  // random segment. We can't compute the id lazily on mount because
  // `useAuth().currentUser?.id` resolves asynchronously and the lazy
  // `useState` initializer only runs once — if it fires while
  // `userId` is still undefined, the load returns null and the next
  // effect run generates a *fresh* random id, overwriting the
  // previously persisted one. That breaks every consumer keyed by
  // `workspace.id` (terminal scrollback, instance list, dev-server
  // records): refresh → new id → saved data orphan → user sees an
  // empty terminal every time. The same race was the root cause of
  // the editorFullscreen bug fixed in WorkspacePage.tsx.
  const [workspace, setWorkspace] = useState<DevServerWorkspace | null>(null);
  const workspaceLoadKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userId || !projectId || !envSlug) return;
    const key = `${userId}|${projectId}|${envSlug}`;
    if (key === workspaceLoadKeyRef.current) return;
    workspaceLoadKeyRef.current = key;
    const loaded = loadDevServerWorkspace(userId, projectId, envSlug);
    if (loaded) {
      setWorkspace(loaded);
      return;
    }
    // First visit for this triple — synthesize an id and persist.
    const ws: DevServerWorkspace = {
      id: `ws-${Math.random().toString(36).slice(2, 8)}`,
      userId,
      projectId,
      envSlug,
      createdAt: new Date().toISOString(),
      port: 5183,
    };
    saveDevServerWorkspace(ws);
    setWorkspace(ws);
  }, [userId, projectId, envSlug]);

  const [servers, setServers] = useState<Map<number, DevServerRecord>>(() => new Map());
  const [problems, setProblems] = useState<Problem[]>([]);

  // ─── Language-server diagnostics state (Phase 1: TS) ───────────
  // One SSE tail per workspaceRoot feeding a path-keyed map. Empty
  // arrays are kept (a publish with zero diagnostics means "clean
  // now") so consumers can distinguish "never analysed" from "no
  // problems".
  const [lspDiagnostics, setLspDiagnostics] = useState<
    Record<string, LspDiagnostic[]>
  >({});
  const [lspOnline, setLspOnline] = useState(false);
  // ─── File watcher state ────────────────────────────────────────
  // Fan-out hub — one SSE tail per workspaceRoot, many subscribers.
  // `watcherOnline` flips false after the reconnect budget burns so
  // the status bar can render a "watcher offline" hint. `skipChangeFor`
  // is the just-written filter (path → expiry ts).
  const [watcherOnline, setWatcherOnline] = useState(false);
  const watcherListenersRef = useRef<Set<(event: WatchEvent) => void>>(new Set());
  // Map<path, expiryTs>. Cleared lazily — at lookup time we drop any
  // entries older than the window. Cap size to avoid a memory leak on
  // a long-running session that saves many files.
  const skipChangeForRef = useRef<Map<string, number>>(new Map());
  const SKIP_WINDOW_MS = 3_000;

  // ─── VS Code-style file tree state ─────────────────────────────
  // `null` until the first `refreshTree()` call lands. Cleared when
  // the user closes the folder (or the workspace triple changes). The
  // tree is the source of truth for the Explorer pane; mutations
  // always re-fetch to stay in sync with disk (cheap enough on
  // small/medium trees; for huge trees we'd add a per-row dirty
  // invalidation, but that's not on the critical path yet).
  const [tree, setTree] = useState<FileNode[] | null>(null);

  // ─── Workspace root — the user-picked local folder. Loaded
  // synchronously on mount from localStorage so the top-bar File
  // menu renders the current folder name without a network round-
  // trip. Re-validated asynchronously after mount (the folder may
  // have been deleted since the last session); a 404 / null response
  // clears the row to keep the top bar honest.
  const [workspaceRoot, setWorkspaceRootState] = useState<WorkspaceRoot | null>(
    () => {
      if (!userId || !projectId || !envSlug) return null;
      return loadWorkspaceRoot(userId, projectId, envSlug);
    },
  );

  // Re-read when the (user, project, env) triple becomes available
  // after mount. `useAuth().currentUser?.id` starts as `undefined`
  // while the auth check is in flight, so the synchronous load on
  // mount runs with an empty userId and writes `null` into state.
  // This effect retries the load once userId is populated so the
  // "last opened folder" actually surfaces after login.
  useEffect(() => {
    if (!userId || !projectId || !envSlug) return;
    if (workspaceRoot) return;
    const loaded = loadWorkspaceRoot(userId, projectId, envSlug);
    if (loaded) setWorkspaceRootState(loaded);
  }, [userId, projectId, envSlug, workspaceRoot]);

  // SSE subscribers — one per port. Stored in a ref because we
  // don't want to re-render when the subscription count changes.
  const unsubsRef = useRef<Map<number, () => void>>(new Map());

  // Pending file writes — debounced per (port, path). Last write
  // wins; if a flush is triggered, we await the latest entry's done.
  const pendingRef = useRef<Map<string, PendingSave>>(new Map());
  const flushTimerRef = useRef<number | null>(null);
  const flushWaitersRef = useRef<Array<() => void>>([]);
  const flushErrorRef = useRef<Error | null>(null);

  // Per-port cleanup when the workspace changes.
  const workspaceKeyStr = workspaceKey(userId, projectId, envSlug);
  useEffect(() => {
    return () => {
      for (const u of unsubsRef.current.values()) u();
      unsubsRef.current.clear();
      setServers(new Map());
      setProblems([]);
    };
    // Re-run when the workspace id changes; identity comparison is fine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id, workspaceKeyStr]);

  // beforeunload — best-effort flush. The browser doesn't await, but
  // `fetch(..., { keepalive: true })` keeps the request alive long
  // enough for the PUT to land.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (pendingRef.current.size === 0) return;
      e.preventDefault();
      // Best-effort: keepalive PUTs for each pending write.
      for (const [k, p] of pendingRef.current) {
        // path encoded into the URL — mcp-server path-traversal guard
        // rejects `..` and `\\`, but our paths come from the editor
        // and are already relative. Pull the workspaceId + port off
        // the path key.
        const [port, ...rest] = k.split("::");
        if (!workspace) return;
        fetch(
          `/api/dev-server/${encodeURIComponent(workspace.id)}/${port}/files/${rest.join("::")}`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ content: p.content }),
            keepalive: true,
          },
        ).catch(() => {
          // best-effort.
        });
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [workspace]);

  const ingestEvent = useCallback((port: number, ev: DevServerEvent) => {
    if (ev.kind === "devserver_log") {
      // Update the per-port record's `lastLogAt` marker for the status
      // bar — the actual terminal rendering is done by
      // TerminalPanel which subscribes directly.
      setServers((prev) => {
        const cur = prev.get(port);
        if (!cur) return prev;
        const next = new Map(prev);
        next.set(port, { ...cur, status: cur.status === "starting" ? "ready" : cur.status });
        return next;
      });
    } else if (ev.kind === "devserver_ready") {
      setServers((prev) => {
        const cur = prev.get(port);
        if (!cur) return prev;
        const next = new Map(prev);
        next.set(port, { ...cur, status: "ready", readyAt: new Date().toISOString() });
        return next;
      });
    } else if (ev.kind === "devserver_exit") {
      setServers((prev) => {
        const cur = prev.get(port);
        if (!cur) return prev;
        const next = new Map(prev);
        next.set(port, { ...cur, status: ev.code === 0 ? "exited" : "failed", lastExitCode: ev.code ?? null });
        return next;
      });
    } else if (ev.kind === "devserver_error") {
      const problem = parseProblem(ev.message ?? "");
      setProblems((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          ts: Date.now(),
          message: ev.message ?? "(unknown error)",
          file: problem?.file,
          line: problem?.line,
          column: problem?.column,
        },
      ].slice(-200));
    }
  }, []);

  const subscribePort = useCallback((port: number) => {
    if (!workspace) return;
    if (unsubsRef.current.has(port)) return;
    const unsub = devServerApi.subscribeEvents({
      workspaceId: workspace.id,
      port,
      onEvent: (ev) => ingestEvent(port, ev),
      onError: () => {
        // Soft-fail — the per-port record stays; the status bar shows
        // the last `status` we observed. The terminal panel uses its
        // own subscriber if it wants to render live.
      },
      onGiveUp: () => {
        // Mark the port as failed when the reconnect budget burns.
        setServers((prev) => {
          const cur = prev.get(port);
          if (!cur) return prev;
          const next = new Map(prev);
          next.set(port, { ...cur, status: "failed" });
          return next;
        });
      },
    });
    unsubsRef.current.set(port, unsub);
  }, [workspace, ingestEvent]);

  const startDevServer = useCallback(async (opts: {
    port: number;
    command: string;
    args: string[];
  }) => {
    if (!workspace) throw new Error("no workspace");
    // Optimistic — paint the row as `starting` immediately so the UI
    // doesn't wait on the round-trip.
    setServers((prev) => {
      const next = new Map(prev);
      next.set(opts.port, {
        id: `${workspace.id}:${opts.port}`,
        workspaceId: workspace.id,
        port: opts.port,
        status: "starting",
        command: opts.command,
        args: opts.args,
        cwd: workspace.id,
        startedAt: new Date().toISOString(),
      });
      return next;
    });
    try {
      await devServerApi.startDevServer({
        workspaceId: workspace.id,
        port: opts.port,
        command: opts.command,
        args: opts.args,
      });
      subscribePort(opts.port);
    } catch (err) {
      // Roll back the optimistic insert.
      setServers((prev) => {
        const next = new Map(prev);
        next.delete(opts.port);
        return next;
      });
      throw err;
    }
    // Persist the port as the last-used default for next session.
    const updated: DevServerWorkspace = { ...workspace, port: opts.port, lastCommand: `${opts.command} ${opts.args.join(" ")}` };
    saveDevServerWorkspace(updated);
    setWorkspace(updated);
  }, [workspace, subscribePort]);

  const stopDevServer = useCallback(async (port: number) => {
    if (!workspace) return;
    try {
      await devServerApi.stopDevServer({ workspaceId: workspace.id, port });
    } finally {
      const unsub = unsubsRef.current.get(port);
      if (unsub) {
        unsub();
        unsubsRef.current.delete(port);
      }
    }
  }, [workspace]);

  const flushPending = useCallback(async () => {
    if (pendingRef.current.size === 0) return;
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    // Fire every pending PUT in parallel — they have distinct (port,
    // path) keys so there's no write-write hazard.
    const all = Array.from(pendingRef.current.values()).map((p) => p.done);
    try {
      await Promise.all(all);
      flushErrorRef.current = null;
    } catch (err) {
      flushErrorRef.current = err instanceof Error ? err : new Error(String(err));
      throw flushErrorRef.current;
    } finally {
      pendingRef.current.clear();
      for (const w of flushWaitersRef.current) w();
      flushWaitersRef.current = [];
    }
  }, []);

  const saveFile = useCallback((path: string, content: string) => {
    if (!workspace) throw new Error("no workspace");
    // `port` is encoded into the path key so two ports writing to the
    // same relative path don't overwrite each other's debounce timer.
    const port = workspace.port;
    const key = `${port}::${path}`;
    return new Promise<void>((resolve, reject) => {
      const prev = pendingRef.current.get(key);
      if (prev) {
        // Last-write-wins — resolve it with no-op (we'll never fire
        // the rejected promise because the new write replaces it).
        prev.resolve();
        prev.reject = () => {};
      }
      const done = new Promise<void>((res, rej) => {
        pendingRef.current.set(key, {
          path,
          content,
          done: undefined as unknown as Promise<void>,
          resolve: res,
          reject: rej,
        });
      });
      pendingRef.current.get(key)!.done = done;
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
      }
      flushTimerRef.current = window.setTimeout(() => {
        flushTimerRef.current = null;
        void (async () => {
          // Snapshot — anything added during the fire stays for the
          // next tick.
          const snapshot = Array.from(pendingRef.current.entries());
          pendingRef.current.clear();
          await Promise.all(snapshot.map(async ([k, p]) => {
            const [pStr, ...rest] = k.split("::");
            const portNum = Number(pStr);
            const relPath = rest.join("::");
            try {
              await devServerApi.writeFile({
                workspaceId: workspace.id,
                port: portNum,
                path: relPath,
                content: p.content,
              });
              // Echo-filter: the watcher's "change" event for this
              // path arrives ~200ms after our write (chokidar's
              // awaitWriteFinish). Mark the path so the fan-out
              // doesn't trip the external-change prompt.
              skipChangeForRef.current.set(relPath, Date.now() + SKIP_WINDOW_MS);
              p.resolve();
            } catch (err) {
              p.reject(err instanceof Error ? err : new Error(String(err)));
            }
          }));
        })();
      }, SAVE_DEBOUNCE_MS);
    });
  }, [workspace]);

  const readFile = useCallback(async (path: string, port?: number) => {
    if (!workspace) return null;
    return devServerApi.readFile({
      workspaceId: workspace.id,
      port: port ?? workspace.port,
      path,
    });
  }, [workspace]);

  // ─── Open Folder ────────────────────────────────────────────────
  // Two-step: native dialog → inspect package.json. Persists to the
  // same per-(user, project, env) localStorage key the synchronous
  // load on mount reads from, so the top bar's "last opened folder"
  // label survives reloads.

  const applyWorkspaceRoot = useCallback(
    (path: string, pkg: WorkspaceRoot["packageJson"]): WorkspaceRoot => {
      const name = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
      const root: WorkspaceRoot = { path, name, packageJson: pkg };
      saveWorkspaceRoot(userId, projectId, envSlug, root);
      setWorkspaceRootState(root);
      return root;
    },
    [userId, projectId, envSlug],
  );

  const setWorkspaceRoot = useCallback(
    // Returns the outcome so non-UI callers (the chat agent's
    // workspace_open_folder tool) can report success/failure — the
    // toasts stay for the human.
    async (path: string): Promise<{ ok: boolean; message: string }> => {
      if (!userId || !projectId || !envSlug) {
        // Auth/env triple hasn't hydrated — typing a path while the
        // IAM session is broken would otherwise silently swallow the
        // click. Surface the failure so the user knows to refresh.
        const message =
          "Authentication not ready — please refresh the page and try again.";
        toast.error(message);
        return { ok: false, message };
      }
      const trimmed = path.trim();
      if (!trimmed) return { ok: false, message: "Empty path." };
      try {
        const res = await devServerApi.inspectPackage(trimmed);
        if (!res.exists) {
          // The folder isn't on disk. Never store it — a phantom root
          // would sit in localStorage forever (the mount re-validation
          // used to be unable to clear these) and leak into every
          // workspace tool call as a guaranteed failure.
          const message = `Folder not found: ${trimmed}`;
          toast.error(message);
          return { ok: false, message };
        }
        if (!res.package) {
          // Folder exists but no package.json — still set the root,
          // just with a null packageJson. The UI shows "no package.json
          // found" and hides the workspace dependencies subsection.
          applyWorkspaceRoot(trimmed, null);
          const name = trimmed.split(/[\\/]/).pop() ?? trimmed;
          const message = `Opened ${name} — no package.json found`;
          toast.success(message);
          return { ok: true, message };
        }
        applyWorkspaceRoot(trimmed, res.package);
        const message = `Opened ${res.package.name}${res.package.version ? ` v${res.package.version}` : ""}`;
        toast.success(message);
        return { ok: true, message };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(message);
        return { ok: false, message };
      }
    },
    [userId, projectId, envSlug, applyWorkspaceRoot],
  );

  const openFolder = useCallback(async () => {
    try {
      const result = await devServerApi.pickFolder();
      if ("path" in result) {
        // Re-inspect server-side. The native dialog returns the
        // path; we ask the backend to read package.json. This keeps
        // the parse path uniform (the server is the only thing
        // touching fs).
        const res = await devServerApi.inspectPackage(result.path);
        if (!res.exists) {
          // The picker shouldn't hand back phantom paths, but a
          // network drive that dropped between pick and inspect
          // would land here — refuse rather than store a dead root.
          toast.error(`Folder not found: ${result.path}`);
          return;
        }
        if (!res.package) {
          applyWorkspaceRoot(result.path, null);
          const name = result.path.split(/[\\/]/).pop() ?? result.path;
          toast.success(`Opened ${name} — no package.json found`);
          return;
        }
        applyWorkspaceRoot(result.path, res.package);
        toast.success(`Opened ${res.package.name}${res.package.version ? ` v${res.package.version}` : ""}`);
      } else if (result.reason === "no_gui" || result.reason === "spawn_failed") {
        toast.error("Native folder dialog unavailable. Use the text input fallback.");
      }
      // `cancelled` is a no-op — user closed the dialog themselves.
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, [applyWorkspaceRoot]);

  const closeFolder = useCallback(() => {
    saveWorkspaceRoot(userId, projectId, envSlug, null);
    setWorkspaceRootState(null);
    setTree(null);
    toast.success("Folder closed");
  }, [userId, projectId, envSlug]);

  // ─── VS Code-style tree CRUD on the picked folder ──────────────
  // Every mutation closes with `refreshTree()` so the Explorer pane
  // stays in sync with disk. Network errors throw — the caller can
  // decide between silent-toast (file already gone → ok) and a
  // louder surface (write failure → show why).

  const refreshTree = useCallback(async () => {
    if (!workspace || !workspaceRoot) {
      setTree(null);
      return;
    }
    try {
      const next = await devServerApi.listTree({
        workspaceId: workspace.id,
        root: workspaceRoot.path,
      });
      setTree(next);
    } catch (err) {
      // Soft-fail — keep the existing tree so a transient network
      // blip doesn't wipe the UI. Caller can retry.
      throw err instanceof Error ? err : new Error(String(err));
    }
  }, [workspace, workspaceRoot]);

  const readUserFile = useCallback(
    async (path: string) => {
      if (!workspace || !workspaceRoot) return null;
      return devServerApi.readUserFile({
        workspaceId: workspace.id,
        root: workspaceRoot.path,
        path,
      });
    },
    [workspace, workspaceRoot],
  );

  const writeUserFile = useCallback(
    async (path: string, content: string) => {
      if (!workspace || !workspaceRoot) throw new Error("no workspace folder");
      await devServerApi.writeUserFile({
        workspaceId: workspace.id,
        root: workspaceRoot.path,
        path,
        content,
      });
      // Echo-filter: this is the editor's own autosave write. The
      // watcher's "change" event for it arrives a few hundred ms later
      // (chokidar awaitWriteFinish) — mark the path so the fan-out
      // drops it instead of tripping the "file changed on disk"
      // prompt. Same contract as the sandbox writer above; without
      // this every autosave dialog-popped itself.
      skipChangeForRef.current.set(path, Date.now() + SKIP_WINDOW_MS);
    },
    [workspace, workspaceRoot],
  );

  const createUserFolder = useCallback(
    async (path: string) => {
      if (!workspace || !workspaceRoot) throw new Error("no workspace folder");
      await devServerApi.mkdirUserPath({
        workspaceId: workspace.id,
        root: workspaceRoot.path,
        path,
      });
      await refreshTree();
    },
    [workspace, workspaceRoot, refreshTree],
  );

  const deleteUserPath = useCallback(
    async (path: string) => {
      if (!workspace || !workspaceRoot) throw new Error("no workspace folder");
      await devServerApi.deleteUserPath({
        workspaceId: workspace.id,
        root: workspaceRoot.path,
        path,
      });
      await refreshTree();
    },
    [workspace, workspaceRoot, refreshTree],
  );

  const renameUserPath = useCallback(
    async (oldPath: string, newPath: string) => {
      if (!workspace || !workspaceRoot) throw new Error("no workspace folder");
      await devServerApi.renameUserPath({
        workspaceId: workspace.id,
        root: workspaceRoot.path,
        oldPath,
        newPath,
      });
      await refreshTree();
    },
    [workspace, workspaceRoot, refreshTree],
  );

  // Re-fetch the tree whenever the picked folder changes (mount +
  // every `openFolder()` / `setWorkspaceRoot()` round-trip). No-op
  // when no folder is open. Debounced via `refreshTree`'s own
  // single-flight guard: identical back-to-back calls collapse.
  useEffect(() => {
    if (!workspaceRoot || !workspace) return;
    void refreshTree();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceRoot?.path, workspace?.id]);

  // ─── File watcher subscription ──────────────────────────────────
  // One SSE tail per workspaceRoot, fans out to every subscriber via
  // `watcherListenersRef`. Reopens on workspaceRoot change; `onGiveUp`
  // flips `watcherOnline` false so the UI can render a hint.
  useEffect(() => {
    if (!workspace || !workspaceRoot) {
      setWatcherOnline(false);
      return;
    }
    setWatcherOnline(true);
    const unsub = devServerApi.subscribeWatcher({
      workspaceId: workspace.id,
      root: workspaceRoot.path,
      onEvent: (event) => {
        // Filter out our own writes. The Map is keyed by path; the
        // value is the expiry timestamp. We drop expired entries
        // lazily on every lookup — cheaper than a background sweeper
        // and bounded by typical editor activity (a few saves per
        // minute, tops).
        if (event.kind === "change") {
          const expiry = skipChangeForRef.current.get(event.path);
          const now = Date.now();
          if (expiry && expiry > now) {
            // Our own write — drop.
            return;
          }
          // Garbage-collect expired entries (cap the sweep cost so
          // a long-running session with thousands of saves doesn't
          // slow down every event).
          if (skipChangeForRef.current.size > 200) {
            for (const [k, v] of skipChangeForRef.current) {
              if (v <= now) skipChangeForRef.current.delete(k);
            }
          }
        }
        // Tree-shape changes (add/unlink/addDir/unlinkDir) imply the
        // Explorer pane needs to refetch. We don't auto-refresh on
        // `change` because consumers decide what to do (the editor
        // checks if the path is open; the Explorer does not care
        // about content changes).
        if (event.kind !== "change") {
          void refreshTree();
        }
        // Fan out to subscribers (cheap set copy — listeners get a
        // defensive clone so a subscriber unmounting mid-fanout
        // doesn't poison the iteration).
        for (const cb of Array.from(watcherListenersRef.current)) {
          try {
            cb(event);
          } catch {
            // Don't let one bad subscriber break the others.
          }
        }
      },
      onError: () => {
        // Soft-fail. `onGiveUp` (after 3×) flips the online flag.
      },
      onGiveUp: () => {
        setWatcherOnline(false);
      },
    });
    return () => {
      unsub();
      setWatcherOnline(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id, workspaceRoot?.path]);

  // ─── LSP diagnostics subscription ────────────────────────────────
  // One SSE tail per workspaceRoot, same lifecycle as the watcher
  // above. The first event is a full snapshot; publishes patch one
  // path at a time. Soft-fails: after 3 strikes `lspOnline` drops
  // and the Problems panel renders an offline hint — the rest of
  // the editor keeps working (the language server is an enhancement,
  // never a dependency).
  useEffect(() => {
    if (!workspace || !workspaceRoot) {
      setLspDiagnostics({});
      setLspOnline(false);
      return;
    }
    setLspOnline(true);
    const unsub = devServerApi.subscribeLspDiagnostics({
      workspaceId: workspace.id,
      root: workspaceRoot.path,
      onEvent: (event) => {
        if (event.kind === "snapshot") {
          setLspDiagnostics(event.files ?? {});
        } else {
          setLspDiagnostics((prev) => ({
            ...prev,
            [event.path]: event.diagnostics,
          }));
        }
      },
      onError: () => {
        // Soft-fail — onGiveUp handles the UI downgrade.
      },
      onGiveUp: () => {
        setLspOnline(false);
      },
    });
    return () => {
      unsub();
      setLspOnline(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id, workspaceRoot?.path]);

  // Refresh on tab focus — catches out-of-band edits (user saves
  // the file in their text editor, a watcher fires, etc.). Debounced
  // 1s so a rapid tab-flick doesn't hammer the backend.
  useEffect(() => {
    if (!workspaceRoot || !workspace) return;
    let timer: number | null = null;
    const onFocus = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void refreshTree();
      }, 1_000);
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      if (timer !== null) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceRoot?.path, workspace?.id]);

  // Re-validate the persisted folder on mount — the user may have
  // deleted the folder since the last session (or a buggy older build
  // stored a placeholder path that never existed). The synchronous load
  // already populated `workspaceRoot`; this pass calls `inspectPackage`
  // and uses its `exists` flag to clear phantom rows — which the old
  // null-only contract couldn't distinguish from a legitimate
  // "no package.json" folder, so such rows used to sit forever.
  useEffect(() => {
    if (!workspaceRoot) return;
    if (!userId || !projectId || !envSlug) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await devServerApi.inspectPackage(workspaceRoot.path);
        if (cancelled) return;
        if (!res.exists) {
          // Folder is gone (or never existed) — drop the stored root
          // entirely so every workspace surface (Explorer, tools, chat
          // CURRENT STATE) reflects reality.
          saveWorkspaceRoot(userId, projectId, envSlug, null);
          setWorkspaceRootState(null);
          setTree(null);
          toast.error(
            `Folder no longer exists — closed ${workspaceRoot.name}`,
          );
          return;
        }
        const pkg = res.package;
        if (pkg && (!workspaceRoot.packageJson ||
            workspaceRoot.packageJson.name !== pkg.name ||
            workspaceRoot.packageJson.version !== pkg.version)) {
          // Path still valid; refresh the cached package summary so
          // stale dependency lists don't linger.
          applyWorkspaceRoot(workspaceRoot.path, pkg);
        }
        if (!pkg && workspaceRoot.packageJson !== null) {
          // Previously had a package.json, now doesn't — the folder
          // was likely replaced. Refresh state.
          applyWorkspaceRoot(workspaceRoot.path, null);
          toast.error(`Folder changed — no package.json in ${workspaceRoot.name}`);
        }
      } catch {
        // Network failure on mount — keep the cached state. The next
        // explicit `openFolder` will retry.
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-run only when the (user, project, env) triple changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, projectId, envSlug]);

  // ─── Imperative surface ─────────────────────────────────────────────
  const subscribeToWatcher = useCallback((cb: (event: WatchEvent) => void) => {
    watcherListenersRef.current.add(cb);
    return () => {
      watcherListenersRef.current.delete(cb);
    };
  }, []);

  const search = useCallback(
    async (opts: {
      query: string;
      caseSensitive?: boolean;
      wholeWord?: boolean;
      regex?: boolean;
      includeGlobs?: string[];
      excludeGlobs?: string[];
      maxResults?: number;
    }): Promise<SearchResponse> => {
      if (!workspace || !workspaceRoot) {
        throw new Error("no workspace folder");
      }
      const res = await devServerApi.search({
        workspaceId: workspace.id,
        root: workspaceRoot.path,
        ...opts,
      });
      return res;
    },
    [workspace, workspaceRoot],
  );

  // Save-side hook removed — `saveFile` itself marks the path on
  // successful write. External subscribers (the conflict prompt)
  // see the echo filtered out automatically.

  const value = useMemo<DevServerContextValue>(() => ({
    workspace,
    enabled: true,
    servers,
    problems,
    lspDiagnostics,
    lspOnline,
    workspaceRoot,
    tree,
    refreshTree,
    readUserFile,
    writeUserFile,
    createUserFolder,
    deleteUserPath,
    renameUserPath,
    startDevServer,
    stopDevServer,
    saveFile,
    flushPending,
    readFile,
    openFolder,
    setWorkspaceRoot,
    closeFolder,
    subscribeToWatcher,
    watcherOnline,
    search,
  }), [
    workspace,
    servers,
    problems,
    lspDiagnostics,
    lspOnline,
    workspaceRoot,
    tree,
    refreshTree,
    readUserFile,
    writeUserFile,
    createUserFolder,
    deleteUserPath,
    renameUserPath,
    startDevServer,
    stopDevServer,
    saveFile,
    flushPending,
    readFile,
    openFolder,
    setWorkspaceRoot,
    closeFolder,
    subscribeToWatcher,
    watcherOnline,
    search,
  ]);

  return (
    <DevServerContext.Provider value={value}>
      {children}
    </DevServerContext.Provider>
  );
}

export function useDevServer(): DevServerContextValue {
  const ctx = useContext(DevServerContext);
  if (!ctx) {
    throw new Error("useDevServer must be used within a DevServerProvider");
  }
  return ctx;
}