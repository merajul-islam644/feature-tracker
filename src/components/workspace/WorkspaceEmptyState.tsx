// WorkspaceEmptyState — full-bleed empty state for the editor column
// when no folder has been picked yet.
//
// Lives INSIDE the IDE frame (not on the page) so the right column
// matches the Explorer's `bg-muted/30` rail. Deliberately NOT using
// the global `<EmptyState>` primitive: its dashed border clashes
// with the raised IDE frame, and the 280px min-height forces a
// minimum scroll area on short pages. A custom layout keeps the
// visual language consistent (8×8 primary-muted icon badge, single
// column, two CTAs, kbd hint at the bottom) without the dashed
// border treatment.
//
// The Explorer sidebar still renders its own slim placeholder
// (just a flex spacer — no hint text) so the two panes read as a
// single unit when nothing's open.

import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";

interface WorkspaceEmptyStateProps {
  onOpenFolder: () => void;
  onTypePath: () => void;
}

export function WorkspaceEmptyState({
  onOpenFolder,
  onTypePath,
}: WorkspaceEmptyStateProps) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-primary-muted text-primary">
          <FolderOpen className="h-6 w-6" aria-hidden="true" />
        </div>
        <h2 className="text-base font-semibold text-foreground">
          Open a folder to start editing
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Pick a folder from your machine to browse and edit its files
          like VS Code. Edits autosave to disk as you type.
        </p>
        <div className="mt-5 flex items-center gap-2">
          <Button
            onClick={onOpenFolder}
            className="h-8 gap-1.5 px-3 text-xs"
            aria-label="Open folder"
          >
            <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
            Open folder
          </Button>
          <Button
            variant="outline"
            onClick={onTypePath}
            className="h-8 px-3 text-xs"
            aria-label="Type a folder path"
          >
            Type a path
          </Button>
        </div>
        <p className="mt-4 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Kbd>⌘</Kbd>
          <span aria-hidden="true">+</span>
          <Kbd>O</Kbd>
          <span className="ml-1">to open</span>
        </p>
      </div>
    </div>
  );
}
