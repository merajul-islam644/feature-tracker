// WorkspaceStatusBar — VS Code-style status bar pinned to the
// bottom of the page, OUTSIDE the IDE frame.
//
// Sits on the page surface (bg-surface + top border) so the IDE
// frame stays a single, isolated card. Three render clusters:
//
//   LEFT:  file count · folder count · language (when a file is open)
//   RIGHT: save state · problems count · Ln N, Col M
//
// The save state is the canonical "Saved {n}s ago" badge pattern
// from `TestCaseSpreadsheet.tsx:137-164` — a 30s ticker renders
// the elapsed time, then the badge auto-hides 1.5s after a save
// (mirrors `NotepadTextEditorPage.tsx:72-76`).
//
// Problems open a popover. There's no Problems panel yet (out of
// scope) so the popover action just toasts a hint pointing at the
// dev-server panel.

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  FileText,
  Folder,
  Loader2,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

export type SaveState = "idle" | "saving" | "pending" | "saved";

interface WorkspaceStatusBarProps {
  cursor: { line: number; col: number } | null;
  language: string | null;
  saveState: SaveState;
  /** Timestamp (ms) of the last successful save. `0` when no save
   *  has landed yet. */
  lastSavedAt: number | null;
  fileCount: number;
  folderCount: number;
  problemsCount: number;
  onShowProblems: () => void;
}

export function WorkspaceStatusBar({
  cursor,
  language,
  saveState,
  lastSavedAt,
  fileCount,
  folderCount,
  problemsCount,
  onShowProblems,
}: WorkspaceStatusBarProps) {
  return (
    <div
      role="status"
      aria-label="Workspace status"
      className="flex h-7 shrink-0 items-center justify-between gap-2 border-t border-border bg-surface px-3 text-[11px] text-muted-foreground"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="inline-flex items-center gap-1">
          <FileText className="h-3 w-3" aria-hidden="true" />
          <span className="tabular-nums">{fileCount}</span>
          <span>{fileCount === 1 ? "file" : "files"}</span>
        </span>
        <Sep />
        <span className="inline-flex items-center gap-1">
          <Folder className="h-3 w-3" aria-hidden="true" />
          <span className="tabular-nums">{folderCount}</span>
          <span>{folderCount === 1 ? "folder" : "folders"}</span>
        </span>
        {language && (
          <>
            <Sep />
            <span className="truncate font-mono">{language}</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        <SavedBadge saveState={saveState} lastSavedAt={lastSavedAt} />
        <Sep />
        <ProblemsPopover count={problemsCount} onShowProblems={onShowProblems} />
        {cursor && (
          <>
            <Sep />
            <span className="font-mono tabular-nums">
              Ln <span className="text-foreground">{cursor.line}</span>, Col{" "}
              <span className="text-foreground">{cursor.col}</span>
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function Sep() {
  return (
    <span
      aria-hidden="true"
      className="text-muted-foreground/50"
    >
      ·
    </span>
  );
}

/**
 * The save-state badge. Ticks every 30s to re-derive the elapsed
 * label. Auto-hides 1.5s after a save so the bar stays quiet.
 */
function SavedBadge({
  saveState,
  lastSavedAt,
}: {
  saveState: SaveState;
  lastSavedAt: number | null;
}) {
  // Force a re-render every 30s so "Saved 45s ago" → "Saved 1m ago"
  // updates without an explicit save event. Use `setNow` only for
  // its side-effect of re-rendering.
  const [, setNow] = useState(0);
  useEffect(() => {
    if (saveState !== "saved") return;
    const id = window.setInterval(() => setNow((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, [saveState]);

  if (saveState === "saving") {
    return (
      <span
        className="inline-flex items-center gap-1 text-muted-foreground"
        aria-label="Saving"
      >
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        <span>Saving…</span>
      </span>
    );
  }
  if (saveState === "pending") {
    return (
      <span
        className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"
        aria-label="Pending autosave"
      >
        <CircleDot className="h-3 w-3" aria-hidden="true" />
        <span>Pending</span>
      </span>
    );
  }
  if (saveState === "saved" && lastSavedAt && lastSavedAt > 0) {
    return (
      <span
        className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"
        aria-label="Saved"
      >
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
        <span>{savedLabel(lastSavedAt)}</span>
      </span>
    );
  }
  return null;
}

function savedLabel(ts: number): string {
  const elapsedMs = Date.now() - ts;
  if (elapsedMs < 5_000) return "Saved just now";
  if (elapsedMs < 60_000) {
    const s = Math.floor(elapsedMs / 1000);
    return `Saved ${s}s ago`;
  }
  if (elapsedMs < 3_600_000) {
    const m = Math.floor(elapsedMs / 60_000);
    return `Saved ${m}m ago`;
  }
  return "Saved";
}

function ProblemsPopover({
  count,
  onShowProblems,
}: {
  count: number;
  onShowProblems: () => void;
}) {
  const hasProblems = count > 0;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-muted ${
            hasProblems
              ? "text-amber-600 dark:text-amber-400"
              : "text-muted-foreground"
          }`}
          aria-label={`${count} ${count === 1 ? "problem" : "problems"}`}
        >
          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
          <span className="tabular-nums">{count}</span>
          <span>{count === 1 ? "problem" : "problems"}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 text-xs">
        <p className="font-medium text-foreground">
          {count} {count === 1 ? "problem" : "problems"} from the dev server
        </p>
        <p className="mt-1 text-muted-foreground">
          Open the Dev Server panel to view error details, stack frames,
          and click-to-source jumps.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="mt-3 h-7 w-full text-xs"
          onClick={onShowProblems}
        >
          Open Dev Server panel
        </Button>
      </PopoverContent>
    </Popover>
  );
}
