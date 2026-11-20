// Tree helpers — pure data utilities shared between the Explorer
// rows and the cascade-delete confirmation row. Lives in
// `components/workspace/` rather than `lib/` because it's tightly
// coupled to the `FileNode` shape and only used here.
//
// `countSubtree` mirrors the BFS the Playwright panel used
// (`PlaywrightEditorPanel.tsx:2057-2076`) but over real file
// paths instead of the panel's `parentId`-linked folder list. The
// file tree IS the folder list — every entry's parent path is just
// its dir name + `/`, so a `startsWith` walk is equivalent to a BFS
// and skips the queue allocation.
//
// `checkNameClash` is the equivalent of `checkDirectoryNameClash`
// in the Playwright panel — single rule, single source of truth,
// used by every create / rename handler.

import type { FileNode } from "@/types/dev-server";

export interface SubtreeSummary {
  /** Number of directories in the subtree, INCLUDING the root. */
  dirCount: number;
  /** Number of files in the subtree. */
  fileCount: number;
  /** `dirCount - 1` + `fileCount` — what the confirmation dialog
   *  shows as "items inside will be deleted". */
  total: number;
}

/** Walk the tree starting at `rootPath` and tally directories +
 *  files in the subtree. O(n) over the visible (loaded) tree — fine
 *  for the 5,000-entry server-side cap. */
export function countSubtree(
  tree: FileNode[],
  rootPath: string,
): SubtreeSummary {
  let dirCount = 0;
  let fileCount = 0;
  const stack: string[] = [rootPath];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const node = findNode(tree, current);
    if (!node) continue;
    if (node.kind === "dir") {
      dirCount++;
      for (const child of node.children ?? []) {
        stack.push(child.path);
      }
    } else {
      fileCount++;
    }
  }
  return { dirCount, fileCount, total: dirCount - 1 + fileCount };
}

/** Find a node by its relative path. Returns `undefined` if no
 *  match. O(n) for now — the tree is small enough that a flat scan
 *  is fine; if it ever grows we'll add an index. */
export function findNode(
  tree: FileNode[],
  path: string,
): FileNode | undefined {
  if (!path) return undefined; // empty path = the root itself, not a child
  const parts = path.split("/");
  let nodes: FileNode[] | undefined = tree;
  let current: FileNode | undefined;
  for (let i = 0; i < parts.length; i++) {
    const segment = parts[i];
    current = nodes?.find((n) => n.name === segment);
    if (!current) return undefined;
    if (i < parts.length - 1) {
      nodes = current.kind === "dir" ? current.children : undefined;
      if (!nodes) return undefined;
    }
  }
  return current;
}

/** Returns an error string if `name` already exists in `parentPath`
 *  (a sibling file or directory with the same name). Pass
 *  `exceptPath` to skip the entry being renamed. Returns `null`
 *  when there's no clash. */
export function checkNameClash(
  tree: FileNode[],
  parentPath: string,
  name: string,
  exceptPath?: string,
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const parent = parentPath ? findNode(tree, parentPath) : undefined;
  // Root level — parentPath is "" so we scan the top-level list.
  const siblings: FileNode[] =
    parent && parent.kind === "dir" && parent.children
      ? parent.children
      : parentPath
        ? []
        : tree;
  const fullPath = parentPath ? `${parentPath}/${trimmed}` : trimmed;
  if (exceptPath && fullPath === exceptPath) return null;
  const clash = siblings.some((s) => s.name === trimmed);
  if (clash) {
    return `A file or folder named "${trimmed}" already exists here.`;
  }
  return null;
}

/** Compute the absolute path of `node.parentPath` + `node.name`
 *  normalized to forward slashes. Used by create/rename handlers
 *  to build the path they send to the backend. */
export function joinPath(parentPath: string, name: string): string {
  return parentPath ? `${parentPath}/${name}` : name;
}

/** Strip the parent path prefix and return just the basename. */
export function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

/** Return the directory part of a path (`""` for root-level files). */
export function dirname(path: string): string {
  const parts = path.split("/");
  if (parts.length <= 1) return "";
  parts.pop();
  return parts.join("/");
}

/** Count files + directories in a tree (BFS). Mirrors the inline
 *  helper that previously lived at ExplorerSidebar.tsx:329-343.
 *  Used by the status bar to surface total counts. */
export function countNodes(
  tree: FileNode[],
): { files: number; dirs: number } {
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

/** Filter a file tree by substring match on file/folder name. Case-
 *  insensitive. Always keeps parent folders of any matching node so
 *  the Explorer pane doesn't show "matches" floating in mid-air.
 *  Returns a new array of nodes with their `children` arrays pruned;
 *  the original tree is never mutated. Returns an empty array when
 *  the query is empty (callers should short-circuit and render the
 *  full tree). */
export function filterTreeByName(
  tree: FileNode[],
  query: string,
): FileNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return tree;
  const result: FileNode[] = [];
  for (const node of tree) {
    if (node.kind === "file") {
      if (node.name.toLowerCase().includes(q)) result.push(node);
    } else {
      // Recurse first — if any descendant matches, keep the folder
      // (with only the matching sub-tree inside).
      const filteredChildren = filterTreeByName(node.children ?? [], q);
      if (filteredChildren.length > 0 || node.name.toLowerCase().includes(q)) {
        result.push({ ...node, children: filteredChildren });
      }
    }
  }
  return result;
}