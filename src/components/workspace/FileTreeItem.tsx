// One file row in the Explorer tree. Lifted and adapted from
// `PlaywrightEditorPanel.tsx:177-275` — the active-state styling
// and kebab actions are unchanged, but the row operates on a
// `path` (relative to the picked root) instead of a `script.id`,
// and "open in editor" replaces "open the seed Playwright tab".
//
// `depth` is passed by the parent (0 for root-level files, parent
// folder's depth + 1 for nested files). The row's `paddingLeft` and
// the indent-guide `before` border both key off `depth * INDENT_PX`
// (same constant as FolderTreeItem) so a folder row and a sibling
// file row at the same level land in the same icon column.

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
  /** 0 for root-level files, parent folder's depth + 1 for nested. */
  depth: number;
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
  depth,
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
  // Same constant as FolderTreeItem so a folder row and a sibling
  // file row land in the same icon column at every depth.
  const INDENT_PX = 14;
  const MAX_INDENT_DEPTH = 12;
  const indentPx = Math.min(depth, MAX_INDENT_DEPTH) * INDENT_PX;
  const guideLeft = depth > 0 ? indentPx - 7 : null;
  return (
    <li role="treeitem" aria-selected={isActive} data-path={filePath}>
      {isRenaming ? (
        <span className="block py-1" style={{ paddingLeft: indentPx + 6 }}>
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
            "group relative flex w-full items-center gap-1 rounded py-1 text-xs",
            isActive
              ? "bg-accent text-accent-foreground"
              : "text-foreground/80 hover:bg-muted hover:text-foreground",
            depth > 0 &&
              "before:absolute before:top-0 before:h-full before:border-l before:border-border",
          )}
          style={
            {
              paddingLeft: indentPx + 6, // 6px = pl-1.5 to match folder rows
              ...(guideLeft !== null ? { "--guide-left": `${guideLeft}px` } : {}),
            } as React.CSSProperties
          }
        >
          <button
            type="button"
            onClick={onOpen}
            className="flex min-w-0 flex-1 items-center gap-1 text-left"
          >
            {/* Chevron spacer — keeps file icons in the same column
                as folder icons so a folder row and a sibling file row
                at the same depth line up visually. Width = folder's
                chevron button (~12px) + the gap-1 between it and
                the icon. */}
            <span className="h-3 w-3 shrink-0" aria-hidden="true" />
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
