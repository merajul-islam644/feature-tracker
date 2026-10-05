// Explorer sidebar — the VS Code-style file tree column on the left
// of the workspace. Lifted and adapted from
// `PlaywrightEditorPanel.tsx:2873-3022` with the activity-bar
// removed (single Explorer mode for now).
//
// State managed by the parent (`WorkspacePage`):
//   - `tree: FileNode[]` from the backend
//   - `closedPaths: Set<string>` for collapse/expand
//   - `activePath: string | null` — currently-focused file
//   - `renamingPath` / `creatingSubfolderPath` / `creatingFilePath`
//     mutex state for inline inputs
//   - `confirmingDeletePath` for cascade-delete confirmation
//
// The parent owns all of these because the per-row InlineFolderInput
// (an arbitrary sub-tree of inputs) needs to coordinate with the
// kebab / "+ file" / "+ folder" actions in the same tree.

import { FolderPlus, RefreshCw, Type, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FileNode } from "@/types/dev-server";
import { useT } from "@/lib/blocks/i18n";
import { FileTreeItem } from "./FileTreeItem";
import { FolderTreeItem } from "./FolderTreeItem";
import { InlineFolderInput } from "./InlineFolderInput";
import { basename, joinPath } from "./treeHelpers";
import { cn } from "@/lib/utils";

interface ExplorerSidebarProps {
  tree: FileNode[] | null;
  closedPaths: Set<string>;
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
  onOpenFolder: () => void;
  onTypePath: () => void;
  /** When true, the inline empty state is hidden (the parent already
   *  shows one — used while a freshly-picked folder is still being
   *  walked and the tree is still `null`). */
  treeLoading?: boolean;
}

export function ExplorerSidebar(props: ExplorerSidebarProps) {
  const t = useT();
  const {
    tree,
    closedPaths,
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
    onOpenFolder,
    onTypePath,
    treeLoading,
  } = props;

  const isCreatingRootFolder = creatingSubfolderPath === "";
  const isCreatingRootFile = creatingFilePath === "";

  // `tree` is null when no folder is open (we render the no-folder
  // empty state instead). Once a folder is picked it becomes an
  // array — possibly empty if the folder itself has no entries.
  const safeTree: FileNode[] = tree ?? [];
  const rootFolders = safeTree.filter((n) => n.kind === "dir");
  const rootFiles = safeTree.filter((n) => n.kind === "file");

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

      {rootFolderName === null ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-6 text-center">
          <p className="text-xs text-muted-foreground">
            {t(
              "issueTracker.workspace.noFolderHint",
              "Open a folder on your machine to start editing files like VS Code. Edits are saved directly to disk.",
            )}
          </p>
          <div className="flex w-full flex-col gap-1.5">
            <Button
              variant="default"
              size="sm"
              className="h-8 gap-1.5"
              onClick={onOpenFolder}
            >
              <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
              {t("issueTracker.workspace.openFolder", "Open folder")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={onTypePath}
            >
              <Type className="h-3.5 w-3.5" aria-hidden="true" />
              {t("issueTracker.workspace.typePath", "Type path")}
            </Button>
          </div>
        </div>
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
                <>
                  <FolderPlus
                    className="h-3.5 w-3.5 shrink-0 text-amber-500"
                    aria-hidden="true"
                  />
                </>
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
            tree={safeTree}
            closedPaths={closedPaths}
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
          treeLoading ? (
            <li className="px-2 py-2 text-[11px] text-muted-foreground">
              Loading folder…
            </li>
          ) : (
            <li className="px-2 py-2 text-[11px] text-muted-foreground">
              Folder is empty. Click <kbd className="rounded border border-border bg-background px-1">+</kbd>{" "}
              above to create a file or folder.
            </li>
          )
        )}
      </ul>
      )}

      <footer className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
        <span>
          {countNodes(safeTree).files} file
          {countNodes(safeTree).files === 1 ? "" : "s"} · {countNodes(safeTree).dirs} folder
          {countNodes(safeTree).dirs === 1 ? "" : "s"}
        </span>
      </footer>
    </aside>
  );
}

// Hide from public API surface; only used by ExplorerSidebar above.
function countNodes(tree: FileNode[]): { files: number; dirs: number } {
  let files = 0;
  let dirs = 0;
  const stack: FileNode[] = [...tree];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n.kind === "dir") {
      dirs++;
      for (const c of n.children ?? []) stack.push(c);
    } else {
      files++;
    }
  }
  return { files, dirs };
}

// Suppress the unused-import linter for joinPath — kept for API
// symmetry with the planned rename helper.
void joinPath;