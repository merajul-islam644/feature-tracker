// Git bridge — types shared between the Source Control panel and the
// API client. Mirror of `mcp-server/src/git.ts`. Don't drift.

export interface GitFileEntry {
  /** Forward-slash path relative to the workspace root. */
  path: string;
  /** Rename/copy source path, when the entry is an R/C. */
  origPath?: string;
  /** Index (staged) column: ' ', M, A, D, R, C. */
  x: string;
  /** Worktree (unstaged) column: ' ', M, D, R, C, ?, !. */
  y: string;
  /** Never committed — `git diff` shows nothing for these. */
  untracked: boolean;
}

export interface GitStatus {
  isRepo: boolean;
  /** `git-missing` | `not-a-repo` | `root-missing` — why the panel
   *  renders the unavailable state instead of a file list. */
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

// ── Editor git integration (gutter decorations + inline blame) ──────

/** One changed region vs HEAD, for the editor's gutter bars. */
export interface GitDiffHunk {
  kind: "added" | "modified" | "deleted";
  /** 1-based first NEW-file line the marker covers. */
  line: number;
  /** New-file lines covered; for `deleted`, how many lines vanished. */
  count: number;
}

/** One row of `git blame --porcelain`, per working-file line. */
export interface GitBlameLine {
  /** 1-based line in the current working file. */
  line: number;
  /** Abbreviated commit hash (8 chars). */
  hash: string;
  author: string;
  /** Author-time as epoch seconds. */
  time: number;
  summary: string;
}
