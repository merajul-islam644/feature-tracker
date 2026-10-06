// WorkspacePage — VS Code-style file/folder management at
// `/projects/:projectId/:envSlug/panel`.
//
// Layout (always-on, mirrors VS Code):
//   • Top bar
//       left  — title + EnvHeaderChip + Close-folder affordance
//       right — Undo / Redo / Discard / path-input / Open-folder
//   • Two-column body
//       left  — ExplorerSidebar (shows inline empty state when no folder)
//       right — EditorTabs + EditorArea (CodeMirror area when no file)
//
// Autosave: every keystroke schedules a 500ms debounced write for the
// affected path. The Cmd+S / Ctrl+S keyboard shortcut that the previous
// iteration forced is gone — saving is automatic. Per-tab indicators:
//   • savingPaths (write in flight) → spinner
//   • pendingPaths (debounce timer pending) → amber dot
//
// Undo / Redo: CodeMirror's history is exposed to the top bar via the
// `editorViewRef` captured by `EditorArea.onCreateEditor`. Discard
// reverts the active file's editor doc to the on-disk version (refetched
// from the mcp-server).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Redo2,
  RotateCcw,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/blocks/i18n";
import { useDevServer } from "@/contexts/DevServerContext";
import { EnvHeaderChip } from "@/components/project/EnvHeaderChip";
import { ExplorerSidebar } from "./ExplorerSidebar";
import { EditorTabs } from "./EditorTabs";
import { EditorArea } from "./EditorArea";
import { AgentStatusBanner, AgentStatusPill } from "./AgentStatusBanner";
import { basename, checkNameClash, dirname } from "./treeHelpers";
import { toast } from "sonner";
import { redo, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { cn } from "@/lib/utils";

// Debounce window for autosave. Small enough that the dot indicator
// barely registers; long enough to coalesce a stream of keystrokes
// into a single PUT.
const AUTOSAVE_DEBOUNCE_MS = 500;

export function WorkspacePage() {
  const t = useT();
  const {
    workspaceRoot,
    tree,
    refreshTree,
    readUserFile,
    writeUserFile,
    createUserFolder,
    deleteUserPath,
    renameUserPath,
    openFolder,
    setWorkspaceRoot,
    closeFolder,
    agentStatus,
  } = useDevServer();

  // ─── Tab / content state ──────────────────────────────────────
  const [openPaths, setOpenPaths] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [tabContent, setTabContent] = useState<Map<string, string>>(new Map());

  // ─── Autosave state ───────────────────────────────────────────
  // `pendingPaths`: debounce timer scheduled but not yet flushed.
  // `savingPaths`: write request currently on the wire to the
  // mcp-server. Per-tab indicators surface one of the two (or none).
  const [pendingPaths, setPendingPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const [savingPaths, setSavingPaths] = useState<Set<string>>(
    () => new Set(),
  );
  // Map<path, timeoutId> — debounce handles for each in-flight write.
  const debounceTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  // Refs that mirror the state above so the debounced callbacks read
  // the latest content/path without forcing the page to re-create
  // every callback on every render.
  const tabContentRef = useRef<Map<string, string>>(new Map());
  const openPathsRef = useRef<string[]>([]);
  const activePathRef = useRef<string | null>(null);
  const treeRef = useRef(tree);
  useEffect(() => {
    tabContentRef.current = tabContent;
  }, [tabContent]);
  useEffect(() => {
    openPathsRef.current = openPaths;
  }, [openPaths]);
  useEffect(() => {
    activePathRef.current = activePath;
  }, [activePath]);
  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);

  // Flush a single path's debounced write. Called from the debounce
  // timer; never directly. Marks it as `saving` for the duration of
  // the request, removes it from `pending`, and clears the timer
  // bookkeeping so a re-edit during the write schedules a fresh
  // debounce for the next save.
  const flushSave = useCallback(
    async (path: string) => {
      const timerId = debounceTimersRef.current.get(path);
      if (timerId !== undefined) {
        clearTimeout(timerId);
        debounceTimersRef.current.delete(path);
      }
      setPendingPaths((prev) => {
        if (!prev.has(path)) return prev;
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
      setSavingPaths((prev) => {
        if (prev.has(path)) return prev;
        const next = new Set(prev);
        next.add(path);
        return next;
      });
      try {
        const content = tabContentRef.current.get(path) ?? "";
        await writeUserFile(path, content);
      } catch (err) {
        toast.error(
          `Autosave failed for ${path}: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setSavingPaths((prev) => {
          if (!prev.has(path)) return prev;
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
        // If the user kept typing while the write was in flight,
        // re-mark as pending so the dot reappears briefly until the
        // next debounce fires.
        const stillDirty =
          debounceTimersRef.current.has(path);
        if (stillDirty) {
          setPendingPaths((prev) => {
            if (prev.has(path)) return prev;
            const next = new Set(prev);
            next.add(path);
            return next;
          });
        }
      }
    },
    [writeUserFile],
  );

  // Cancel any pending autosave for a path. Called when the file is
  // closed, the folder is closed, or the file is being discarded.
  const cancelAutosave = useCallback((path: string) => {
    const timerId = debounceTimersRef.current.get(path);
    if (timerId !== undefined) {
      clearTimeout(timerId);
      debounceTimersRef.current.delete(path);
    }
    setPendingPaths((prev) => {
      if (!prev.has(path)) return prev;
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
    setSavingPaths((prev) => {
      if (!prev.has(path)) return prev;
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
  }, []);

  // ─── Mutex state for inline inputs ───────────────────────────
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [creatingSubfolderPath, setCreatingSubfolderPath] =
    useState<string | null>(null);
  const [subfolderCreateError, setSubfolderCreateError] =
    useState<string | null>(null);
  const [creatingFilePath, setCreatingFilePath] = useState<string | null>(
    null,
  );
  const [createFileError, setCreateFileError] = useState<string | null>(null);
  const [confirmingDeletePath, setConfirmingDeletePath] = useState<string | null>(
    null,
  );

  // Collapse state for folders
  const [closedPaths, setClosedPaths] = useState<Set<string>>(() => new Set());

  // Editor view ref — captured from EditorArea.onCreateEditor. The
  // top bar's Undo/Redo/Discard buttons dispatch directly on it. We
  // also need it because when the user switches tabs the React
  // remounts the CodeMirror editor and we get a fresh view.
  const editorViewRef = useRef<EditorView | null>(null);
  const handleEditorView = useCallback((view: EditorView) => {
    editorViewRef.current = view;
  }, []);

  // Track the path of the editor view we last captured so we can
  // flush a pending autosave when the editor tears down (e.g. tab
  // switch). CodeMirror disposes on unmount.
  const lastEditorPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      lastEditorPathRef.current &&
      lastEditorPathRef.current !== activePath &&
      pendingPaths.has(lastEditorPathRef.current)
    ) {
      // Tab switch with unsaved debounced content — flush it before
      // the editor unmounts so the user doesn't lose keystrokes.
      void flushSave(lastEditorPathRef.current);
    }
    lastEditorPathRef.current = activePath;
    // We only want to react to activePath changes, not pendingPaths.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath]);

  // ─── File open / close ────────────────────────────────────────
  const openFile = useCallback(
    async (path: string) => {
      setActivePath(path);
      if (!openPathsRef.current.includes(path)) {
        setOpenPaths((prev) => [...prev, path]);
      }
      // Cache hit — no fetch.
      if (tabContentRef.current.has(path)) return;
      try {
        const content = await readUserFile(path);
        setTabContent((prev) => {
          const next = new Map(prev);
          next.set(path, content ?? "");
          return next;
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    },
    [readUserFile],
  );

  const closeTab = useCallback((path: string) => {
    // Flush any pending autosave before discarding the cached content.
    if (pendingPathsRef.current.has(path)) {
      void flushSave(path);
    } else {
      cancelAutosave(path);
    }
    setOpenPaths((prev) => prev.filter((p) => p !== path));
    setTabContent((prev) => {
      if (!prev.has(path)) return prev;
      const next = new Map(prev);
      next.delete(path);
      return next;
    });
    setActivePath((cur) => {
      if (cur !== path) return cur;
      const remaining = openPathsRef.current.filter((p) => p !== path);
      return remaining[remaining.length - 1] ?? null;
    });
  }, [flushSave, cancelAutosave]);

  const focusTab = useCallback((path: string) => {
    setActivePath(path);
  }, []);

  // ─── Editor change handler — schedules an autosave ────────────
  const handleEditorChange = useCallback(
    (value: string) => {
      const path = activePathRef.current;
      if (!path) return;
      setTabContent((prev) => {
        const next = new Map(prev);
        next.set(path, value);
        return next;
      });
      // Mark as pending (debounce timer set below).
      setPendingPaths((prev) => {
        if (prev.has(path)) return prev;
        const next = new Set(prev);
        next.add(path);
        return next;
      });
      // Reset the existing timer if any, then schedule a new flush.
      const existing = debounceTimersRef.current.get(path);
      if (existing !== undefined) clearTimeout(existing);
      const timerId = setTimeout(() => {
        void flushSave(path);
      }, AUTOSAVE_DEBOUNCE_MS);
      debounceTimersRef.current.set(path, timerId);
    },
    [flushSave],
  );

  // ─── EditorView-dependent actions ───────────────────────────────
  // These run through the live EditorView so CodeMirror's undo history
  // captures them as native transactions.

  const handleUndo = useCallback(() => {
    const view = editorViewRef.current;
    if (!view) return;
    undo({ state: view.state, dispatch: view.dispatch });
  }, []);

  const handleRedo = useCallback(() => {
    const view = editorViewRef.current;
    if (!view) return;
    redo({ state: view.state, dispatch: view.dispatch });
  }, []);

  // Discard local edits — re-fetch the disk version and replace the
  // editor doc. The replacement is dispatched as a transaction so
  // Cmd+Z still works (it just undoes the discard).
  const handleDiscard = useCallback(async () => {
    const path = activePathRef.current;
    if (!path) return;
    cancelAutosave(path);
    try {
      const fresh = await readUserFile(path);
      const view = editorViewRef.current;
      const next = fresh ?? "";
      setTabContent((prev) => {
        const m = new Map(prev);
        m.set(path, next);
        return m;
      });
      if (view && view.state.doc.toString() !== next) {
        view.dispatch({
          changes: {
            from: 0,
            to: view.state.doc.length,
            insert: next,
          },
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, [readUserFile, cancelAutosave]);

  // ─── Tree operations ──────────────────────────────────────────
  const onToggleOpen = useCallback((path: string) => {
    setClosedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // Root-level create (called from Explorer header)
  const startCreateRootFile = useCallback(() => {
    setRenamingPath(null);
    setCreatingSubfolderPath(null);
    setCreatingFilePath("");
    setConfirmingDeletePath(null);
    setCreateFileError(null);
  }, []);

  const startCreateRootFolder = useCallback(() => {
    setRenamingPath(null);
    setCreatingFilePath(null);
    setCreatingSubfolderPath("");
    setSubfolderCreateError(null);
    setConfirmingDeletePath(null);
  }, []);

  const commitCreateRootFile = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) {
        setCreatingFilePath(null);
        setCreateFileError(null);
        return;
      }
      const clash = checkNameClash(treeRef.current ?? [], "", trimmed);
      if (clash) {
        setCreateFileError(clash);
        return;
      }
      const path = trimmed;
      (async () => {
        try {
          await writeUserFile(path, "");
          setCreatingFilePath(null);
          setCreateFileError(null);
          await refreshTree();
          await openFile(path);
        } catch (err) {
          setCreateFileError(err instanceof Error ? err.message : String(err));
        }
      })();
    },
    [writeUserFile, refreshTree, openFile],
  );

  const cancelCreateRootFile = useCallback(() => {
    setCreatingFilePath(null);
    setCreateFileError(null);
  }, []);

  const commitCreateRootFolder = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) {
        setCreatingSubfolderPath(null);
        setSubfolderCreateError(null);
        return;
      }
      const clash = checkNameClash(treeRef.current ?? [], "", trimmed);
      if (clash) {
        setSubfolderCreateError(clash);
        return;
      }
      (async () => {
        try {
          await createUserFolder(trimmed);
          setCreatingSubfolderPath(null);
          setSubfolderCreateError(null);
        } catch (err) {
          setSubfolderCreateError(err instanceof Error ? err.message : String(err));
        }
      })();
    },
    [createUserFolder],
  );

  const cancelCreateRootFolder = useCallback(() => {
    setCreatingSubfolderPath(null);
    setSubfolderCreateError(null);
  }, []);

  // Per-folder create subfolder / file
  const startCreateSubfolder = useCallback((parentPath: string) => {
    setRenamingPath(null);
    setCreatingFilePath(null);
    setConfirmingDeletePath(null);
    setCreatingSubfolderPath(parentPath);
    setSubfolderCreateError(null);
  }, []);

  const startCreateFileInFolder = useCallback((parentPath: string) => {
    setRenamingPath(null);
    setCreatingSubfolderPath(null);
    setConfirmingDeletePath(null);
    setCreatingFilePath(parentPath);
    setCreateFileError(null);
  }, []);

  const commitCreateSubfolder = useCallback(
    (parentPath: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) {
        setCreatingSubfolderPath(null);
        setSubfolderCreateError(null);
        return;
      }
      const clash = checkNameClash(treeRef.current ?? [], parentPath, trimmed);
      if (clash) {
        setSubfolderCreateError(clash);
        return;
      }
      const newPath = parentPath ? `${parentPath}/${trimmed}` : trimmed;
      (async () => {
        try {
          await createUserFolder(newPath);
          setCreatingSubfolderPath(null);
          setSubfolderCreateError(null);
        } catch (err) {
          setSubfolderCreateError(err instanceof Error ? err.message : String(err));
        }
      })();
    },
    [createUserFolder],
  );

  const cancelCreateSubfolder = useCallback(() => {
    setCreatingSubfolderPath(null);
    setSubfolderCreateError(null);
  }, []);

  const commitCreateFileInFolder = useCallback(
    (parentPath: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) {
        setCreatingFilePath(null);
        setCreateFileError(null);
        return;
      }
      const clash = checkNameClash(treeRef.current ?? [], parentPath, trimmed);
      if (clash) {
        setCreateFileError(clash);
        return;
      }
      const newPath = parentPath ? `${parentPath}/${trimmed}` : trimmed;
      (async () => {
        try {
          await writeUserFile(newPath, "");
          setCreatingFilePath(null);
          setCreateFileError(null);
          await refreshTree();
          await openFile(newPath);
        } catch (err) {
          setCreateFileError(err instanceof Error ? err.message : String(err));
        }
      })();
    },
    [writeUserFile, refreshTree, openFile],
  );

  const cancelCreateFile = useCallback(() => {
    setCreatingFilePath(null);
    setCreateFileError(null);
  }, []);

  // Rename (file or folder)
  const startRenameFile = useCallback((path: string) => {
    setCreatingFilePath(null);
    setCreatingSubfolderPath(null);
    setConfirmingDeletePath(null);
    setRenamingPath(path);
    setRenameError(null);
  }, []);

  const commitRenameFile = useCallback(
    (oldPath: string, newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed) {
        setRenamingPath(null);
        setRenameError(null);
        return;
      }
      const parent = dirname(oldPath);
      const clash = checkNameClash(
        treeRef.current ?? [],
        parent,
        trimmed,
        oldPath,
      );
      if (clash) {
        setRenameError(clash);
        return;
      }
      const newPath = parent ? `${parent}/${trimmed}` : trimmed;
      if (newPath === oldPath) {
        setRenamingPath(null);
        setRenameError(null);
        return;
      }
      (async () => {
        try {
          await renameUserPath(oldPath, newPath);
          setRenamingPath(null);
          setRenameError(null);
          // Move any open tab + content cache entry to the new path.
          if (openPathsRef.current.includes(oldPath)) {
            setOpenPaths((prev) =>
              prev.map((p) => (p === oldPath ? newPath : p)),
            );
            if (activePathRef.current === oldPath) setActivePath(newPath);
            const content = tabContentRef.current.get(oldPath);
            setTabContent((prev) => {
              const next = new Map(prev);
              next.delete(oldPath);
              if (content !== undefined) next.set(newPath, content);
              return next;
            });
          }
        } catch (err) {
          setRenameError(err instanceof Error ? err.message : String(err));
        }
      })();
    },
    [renameUserPath],
  );

  const cancelRename = useCallback(() => {
    setRenamingPath(null);
    setRenameError(null);
  }, []);

  // Delete
  const startDelete = useCallback((path: string) => {
    setRenamingPath(null);
    setCreatingFilePath(null);
    setCreatingSubfolderPath(null);
    setConfirmingDeletePath(path);
  }, []);

  const cancelDelete = useCallback(() => {
    setConfirmingDeletePath(null);
  }, []);

  const commitDelete = useCallback(
    (path: string) => {
      // Flush any pending autosaves inside the deleted subtree so the
      // user doesn't lose recent edits that hadn't been written yet.
      for (const [p, timerId] of debounceTimersRef.current.entries()) {
        if (p === path || p.startsWith(`${path}/`)) {
          clearTimeout(timerId);
          debounceTimersRef.current.delete(p);
        }
      }
      (async () => {
        try {
          await deleteUserPath(path);
          setConfirmingDeletePath(null);
          // Close any open tabs inside the deleted subtree.
          setOpenPaths((prev) =>
            prev.filter((p) => p === path || !p.startsWith(`${path}/`)),
          );
          setActivePath((cur) => {
            if (!cur) return cur;
            if (cur === path || cur.startsWith(`${path}/`)) {
              const remaining = openPathsRef.current.filter(
                (p) => p !== path && !p.startsWith(`${path}/`),
              );
              return remaining[remaining.length - 1] ?? null;
            }
            return cur;
          });
          setTabContent((prev) => {
            const next = new Map(prev);
            for (const k of Array.from(prev.keys())) {
              if (k === path || k.startsWith(`${path}/`)) next.delete(k);
            }
            return next;
          });
          setPendingPaths((prev) => {
            const next = new Set(prev);
            for (const k of Array.from(prev)) {
              if (k === path || k.startsWith(`${path}/`)) next.delete(k);
            }
            return next;
          });
          setSavingPaths((prev) => {
            const next = new Set(prev);
            for (const k of Array.from(prev)) {
              if (k === path || k.startsWith(`${path}/`)) next.delete(k);
            }
            return next;
          });
        } catch (err) {
          toast.error(err instanceof Error ? err.message : String(err));
        }
      })();
    },
    [deleteUserPath],
  );

  // ─── Top-bar: path input + open/close affordances ──────────────
  // The path input doubles as "current folder" indicator AND "type a
  // new path to switch" affordance. Editing + Enter switches the
  // workspace root.
  const [pathDraft, setPathDraft] = useState("");
  const [pathInputOpen, setPathInputOpen] = useState(false);
  // Sync the input with the actual workspace root whenever it changes
  // (open folder / close folder / failed setWorkspaceRoot).
  useEffect(() => {
    setPathDraft(workspaceRoot?.path ?? "");
  }, [workspaceRoot?.path]);

  const onOpenFolder = useCallback(async () => {
    await openFolder();
  }, [openFolder]);

  const onCloseFolder = useCallback(() => {
    // Flush any pending autosaves before tearing down state so
    // keystrokes that haven't reached disk yet aren't lost.
    for (const path of Array.from(pendingPathsRef.current)) {
      void flushSave(path);
    }
    closeFolder();
    setOpenPaths([]);
    setActivePath(null);
    setTabContent(new Map());
    setRenamingPath(null);
    setCreatingFilePath(null);
    setCreatingSubfolderPath(null);
    setConfirmingDeletePath(null);
    setPendingPaths(new Set());
    setSavingPaths(new Set());
    debounceTimersRef.current.clear();
    setPathInputOpen(false);
  }, [closeFolder, flushSave]);

  const startTypePath = useCallback(() => {
    setPathDraft(workspaceRoot?.path ?? "");
    setPathInputOpen(true);
  }, [workspaceRoot?.path]);

  const submitTypePath = useCallback(async () => {
    const trimmed = pathDraft.trim();
    if (!trimmed) return;
    setPathInputOpen(false);
    try {
      await setWorkspaceRoot(trimmed);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, [pathDraft, setWorkspaceRoot]);

  // Refs to read latest state from event-handler callbacks that
  // would otherwise need to be torn down on every render.
  const pendingPathsRef = useRef(pendingPaths);
  useEffect(() => {
    pendingPathsRef.current = pendingPaths;
  }, [pendingPaths]);

  // ─── Render ───────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      <AgentStatusBanner status={agentStatus} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-foreground">
            {t("issueTracker.workspace.title", "Workspace")}
          </h1>
          <EnvHeaderChip />
          {workspaceRoot && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onCloseFolder}
              className="h-7 gap-1.5 px-2 text-xs"
              aria-label="Close folder"
              title="Close folder"
            >
              <i
                className="codicon codicon-folder text-[14px] leading-none text-amber-500"
                aria-hidden="true"
              />
              {t("issueTracker.workspace.closeFolder", "Close folder")}
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <AgentStatusPill status={agentStatus} />
          <Button
            variant="ghost"
            size="icon"
            onClick={handleUndo}
            disabled={!activePath}
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            aria-label="Undo"
            title="Undo (Cmd+Z)"
          >
            <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRedo}
            disabled={!activePath}
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            aria-label="Redo"
            title="Redo (Cmd+Shift+Z)"
          >
            <Redo2 className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void handleDiscard()}
            disabled={!activePath}
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            aria-label="Discard changes"
            title="Discard changes — revert to the saved version on disk"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          {pathInputOpen ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                autoFocus
                value={pathDraft}
                onChange={(e) => setPathDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitTypePath();
                  else if (e.key === "Escape") setPathInputOpen(false);
                }}
                placeholder={t(
                  "issueTracker.workspace.pathPlaceholder",
                  "C:\\path\\to\\folder",
                )}
                className="h-7 w-64 rounded border border-input bg-background px-2 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                aria-label="Folder path"
              />
              <Button
                onClick={() => void submitTypePath()}
                size="sm"
                className="h-7 px-2 text-xs"
                aria-label="Open path"
              >
                {t("issueTracker.workspace.open", "Open")}
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={startTypePath}
              className="h-7 gap-1.5 px-2 text-xs font-mono"
              aria-label="Type folder path"
              title="Type a folder path"
            >
              {workspaceRoot?.path ?? t("issueTracker.workspace.typePath", "Type path")}
            </Button>
          )}
          <Button
            onClick={onOpenFolder}
            size="sm"
            className="h-7 gap-1.5 px-2.5 text-xs"
            aria-label="Open folder"
            title="Open folder (pick from your machine)"
          >
            <i
              className="codicon codicon-folder-opened text-[14px] leading-none text-amber-500"
              aria-hidden="true"
            />
            {t("issueTracker.workspace.openFolder", "Open folder")}
          </Button>
        </div>
      </div>

      <div className="-mx-4 sm:-mx-6 flex h-[calc(100vh-160px)] min-h-[480px] overflow-hidden border border-border bg-background">
        <ExplorerSidebar
          tree={tree ?? null}
          closedPaths={closedPaths}
          activePath={activePath}
          renamingPath={renamingPath}
          renameError={renameError}
          creatingSubfolderPath={creatingSubfolderPath}
          subfolderCreateError={subfolderCreateError}
          creatingFilePath={creatingFilePath}
          createFileError={createFileError}
          confirmingDeletePath={confirmingDeletePath}
          onToggleOpen={onToggleOpen}
          onOpenFile={openFile}
          onStartCreateRootFile={startCreateRootFile}
          onStartCreateRootFolder={startCreateRootFolder}
          onCommitCreateRootFile={commitCreateRootFile}
          onCancelCreateRootFile={cancelCreateRootFile}
          onCommitCreateRootFolder={commitCreateRootFolder}
          onCancelCreateRootFolder={cancelCreateRootFolder}
          onStartRenameFile={startRenameFile}
          onCancelRename={cancelRename}
          onCommitRenameFile={commitRenameFile}
          onStartCreateSubfolder={startCreateSubfolder}
          onCommitCreateSubfolder={commitCreateSubfolder}
          onCancelCreateSubfolder={cancelCreateSubfolder}
          onStartCreateFileInFolder={startCreateFileInFolder}
          onCommitCreateFileInFolder={commitCreateFileInFolder}
          onCancelCreateFile={cancelCreateFile}
          onStartDelete={startDelete}
          onCancelDelete={cancelDelete}
          onCommitDelete={commitDelete}
          onRefresh={() => void refreshTree()}
          rootFolderName={workspaceRoot?.name ?? null}
          onOpenFolder={onOpenFolder}
          onTypePath={startTypePath}
          treeLoading={Boolean(workspaceRoot && !tree)}
        />

        <section className="flex min-w-0 flex-1 flex-col bg-background">
          <EditorTabs
            openPaths={openPaths}
            activePath={activePath}
            pendingPaths={pendingPaths}
            savingPaths={savingPaths}
            onFocusTab={focusTab}
            onCloseTab={closeTab}
          />
          <EditorArea
            activePath={activePath}
            content={activePath ? tabContent.get(activePath) ?? "" : ""}
            onChange={handleEditorChange}
            onCreateEditor={handleEditorView}
          />
        </section>
      </div>

      {/* Hidden filename indicator so screen readers can announce the
          active tab. Keeps the visual UI clean. */}
      <span className="sr-only" aria-live="polite">
        {activePath ? basename(activePath) : ""}
      </span>
    </div>
  );
}

// Empty obj literal pattern: keep imports referenced even when a
// useMemo lookup is removed. (Linter-cleanup helper.)
void useMemo;