// Backend-facing methods for the VS Code-style workspace.
//
// Talks to mcp-server (`:8787` via the Vite proxy at `/api/dev-server/*`)
// for the dev-server sandbox: long-running `npm run dev` children
// scoped to a per-(user, project, env) workspace, file CRUD on the
// workspace dir, and a hand-rolled reverse-proxy that the preview
// iframe hangs off.
//
// SSE reconnect (`subscribeEvents`) mirrors `issueTrackerApi.subscribeRun`
// (lines 477-600): manual reconnect with cursor advance instead of
// `EventSource` auto-retry, exponential backoff up to 8s, and an
// `onGiveUp` hook so the consumer can downgrade when the proxy is
// permanently unavailable.

import type {
  DevServerEvent,
  DevServerRecord,
  DevServerStatus,
  DevServerWorkspace,
  FileNode,
  LspDiagnosticEvent,
  PackageJsonSummary,
  SearchResponse,
  SearchResult,
  ShellDescriptor,
  WatchEvent,
  WatchEventKind,
} from "@/types/dev-server";
import type { GitBranch, GitStatus } from "@/types/git";

// Feature flag removed — the dev-server sandbox is always on. The
// previous `VITE_USE_DEV_SERVER` build-time flag was silently false
// in production (cloudbuild.yaml had no substitution for it), which
// short-circuited every method to `FLAG_OFF_ERROR("…")` and broke
// the `/panel` workspace. Keeping the path on always means local
// dev, containerized staging, and Cloud Run prod all share one code
// path — no "did someone forget to set the build arg" footgun.

// ─────────────────────────────────────────────────────────────────────
//  Workspace identity
//
//  The workspace id is generated once on first scaffold and stored in
//  localStorage (per `(user, project, env)`). Subsequent mounts reuse
//  the same id so files on disk stay in one place. mcp-server doesn't
//  know about the workspace concept beyond the id string it gets in
//  every request — the (userId, projectId, envSlug) → id mapping is
//  purely a frontend concern.
// ─────────────────────────────────────────────────────────────────────

// Use the platform CSPRNG when available — `Math.random` has only
// ~52 bits of state and a real birthday-collision risk around
// 60K generations. `crypto.randomUUID()` is collision-free and is
// widely supported in modern browsers + Node.
function randomId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  // Last-ditch fallback for very old environments.
  return Math.random().toString(36).slice(2, 12);
}

export function makeWorkspaceId(): string {
  // Suffix is the full UUID; the `ws-` prefix keeps the id readable
  // in logs and avoids accidental confusion with ItemIds elsewhere
  // in the system.
  return `ws-${randomId()}`;
}

// ─────────────────────────────────────────────────────────────────────
//  Method surface
// ─────────────────────────────────────────────────────────────────────

export const devServerApi = {
  /**
   * Start (or restart) a child `npm run dev` for the given workspace
   * + port. Idempotent — `startDevServer` in mcp-server reuses the
   * record if the (workspaceId, port) pair already exists.
   *
   * Returns the initial status (`starting` typically) so the UI can
   * paint the spinner without waiting for the first SSE event.
   */
  async startDevServer(opts: {
    workspaceId: string;
    port: number;
    command: string;
    args: string[];
  }): Promise<{ id: string; status: DevServerStatus; port: number }> {
    const res = await fetch("/api/dev-server/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(opts),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `start failed (${res.status})`);
    }
    return (await res.json()) as {
      id: string;
      status: DevServerStatus;
      port: number;
    };
  },

  async stopDevServer(opts: {
    workspaceId: string;
    port: number;
  }): Promise<void> {
    const res = await fetch("/api/dev-server/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(opts),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `stop failed (${res.status})`);
    }
  },

  /**
   * Pull the current record. Returns `null` when the backend has no
   * record for this (workspaceId, port) — happens after mcp-server
   * restarts. Used on mount to decide whether to re-open the SSE
   * tail or surface a "Stopped" status.
   */
  async getStatus(opts: {
    workspaceId: string;
    port: number;
  }): Promise<DevServerRecord | null> {
    try {
      const res = await fetch(
        `/api/dev-server/${encodeURIComponent(opts.workspaceId)}/${opts.port}/status`,
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`status failed (${res.status})`);
      return (await res.json()) as DevServerRecord;
    } catch (err) {
      // Network failure on mount shouldn't sink the panel; let the
      // caller choose between toast + offline-mode vs. retry.
      throw err instanceof Error ? err : new Error(String(err));
    }
  },

  /**
   * Subscribe to the SSE tail for a running dev server. Mirrors
   * `issueTrackerApi.subscribeRun` — manual cursor advance, exponential
   * backoff up to 8s, `onGiveUp` after three consecutive failures.
   *
   * Returns a teardown function. Idempotent: calling unsubscribe
   * after the stream settled (`done`) is a no-op.
   */
  subscribeEvents(opts: {
    workspaceId: string;
    port: number;
    onEvent: (event: DevServerEvent) => void;
    onError: (err: Error) => void;
    /** Fires once after `MAX_FAILURES` consecutive reconnect
     *  failures. Lets the consumer flip the status bar to "Stopped"
     *  without waiting for per-attempt `onError` callbacks. */
    onGiveUp?: (err: Error) => void;
  }): () => void {
    const url0 = `/api/dev-server/${encodeURIComponent(opts.workspaceId)}/${opts.port}/events`;
    let es: EventSource | null = null;
    let reconnectTimer: number | undefined;
    let disposed = false;
    let settled = false;
    let openedOnce = false;
    let cursor = 0;
    const MAX_FAILURES = 3;
    let consecutiveFailures = 0;
    let backoffMs = 1_000;

    const connect = () => {
      if (disposed || settled) return;
      es = new EventSource(cursor > 0 ? `${url0}?since=${cursor}` : url0);
      es.onopen = () => {
        openedOnce = true;
        consecutiveFailures = 0;
        backoffMs = 1_000;
      };
      es.onmessage = (msg) => {
        try {
          // Envelope shape — mirrors /verify/runs/:id/events:
          //   { type: "event", event: DevServerEvent }
          //   { type: "done" }
          const envelope = JSON.parse(msg.data) as
            | { type: "event"; event: DevServerEvent }
            | { type: "done" }
            | { type?: string };
          if (
            envelope &&
            (envelope as { type?: string }).type === "event" &&
            (envelope as { event?: DevServerEvent }).event
          ) {
            cursor += 1;
            opts.onEvent((envelope as { event: DevServerEvent }).event);
          }
          if (envelope && (envelope as { type?: string }).type === "done") {
            settled = true;
            es?.close();
          }
        } catch (err) {
          opts.onError(err instanceof Error ? err : new Error(String(err)));
        }
      };
      es.onerror = () => {
        // We own the retry decision — close first so the browser
        // doesn't race us with auto-retry.
        es?.close();
        es = null;
        if (disposed || settled) return;
        if (!openedOnce && cursor === 0) {
          // First-attempt 503 → proxy not configured. Downgrade
          // immediately rather than burning the backoff budget on a
          // known-dead endpoint.
          opts.onGiveUp?.(new Error("dev-server stream unavailable"));
          return;
        }
        opts.onError(new Error("dev-server stream error"));
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_FAILURES) {
          opts.onGiveUp?.(new Error("dev-server stream gave up after retries"));
          return;
        }
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = undefined;
          connect();
        }, backoffMs);
        // `onopen` resets backoffMs on a healthy reconnect, but a
        // connect-then-immediate-close (server died, network blip)
        // fires `onerror` without ever reaching `onopen` — leaving
        // the previous backoff in place and inflating the next delay.
        // Cap the backoff aggressively from the second failure
        // onward (1s, 2s, 2s, 2s, …) so we don't burn the 3-strike
        // budget on a single transient outage. The cap (2s) is
        // intentionally low because the dev-server loop is local and
        // we want the SSE to come back fast once the user restarts the
        // server.
        backoffMs = Math.min(Math.max(backoffMs, 1_000) * 2, 2_000);
      };
    };
    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      es?.close();
    };
  },

  /**
   * Read a file from the workspace dir. Returns `null` when the file
   * doesn't exist (404). Path-traversal guard lives on the backend;
   * the client passes the relative path as-is.
   */
  async readFile(opts: {
    workspaceId: string;
    port: number;
    path: string;
  }): Promise<string | null> {
    const res = await fetch(
      `/api/dev-server/${encodeURIComponent(opts.workspaceId)}/${opts.port}/files/${opts.path}`,
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`read failed (${res.status})`);
    const data = (await res.json()) as { content: string };
    return data.content;
  },

  /**
   * Write a file to the workspace dir. 1MB cap on the server; the
   * caller is expected to chunk large files. Throws on disk failure
   * so the context can decide between silent-toast (scaffold) and
   * loud-error (in-editor Cmd+S).
   */
  async writeFile(opts: {
    workspaceId: string;
    port: number;
    path: string;
    content: string;
  }): Promise<void> {
    const res = await fetch(
      `/api/dev-server/${encodeURIComponent(opts.workspaceId)}/${opts.port}/files/${opts.path}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: opts.content }),
      },
    );
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `write failed (${res.status})`);
    }
  },

  /**
   * Absolute URL the preview iframe hangs its `src` off. The proxy
   * route streams the dev-server response back through the mcp-server
   * so it stays on the same registrable domain as the Lattice page
   * (IAM cookies + HMR client injection require that).
   *
   * Path defaults to `/`. Pass `path: ""` for an exact empty path
   * (rare).
   */
  proxyUrl(opts: { workspaceId: string; port: number; path?: string }): string {
    const p = opts.path ?? "/";
    // Anchor on `window.location.origin` so the URL is valid inside an
    // iframe and matches the Vite proxy when running in dev.
    return `${window.location.origin}/api/dev-server/${encodeURIComponent(opts.workspaceId)}/${opts.port}/proxy/${p}`;
  },

  // ───────────────────────────────────────────────────────────────
  //  VS Code-style "Open Folder" — native folder picker.
  //
  //  Spawns the OS dialog (PowerShell / osascript / zenity). The
  //  server returns one of three shapes:
  //
  //    { path: string }                      — picked
  //    { cancelled: true, reason: "cancelled" }  — user closed dialog
  //    { cancelled: true, reason: "no_gui" }    — shim unavailable
  //
  //  The first two are user actions; the third is a server-side
  //  fallback the UI surfaces as a "Type the absolute path" text
  //  input.
  // ───────────────────────────────────────────────────────────────

  async pickFolder(): Promise<
    | { path: string }
    | { cancelled: true; reason: "cancelled" | "no_gui" | "spawn_failed" }
  > {
    const res = await fetch("/api/dev-server/pick-folder", {
      method: "POST",
      // Send an explicit JSON content-type with an empty object — Vite's
      // proxy can otherwise forward the request with no content-type,
      // which Fastify's default body parser rejects with
      // `FST_ERR_CTP_EMPTY_JSON_BODY` (400). The server route accepts
      // an empty body either way; this is purely a header hygiene fix.
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `pick failed (${res.status})`);
    }
    return (await res.json()) as
      | { path: string }
      | { cancelled: true; reason: "cancelled" | "no_gui" | "spawn_failed" };
  },

  /**
   * Reads the `package.json` at the given path. Returns `null` when
   * the file is missing or malformed — that's a normal state for a
   * folder the user just picked (e.g. `~/Downloads`), not an error.
   * The UI shows "no package.json found" and hides the workspace
   * dependencies subsection.
   */
  async inspectPackage(path: string): Promise<PackageJsonSummary | null> {
    const res = await fetch("/api/dev-server/inspect-package", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `inspect failed (${res.status})`);
    }
    const data = (await res.json()) as { package: PackageJsonSummary | null };
    return data.package;
  },

  // ───────────────────────────────────────────────────────────────
  //  User-folder CRUD — VS Code-style file management on the folder
  //  the user picked via `pickFolder()`. All routes are POST and
  //  take `root` (the picked absolute path) + path-relative fields
  //  in the body. The backend's `safeResolveUserFolder` enforces the
  //  path-traversal guard; rejected attempts 403.
  //
  //  Naming deliberately mirrors the backend routes so a route-not-
  //  found maps to a clear client-side error. The Vite proxy at
  //  `/api/dev-server` forwards every method+path uniformly, so any
  //  backend route is reachable from here without vite changes.
  // ───────────────────────────────────────────────────────────────

  /**
   * Recursive tree walk of the user's picked folder. Hides
   * `node_modules` and `.git`; caps at 5,000 entries + 8 levels deep
   * server-side so a hostile tree can't OOM the route.
   */
  async listTree(opts: {
    workspaceId: string;
    root: string;
    maxDepth?: number;
  }): Promise<FileNode[]> {
    const res = await fetch(
      `/api/dev-server/${encodeURIComponent(opts.workspaceId)}/list`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ root: opts.root, maxDepth: opts.maxDepth }),
      },
    );
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `list failed (${res.status})`);
    }
    const data = (await res.json()) as { tree: FileNode[] };
    return data.tree;
  },

  /**
   * Read a text file in the user folder. Returns `null` on 404 (file
   * deleted out from under the editor). UTF-8 only — binary content
   * would need a separate `/binary/*` route.
   */
  async readUserFile(opts: {
    workspaceId: string;
    root: string;
    path: string;
  }): Promise<string | null> {
    const res = await fetch(
      `/api/dev-server/${encodeURIComponent(opts.workspaceId)}/read`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ root: opts.root, path: opts.path }),
      },
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `read failed (${res.status})`);
    }
    const data = (await res.json()) as { content: string };
    return data.content;
  },

  /**
   * Write a text file in the user folder. Auto-creates missing
   * parents (mkdir -p). 1MB server-side cap, same as the sandbox
   * dir. Throws on disk failure so the editor can decide between
   * silent-toast (scaffold) and loud-error (in-editor Cmd+S).
   */
  async writeUserFile(opts: {
    workspaceId: string;
    root: string;
    path: string;
    content: string;
  }): Promise<void> {
    const res = await fetch(
      `/api/dev-server/${encodeURIComponent(opts.workspaceId)}/write`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          root: opts.root,
          path: opts.path,
          content: opts.content,
        }),
      },
    );
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `write failed (${res.status})`);
    }
  },

  /**
   * Delete a file or directory. Recursive for directories. Throws on
   * `ENOENT` (the path was already gone — caller decides whether to
   * refresh the tree).
   */
  async deleteUserPath(opts: {
    workspaceId: string;
    root: string;
    path: string;
  }): Promise<void> {
    const res = await fetch(
      `/api/dev-server/${encodeURIComponent(opts.workspaceId)}/delete`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ root: opts.root, path: opts.path }),
      },
    );
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `delete failed (${res.status})`);
    }
  },

  /**
   * Rename or move a file/directory. Refuses if `newPath` already
   * exists on the server. Throws on cross-device moves etc.
   */
  async renameUserPath(opts: {
    workspaceId: string;
    root: string;
    oldPath: string;
    newPath: string;
  }): Promise<void> {
    const res = await fetch(
      `/api/dev-server/${encodeURIComponent(opts.workspaceId)}/rename`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          root: opts.root,
          oldPath: opts.oldPath,
          newPath: opts.newPath,
        }),
      },
    );
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `rename failed (${res.status})`);
    }
  },

  /**
   * Make a directory (mkdir -p). Intermediate parents are created.
   */
  async mkdirUserPath(opts: {
    workspaceId: string;
    root: string;
    path: string;
  }): Promise<void> {
    const res = await fetch(
      `/api/dev-server/${encodeURIComponent(opts.workspaceId)}/mkdir`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ root: opts.root, path: opts.path }),
      },
    );
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `mkdir failed (${res.status})`);
    }
  },

  // Interactive shell bridge — opens a single WebSocket to
  // `wss://<host>/api/dev-terminal/shell?workspaceId=...&cwd=...&cols=...&rows=...`
  // which mcp-server proxies to a node-pty PTY. The handle exposes
  // the minimum the panel needs: send keystrokes, resize on
  // reflow, and tear down. Status is delivered through the
  // `onStarted` / `onExit` callbacks so the caller can drive its
  // own state machine.
  connectTerminal(opts: {
    workspaceId: string;
    cwd: string;
    /** Per-tab stable id — distinguishes multiple terminals open in
     *  the same workspace+folder. Generated by the panel on `[+]`
     *  and persisted in localStorage so refresh keeps the tab
     *  identity. Required. */
    terminalId: string;
    /** Stable id from `listShells()` — picks PowerShell 7 vs
     *  Git Bash vs cmd etc. Falls back to server default when
     *  omitted. */
    shellId?: string;
    cols?: number;
    rows?: number;
    onStarted: (info: { shell: string; cwd: string }) => void;
    onOutput: (data: string) => void;
    onExit: (info: { code: number | null; reason: string }) => void;
    onError: (message: string) => void;
    /** Fires on every `started` frame. `true` means the WS attached
     *  to a pre-existing PTY (page refresh / navigation / tab close
     *  + reopen); `false` means a fresh spawn. */
    onResumed?: (info: { shell: string; cwd: string; pid: number; resumed: boolean }) => void;
  }): {
    send: (data: string) => void;
    resize: (cols: number, rows: number) => void;
    close: () => void;
  } {
    const url = new URL("/api/dev-terminal/shell", window.location.origin);
    url.searchParams.set("workspaceId", opts.workspaceId);
    url.searchParams.set("cwd", opts.cwd);
    url.searchParams.set("terminalId", opts.terminalId);
    if (opts.shellId) url.searchParams.set("shellId", opts.shellId);
    if (typeof opts.cols === "number") url.searchParams.set("cols", String(opts.cols));
    if (typeof opts.rows === "number") url.searchParams.set("rows", String(opts.rows));

    // ── Reconnect state ──────────────────────────────────────────
    // mcp-server keeps the PTY alive across WS disconnects, so a
    // browser refresh / proxy hiccup / network flap should NOT end
    // the terminal session. We reconnect with exponential backoff
    // capped at 2 s and at most 6 attempts before giving up.
    const MAX_FAILURES = 6;
    const INITIAL_BACKOFF_MS = 250;
    const MAX_BACKOFF_MS = 2_000;

    let disposed = false;        // set by `close()` — no more reconnects
    let exited = false;          // set by an `exit` frame — real shell death, stop reconnecting
    let consecutiveFailures = 0;
    let backoffMs = INITIAL_BACKOFF_MS;
    let reconnectTimer: number | null = null;
    let opened = false;
    let ws: WebSocket | null = null;

    function clearReconnect(): void {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function reportReconnecting(reason: string): void {
      // Silent — the next WS will surface a `started` (or `exit`)
      // frame. The panel uses the `reconnecting:` reason prefix to
      // flip its phase without painting the `[Process exited]` banner.
      opts.onExit({ code: null, reason: `reconnecting:${reason}` });
    }

    function connect(): void {
      if (disposed || exited) return;

      try {
        ws = new WebSocket(url.toString());
      } catch (err) {
        // Synchronous construction can throw on bad URLs / secure-
        // context violations. Treat the same as an open-failure: try
        // again with backoff.
        scheduleReconnect();
        if (!opened) {
          queueMicrotask(() =>
            opts.onError(err instanceof Error ? err.message : String(err)),
          );
        }
        return;
      }

      opened = false;

      ws.addEventListener("open", () => {
        opened = true;
        // A successful open resets the backoff so the next transient
        // drop starts fresh from the initial delay.
        consecutiveFailures = 0;
        backoffMs = INITIAL_BACKOFF_MS;
      });

      ws.addEventListener("message", (ev) => {
        let frame: any;
        try {
          frame = JSON.parse(typeof ev.data === "string" ? ev.data : "");
        } catch {
          return;
        }
        switch (frame?.type) {
          case "started": {
            const info = {
              shell: String(frame.shell ?? ""),
              cwd: String(frame.cwd ?? opts.cwd),
              pid: typeof frame.pid === "number" ? frame.pid : 0,
              resumed: frame.resumed === true,
            };
            opts.onResumed?.(info);
            opts.onStarted({ shell: info.shell, cwd: info.cwd });
            return;
          }
          case "output":
            if (typeof frame.data === "string") {
              try {
                opts.onOutput(atob(frame.data));
              } catch {
                /* malformed base64 — ignore */
              }
            }
            return;
          case "exit":
            // Real shell exit. We deliberately do NOT call onExit
            // again on WS close — `exited` short-circuits it.
            if (!exited) {
              exited = true;
              opts.onExit({
                code: typeof frame.code === "number" ? frame.code : null,
                reason:
                  typeof frame.signal === "string"
                    ? frame.signal
                    : "pty_exit",
              });
            }
            return;
          case "pong":
            return;
          default:
            return;
        }
      });

      ws.addEventListener("error", () => {
        // The browser's WS error event fires before close; the close
        // handler does the actual reconnect work. Nothing to do here.
      });

      ws.addEventListener("close", (ev) => {
        if (disposed) return;
        if (exited) {
          // Real shell death already reported via the `exit` frame.
          return;
        }
        // WS dropped without an `exit` frame — the PTY is still
        // alive on mcp-server. Tell the panel to flip to
        // "reconnecting" and try again.
        reportReconnecting(String(ev.reason ?? "closed"));
        scheduleReconnect();
      });
    }

    function scheduleReconnect(): void {
      if (disposed || exited) return;
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_FAILURES) {
        opts.onError(
          `Terminal stream gave up after ${MAX_FAILURES} reconnect attempts. The shell may still be running on mcp-server — refresh the page to retry.`,
        );
        return;
      }
      const delay = Math.min(backoffMs, MAX_BACKOFF_MS);
      backoffMs = Math.max(backoffMs * 2, INITIAL_BACKOFF_MS);
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    }

    connect();

    return {
      send: (data: string) => {
        if (!ws || ws.readyState !== 1) return;
        try {
          ws.send(
            JSON.stringify({
              type: "input",
              data: btoa(unescape(encodeURIComponent(data))),
            }),
          );
        } catch {
          /* socket closed mid-send */
        }
      },
      resize: (cols: number, rows: number) => {
        if (!ws || ws.readyState !== 1) return;
        try {
          ws.send(JSON.stringify({ type: "resize", cols, rows }));
        } catch {
          /* */
        }
      },
      close: () => {
        if (disposed) return;
        disposed = true;
        clearReconnect();
        if (ws) {
          try {
            ws.close();
          } catch {
            /* */
          }
        }
      },
    };
  },

  /**
   * Explicit kill of the persistent terminal PTY. No UI calls this
   * today — the user presses Ctrl+C inside the terminal, which is
   * a natural shell exit. The route exists for parity with
   * `/dev-server/stop` and future scripting.
   */
  async stopTerminal(opts: {
    workspaceId: string;
    cwd: string;
    terminalId: string;
  }): Promise<{ ok: true; pid: number | null }> {
    const res = await fetch("/api/dev-terminal/shell/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(opts),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `stopTerminal failed (${res.status})`);
    }
    return (await res.json()) as { ok: true; pid: number | null };
  },

  // Local-agent bridge status. The mcp-server in the cloud exposes
  // GET /api/dev-server/_agent/status which returns
  // { enabled, connected, connectedAt, version }.
  //   - `enabled=false` means the cloud mcp-server is running the

  // ───────────────────────────────────────────────────────────────
  //  Shell catalog — enumerates PowerShell 7 / Windows PowerShell /
  //  cmd / Git Bash / WSL (and bash / zsh / sh on macOS/Linux) for
  //  the terminal panel's dropdown menu. The browser can't see
  //  `process.env.PATH`, so detection has to happen server-side.
  //  No caching — discovery is just `whichSync` × ~6 paths.
  // ───────────────────────────────────────────────────────────────
  async listShells(): Promise<ShellDescriptor[]> {
    const res = await fetch("/api/dev-terminal/shells");
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `listShells failed (${res.status})`);
    }
    const data = (await res.json()) as { shells: ShellDescriptor[] };
    return data.shells;
  },

  // ───────────────────────────────────────────────────────────────
  //  Project-wide search — recursive grep on the user's folder.
  //
  //  Mirrors ripgrep's `--json` shape so the frontend can lift
  //  `(path, line, column)` directly into a clickable result list
  //  that opens the file in the editor + jumps to the match.
  //
  //  Bounded by `maxResults` server-side (default 5K). When the
  //  caller asks for "everything" and the route truncates, the
  //  `truncated` flag flips and the UI nudges them to add a glob.
  // ───────────────────────────────────────────────────────────────
  async search(opts: {
    workspaceId: string;
    root: string;
    query: string;
    caseSensitive?: boolean;
    wholeWord?: boolean;
    regex?: boolean;
    includeGlobs?: string[];
    excludeGlobs?: string[];
    maxResults?: number;
  }): Promise<SearchResponse> {
    const res = await fetch(
      `/api/dev-server/${encodeURIComponent(opts.workspaceId)}/search`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          root: opts.root,
          query: opts.query,
          caseSensitive: opts.caseSensitive,
          wholeWord: opts.wholeWord,
          regex: opts.regex,
          includeGlobs: opts.includeGlobs,
          excludeGlobs: opts.excludeGlobs,
          maxResults: opts.maxResults,
        }),
      },
    );
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `search failed (${res.status})`);
    }
    return (await res.json()) as SearchResponse;
  },

  // ───────────────────────────────────────────────────────────────
  //  File watcher — SSE tail of chokidar add/change/unlink events.
  //
  //  Shape is identical to `subscribeEvents`: manual reconnect,
  //  cursor advance via `?since=N`, exponential backoff capped at
  //  2s, `onGiveUp` after three consecutive failures. Cursor lives
  //  client-side — server replays everything since the last
  //  successful cursor advance, so a transient disconnect doesn't
  //  drop events.
  //
  //  Used by the workspace to detect external edits (the silent
  //  overwrite is the #1 source of "my code reverted" tickets).
  // ───────────────────────────────────────────────────────────────
  subscribeWatcher(opts: {
    workspaceId: string;
    root: string;
    onEvent: (event: WatchEvent) => void;
    onError?: (err: Error) => void;
    /** Fires once after `MAX_FAILURES` consecutive reconnect
     *  failures. Lets the consumer downgrade to "Stopped" without
     *  spamming per-retry errors. */
    onGiveUp?: (err: Error) => void;
  }): () => void {
    const base = `/api/dev-server/${encodeURIComponent(opts.workspaceId)}/watch?root=${encodeURIComponent(opts.root)}`;
    let es: EventSource | null = null;
    let reconnectTimer: number | undefined;
    let disposed = false;
    let openedOnce = false;
    let cursor = 0;
    const MAX_FAILURES = 3;
    let consecutiveFailures = 0;
    let backoffMs = 1_000;

    const connect = () => {
      if (disposed) return;
      es = new EventSource(cursor > 0 ? `${base}&since=${cursor}` : base);
      es.onopen = () => {
        openedOnce = true;
        consecutiveFailures = 0;
        backoffMs = 1_000;
      };
      es.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data) as WatchEvent;
          if (
            event &&
            typeof event.kind === "string" &&
            typeof event.path === "string"
          ) {
            cursor += 1;
            opts.onEvent(event);
          }
        } catch (err) {
          opts.onError?.(err instanceof Error ? err : new Error(String(err)));
        }
      };
      es.onerror = () => {
        es?.close();
        es = null;
        if (disposed) return;
        if (!openedOnce && cursor === 0) {
          // First-attempt 503 → watcher endpoint is not configured.
          // Downgrade immediately rather than burning the budget.
          opts.onGiveUp?.(new Error("file watcher unavailable"));
          return;
        }
        opts.onError?.(new Error("file watcher stream error"));
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_FAILURES) {
          opts.onGiveUp?.(new Error("file watcher gave up after retries"));
          return;
        }
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = undefined;
          connect();
        }, backoffMs);
        // Same backoff cap as subscribeEvents — 1s, 2s, 2s, 2s…
        // The watcher is local so we want it back fast on a
        // transient outage without burning the 3-strike budget.
        backoffMs = Math.min(Math.max(backoffMs, 1_000) * 2, 2_000);
      };
    };
    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      es?.close();
    };
  },

  // ───────────────────────────────────────────────────────────────
  //  LSP bridge (Phase 1: TypeScript)
  // ───────────────────────────────────────────────────────────────

  /**
   * One JSON-RPC request to the workspace's language server. `doc`
   * syncs the server's view of a file first (didOpen/didChange with
   * the editor's live content, or disk content when omitted) so
   * hover/diagnostics reflect unsaved edits. `path` inside `params`
   * is a root-relative path — the server rewrites it to the
   * `textDocument.uri` the protocol wants.
   */
  async lspRequest(opts: {
    workspaceId: string;
    root: string;
    method: string;
    params?: unknown;
    doc?: { path: string; content?: string };
  }): Promise<unknown> {
    const res = await fetch(
      `/api/dev-server/${encodeURIComponent(opts.workspaceId)}/lsp/request`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          root: opts.root,
          method: opts.method,
          params: opts.params,
          doc: opts.doc,
        }),
      },
    );
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `lsp request failed (${res.status})`);
    }
    const data = (await res.json()) as { result: unknown };
    return data.result;
  },

  /** Recycle the workspace's language server process (e.g. after a
   *  tsconfig change). */
  async stopLsp(opts: { workspaceId: string }): Promise<void> {
    await fetch(
      `/api/dev-server/${encodeURIComponent(opts.workspaceId)}/lsp/stop`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    ).catch(() => undefined);
  },

  /**
   * SSE feed of LSP diagnostics — same reconnect/cursor skeleton as
   * `subscribeWatcher`, with one difference: the first event on a
   * fresh connection is a `snapshot` of every file's current
   * diagnostics, so a fresh subscriber paints immediately.
   */
  subscribeLspDiagnostics(opts: {
    workspaceId: string;
    root: string;
    onEvent: (event: LspDiagnosticEvent) => void;
    onError?: (err: Error) => void;
    onGiveUp?: (err: Error) => void;
  }): () => void {
    const base = `/api/dev-server/${encodeURIComponent(opts.workspaceId)}/lsp/diagnostics?root=${encodeURIComponent(opts.root)}`;
    let es: EventSource | null = null;
    let reconnectTimer: number | undefined;
    let disposed = false;
    let openedOnce = false;
    let cursor = 0;
    const MAX_FAILURES = 3;
    let consecutiveFailures = 0;
    let backoffMs = 1_000;

    const connect = () => {
      if (disposed) return;
      es = new EventSource(cursor > 0 ? `${base}&since=${cursor}` : base);
      es.onopen = () => {
        openedOnce = true;
        consecutiveFailures = 0;
        backoffMs = 1_000;
      };
      es.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data) as LspDiagnosticEvent;
          if (event && (event.kind === "snapshot" || event.kind === "publish")) {
            cursor += 1;
            opts.onEvent(event);
          }
        } catch (err) {
          opts.onError?.(err instanceof Error ? err : new Error(String(err)));
        }
      };
      es.onerror = () => {
        es?.close();
        es = null;
        if (disposed) return;
        if (!openedOnce && cursor === 0) {
          // First-attempt failure → the language server binary is
          // missing or the route doesn't exist on this backend.
          opts.onGiveUp?.(new Error("language server unavailable"));
          return;
        }
        opts.onError?.(new Error("language server stream error"));
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_FAILURES) {
          opts.onGiveUp?.(new Error("language server gave up after retries"));
          return;
        }
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = undefined;
          connect();
        }, backoffMs);
        backoffMs = Math.min(Math.max(backoffMs, 1_000) * 2, 2_000);
      };
    };
    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      es?.close();
    };
  },

  // ───────────────────────────────────────────────────────────────
  //  Git bridge — the Source Control panel. Mutations throw with
  //  git's own stderr as the message (the server forwards it), so
  //  panel toasts read exactly what a terminal would have printed.
  // ───────────────────────────────────────────────────────────────

  /** Porcelain status. Never throws for "not a repo" — that arrives
   *  as `isRepo: false` + `reason`, an ordinary panel state. */
  async gitStatus(opts: { workspaceId: string; root: string }): Promise<GitStatus> {
    const res = await fetch(
      `/api/dev-server/${encodeURIComponent(opts.workspaceId)}/git/status?root=${encodeURIComponent(opts.root)}`,
    );
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `git status failed (${res.status})`);
    }
    return (await res.json()) as GitStatus;
  },

  /** Unified diff text for one file. Empty string for untracked files
   *  (no baseline to diff against). */
  async gitDiff(opts: {
    workspaceId: string;
    root: string;
    path: string;
    staged: boolean;
  }): Promise<string> {
    const q = new URLSearchParams({
      root: opts.root,
      path: opts.path,
      staged: opts.staged ? "1" : "0",
    });
    const res = await fetch(
      `/api/dev-server/${encodeURIComponent(opts.workspaceId)}/git/diff?${q.toString()}`,
    );
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `git diff failed (${res.status})`);
    }
    const data = (await res.json()) as { diff: string };
    return data.diff;
  },

  async gitBranches(opts: {
    workspaceId: string;
    root: string;
  }): Promise<GitBranch[]> {
    const res = await fetch(
      `/api/dev-server/${encodeURIComponent(opts.workspaceId)}/git/branches?root=${encodeURIComponent(opts.root)}`,
    );
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `git branches failed (${res.status})`);
    }
    const data = (await res.json()) as { branches: GitBranch[] };
    return data.branches;
  },

  async gitStage(opts: {
    workspaceId: string;
    root: string;
    paths: string[];
  }): Promise<void> {
    await devServerApi.gitMutation(opts.workspaceId, "stage", {
      root: opts.root,
      paths: opts.paths,
    });
  },

  async gitUnstage(opts: {
    workspaceId: string;
    root: string;
    paths: string[];
  }): Promise<void> {
    await devServerApi.gitMutation(opts.workspaceId, "unstage", {
      root: opts.root,
      paths: opts.paths,
    });
  },

  async gitDiscard(opts: {
    workspaceId: string;
    root: string;
    paths: string[];
  }): Promise<void> {
    await devServerApi.gitMutation(opts.workspaceId, "discard", {
      root: opts.root,
      paths: opts.paths,
    });
  },

  /** Commit the staged index. Resolves with git's summary line for
   *  the success toast. */
  async gitCommit(opts: {
    workspaceId: string;
    root: string;
    message: string;
  }): Promise<string> {
    const data = (await devServerApi.gitMutation(opts.workspaceId, "commit", {
      root: opts.root,
      message: opts.message,
    })) as { summary?: string };
    return data.summary ?? "";
  },

  async gitPush(opts: {
    workspaceId: string;
    root: string;
  }): Promise<string> {
    const data = (await devServerApi.gitMutation(opts.workspaceId, "push", {
      root: opts.root,
    })) as { output?: string };
    return data.output ?? "";
  },

  async gitPull(opts: {
    workspaceId: string;
    root: string;
  }): Promise<string> {
    const data = (await devServerApi.gitMutation(opts.workspaceId, "pull", {
      root: opts.root,
    })) as { output?: string };
    return data.output ?? "";
  },

  async gitCheckout(opts: {
    workspaceId: string;
    root: string;
    branch: string;
  }): Promise<void> {
    await devServerApi.gitMutation(opts.workspaceId, "checkout", {
      root: opts.root,
      branch: opts.branch,
    });
  },

  /** Shared POST plumbing for the git mutations — identical shape:
   *  `{ root, …op fields }` body, `{ ok: true, … }` response, git's
   *  stderr in `error` on failure. */
  async gitMutation(
    workspaceId: string,
    op: "stage" | "unstage" | "discard" | "commit" | "push" | "pull" | "checkout",
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const res = await fetch(
      `/api/dev-server/${encodeURIComponent(workspaceId)}/git/${op}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `git ${op} failed (${res.status})`);
    }
    return (await res.json().catch(() => ({}))) as unknown;
  },
};

// Convenience re-export so callers don't have to chase the type.
export type {
  DevServerRecord,
  DevServerStatus,
  DevServerWorkspace,
  SearchResponse,
  SearchResult,
  ShellDescriptor,
  WatchEvent,
  WatchEventKind,
};

// (USE_DEV_SERVER_FLAG removed — the dev-server sandbox is always on
// now. See the comment block at the top of this file for the
// rationale.)
