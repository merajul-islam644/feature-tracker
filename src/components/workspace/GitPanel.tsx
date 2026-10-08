// Source Control sidebar panel — VS Code's git view, scoped to what
// the panel flow actually needs: status, stage/unstage, discard
// (confirmed), commit, push, pull, branch switch, and a per-file diff
// viewer in a dialog.
//
// Data flow: the panel polls `gitStatus` on mount + after every
// mutation + on window focus, and re-pulls when the parent bumps
// `refreshSignal` (the workspace file watcher feeds that). Mutations
// never touch state optimistically — git is the source of truth and
// every action ends in a fresh status.
//
// Error surfacing: every backend failure carries git's own stderr as
// the Error message, so toasts read exactly what a terminal would
// have printed ("Please tell me who you are", "could not read
// Username", …). No re-wording — those messages ARE the docs.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Download,
  FileDiff,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Undo2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { devServerApi } from "@/services/devServerApi";
import type { GitBranch, GitFileEntry, GitStatus } from "@/types/git";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface GitPanelProps {
  workspaceId: string;
  root: string;
  /** Opens a file in the editor — used for untracked files (no diff
   *  baseline) and the row's secondary action. */
  onOpenFile: (path: string) => void;
  /** Lifts the changed-file count for the activity-bar badge. */
  onStatusCountChange?: (count: number) => void;
  /** Bumped by the parent when the file watcher sees activity. */
  refreshSignal?: number;
}

interface DiffDialogState {
  path: string;
  staged: boolean;
  text: string;
}

/** One letter per change kind, colored like VS Code's badges. */
function statusLetter(entry: GitFileEntry, stagedSide: boolean): {
  letter: string;
  className: string;
} {
  const code = stagedSide ? entry.x : entry.y;
  const letter = entry.untracked && !stagedSide ? "U" : code === " " ? (stagedSide ? "A" : "M") : code;
  switch (letter) {
    case "A":
      return { letter, className: "text-emerald-600 dark:text-emerald-400" };
    case "M":
      return { letter, className: "text-amber-600 dark:text-amber-400" };
    case "D":
      return { letter, className: "text-red-600 dark:text-red-400" };
    case "R":
    case "C":
      return { letter, className: "text-sky-600 dark:text-sky-400" };
    default:
      return { letter, className: "text-muted-foreground" };
  }
}

function basename(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx >= 0 ? p.slice(idx + 1) : p;
}

function dirname(p: string): string | null {
  const idx = p.lastIndexOf("/");
  return idx > 0 ? p.slice(0, idx) : null;
}

/** Very small unified-diff renderer — colors +/-/@@ lines. Good
 *  enough for a review glance; the editor-tab merge view is a later
 *  phase. */
function DiffBody({ text }: { text: string }) {
  if (!text.trim()) {
    return (
      <p className="py-6 text-center text-xs text-muted-foreground">
        No textual diff (binary file, or no baseline yet).
      </p>
    );
  }
  const lines = text.split("\n");
  return (
    <pre className="max-h-[60vh] overflow-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-[11px] leading-5">
      {lines.map((line, i) => {
        let cls = "text-muted-foreground";
        if (line.startsWith("@@")) cls = "text-sky-700 dark:text-sky-300";
        else if (line.startsWith("+")) cls = "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
        else if (line.startsWith("-")) cls = "bg-red-500/10 text-red-700 dark:text-red-300";
        else if (line.startsWith("diff ") || line.startsWith("index ")) cls = "text-muted-foreground/70";
        else if (line.startsWith("---") || line.startsWith("+++")) cls = "text-muted-foreground/70";
        else cls = "text-foreground/80";
        return (
          <div key={i} className={cn("whitespace-pre-wrap break-all px-1", cls)}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

const NOT_A_REPO_COPY: Record<string, { title: string; hint: string }> = {
  "not-a-repo": {
    title: "Not a git repository",
    hint: "Run `git init` in the terminal to start tracking this folder.",
  },
  "git-missing": {
    title: "git is not available",
    hint: "Install git (git-scm.com) and restart the panel — the Source Control view shells out to the git CLI.",
  },
  "root-missing": {
    title: "Workspace folder is missing",
    hint: "The folder this panel points at no longer exists on disk. Re-open the folder from the Explorer.",
  },
};

export function GitPanel({
  workspaceId,
  root,
  onOpenFile,
  onStatusCountChange,
  refreshSignal,
}: GitPanelProps) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [commitMsg, setCommitMsg] = useState("");
  const [branches, setBranches] = useState<GitBranch[] | null>(null);
  const [diff, setDiff] = useState<DiffDialogState | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState<string[] | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fail = useCallback((err: unknown) => {
    toast.error(err instanceof Error ? err.message : String(err));
  }, []);

  const reload = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      try {
        const next = await devServerApi.gitStatus({ workspaceId, root });
        if (!mountedRef.current) return;
        setStatus(next);
        setLoadError(null);
      } catch (err) {
        if (!mountedRef.current) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [workspaceId, root],
  );

  // Initial load + watcher-driven refresh. `refreshSignal` comes from
  // the workspace's chokidar feed, so external writes (terminal
  // tooling, git in the terminal, the editor's own autosave) keep the
  // list honest without a timer.
  useEffect(() => {
    void reload();
  }, [reload, refreshSignal]);

  // Refresh on window focus — cheap, and covers the "I committed in
  // an external terminal" case.
  useEffect(() => {
    const onFocus = () => void reload({ silent: true });
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reload]);

  // Branch list — lazy, only when the panel has a repo to look at.
  useEffect(() => {
    if (!status?.isRepo) {
      setBranches(null);
      return;
    }
    devServerApi
      .gitBranches({ workspaceId, root })
      .then((list) => {
        if (mountedRef.current) setBranches(list);
      })
      .catch(() => {
        /* non-fatal — the switcher just renders the current branch */
      });
  }, [status?.isRepo, workspaceId, root]);

  // Badge feed — count every entry once (a file may appear staged AND
  // modified; VS Code's badge counts files, not sides).
  useEffect(() => {
    onStatusCountChange?.(status?.isRepo ? status.files.length : 0);
  }, [status, onStatusCountChange]);

  const run = useCallback(
    async (op: string, fn: () => Promise<void>, successToast?: string) => {
      setBusy(op);
      try {
        await fn();
        if (successToast) toast.success(successToast);
        await reload({ silent: true });
      } catch (err) {
        fail(err);
      } finally {
        setBusy(null);
      }
    },
    [reload, fail],
  );

  const stagedEntries = useMemo(
    () => (status?.files ?? []).filter((f) => f.x !== " " && f.x !== "?"),
    [status],
  );
  const worktreeEntries = useMemo(
    () => (status?.files ?? []).filter((f) => f.y !== " "),
    [status],
  );
  const changedCount = status?.files.length ?? 0;

  const openDiff = useCallback(
    async (path: string, staged: boolean) => {
      setBusy("diff");
      try {
        const text = await devServerApi.gitDiff({ workspaceId, root, path, staged });
        setDiff({ path, staged, text });
      } catch (err) {
        fail(err);
      } finally {
        setBusy(null);
      }
    },
    [workspaceId, root, fail],
  );

  const handleCommit = useCallback(() => {
    const message = commitMsg.trim();
    if (!message) {
      toast.error("Write a commit message first");
      return;
    }
    void run(
      "commit",
      async () => {
        const summary = await devServerApi.gitCommit({ workspaceId, root, message });
        setCommitMsg("");
        toast.success(summary || "Committed");
      },
    );
  }, [commitMsg, workspaceId, root, run]);

  const handleCommitAll = useCallback(() => {
    void run(
      "commit-all",
      async () => {
        const message = commitMsg.trim();
        if (!message) {
          toast.error("Write a commit message first");
          return;
        }
        await devServerApi.gitStage({
          workspaceId,
          root,
          paths: worktreeEntries.map((f) => f.path),
        });
        const summary = await devServerApi.gitCommit({ workspaceId, root, message });
        setCommitMsg("");
        toast.success(summary || "Committed");
      },
    );
  }, [commitMsg, workspaceId, root, worktreeEntries, run]);

  const handleCheckout = useCallback(
    (branch: string) => {
      void run("checkout", async () => {
        await devServerApi.gitCheckout({ workspaceId, root, branch });
        toast.success(`Switched to ${branch}`);
      });
    },
    [workspaceId, root, run],
  );

  const confirmDiscardMessage = useMemo(() => {
    if (!confirmDiscard || confirmDiscard.length === 0) return "";
    const first = confirmDiscard[0];
    const label = confirmDiscard.length > 1 ? `${confirmDiscard.length} files` : basename(first);
    const hasUntracked =
      status?.files.some((f) => f.untracked && confirmDiscard.includes(f.path)) ?? false;
    return hasUntracked
      ? `Discard ${label}? Untracked files are deleted — this can't be undone.`
      : `Discard changes in ${label}? The file reverts to its last committed state — this can't be undone.`;
  }, [confirmDiscard, status]);

  if (loading && !status) {
    return (
      <div
        data-testid="git-panel"
        className="flex h-full items-center justify-center text-muted-foreground"
      >
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div data-testid="git-panel" className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-xs text-destructive">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => void reload()}>
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </Button>
      </div>
    );
  }

  if (!status?.isRepo) {
    const copy = NOT_A_REPO_COPY[status?.reason ?? "not-a-repo"] ?? NOT_A_REPO_COPY["not-a-repo"];
    return (
      <div data-testid="git-panel" className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-sm font-medium">{copy.title}</p>
        <p className="text-xs text-muted-foreground">{copy.hint}</p>
      </div>
    );
  }

  return (
    <div data-testid="git-panel" className="flex h-full flex-col overflow-hidden">
      {/* Header — branch switcher + sync actions */}
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 max-w-[55%] gap-1 px-2 text-xs font-medium"
              disabled={busy !== null}
              data-testid="git-branch-switcher"
            >
              <span className="truncate">{status.branch ?? "HEAD"}</span>
              <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 overflow-auto">
            <DropdownMenuLabel>Switch branch</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {(branches ?? [{ name: status.branch ?? "", current: true }]).map((b) => (
              <DropdownMenuItem
                key={b.name}
                onClick={() => {
                  if (!b.current) handleCheckout(b.name);
                }}
                className="gap-2 text-xs"
              >
                <Check className={cn("h-3 w-3", b.current ? "opacity-100" : "opacity-0")} />
                {b.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {(status.ahead > 0 || status.behind > 0) && (
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {status.ahead > 0 && <span>↑{status.ahead}</span>}
            {status.behind > 0 && <span className="ml-1">↓{status.behind}</span>}
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Pull"
            aria-label="Pull from remote"
            disabled={busy !== null}
            data-testid="git-pull"
            onClick={() =>
              void run("pull", async () => {
                const out = await devServerApi.gitPull({ workspaceId, root });
                toast.success(out || "Pulled");
              })
            }
          >
            {busy === "pull" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Push"
            aria-label="Push to remote"
            disabled={busy !== null}
            data-testid="git-push"
            onClick={() =>
              void run("push", async () => {
                const out = await devServerApi.gitPush({ workspaceId, root });
                toast.success(out || "Pushed");
              })
            }
          >
            {busy === "push" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Refresh"
            aria-label="Refresh git status"
            disabled={busy !== null}
            onClick={() => void reload()}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Commit box */}
        <div className="space-y-1.5 border-b border-border p-2">
          <textarea
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                if (stagedEntries.length > 0) handleCommit();
                else if (worktreeEntries.length > 0) handleCommitAll();
              }
            }}
            placeholder={`Message (Ctrl+Enter to commit on ${status.branch ?? "HEAD"})`}
            rows={2}
            className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            data-testid="git-commit-message"
          />
          {stagedEntries.length > 0 ? (
            <Button
              size="sm"
              className="h-7 w-full text-xs"
              disabled={busy !== null || !commitMsg.trim()}
              data-testid="git-commit"
              onClick={handleCommit}
            >
              {busy === "commit" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Commit
            </Button>
          ) : worktreeEntries.length > 0 ? (
            <Button
              size="sm"
              variant="secondary"
              className="h-7 w-full text-xs"
              disabled={busy !== null || !commitMsg.trim()}
              title="Stages every change, then commits"
              data-testid="git-commit-all"
              onClick={handleCommitAll}
            >
              {busy === "commit-all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Commit all
            </Button>
          ) : (
            <Button size="sm" className="h-7 w-full text-xs" disabled>
              Commit
            </Button>
          )}
        </div>

        {changedCount === 0 && (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            No changes
          </p>
        )}

        {/* Staged changes */}
        {stagedEntries.length > 0 && (
          <section className="border-b border-border pb-1">
            <div className="flex items-center justify-between px-3 pb-1 pt-2">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Staged Changes
              </h3>
              <button
                type="button"
                className="text-muted-foreground transition-colors hover:text-foreground"
                title="Unstage all"
                aria-label="Unstage all"
                disabled={busy !== null}
                onClick={() =>
                  void run("unstage-all", async () => {
                    await devServerApi.gitUnstage({
                      workspaceId,
                      root,
                      paths: stagedEntries.map((f) => f.path),
                    });
                  })
                }
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
            </div>
            <FileRows
              entries={stagedEntries}
              staged
              busy={busy !== null}
              onDiff={(p) => void openDiff(p, true)}
              onOpenFile={onOpenFile}
              onStageToggle={(p) =>
                void run("unstage", async () => {
                  await devServerApi.gitUnstage({ workspaceId, root, paths: [p] });
                })
              }
              onDiscard={(p) => setConfirmDiscard([p])}
            />
          </section>
        )}

        {/* Worktree changes */}
        {worktreeEntries.length > 0 && (
          <section className="pb-1">
            <div className="flex items-center justify-between px-3 pb-1 pt-2">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Changes
              </h3>
              <button
                type="button"
                className="text-muted-foreground transition-colors hover:text-foreground"
                title="Stage all"
                aria-label="Stage all"
                disabled={busy !== null}
                onClick={() =>
                  void run("stage-all", async () => {
                    await devServerApi.gitStage({
                      workspaceId,
                      root,
                      paths: worktreeEntries.map((f) => f.path),
                    });
                  })
                }
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <FileRows
              entries={worktreeEntries}
              staged={false}
              busy={busy !== null}
              onDiff={(p) => void openDiff(p, false)}
              onOpenFile={onOpenFile}
              onStageToggle={(p) =>
                void run("stage", async () => {
                  await devServerApi.gitStage({ workspaceId, root, paths: [p] });
                })
              }
              onDiscard={(p) => setConfirmDiscard([p])}
            />
          </section>
        )}
      </div>

      {/* Diff viewer */}
      <Dialog open={diff !== null} onOpenChange={(open) => !open && setDiff(null)}>
        <DialogContent className="flex max-w-3xl flex-col gap-3">
          <DialogHeader>
            <DialogTitle className="truncate text-sm" data-testid="git-diff-title">
              {diff ? `${basename(diff.path)} — ${diff.staged ? "staged" : "unstaged"} diff` : ""}
            </DialogTitle>
            <DialogDescription className="truncate text-xs">
              {diff?.path}
            </DialogDescription>
          </DialogHeader>
          {diff && <DiffBody text={diff.text} />}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDiff(null)}>
              Close
            </Button>
            {diff && (
              <Button
                size="sm"
                onClick={() => {
                  const path = diff.path;
                  setDiff(null);
                  onOpenFile(path);
                }}
              >
                Open file
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Discard confirm */}
      <Dialog
        open={confirmDiscard !== null}
        onOpenChange={(open) => !open && setConfirmDiscard(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Discard changes?</DialogTitle>
            <DialogDescription className="text-xs">
              {confirmDiscardMessage}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmDiscard(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy !== null}
              data-testid="git-discard-confirm"
              onClick={() => {
                const paths = confirmDiscard ?? [];
                setConfirmDiscard(null);
                void run("discard", async () => {
                  await devServerApi.gitDiscard({ workspaceId, root, paths });
                });
              }}
            >
              {busy === "discard" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────
//  File rows — shared by both sections; the staged flag decides the
//  letter column, the diff variant, and which toggle action runs.
// ───────────────────────────────────────────────────────────────────

interface FileRowsProps {
  entries: GitFileEntry[];
  staged: boolean;
  busy: boolean;
  onDiff: (path: string) => void;
  onOpenFile: (path: string) => void;
  onStageToggle: (path: string) => void;
  onDiscard: (path: string) => void;
}

function FileRows({
  entries,
  staged,
  busy,
  onDiff,
  onOpenFile,
  onStageToggle,
  onDiscard,
}: FileRowsProps) {
  return (
    <ul>
      {entries.map((f) => {
        const { letter, className } = statusLetter(f, staged);
        const dir = dirname(f.path);
        return (
          <li
            key={`${f.path}:${staged ? "s" : "w"}`}
            className="group flex items-center gap-1.5 px-2 py-1 hover:bg-muted/60"
            data-testid="git-file-row"
            data-path={f.path}
          >
            <span
              className={cn("w-3 shrink-0 text-center font-mono text-[11px] font-semibold", className)}
              title={staged ? `index: ${f.x}` : `worktree: ${f.y}`}
            >
              {letter}
            </span>
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              title={f.origPath ? `${f.origPath} → ${f.path}` : f.path}
              onClick={() => (f.untracked && !staged ? onOpenFile(f.path) : onDiff(f.path))}
            >
              <span className="block truncate text-xs">{basename(f.path)}</span>
              {dir && (
                <span className="block truncate text-[10px] text-muted-foreground">{dir}/</span>
              )}
            </button>
            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                title={
                  f.untracked && !staged
                    ? "Open file"
                    : staged
                      ? "Unstage"
                      : "Stage"
                }
                aria-label={
                  f.untracked && !staged
                    ? `Open ${f.path}`
                    : staged
                      ? `Unstage ${f.path}`
                      : `Stage ${f.path}`
                }
                disabled={busy}
                onClick={() =>
                  f.untracked && !staged ? onOpenFile(f.path) : onStageToggle(f.path)
                }
              >
                {staged ? (
                  <Minus className="h-3.5 w-3.5" />
                ) : f.untracked ? (
                  <FileDiff className="h-3.5 w-3.5" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                type="button"
                className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                title="Discard changes"
                aria-label={`Discard changes in ${f.path}`}
                disabled={busy}
                onClick={() => onDiscard(f.path)}
              >
                <Undo2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
