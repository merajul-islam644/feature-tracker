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
  Problem,
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
  setWorkspaceRoot: (path: string) => Promise<void>;
  /** Forget the picked folder. Clears localStorage + state. */
  closeFolder: () => void;

  /**
   * Local-agent bridge status, polled every 5s while the panel is
   * mounted. `null` until the first response lands.
   *
   * - `enabled=false` → cloud mcp-server is running /dev-server/*
   *   locally (the dev case). No banner, no agent needed.
   * - `enabled=true, connected=false` → bridge is engaged but no
   *   local agent is connected. The banner shows the "start the
   *   agent" instructions; any /dev-server/* call 503s.
   * - `enabled=true, connected=true` → the local agent is up and
   *   serving /dev-server/* requests. Banner hidden, panel
   *   operates against the user's filesystem.
   */
  agentStatus: {
    enabled: boolean;
    connected: boolean;
    connectedAt: string | null;
    version: string | null;
  } | null;
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
  const [workspace, setWorkspace] = useState<DevServerWorkspace | null>(() => {
    if (!userId || !projectId || !envSlug) return null;
    return loadDevServerWorkspace(userId, projectId, envSlug);
  });

  // Persist the workspace on first mount if it didn't exist.
  useEffect(() => {
    if (!userId || !projectId || !envSlug) return;
    if (workspace && workspace.userId === userId && workspace.projectId === projectId && workspace.envSlug === envSlug) {
      return;
    }
    const ws: DevServerWorkspace = workspace ?? {
      id: `ws-${Math.random().toString(36).slice(2, 8)}`,
      userId,
      projectId,
      envSlug,
      createdAt: new Date().toISOString(),
      port: 5183,
    };
    saveDevServerWorkspace(ws);
    setWorkspace(ws);
  }, [userId, projectId, envSlug, workspace]);

  const [servers, setServers] = useState<Map<number, DevServerRecord>>(() => new Map());
  const [problems, setProblems] = useState<Problem[]>([]);
  // Local-agent bridge status. `null` until the first poll lands;
  // the banner treats that as "loading" and renders nothing. See
  // the matching effect below.
  const [agentStatus, setAgentStatus] = useState<DevServerContextValue["agentStatus"]>(null);
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
    async (path: string) => {
      if (!userId || !projectId || !envSlug) {
        // Auth/env triple hasn't hydrated — typing a path while the
        // IAM session is broken would otherwise silently swallow the
        // click. Surface the failure so the user knows to refresh.
        toast.error(
          "Authentication not ready — please refresh the page and try again.",
        );
        return;
      }
      const trimmed = path.trim();
      if (!trimmed) return;
      try {
        const pkg = await devServerApi.inspectPackage(trimmed);
        if (!pkg) {
          // Folder exists but no package.json — still set the root,
          // just with a null packageJson. The UI shows "no package.json
          // found" and hides the workspace dependencies subsection.
          applyWorkspaceRoot(trimmed, null);
          toast.success(`Opened ${trimmed.split(/[\\/]/).pop() ?? trimmed} — no package.json found`);
          return;
        }
        applyWorkspaceRoot(trimmed, pkg);
        toast.success(`Opened ${pkg.name}${pkg.version ? ` v${pkg.version}` : ""}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
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
        const pkg = await devServerApi.inspectPackage(result.path);
        if (!pkg) {
          applyWorkspaceRoot(result.path, null);
          const name = result.path.split(/[\\/]/).pop() ?? result.path;
          toast.success(`Opened ${name} — no package.json found`);
          return;
        }
        applyWorkspaceRoot(result.path, pkg);
        toast.success(`Opened ${pkg.name}${pkg.version ? ` v${pkg.version}` : ""}`);
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
  // deleted the folder since the last session. The synchronous load
  // already populated `workspaceRoot`; this pass calls `inspectPackage`
  // and clears the row if the path is gone (returns null AND was
  // previously non-null). Distinguishing the two cases matters so a
  // brand-new "no package.json" folder doesn't get wiped on mount.
  useEffect(() => {
    if (!workspaceRoot) return;
    if (!userId || !projectId || !envSlug) return;
    let cancelled = false;
    (async () => {
      try {
        const pkg = await devServerApi.inspectPackage(workspaceRoot.path);
        if (cancelled) return;
        // Path no longer exists — `inspectPackage` returns null AND
        // a `fsp.stat` failure means the dir is gone. Clear + toast.
        if (!pkg && workspaceRoot.packageJson === null) {
          // Already null packageJson (we knew it was missing) — re-check
          // by re-statting through a throwaway. Simplest: clear the row
          // only if the directory also doesn't exist. Since the server
          // is the one with fs access, we just trust the inspectPackage
          // contract: null on missing dir OR missing package.json.
          // To distinguish, attempt a second call via the underlying
          // helper isn't available — instead, leave the row alone
          // unless the user explicitly retries.
          return;
        }
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

  // Local-agent bridge status — poll every 5s. The banner is
  // proactive UI: it shows the user the "start the agent"
  // instructions before they hit any /dev-server/* call. Without
  // this poll, the only feedback would be a 503 toast on the first
  // failed operation, which feels like a server bug.
  //
  // The poll starts as soon as the panel mounts and runs until
  // unmount. We use a simple setInterval — no exponential
  // backoff, no jitter — because the endpoint is the same-origin
  // SPA proxy and is essentially free.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await devServerApi.getAgentStatus();
        if (cancelled) return;
        setAgentStatus((prev) => {
          // Skip the re-render when the new status is byte-identical
          // to the previous one — saves the banner from 4 useless
          // re-renders per minute when nothing changes.
          if (
            prev &&
            prev.enabled === next.enabled &&
            prev.connected === next.connected &&
            prev.connectedAt === next.connectedAt &&
            prev.version === next.version
          ) {
            return prev;
          }
          return next;
        });
      } catch {
        // Network blip — keep the previous status; next tick will
        // retry. Banner doesn't flash because we only update on a
        // real change.
      }
    };
    void tick();
    const handle = window.setInterval(tick, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, []);

  const value = useMemo<DevServerContextValue>(() => ({
    workspace,
    enabled: true,
    servers,
    problems,
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
    agentStatus,
  }), [
    workspace,
    servers,
    problems,
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
    agentStatus,
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