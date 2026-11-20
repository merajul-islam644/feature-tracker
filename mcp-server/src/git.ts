// Git bridge (Phase: Source Control panel) — shell out to the `git`
// CLI the same way the terminal panel would, but with every argument
// passed as a spawn argv (never through a shell) and every file path
// run through `safeResolveUserFolder` first.
//
// Why spawn instead of a library (simple-git / isomorphic-git): the
// bridge's whole job is to surface the user's own repo state — branch,
// staged files, diff text — and `git` itself is already a dependency
// on every machine this server runs on (the terminal panel lists Git
// Bash). Zero new deps, and error messages come straight from git so
// the UI toasts read exactly what a terminal would have printed.
//
// Safety model:
//   - No `shell: true` — args are argv entries, so a filename like
//     `foo; rm -rf /` is one inert pathspec to git.
//   - Paths arrive as root-relative, forward-slash strings from the
//     panel and are validated with `safeResolveUserFolder` (rejects
//     `..`, backslashes, NUL) before reaching argv.
//   - Ref names (branch checkout) are validated against git's own
//     forbidden-character rules — no leading `-` rules out option
//     injection.
//   - `GIT_TERMINAL_PROMPT=0` + `GCM_INTERACTIVE=Never` make push/pull
//     FAIL with git's own "could not read Username" message instead of
//     hanging the HTTP request on a credential prompt nobody can see.
//     Stored credentials (Windows credential manager / SSH agent)
//     still work — only the interactive fallback is disabled.
//   - Read-only commands use `--no-optional-locks` so a status refresh
//     can't collide with the user's own git process over index.lock.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { safeDeleteUserFolder, safeResolveUserFolder } from "./devServer.js";

// ────────────────────────────────────────────────────────────────────
//  Types
// ────────────────────────────────────────────────────────────────────

/** One row of `git status --porcelain=v1`. */
export interface GitFileEntry {
  /** Forward-slash path relative to the workspace root. */
  path: string;
  /** Rename/copy source path (porcelain emits it after the target). */
  origPath?: string;
  /** Index (staged) column: ' ', M, A, D, R, C. */
  x: string;
  /** Worktree (unstaged) column: ' ', M, D, R, C, ?, !. */
  y: string;
  /** `??` in porcelain — never committed, so `git diff` shows nothing. */
  untracked: boolean;
}

export interface GitStatusResult {
  isRepo: boolean;
  /** Why the panel should render the "not available" state instead of
   *  a file list: `git-missing` | `not-a-repo` | `root-missing`. */
  reason?: string;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: GitFileEntry[];
}

export interface GitBranch {
  name: string;
  current: boolean;
}

/** Carries git's own stderr so the UI toast can show it verbatim. */
export class GitError extends Error {
  readonly exitCode: number | null;
  readonly stderr: string;
  constructor(message: string, exitCode: number | null, stderr: string) {
    super(message);
    this.name = "GitError";
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

// ────────────────────────────────────────────────────────────────────
//  spawn wrapper
// ────────────────────────────────────────────────────────────────────

const GIT_TIMEOUT_MS = 30_000;
/** Network commands (push/pull) — DNS+TLS+transfer on a cold repo can
 *  legitimately take a minute; see the GitHub DNS notes in ops. */
const GIT_NETWORK_TIMEOUT_MS = 120_000;
/** Cap diff output — a `node_modules`-in-repo accident shouldn't OOM
 *  the route. Tail is kept (most recent hunks are what users look at). */
const DIFF_MAX_BYTES = 512_000;

function capTail(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return text;
  return buf.subarray(buf.length - maxBytes).toString("utf8");
}

interface GitRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runGit(
  root: string,
  args: string[],
  timeoutMs: number = GIT_TIMEOUT_MS,
): Promise<GitRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: root,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GCM_INTERACTIVE: "Never",
      },
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(
        new GitError(
          `git ${args.filter((a) => !a.startsWith("-")).join(" ")} timed out after ${Math.round(timeoutMs / 1000)}s`,
          null,
          "",
        ),
      );
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));

    child.on("error", (e: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (e.code === "ENOENT") {
        reject(new GitError("git is not installed or not on PATH", null, ""));
      } else {
        reject(new GitError(e.message, null, ""));
      }
    });

    // `close` (not `exit`) — fires after stdio streams flush, so the
    // buffers are complete.
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    });
  });
}

function gitFail(op: string, res: GitRunResult): never {
  const detail = (res.stderr || res.stdout).trim();
  throw new GitError(
    detail ? `git ${op}: ${detail}` : `git ${op} failed (exit ${res.code})`,
    res.code,
    detail,
  );
}

/** Validate a root-relative, forward-slash path arg. Returns the
 *  unchanged string (git resolves it against `cwd: root`); throws on
 *  anything that escapes the root. */
function validatedPath(root: string, relPath: string): string {
  if (!safeResolveUserFolder(root, relPath)) {
    throw new GitError(`bad path: ${relPath}`, null, "");
  }
  return relPath;
}

// git check-ref-format rules, approximated: no whitespace or
// `~^:?*[\`, no leading `-`/`+`/`.`, no `..`, no `.lock` suffix, no
// trailing `/`/`.`. Enough to make checkout's single argv inert.
function validatedRef(name: string): string {
  if (
    name.length === 0 ||
    name.length > 260 ||
    name.startsWith("-") ||
    name.startsWith("+") ||
    name.startsWith(".") ||
    name.endsWith(".") ||
    name.endsWith("/") ||
    name.endsWith(".lock") ||
    name.includes("..") ||
    name.includes("@{") ||
    /[\s~^:?*[\]\\]/.test(name)
  ) {
    throw new GitError(`bad branch name: ${name}`, null, "");
  }
  return name;
}

/** Common pre-flight: the root must exist on disk. */
function requireRoot(root: string): void {
  if (!root || !existsSync(root)) {
    throw new GitError("workspace folder is missing on disk", null, "");
  }
}

// ────────────────────────────────────────────────────────────────────
//  Status — `git status --porcelain=v1 -z -b`
//
//  -z (NUL-delimited) is parsed instead of the newline form because
//  NUL is the only delimiter that survives filenames with embedded
//  newlines/quotes, and rename pairs arrive as an extra NUL token
//  (`R  new\0old\0`). The `## ` branch header rides first with -b and
//  carries the upstream + ahead/behind counts.
// ────────────────────────────────────────────────────────────────────

export async function gitStatus(root: string): Promise<GitStatusResult> {
  const empty: Omit<GitStatusResult, "isRepo" | "reason"> = {
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    files: [],
  };
  if (!root || !existsSync(root)) {
    return { isRepo: false, reason: "root-missing", ...empty };
  }
  let res: GitRunResult;
  try {
    res = await runGit(
      root,
      ["--no-optional-locks", "status", "--porcelain=v1", "-z", "-b"],
      GIT_TIMEOUT_MS,
    );
  } catch (err) {
    // git binary missing — the panel should say so, not crash-loop.
    if ((err as GitError).message.includes("not installed")) {
      return { isRepo: false, reason: "git-missing", ...empty };
    }
    throw err;
  }
  if (res.code !== 0) {
    const detail = res.stderr.trim();
    if (/not a git repository/i.test(detail)) {
      return { isRepo: false, reason: "not-a-repo", ...empty };
    }
    throw new GitError(detail || "git status failed", res.code, detail);
  }
  return parseStatusZ(res.stdout);
}

function parseStatusZ(out: string): GitStatusResult {
  const tokens = out.split("\0");
  let branch: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  const files: GitFileEntry[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (!tok) continue;

    if (tok.startsWith("## ")) {
      const header = tok.slice(3).trim();
      // Unborn HEAD: "## No commits yet on main".
      const unborn = /^No commits yet on (.+)$/.exec(header);
      if (unborn) {
        branch = unborn[1];
        continue;
      }
      const [local, tracking] = header.split("...");
      branch = local.trim() || null;
      if (tracking) {
        upstream = tracking.split(" ")[0]?.trim() || null;
        const aheadM = /\bahead (\d+)/.exec(tracking);
        const behindM = /\bbehind (\d+)/.exec(tracking);
        ahead = aheadM ? Number(aheadM[1]) : 0;
        behind = behindM ? Number(behindM[1]) : 0;
      }
      continue;
    }

    // Entry: `XY path` where X=index column, Y=worktree column.
    if (tok.length < 4 || tok[2] !== " ") continue;
    const x = tok[0];
    const y = tok[1];
    const entry: GitFileEntry = {
      path: tok.slice(3).replace(/\\/g, "/"),
      x,
      y,
      untracked: x === "?" && y === "?",
    };
    // Rename/copy: the ORIGINAL path arrives as the next NUL token.
    if (x === "R" || x === "C" || y === "R" || y === "C") {
      const orig = tokens[i + 1];
      if (orig) {
        entry.origPath = orig.replace(/\\/g, "/");
        i += 1;
      }
    }
    files.push(entry);
  }

  return { isRepo: true, branch, upstream, ahead, behind, files };
}

// ────────────────────────────────────────────────────────────────────
//  Mutations
// ────────────────────────────────────────────────────────────────────

/** Stage files — `git add -- <paths…>`. Works for modified, deleted
 *  and untracked paths alike. */
export async function gitStage(root: string, paths: string[]): Promise<void> {
  requireRoot(root);
  const res = await runGit(root, [
    "add",
    "--",
    ...paths.map((p) => validatedPath(root, p)),
  ]);
  if (res.code !== 0) gitFail("add", res);
}

/** Unstage — `git reset -- <paths…>`. Index-only; the worktree is
 *  never touched (that's discard's job, behind a confirm dialog). */
export async function gitUnstage(root: string, paths: string[]): Promise<void> {
  requireRoot(root);
  const res = await runGit(root, [
    "reset",
    "--",
    ...paths.map((p) => validatedPath(root, p)),
  ]);
  if (res.code !== 0) gitFail("reset", res);
}

/** Discard worktree changes — tracked files via `git checkout --`,
 *  untracked files by deleting them (they have no baseline to restore
 *  to — this mirrors VS Code's discard). The UI confirms first. */
export async function gitDiscard(root: string, paths: string[]): Promise<void> {
  requireRoot(root);
  const valid = paths.map((p) => validatedPath(root, p));
  const tracked = valid.filter((p) => !p.endsWith("/"));
  // Split tracked vs untracked by re-checking porcelain — cheap and
  // exact, and it keeps us from `rm`ing a staged-new file that the
  // user only meant to unstage+discard half of.
  const st = await gitStatus(root);
  const untrackedSet = new Set(
    st.files.filter((f) => f.untracked).map((f) => f.path),
  );
  const trackedPaths = tracked.filter((p) => !untrackedSet.has(p));
  const untrackedPaths = tracked.filter((p) => untrackedSet.has(p));
  if (trackedPaths.length > 0) {
    const res = await runGit(root, ["checkout", "--", ...trackedPaths]);
    if (res.code !== 0) gitFail("checkout", res);
  }
  for (const p of untrackedPaths) {
    await safeDeleteUserFolder(root, p);
  }
}

/** Commit the staged index. Returns git's own one-line summary
 *  (`[main a1b2c3d] subject`) for the toast. */
export async function gitCommit(
  root: string,
  message: string,
): Promise<string> {
  requireRoot(root);
  const res = await runGit(root, ["commit", "-m", message]);
  if (res.code !== 0) gitFail("commit", res);
  return res.stdout.trim();
}

/** Push the current branch to its upstream. Auth comes from the
 *  machine's stored credentials; interactive prompts are disabled
 *  (see the env block at the top). */
export async function gitPush(root: string): Promise<string> {
  requireRoot(root);
  const res = await runGit(root, ["push"], GIT_NETWORK_TIMEOUT_MS);
  if (res.code !== 0) gitFail("push", res);
  // Progress goes to stderr ("To github.com:…"), summary to stdout.
  return (res.stderr || res.stdout).trim();
}

/** Pull with `--no-edit` so a merge never blocks on an editor. */
export async function gitPull(root: string): Promise<string> {
  requireRoot(root);
  const res = await runGit(root, ["pull", "--no-edit"], GIT_NETWORK_TIMEOUT_MS);
  if (res.code !== 0) gitFail("pull", res);
  return (res.stdout || res.stderr).trim();
}

// ────────────────────────────────────────────────────────────────────
//  Branches
// ────────────────────────────────────────────────────────────────────

export async function gitBranches(root: string): Promise<GitBranch[]> {
  requireRoot(root);
  const res = await runGit(root, [
    "--no-optional-locks",
    "branch",
    "--format=%(HEAD)%(refname:short)",
  ]);
  if (res.code !== 0) gitFail("branch", res);
  return res.stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => ({
      current: line.startsWith("*"),
      name: line.slice(1).trim(),
    }))
    .filter((b) => b.name.length > 0);
}

export async function gitCheckout(root: string, branch: string): Promise<void> {
  requireRoot(root);
  const res = await runGit(root, ["checkout", validatedRef(branch)]);
  if (res.code !== 0) gitFail("checkout", res);
}

// ────────────────────────────────────────────────────────────────────
//  Diff — unified text for the panel's viewer.
//
//  `staged=true` reads the index vs HEAD (`--cached`); `false` reads
//  the worktree vs the index. Untracked files return "" — they have
//  no baseline, and the panel routes those clicks to "open the file"
//  instead.
// ────────────────────────────────────────────────────────────────────

export async function gitDiff(
  root: string,
  relPath: string,
  staged: boolean,
): Promise<string> {
  requireRoot(root);
  validatedPath(root, relPath);
  const args = ["--no-optional-locks", "diff", "--no-color"];
  if (staged) args.push("--cached");
  args.push("--", relPath);
  const res = await runGit(root, args);
  if (res.code !== 0) gitFail("diff", res);
  return capTail(res.stdout, DIFF_MAX_BYTES);
}

// ────────────────────────────────────────────────────────────────────
//  Per-file change hunks + blame — data for the editor gutter
//  decorations and the inline blame readout (editor git integration).
//
//  Hunks come from `diff -U0 HEAD`: comparing against HEAD (not the
//  index) matches VS Code's gutter, which colors staged and unstaged
//  edits alike. A pure-deletion hunk leaves no new-file line to color,
//  so it reports the line that now sits where the block was — the
//  editor clamps it to the last line at EOF.
// ────────────────────────────────────────────────────────────────────

export interface GitDiffHunk {
  kind: "added" | "modified" | "deleted";
  /** 1-based first NEW-file line the marker covers. */
  line: number;
  /** New-file lines covered; for `deleted`, how many lines vanished. */
  count: number;
}

/** Number of lines in a workspace file (counted here so the client
 *  doesn't need a second round-trip for the whole-file-added case). */
async function countLines(root: string, relPath: string): Promise<number> {
  const abs = safeResolveUserFolder(root, relPath);
  if (!abs) return 0;
  const fs = await import("node:fs/promises");
  try {
    const text = await fs.readFile(abs, "utf8");
    return text.length === 0 ? 0 : text.split("\n").length;
  } catch {
    return 0;
  }
}

function parseDiffHunks(diffText: string): GitDiffHunk[] {
  const hunks: GitDiffHunk[] = [];
  const re = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(diffText))) {
    const oldCount = m[2] === undefined ? 1 : Number(m[2]);
    const newStart = Number(m[3]);
    const newCount = m[4] === undefined ? 1 : Number(m[4]);
    if (oldCount === 0 && newCount > 0) {
      hunks.push({ kind: "added", line: newStart, count: newCount });
    } else if (newCount === 0 && oldCount > 0) {
      hunks.push({ kind: "deleted", line: newStart, count: oldCount });
    } else if (oldCount > 0 && newCount > 0) {
      hunks.push({ kind: "modified", line: newStart, count: newCount });
      if (oldCount > newCount) {
        hunks.push({
          kind: "deleted",
          line: newStart + newCount,
          count: oldCount - newCount,
        });
      }
    }
  }
  return hunks;
}

export async function gitFileDiffHunks(
  root: string,
  relPath: string,
): Promise<GitDiffHunk[]> {
  requireRoot(root);
  validatedPath(root, relPath);
  const args = [
    "--no-optional-locks",
    "diff",
    "--no-color",
    "-U0",
    "HEAD",
    "--",
    relPath,
  ];
  const res = await runGit(root, args);
  if (res.code !== 0) {
    // `diff HEAD` on an unborn HEAD (no commits yet) fails; a brand-new
    // repo should still show every line as added — same as untracked.
    const head = await runGit(root, ["rev-parse", "--verify", "-q", "HEAD"]);
    if (head.code !== 0) {
      const lineCount = await countLines(root, relPath);
      return lineCount > 0 ? [{ kind: "added", line: 1, count: lineCount }] : [];
    }
    gitFail("diff", res);
  }
  const hunks = parseDiffHunks(capTail(res.stdout, DIFF_MAX_BYTES));
  if (hunks.length > 0) return hunks;
  // No hunks — genuinely unchanged, or never committed (untracked
  // files have no baseline so diff prints nothing). One cheap call
  // tells them apart.
  const tracked = await runGit(root, [
    "--no-optional-locks",
    "ls-files",
    "--error-unmatch",
    "--",
    relPath,
  ]);
  if (tracked.code !== 0) {
    const lineCount = await countLines(root, relPath);
    return lineCount > 0 ? [{ kind: "added", line: 1, count: lineCount }] : [];
  }
  return hunks;
}

// ────────────────────────────────────────────────────────────────────
//  Blame — `blame --porcelain` parsed to one row per working-file
//  line. Porcelain groups consecutive lines from the same commit: one
//  header (`hash origLine finalLine [numLines]`) + a metadata block,
//  then `numLines` tab-prefixed content lines. Only author/time/
//  summary survive — the editor's readout needs nothing else.
// ────────────────────────────────────────────────────────────────────

export interface GitBlameLine {
  /** 1-based line in the current working file. */
  line: number;
  /** Abbreviated commit hash (8 chars, GitLens-style). */
  hash: string;
  author: string;
  /** Author-time as epoch seconds. */
  time: number;
  summary: string;
}

export async function gitBlame(
  root: string,
  relPath: string,
): Promise<GitBlameLine[] | null> {
  requireRoot(root);
  validatedPath(root, relPath);
  const res = await runGit(root, [
    "--no-optional-locks",
    "blame",
    "--porcelain",
    "--",
    relPath,
  ]);
  if (res.code !== 0) {
    const detail = res.stderr.trim();
    if (/not a git repository|no such path.*exists|does not have a commit/i.test(detail)) {
      return null;
    }
    gitFail("blame", res);
  }
  const rows: GitBlameLine[] = [];
  let cur: { hash: string; author: string; time: number; summary: string } = {
    hash: "",
    author: "",
    time: 0,
    summary: "",
  };
  let remaining = 0;
  let nextLine = 0;
  for (const raw of capTail(res.stdout, DIFF_MAX_BYTES).split("\n")) {
    if (remaining > 0) {
      if (raw.startsWith("\t")) {
        rows.push({
          line: nextLine,
          hash: cur.hash,
          author: cur.author,
          time: cur.time,
          summary: cur.summary,
        });
        nextLine += 1;
        remaining -= 1;
        continue;
      }
      // A header before the group's content ran out shouldn't happen;
      // fall through and re-parse defensively.
    }
    const header = /^([0-9a-f]{7,40}) (\d+) (\d+)(?: (\d+))?$/.exec(raw);
    if (header) {
      cur = { hash: header[1].slice(0, 8), author: "", time: 0, summary: "" };
      nextLine = Number(header[3]);
      remaining = header[4] ? Number(header[4]) : 1;
      continue;
    }
    if (raw.startsWith("author ")) cur.author = raw.slice(7);
    else if (raw.startsWith("author-time ")) cur.time = Number(raw.slice(12));
    else if (raw.startsWith("summary ")) cur.summary = raw.slice(8);
  }
  return rows;
}
