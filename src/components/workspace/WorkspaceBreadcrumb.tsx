// WorkspaceBreadcrumb — VS Code-style breadcrumb above the editor.
//
// Sits inside the IDE frame, above <EditorTabs>. Shows the picked
// folder's name as the first segment (clickable — jumps to "no
// file open" by collapsing the active tab) and the active file's
// parent path as subsequent segments. The last segment is disabled
// to match VS Code's "you can't click the file you're editing" rule.
//
// Visual reference: the only breadcrumb already in the codebase
// is `RepoBrowserPage.tsx:1660-1678` — same segment / chevron /
// hover-muted pattern, just relocated into the IDE chrome and
// driven by `activePath` instead of a route.
//
// When `activePath` is null (folder open, no file focused), we
// still render the folder row so the breadcrumb strip doesn't
// collapse on tab close — VS Code does the same.

import { ChevronRight, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { basename, dirname } from "./treeHelpers";

interface WorkspaceBreadcrumbProps {
  /** Picked folder name (workspaceRoot.name), or null when no folder. */
  folderName: string | null;
  /** Currently active file path, or null when no file is open. */
  activePath: string | null;
  /** Click handler for a non-leaf segment. Receives the path the
   *  segment represents: `""` for the folder root (jump-to-root),
   *  or the directory path the user wants to open. The parent
   *  uses this to drop the active tab (collapsing back to the
   *  folder view) or to navigate into a sibling directory. */
  onJumpToSegment: (path: string) => void;
}

export function WorkspaceBreadcrumb({
  folderName,
  activePath,
  onJumpToSegment,
}: WorkspaceBreadcrumbProps) {
  // Build the segment list. Always render the folder as segment 0.
  // Then a per-directory segment per ancestor of `activePath`, and
  // finally the file's basename as the (disabled) leaf.
  const segments: Array<{ label: string; path: string; isLeaf: boolean }> = [];
  if (folderName) {
    segments.push({ label: folderName, path: "", isLeaf: false });
  }
  if (activePath) {
    const dir = dirname(activePath);
    if (dir) {
      // Walk up the directory chain, root-first.
      const parts = dir.split("/");
      let acc = "";
      for (const part of parts) {
        acc = acc ? `${acc}/${part}` : part;
        segments.push({ label: part, path: acc, isLeaf: false });
      }
    }
    segments.push({
      label: basename(activePath),
      path: activePath,
      isLeaf: true,
    });
  }

  // No folder open → nothing to show.
  if (segments.length === 0) return null;

  return (
    <nav
      aria-label="Workspace path"
      className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-muted/30 px-3 text-xs text-muted-foreground"
    >
      <FolderOpen
        className="h-3.5 w-3.5 shrink-0 text-amber-500/80"
        aria-hidden="true"
      />
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        return (
          <span key={`${seg.path}-${i}`} className="inline-flex items-center gap-1">
            {i > 0 && (
              <ChevronRight
                className="h-3 w-3 shrink-0 text-muted-foreground/60"
                aria-hidden="true"
              />
            )}
            <button
              type="button"
              onClick={() => !seg.isLeaf && onJumpToSegment(seg.path)}
              disabled={seg.isLeaf}
              className={cn(
                "rounded px-1.5 py-0.5 font-mono transition-colors",
                seg.isLeaf
                  ? "bg-muted text-foreground"
                  : "hover:bg-muted hover:text-foreground",
              )}
              aria-current={seg.isLeaf ? "page" : undefined}
              title={seg.isLeaf ? undefined : `Open ${seg.label}`}
            >
              {seg.label}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
