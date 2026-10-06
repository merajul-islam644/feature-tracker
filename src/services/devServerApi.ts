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
  PackageJsonSummary,
} from "@/types/dev-server";

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

  // Local-agent bridge status. The mcp-server in the cloud exposes
  // GET /api/dev-server/_agent/status which returns
  // { enabled, connected, connectedAt, version }.
  //   - `enabled=false` means the cloud mcp-server is running the
  //     /dev-server/* routes locally (the dev case, or the prod case
  //     where the bridge flag is off). All /panel operations work
  //     without an agent.
  //   - `enabled=true, connected=false` means the cloud mcp-server
  //     is in bridge mode but no local agent has connected yet. The
  //     banner shows the "start the agent" instructions and any
  //     /dev-server/* call will 503 with `agent_offline`.
  //   - `enabled=true, connected=true` is the happy path: the
  //     banner is hidden and /panel operates against the user's
  //     local filesystem.
  async getAgentStatus(): Promise<{
    enabled: boolean;
    connected: boolean;
    connectedAt: string | null;
    version: string | null;
  }> {
    // The SPA cache: dedupe consecutive identical responses inside a
    // 1s window so the 5s poll doesn't trigger 5 banner re-renders
    // for the same status. Implementation lives in DevServerContext.
    const res = await fetch("/api/dev-server/_agent/status", {
      method: "GET",
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      // Bridge is not configured at all (older cloud, dev mode
      // without the flag). Treat as "not enabled, not connected" so
      // the banner stays out of the way and the existing local
      // mcp-server still serves /dev-server/*.
      return { enabled: false, connected: false, connectedAt: null, version: null };
    }
    return (await res.json()) as {
      enabled: boolean;
      connected: boolean;
      connectedAt: string | null;
      version: string | null;
    };
  },
};

// Convenience re-export so callers don't have to chase the type.
export type { DevServerRecord, DevServerStatus, DevServerWorkspace };

// (USE_DEV_SERVER_FLAG removed — the dev-server sandbox is always on
// now. See the comment block at the top of this file for the
// rationale.)
