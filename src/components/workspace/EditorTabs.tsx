// Multi-tab strip for the editor — VS Code style. Each open file
// gets a tab; the active tab is highlighted and the editor area
// shows its content. The X on a tab closes it (and switches focus
// to a neighbor when the active one is closed). The strip scrolls
// horizontally when it overflows.
//
// Autosave model: the tab strip surfaces three transient states
// for the active file — `savingPaths` (write in flight → spinner),
// `pendingPaths` (debounce timer pending → amber dot), clean
// (nothing). The dirty dot was the only pre-autosave signal; now
// it shows the pending-save state until the next debounce flushes
// the write to disk.

import { Loader2, X } from "lucide-react";
import { basename } from "./treeHelpers";
import { getFileIcon } from "./fileIcon";
import { cn } from "@/lib/utils";

interface EditorTabsProps {
  openPaths: string[];
  activePath: string | null;
  /** Per-path pending flag — autosave timer scheduled but not fired. */
  pendingPaths: Set<string>;
  /** Per-path in-flight flag — write request currently on the wire. */
  savingPaths: Set<string>;
  onFocusTab: (path: string) => void;
  onCloseTab: (path: string) => void;
}

export function EditorTabs({
  openPaths,
  activePath,
  pendingPaths,
  savingPaths,
  onFocusTab,
  onCloseTab,
}: EditorTabsProps) {
  if (openPaths.length === 0) return null;
  return (
    <div className="flex h-9 items-center gap-1 overflow-x-auto border-b border-border bg-muted/30 px-2">
      {openPaths.map((tabPath) => {
        const isActive = tabPath === activePath;
        const isSaving = savingPaths.has(tabPath);
        const isPending = pendingPaths.has(tabPath);
        const name = basename(tabPath);
        const tabIcon = getFileIcon(tabPath);
        return (
          <div
            key={tabPath}
            role="tab"
            aria-selected={isActive}
            onClick={() => onFocusTab(tabPath)}
            className={cn(
              "group flex h-full shrink-0 cursor-pointer items-center gap-1.5 rounded-t px-3 text-xs",
              isActive
                ? "border-t border-x border-border bg-background text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center [&_svg]:h-4 [&_svg]:w-4">
              {tabIcon}
            </span>
            <span className="font-mono">{name}</span>
            {isSaving ? (
              <Loader2
                className="h-3 w-3 animate-spin text-muted-foreground"
                aria-label="Saving"
              />
            ) : isPending ? (
              <span
                aria-label="Pending autosave"
                className="h-1.5 w-1.5 rounded-full bg-amber-500"
              />
            ) : null}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tabPath);
              }}
              className="ml-1 flex h-4 w-4 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
              aria-label={`Close ${name}`}
              title="Close"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}