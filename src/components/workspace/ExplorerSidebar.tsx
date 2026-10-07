// Explorer sidebar — the VS Code-style file tree column on the left
// of the workspace. Lifted and adapted from
// `PlaywrightEditorPanel.tsx:2873-3022` with the activity-bar
// removed (single Explorer mode for now).
//
// State managed by the parent (`WorkspacePage`):
//   - `tree: FileNode[]` from the backend
//   - `expandedFolders: Set<string>` for expand/collapse. Empty =
//     all folders collapsed (the default; the user clicks the
//     chevron to open one). Mirrors VS Code's Explorer behaviour.
//   - `activePath: string | null` — currently-focused file
//   - `renamingPath` / `creatingSubfolderPath` / `creatingFilePath`
//     mutex state for inline inputs
//   - `confirmingDeletePath` for cascade-delete confirmation
//
// The parent owns all of these because the per-row InlineFolderInput
// (an arbitrary sub-tree of inputs) needs to coordinate with the
// kebab / "+ file" / "+ folder" actions in the same tree.
//
// Local state owned here:
//   - `filter` substring (resets whenever the picked folder changes)

import { useEffect, useState } from "react";
import {
  FolderPlus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { FileNode } from "@/types/dev-server";
import { useT } from "@/lib/blocks/i18n";
import { FileTreeItem } from "./FileTreeItem";
import { FolderTreeItem } from "./FolderTreeItem";
import { InlineFolderInput } from "./InlineFolderInput";
import { basename, filterTreeByName } from "./treeHelpers";
import { cn } from "@/lib/utils";

interface ExplorerSidebarProps {
  tree: FileNode[] | null;
  /** Folders the user has expanded. Empty = all collapsed. */
  expandedFolders: Set<string>;
  activePath: string | null;
  /** Mutex: only one inline rename at a time. */
  renamingPath: string | null;
  renameError: string | null;
  /** Mutex: one folder-create input at a time (root or per-folder). */
  creatingSubfolderPath: string | null;
  subfolderCreateError: string | null;
  /** Mutex: one file-create input at a time (root or per-folder). */
  creatingFilePath: string | null;
  createFileError: string | null;
  /** Mutex: only one delete-confirmation row at a time. */
  confirmingDeletePath: string | null;

  onToggleOpen: (path: string) => void;
  onOpenFile: (path: string) => void;

  onStartCreateRootFile: () => void;
  onStartCreateRootFolder: () => void;
  onCommitCreateRootFile: (name: string) => void;
  onCancelCreateRootFile: () => void;
  onCommitCreateRootFolder: (name: string) => void;
  onCancelCreateRootFolder: () => void;

  onStartRenameFile: (path: string) => void;
  onCancelRename: () => void;
  onCommitRenameFile: (path: string, newName: string) => void;

  onStartCreateSubfolder: (parentPath: string) => void;
  onCommitCreateSubfolder: (parentPath: string, name: string) => void;
  onCancelCreateSubfolder: () => void;

  onStartCreateFileInFolder: (parentPath: string) => void;
  onCommitCreateFileInFolder: (parentPath: string, name: string) => void;
  onCancelCreateFile: () => void;

  onStartDelete: (path: string) => void;
  onCancelDelete: () => void;
  onCommitDelete: (path: string) => void;

  onRefresh: () => void;
  /** Folder name from `workspaceRoot.name`, or null when no folder is open. */
  rootFolderName: string | null;
  /** When true, the inline empty state is hidden (the parent already
   *  shows one — used while a freshly-picked folder is still being
   *  walked and the tree is still `null`). */
  treeLoading?: boolean;
}

export function ExplorerSidebar(props: ExplorerSidebarProps) {
  const t = useT();
  const {
    tree,
    expandedFolders,
    activePath,
    renamingPath,
    renameError,
    creatingSubfolderPath,
    subfolderCreateError,
    creatingFilePath,
    createFileError,
    confirmingDeletePath,
    onToggleOpen,
    onOpenFile,
    onStartCreateRootFile,
    onStartCreateRootFolder,
    onCommitCreateRootFile,
    onCancelCreateRootFile,
    onCommitCreateRootFolder,
    onCancelCreateRootFolder,
    onStartRenameFile,
    onCancelRename,
    onCommitRenameFile,
    onStartCreateSubfolder,
    onCommitCreateSubfolder,
    onCancelCreateSubfolder,
    onStartCreateFileInFolder,
    onCommitCreateFileInFolder,
    onCancelCreateFile,
    onStartDelete,
    onCancelDelete,
    onCommitDelete,
    onRefresh,
    rootFolderName,
    treeLoading,
  } = props;

  const isCreatingRootFolder = creatingSubfolderPath === "";
  const isCreatingRootFile = creatingFilePath === "";

  // `tree` is null when no folder is open (we render the no-folder
  // empty state instead). Once a folder is picked it becomes an
  // array — possibly empty if the folder itself has no entries.
  const safeTree: FileNode[] = tree ?? [];
  const [filter, setFilter] = useState("");
  // Reset the filter whenever the user switches folders — stale
  // filters from a previous folder would just hide the new tree.
  useEffect(() => {
    setFilter("");
  }, [rootFolderName]);

  const filteredTree = filter ? filterTreeByName(safeTree, filter) : safeTree;
  const isFiltering = filter.trim().length > 0;
  const rootFolders = filteredTree.filter((n) => n.kind === "dir");
  const rootFiles = filteredTree.filter((n) => n.kind === "file");

  return (
    <aside
      aria-label="Explorer"
      className="flex w-64 shrink-0 flex-col border-r border-border bg-muted/30"
    >
      <header className="flex h-9 items-center justify-between border-b border-border px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>Explorer</span>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={onStartCreateRootFile}
            aria-label="New file"
            title="New file"
          >
            <i
              className="codicon codicon-file-add text-[14px] leading-none"
              aria-hidden="true"
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={onStartCreateRootFolder}
            aria-label="New folder"
            title="New folder"
          >
            <FolderPlus className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={onRefresh}
            aria-label="Refresh tree"
            title="Refresh tree"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </header>

      <div className="flex items-center justify-between px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span className="truncate">
          {rootFolderName ?? t("issueTracker.workspace.noFolder", "No folder")}
        </span>
        {rootFolderName && (
          <button
            type="button"
            onClick={onCancelCreateRootFolder}
            aria-label="Collapse"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        )}
      </div>

      {rootFolderName && (
        <div className="px-3 pb-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter files…"
              aria-label="Filter files"
              className={cn(
                "h-6 w-full rounded border border-border bg-background pl-6 pr-2 font-mono text-[11px]",
                "placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              )}
            />
          </div>
        </div>
      )}

      {rootFolderName === null ? (
        // The right column renders the full empty state. Here we
        // only need a flex spacer so the explorer rail keeps its
        // height without competing hint copy.
        <div className="flex-1" aria-hidden="true" />
      ) : treeLoading && !isFiltering ? (
        <ul className="scrollbar-hide flex-1 overflow-y-auto px-1 pb-2" role="tree">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="flex items-center gap-1.5 px-2 py-1.5">
              <Skeleton className="h-3 w-3" />
              <Skeleton className="h-3 w-32" />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="scrollbar-hide flex-1 overflow-y-auto px-1 pb-2" role="tree">
        {isCreatingRootFile && (
          <li role="treeitem" aria-selected="true" className="px-2 py-1">
            <InlineFolderInput
              initialValue=""
              placeholder="File name"
              ariaLabel="New root-level file name"
              error={createFileError}
              leadingIcon={
                <i
                  className="codicon codicon-file-add shrink-0 text-[14px] leading-none text-sky-500"
                  aria-hidden="true"
                />
              }
              onCommit={onCommitCreateRootFile}
              onCancel={onCancelCreateRootFile}
            />
          </li>
        )}

        {isCreatingRootFolder && (
          <li role="treeitem" className="px-1.5 py-1">
            <InlineFolderInput
              initialValue=""
              placeholder="Folder name"
              ariaLabel="New folder name"
              error={subfolderCreateError}
              leadingIcon={
                <FolderPlus
                  className="h-3.5 w-3.5 shrink-0 text-amber-500"
                  aria-hidden="true"
                />
              }
              onCommit={onCommitCreateRootFolder}
              onCancel={onCancelCreateRootFolder}
            />
          </li>
        )}

        {rootFolders.map((folder) => (
            <FolderTreeItem
              key={folder.path}
              folder={folder}
              depth={0}
              tree={filteredTree}
              expandedFolders={expandedFolders}
              activePath={activePath}
              renamingPath={renamingPath}
              renameError={renameError}
              creatingSubfolderPath={creatingSubfolderPath}
              subfolderCreateError={subfolderCreateError}
              confirmingDeletePath={confirmingDeletePath}
              creatingFileInFolderPath={creatingFilePath}
              createFileError={createFileError}
              onToggleOpen={onToggleOpen}
              onOpenFile={onOpenFile}
              onStartRename={onStartRenameFile}
              onCommitRename={onCommitRenameFile}
              onCancelRename={onCancelRename}
              onStartCreateSubfolder={onStartCreateSubfolder}
              onStartCreateFile={onStartCreateFileInFolder}
              onCommitCreateSubfolder={onCommitCreateSubfolder}
              onCommitCreateFile={onCommitCreateFileInFolder}
              onCancelCreateSubfolder={onCancelCreateSubfolder}
              onCancelCreateFile={onCancelCreateFile}
              onStartDelete={onStartDelete}
              onCancelDelete={onCancelDelete}
              onCommitDelete={onCommitDelete}
              onRenameFile={onStartRenameFile}
              onCommitRenameFile={onCommitRenameFile}
              onCancelRenameFile={onCancelRename}
              onDeleteFile={onStartDelete}
            />
          ))}

        {/* Top-level (no-folder) files */}
        {rootFiles.length > 0 && (
          <>
            {rootFolders.length > 0 && (
              <li className="mt-1 border-t border-border pt-1" aria-hidden="true" />
            )}
            {rootFiles.map((f) => (
              <FileTreeItem
                key={f.path}
                filePath={f.path}
                fileName={basename(f.path)}
                depth={0}
                isActive={activePath === f.path}
                isRenaming={renamingPath === f.path}
                renameError={renamingPath === f.path ? renameError : null}
                onOpen={() => onOpenFile(f.path)}
                onStartRename={() => onStartRenameFile(f.path)}
                onCommitRename={(newName) => onCommitRenameFile(f.path, newName)}
                onCancelRename={onCancelRename}
                onDelete={() => onStartDelete(f.path)}
              />
            ))}
          </>
        )}

        {safeTree.length === 0 && (
          <li className="px-2 py-2 text-[11px] text-muted-foreground">
            Folder is empty. Click <kbd className="rounded border border-border bg-background px-1">+</kbd>{" "}
            above to create a file or folder.
          </li>
        )}
        {safeTree.length > 0 && isFiltering && filteredTree.length === 0 && (
          <li className="px-2 py-2 text-[11px] text-muted-foreground">
            No files match "{filter}".
          </li>
        )}
      </ul>
      )}
    </aside>
  );
}
