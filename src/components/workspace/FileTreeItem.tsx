// One file row in the Explorer tree. Lifted and adapted from
// `PlaywrightEditorPanel.tsx:177-275` — the active-state styling
// and kebab actions are unchanged, but the row operates on a
// `path` (relative to the picked root) instead of a `script.id`,
// and "open in editor" replaces "open the seed Playwright tab".

import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { InlineFolderInput } from "./InlineFolderInput";
import { getFileIcon } from "./fileIcon";

interface FileTreeItemProps {
  /** Path relative to the picked root (e.g. `"src/App.tsx"`). */
  filePath: string;
  /** Display name — usually `basename(filePath)`. */
  fileName: string;
  isActive: boolean;
  isRenaming: boolean;
  renameError: string | null;
  onOpen: () => void;
  onStartRename: () => void;
  onCommitRename: (newName: string) => void;
  onCancelRename: () => void;
  onDelete: () => void;
}

export function FileTreeItem({
  filePath,
  fileName,
  isActive,
  isRenaming,
  renameError,
  onOpen,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDelete,
}: FileTreeItemProps) {
  const fileIcon = getFileIcon(filePath);
  return (
    <li role="treeitem" aria-selected={isActive} data-path={filePath}>
      {isRenaming ? (
        <span className="block px-2 py-1">
          <InlineFolderInput
            initialValue={fileName}
            placeholder="File name"
            ariaLabel="Rename file"
            error={renameError}
            onCommit={(name) => onCommitRename(name)}
            onCancel={onCancelRename}
          />
        </span>
      ) : (
        <div
          className={cn(
            "group flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs",
            isActive
              ? "bg-accent text-accent-foreground"
              : "text-foreground/80 hover:bg-muted hover:text-foreground",
          )}
        >
          <button
            type="button"
            onClick={onOpen}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center [&_svg]:h-4 [&_svg]:w-4">
              {fileIcon}
            </span>
            <span className="flex-1 truncate">{fileName}</span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                className="opacity-0 transition-opacity group-hover:opacity-60 data-[state=open]:opacity-100"
                aria-label={`File ${fileName} actions`}
                title="File actions"
              >
                <MoreHorizontal
                  className="h-3.5 w-3.5"
                  aria-hidden="true"
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="right" className="min-w-[10rem]">
              <DropdownMenuItem onSelect={onStartRename}>Rename</DropdownMenuItem>
              <DropdownMenuItem
                onSelect={onDelete}
                className="text-destructive focus:text-destructive"
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </li>
  );
}