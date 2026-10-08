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
