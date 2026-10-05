// Recursive folder row in the Explorer tree. Lifted and adapted
// from `PlaywrightEditorPanel.tsx:2511-2815`. Render order per
// node:
//   1. Folder row (chevron + icon + name + actions)
//   2. Inline rename input (when renamingPath matches)
//   3. Inline subfolder-create input (when creatingSubfolderPath matches)
//   4. Delete confirmation row (when confirmingDeletePath matches)
//   5. Open children: subfolders (recurse) THEN files in this folder
//
// The Playwright panel rendered files/folders with the `script.id` /
// `folder.id` cloud-Id as the row key. Here we use the relative
// `path` (`"src/components"`), which is also the row's identity in
// the file tree on disk.

import {
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { FileNode } from "@/types/dev-server";
import { cn } from "@/lib/utils";
import { countSubtree } from "./treeHelpers";
import { InlineFolderInput } from "./InlineFolderInput";
import { FileTreeItem } from "./FileTreeItem";
import { getFolderIconEl } from "./fileIcon";

interface FolderTreeItemProps {
  folder: FileNode;
  depth: number;
  tree: FileNode[];
  closedPaths: Set<string>;
  activePath: string | null;
  renamingPath: string | null;
  renameError: string | null;
  creatingSubfolderPath: string | null;
  subfolderCreateError: string | null;
  confirmingDeletePath: string | null;
  onToggleOpen: (path: string) => void;
  onOpenFile: (path: string) => void;
  onStartRename: (path: string) => void;
  onCommitRename: (oldPath: string, newName: string) => void;
  onCancelRename: () => void;
  onStartCreateSubfolder: (parentPath: string) => void;
  onStartCreateFile: (parentPath: string) => void;
  onCommitCreateSubfolder: (parentPath: string, name: string) => void;
  onCommitCreateFile: (parentPath: string, name: string) => void;
  onCancelCreateSubfolder: () => void;
  onCancelCreateFile: () => void;
  onStartDelete: (path: string) => void;
  onCancelDelete: () => void;
  onCommitDelete: (path: string) => void;
  onRenameFile: (path: string) => void;
  onCommitRenameFile: (path: string, newName: string) => void;
  onCancelRenameFile: () => void;
  onDeleteFile: (path: string) => void;
  // Inline file create per folder
  creatingFileInFolderPath: string | null;
  createFileError: string | null;
}

export function FolderTreeItem(props: FolderTreeItemProps) {
  const {
    folder,
    depth,
    tree,
    closedPaths,
    activePath,
    renamingPath,
    renameError,
    creatingSubfolderPath,
    subfolderCreateError,
    confirmingDeletePath,
    creatingFileInFolderPath,
    createFileError,
  } = props;

  const isClosed = closedPaths.has(folder.path);
  const subfolders = (folder.children ?? []).filter((c) => c.kind === "dir");
  const inside = (folder.children ?? []).filter((c) => c.kind === "file");
  const directChildCount = subfolders.length + inside.length;
  const subtree = countSubtree(tree, folder.path);
  const isRenaming = renamingPath === folder.path;
  const isConfirmingDelete = confirmingDeletePath === folder.path;
  const isCreatingSubfolder = creatingSubfolderPath === folder.path;
  const isCreatingFile = creatingFileInFolderPath === folder.path;

  return (
    <li
      role="treeitem"
      aria-expanded={!isClosed}
      data-path={folder.path}
      style={{
        // Cap the indent so a deeply-nested folder chain can't push
        // the row off the right edge on narrow viewports. 8 levels
        // × 20px = 160px, comfortably under the typical 240-280px
        // Explorer pane.
        paddingLeft: Math.min(depth, 8) * 20,
      }}
    >
      <div
        onClick={() => props.onToggleOpen(folder.path)}
        className={cn(
          "group flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-xs hover:bg-muted",
          "text-foreground/80 hover:text-foreground",
        )}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            props.onToggleOpen(folder.path);
          }}
          aria-label={isClosed ? "Expand folder" : "Collapse folder"}
          className="flex items-center"
        >
          {isClosed ? (
            <ChevronRight className="h-3 w-3" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-3 w-3" aria-hidden="true" />
          )}
        </button>
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          {getFolderIconEl(folder.name, !isClosed)}
        </span>
        {isRenaming ? (
          <span onClick={(e) => e.stopPropagation()} className="flex flex-1">
            <InlineFolderInput
              initialValue={folder.name}
              placeholder="Folder name"
              ariaLabel="Rename folder"
              error={renameError}
              onCommit={(name) => props.onCommitRename(folder.path, name)}
              onCancel={props.onCancelRename}
            />
          </span>
        ) : (
          <>
            <span className="flex-1 truncate font-medium">{folder.name}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                props.onStartCreateFile(folder.path);
              }}
              className="opacity-0 transition-opacity group-hover:opacity-60 data-[state=open]:opacity-100"
              aria-label={`New file inside ${folder.name}`}
              title="New file"
            >
              <i
                className="codicon codicon-file-add text-[14px] leading-none"
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                props.onStartCreateSubfolder(folder.path);
              }}
              className="opacity-0 transition-opacity group-hover:opacity-60 data-[state=open]:opacity-100"
              aria-label={`New subfolder inside ${folder.name}`}
              title="New subfolder"
            >
              <i
                className="codicon codicon-new-folder text-[14px] leading-none"
                aria-hidden="true"
              />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => e.stopPropagation()}
                  className="opacity-0 transition-opacity group-hover:opacity-60 data-[state=open]:opacity-100"
                  aria-label={`Folder ${folder.name} actions`}
                  title="Folder actions"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="right" className="min-w-[10rem]">
                <DropdownMenuItem onSelect={() => props.onStartRename(folder.path)}>
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => props.onStartDelete(folder.path)}
                  className="text-destructive focus:text-destructive"
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>

      {isCreatingSubfolder && (
        <div className="pl-5 pr-2 py-1">
          <InlineFolderInput
            initialValue=""
            placeholder="Subfolder name"
            ariaLabel="New subfolder name"
            error={subfolderCreateError}
            leadingIcon={
              <>
                <ChevronRight
                  className="h-3 w-3 shrink-0 opacity-0"
                  aria-hidden="true"
                />
                <i
                  className="codicon codicon-folder shrink-0 text-[14px] leading-none text-amber-500"
                  aria-hidden="true"
                />
              </>
            }
            onCommit={(name) => props.onCommitCreateSubfolder(folder.path, name)}
            onCancel={props.onCancelCreateSubfolder}
          />
        </div>
      )}

      {isConfirmingDelete && (
        <div className="ml-5 mt-1 rounded border border-destructive/40 bg-destructive/5 p-2 text-[11px]">
          <p className="mb-1.5 text-foreground">
            Delete folder <b>{folder.name}</b>?
            {subtree.total > 0 && (
              <>
                {" "}All {subtree.total} item
                {subtree.total === 1 ? "" : "s"} inside (
                {subtree.dirCount - 1} subfolder
                {subtree.dirCount - 1 === 1 ? "" : "s"}, {subtree.fileCount} file
                {subtree.fileCount === 1 ? "" : "s"}) will be deleted
                permanently with this folder.
              </>
            )}
          </p>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="destructive"
              className="h-6 px-2 text-[11px]"
              onClick={() => props.onCommitDelete(folder.path)}
            >
              Delete
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[11px]"
              onClick={props.onCancelDelete}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {!isClosed && (
        <ul role="group" className="pl-0">
          {subfolders.map((sub) => (
            <FolderTreeItem {...props} folder={sub} depth={depth + 1} key={sub.path} />
          ))}
          {subfolders.length === 0 &&
            inside.length === 0 &&
            !isCreatingFile && (
              <li
                style={{ paddingLeft: 20 }}
                className="px-2 py-1 text-[10px] italic text-muted-foreground"
              >
                empty
              </li>
            )}
          {inside.map((f) => (
            <FileTreeItem
              key={f.path}
              filePath={f.path}
              fileName={f.name}
              isActive={activePath === f.path}
              isRenaming={renamingPath === f.path}
              renameError={renamingPath === f.path ? renameError : null}
              onOpen={() => props.onOpenFile(f.path)}
              onStartRename={() => props.onRenameFile(f.path)}
              onCommitRename={(newName) => props.onCommitRenameFile(f.path, newName)}
              onCancelRename={props.onCancelRenameFile}
              onDelete={() => props.onDeleteFile(f.path)}
            />
          ))}
          {isCreatingFile && (
            <li
              style={{ paddingLeft: 20 }}
              className="pr-2 py-1"
              role="treeitem"
              aria-selected="true"
            >
              <InlineFolderInput
                initialValue=""
                placeholder="File name"
                ariaLabel={`New file in ${folder.name}`}
                error={createFileError}
                leadingIcon={
                  <i
                    className="codicon codicon-file-add shrink-0 text-[14px] leading-none text-sky-500"
                    aria-hidden="true"
                  />
                }
                onCommit={(name) => props.onCommitCreateFile(folder.path, name)}
                onCancel={props.onCancelCreateFile}
              />
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

// Helper: when the parent only tracks a single "rename error"
// string and not a per-path map, show it only on the row being
// renamed. (The Playwright panel used a per-folder map so two
// open inputs could each show their own error; here we keep the
// surface simpler and serialize input events.)
function renamingPathError(
  filePath: string,
  renamingPath: string | null,
  renameError: string | null,
): string | null {
  if (renamingPath !== filePath) return null;
  return renameError;
}