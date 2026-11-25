// Backend-facing methods for the folder-backed workbench workspace.
//
// Follows the Lattice workspace contract exactly (src/services/
// devServerApi.ts user-folder section): a folder picked from the user's
// machine IS the workspace — the editor reads and writes its files in
// place through the local runner (`runner/server.mjs` /api/workbench/*),
// so there is no upload step and nothing a refresh can lose.
//
// The runner already serves the terminal and the Playwright runs from
// http://localhost:9090 (loopback is exempt from mixed-content rules),
// so these routes ride the same origin — no Vite proxy involved.

import { runnerUrl } from "../runner/client";

/** One entry of the server's recursive tree walk (Lattice FileNode). */
export type FolderNode = {
  name: string;
  /** Path relative to the picked root, forward slashes. */
  path: string;
  kind: "file" | "dir";
  children?: FolderNode[];
};

/** A native dialog answer: the picked path (for pick-file the runner
 *  adds its parent `folder` + workspace-relative `rel`) or a refusal
 *  the UI can toast instead of throwing. */
export type PickResult =
  | { path: string; folder?: string; rel?: string }
  | { cancelled: true; reason: "cancelled" | "no_gui" | "spawn_failed" };

/** @deprecated legacy alias — use PickResult. */
export type PickFolderResult = PickResult;

/** One test as Playwright's own loader reported it (POST /list). `file` is
 *  the workspace-relative path the app sent; `line` is the declaration line
 *  or null when this Playwright build omits it. */
export type ListedTest = {
  file: string;
  title: string;
  describeChain: string[];
  line: number | null;
};

async function postJson<T>(route: string, body: unknown, signal?: AbortSignal): Promise<T> {
  // Every runner call is capped — a wedged route can never hang the UI.
  const cap = signal ? AbortSignal.any([signal, AbortSignal.timeout(320_000)]) : AbortSignal.timeout(120_000);
  const response = await fetch(`${runnerUrl()}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: cap
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `${route} failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export const localFolder = {
  /** Native OS folder dialog; the server answers picked / cancelled /
   *  no_gui so the UI can fall back to the typed-path input. */
  async pickFolder(): Promise<PickResult> {
    return postJson<PickResult>("/api/workbench/pick-folder", {});
  },

  /** Native OS open-file dialog (the same Explorer-style window, file
   *  mode). The response carries the file's `folder` and workspace-
   *  relative `rel` so the caller can open that folder as the root and
   *  reveal the file in one step. */
  async pickFile(): Promise<PickResult> {
    return postJson<PickResult>("/api/workbench/pick-file", {});
  },

  /** Recursive tree of the picked folder. Hides node_modules/.git;
   *  capped at 5,000 entries + 8 levels server-side. `exists: false`
   *  marks a dead root — callers must refuse to store it. */
  async listTree(opts: { root: string; maxDepth?: number }): Promise<{ tree: FolderNode[]; exists: boolean }> {
    return postJson<{ tree: FolderNode[]; exists: boolean }>("/api/workbench/list", {
      root: opts.root,
      maxDepth: opts.maxDepth
    });
  },

  /** Workspace-root resolution (runner edition of fsaWorkspace's
   *  resolveWorkspaceRoot): the picked path opens as the root, as-is.
   *  The old e2e/playwright validation gate (auto-dive into an inner
   *  e2e/playwright folder, refuse when none existed) is retired —
   *  the user lifted it so ANY folder opens. */
  async resolveRoot(rootPath: string): Promise<string> {
    return rootPath;
  },

  /** Read one text file in the folder. `null` on 404 (deleted out from
   *  under the editor). UTF-8 only — binaries are filtered client-side. */
  async readUserFile(opts: { root: string; path: string }): Promise<string | null> {
    try {
      const data = await postJson<{ content: string }>("/api/workbench/read", { root: opts.root, path: opts.path });
      return data.content;
    } catch (error) {
      // 404 means the file is gone — a normal state for a workspace
      // others (git, another editor) can touch; callers re-list.
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("not found") || message.includes("(404)")) return null;
      throw error;
    }
  },

  /** Write one text file; missing parents are created (mkdir -p). */
  async writeUserFile(opts: { root: string; path: string; content: string }): Promise<void> {
    await postJson("/api/workbench/write", { root: opts.root, path: opts.path, content: opts.content });
  },

  /** Targeted edit: replace `oldStr` with `newStr` inside one file.
   *  Mirrors the retired dev-server /edit semantics — an ambiguous
   *  match (oldStr found more than once, replaceAll unset) throws with
   *  the agent-facing hint instead of guessing. Implemented client-side
   *  over read+write; the runner's guarded /read//write do the IO. */
  async editUserFile(opts: {
    root: string;
    path: string;
    oldStr: string;
    newStr: string;
    replaceAll?: boolean;
  }): Promise<{ replacements: number; size: number }> {
    if (!opts.oldStr) throw new Error("edit failed — oldStr is empty");
    const content = await this.readUserFile({ root: opts.root, path: opts.path });
    if (content === null) throw new Error(`edit failed — "${opts.path}" does not exist (404)`);
    const occurrences = content.split(opts.oldStr).length - 1;
    if (occurrences === 0) throw new Error("edit failed — oldStr not found in the file");
    if (occurrences > 1 && !opts.replaceAll) {
      throw new Error(`edit failed — oldStr matches ${occurrences} places; pass replaceAll or include more context`);
    }
    const replacements = opts.replaceAll ? occurrences : 1;
    const next =
      occurrences > 1 ? content.split(opts.oldStr).join(opts.newStr) : content.replace(opts.oldStr, opts.newStr);
    await this.writeUserFile({ root: opts.root, path: opts.path, content: next });
    return { replacements, size: next.length };
  },

  /** Playwright's own `--list` over the workspace (POST /list on the
   *  runner): the runner materializes the sent files in a temp project and
   *  lets the real loader collect them, so the tree is exact for ANY
   *  authoring format. Null when the runner is unreachable, times out
   *  (90 s), or the specs fail to load — callers keep their text-scan
   *  preview in every one of those cases. */
  async listTests(root: string, files: { name: string; content: string }[]): Promise<ListedTest[] | null> {
    try {
      const response = await fetch(`${runnerUrl()}/list`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ root, files }),
        signal: AbortSignal.timeout(90_000)
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { ok: boolean; tests?: ListedTest[] };
      return data.ok && Array.isArray(data.tests) ? data.tests : null;
    } catch {
      return null;
    }
  },

  /** Delete a file or directory (recursive). Throws on ENOENT — callers
   *  decide whether a vanished path is worth an error. */
  async deleteUserPath(opts: { root: string; path: string }): Promise<void> {
    await postJson("/api/workbench/delete", { root: opts.root, path: opts.path });
  },

  /** Rename or move a file/directory; refuses if newPath exists (409). */
  async renameUserPath(opts: { root: string; oldPath: string; newPath: string }): Promise<void> {
    await postJson("/api/workbench/rename", { root: opts.root, oldPath: opts.oldPath, newPath: opts.newPath });
  },

  /** Make a directory (mkdir -p). */
  async mkdirUserPath(opts: { root: string; path: string }): Promise<void> {
    await postJson("/api/workbench/mkdir", { root: opts.root, path: opts.path });
  },

  /** Server-side content search: walks the guarded tree, skips build
   *  dirs/binaries/secrets/oversize files, scans case-insensitively.
   *  Line `text` is the raw line (≤300 chars); the sidebar splits the
   *  highlight around the query. */
  async search(opts: { root: string; query: string }): Promise<SearchResponse> {
    return postJson<SearchResponse>("/api/workbench/search", { root: opts.root, query: opts.query });
  },

  /** One-shot command run with cwd = the workspace root (the chat
   *  agent's exec). Blocking: the runner kills the child at the
   *  timeout and caps each stream at 2MB. */
  async execUserCommand(opts: {
    root: string;
    command: string;
    timeoutMs?: number;
  }): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean; truncated: boolean }> {
    // The server kills the child at timeoutMs; the client fetch waits a
    // little longer so the server's final answer always arrives.
    return postJson(
      "/api/workbench/exec",
      { root: opts.root, command: opts.command, ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) },
      AbortSignal.timeout((opts.timeoutMs ?? 120_000) + 30_000),
    );
  },

  /** Start (or reuse) the project's long-lived dev server on a port —
   *  runner-side detached spawn with readiness wait. */
  async devServerStart(opts: { root: string; command: string; port: number }): Promise<{ ok: boolean; url: string; reused?: boolean }> {
    return postJson("/api/devserver/start", { root: opts.root, command: opts.command, port: opts.port });
  },

  /** Stop the dev server the runner started on this port. */
  async devServerStop(port: number): Promise<{ ok: boolean; stopped: boolean }> {
    return postJson("/api/devserver/stop", { port });
  },

  /** Forward one Playwright MCP browser tool call (navigate/snapshot/click…). */
  async playwrightCall(tool: string, args: Record<string, unknown>): Promise<{ tool: string; result: string }> {
    return postJson("/playwright/call", { tool, arguments: args }, AbortSignal.timeout(90_000));
  },

  /** Playwright MCP connection status (for the /mcp slash command). */
  async playwrightStatus(): Promise<{ connected: boolean; package: string }> {
    return postJson("/playwright/status", {});
  },

  /** Drop the Playwright MCP connection (kills the official server child). */
  async playwrightDisconnect(): Promise<{ disconnected: boolean }> {
    return postJson("/playwright/disconnect", {});
  },

  /** One allowlisted git op on the workspace clone (stash, blame,
   *  status) — the runner builds the argv, the client only names the op.
   *  Git's non-zero exit arrives as `code`, NOT as a throw, so callers
   *  branch on it (conflict vs transport error). */
  async runGit(opts: { root: string } & GitOp): Promise<GitOpResult> {
    return postJson<GitOpResult>("/api/git", opts);
  }
};

export type SearchLine = { number: number; text: string };
export type SearchGroup = { path: string; lines: SearchLine[] };
export type SearchResponse = { results: SearchGroup[]; truncated: boolean; exists?: boolean };

/** One `git stash list` row: the ref (stash@{0}), its subject line. */
export type GitStashRow = { ref: string; subject: string };

/** Result of one allowlisted git op on the workspace clone. `code` is
 *  git's OWN exit status — non-zero (e.g. a conflicted stash pop) is a
 *  normal answer, not a throw; stdout/stderr carry the diagnosis. */
export type GitOpResult = { ok: true; op: string; code: number; stdout: string; stderr: string };

export type GitOp =
  | { op: "status" }
  | { op: "stash-list" }
  | { op: "stash-push"; message?: string; paths?: string[] }
  | { op: "stash-pop"; index?: number }
  | { op: "stash-drop"; index: number }
  | { op: "blame"; path: string }
  // VS Code-style SCM ops on the open clone — all LOCAL git; auth is the
  // machine's credential helper, never a token in the app.
  | { op: "pull" }
  | { op: "push" }
  | { op: "commit"; message: string; paths?: string[] }
  | { op: "current-branch" }
  | { op: "branch-list" }
  | { op: "checkout"; name: string }
  | { op: "checkout-new"; name: string }
  | { op: "log" }
  // Chat-agent SCM ops (migrated from the retired dev-server routes).
  | { op: "diff"; path?: string; staged?: boolean }
  | { op: "stage"; paths?: string[] }
  | { op: "unstage"; paths: string[] }
  | { op: "discard"; paths: string[] };
