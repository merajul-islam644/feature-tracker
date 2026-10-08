// WorkspacePage — VS Code-style file/folder management at
// `/projects/:projectId/:envSlug/panel`.
//
// Layout (VS Code-like):
//   • Page header
//       left  — icon badge + h1 + EnvHeaderChip + Close-folder
//       right — Undo / Redo / Discard / Type-path / Open-folder
//   • Subtitle line ("Open a folder and edit files like VS Code…")
//   • IDE frame (rounded card)
//       left  — ExplorerSidebar
//       right — WorkspaceBreadcrumb + EditorTabs + EditorArea
//                (or WorkspaceEmptyState when no folder is picked)
//   • Status bar (page surface, outside the frame)
//       left  — file/folder counts + language
//       right — save state + problems + Ln/Col
//
// Autosave: every keystroke schedules a 500ms debounced write for the
// affected path. The Cmd+S / Ctrl+S keyboard shortcut the previous
// iteration forced is gone — saving is automatic. Per-tab indicators:
//   • savingPaths (write in flight) → spinner
//   • pendingPaths (debounce timer pending) → amber dot
//   • lastSavedAt → emerald "Saved {n}s ago" in the status bar
//
// Undo / Redo: CodeMirror's history is exposed to the header via the
// `editorViewRef` captured by `EditorArea.onCreateEditor`. Discard
// reverts the active file's editor doc to the on-disk version
// (refetched from the mcp-server).
//
// Keyboard (Slice B / C):
//   • Cmd/Ctrl + W → close active tab
//   • Cmd/Ctrl + S → flush pending autosave immediately

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  FolderTree,
  Maximize2,
  Minimize2,
  Redo2,
  RotateCcw,
  Search,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/blocks/i18n";
import { useDevServer } from "@/contexts/DevServerContext";
import { EnvHeaderChip } from "@/components/project/EnvHeaderChip";
import { ExplorerSidebar } from "./ExplorerSidebar";
import { EditorTabs } from "./EditorTabs";
import { EditorArea } from "./EditorArea";
import { ProblemsPanel } from "./ProblemsPanel";
import { GitPanel } from "./GitPanel";
import { WorkspaceEmptyState } from "./WorkspaceEmptyState";
import { WorkspaceBreadcrumb } from "./WorkspaceBreadcrumb";
import { TerminalPanel } from "./TerminalPanel";
import { TerminalTabs } from "./TerminalTabs";
import { SearchPanel } from "./SearchPanel";
import {
  BUILTIN_ITEMS,
  SidebarActivityBar,
  resolveLucideIcon,
  type ActivityBarItem,
} from "./SidebarActivityBar";
import { ExtensionsManagerPanel } from "./ExtensionsManagerPanel";
import { ExtensionIframeView } from "./ExtensionIframeView";
import { useInstalledExtensions } from "@/contexts/ExtensionsContext";
import {
  ExternalChangeDialog,
  UnsavedConfirmDialog,
} from "./WorkspaceDialogs";
import {
  WorkspaceStatusBar,
  type SaveState,
} from "./WorkspaceStatusBar";
import {
  basename,
  checkNameClash,
  countNodes,
  dirname,
} from "./treeHelpers";
import { languageLabel } from "./languageLabel";
import { toast } from "sonner";
import { redo, undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { cn } from "@/lib/utils";
import { devServerApi } from "@/services/devServerApi";
import type { TerminalInstance } from "@/types/dev-server";
import {
  loadWorkspaceTabs,
  saveWorkspaceTabs,
  loadWorkspaceFullscreen,
  saveWorkspaceFullscreen,
} from "@/lib/blocks/devServerStorage";

// Debounce window for autosave. Small enough that the dot indicator
// barely registers; long enough to coalesce a stream of keystrokes
// into a single PUT.
const AUTOSAVE_DEBOUNCE_MS = 500;
// How long to wait after the last keystroke before mirroring the
// editor content into the language server (Phase 1 diagnostics).
// Slightly above autosave so the disk copy usually lands first.
const LSP_SYNC_DEBOUNCE_MS = 700;
// Window after a successful save during which the "Saved {n}s ago"
// badge stays visible before it auto-hides.
const SAVED_BADGE_VISIBLE_MS = 1_500;

// ─── Line-ending preservation ─────────────────────────────────────
// CodeMirror folds every line ending (\r\n, \r, \n) to "\n" inside
// the buffer, so autosaving a CRLF file used to rewrite every line
// as LF — git saw the whole file as changed after a one-word edit.
// We capture the file's on-disk ending at each load point and
// convert back in `flushSave`, keeping diffs line-accurate.
type FileEol = "\r\n" | "\n";

/** Detect the dominant on-disk ending. Anything containing CRLF is
 *  treated as a CRLF file; lone-\r (classic Mac) counts as LF —
 *  museum format, not worth preserving. */
function detectFileEol(content: string): FileEol {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

/** Convert LF-only editor text back to the file's on-disk ending.
 *  `\r?\n` (not bare `\n`) keeps this idempotent when the in-memory
 *  cache still holds a CRLF string right after a discard/reload —
 *  existing CRLFs pass through unchanged. */
function applyFileEol(content: string, eol: FileEol): string {
  return eol === "\r\n" ? content.replace(/\r?\n/g, "\r\n") : content;
}

// ─── Terminal-instance persistence (mirrors `notepad/storage.ts`
// readJSON/writeJSON pattern — see that file's comments for why we
// roll our own instead of a project-wide helper). One record per
// `(workspaceId, cwd)` so each project keeps its own tab list.
// Refresh-survivable: a tab created yesterday re-appears with the
// same id and scrollback.

const INSTANCES_KEY = "lattice.terminal.instances.v1";

function loadInstances(workspaceId: string, cwd: string): TerminalInstance[] {
  try {
    const raw = window.localStorage.getItem(INSTANCES_KEY);
    if (!raw) return defaultInstances();
    const map = JSON.parse(raw) as Record<string, TerminalInstance[]>;
    const list = map[`${workspaceId}:${cwd}`];
    if (!Array.isArray(list) || list.length === 0) return defaultInstances();
    return list;
  } catch {
    return defaultInstances();
  }
}

function saveInstances(
  workspaceId: string,
  cwd: string,
  list: TerminalInstance[],
): void {
  try {
    const raw = window.localStorage.getItem(INSTANCES_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, TerminalInstance[]>) : {};
    map[`${workspaceId}:${cwd}`] = list;
    window.localStorage.setItem(INSTANCES_KEY, JSON.stringify(map));
  } catch {
    /* quota / disabled storage — best effort */
  }
}

function defaultInstances(): TerminalInstance[] {
  return [{ id: "term-1", label: "Term 1", shellId: null }];
}

// Scrub the scrollback for a tab whose PTY is being killed. The
// TerminalPanel writes here on debounced output (see its mount
// effect); removing the key prevents a future "[Reattached to
// running shell]" from restoring a buffer whose PTY is dead.
function deleteScrubbedTerminalScrollback(
  workspaceId: string,
  cwd: string,
  terminalId: string,
): void {
  try {
    const key = "lattice.terminal.scrollback.v1";
    const raw = window.localStorage.getItem(key);
    if (!raw) return;
    const map = JSON.parse(raw) as Record<string, string>;
    delete map[`${workspaceId}:${cwd}:${terminalId}`];
    window.localStorage.setItem(key, JSON.stringify(map));
  } catch {
    /* */
  }
}

// ─── Sidebar width persistence (same mirror pattern as the terminal
// instances above). One number per browser — VS Code keeps a single
// side-bar width across workspaces too. Clamped on read so a stale or
// hand-edited value can't push the editor column off-screen.

const SIDEBAR_WIDTH_KEY = "lattice.workspace.sidebarWidth.v1";
export const SIDEBAR_WIDTH_MIN = 170;
export const SIDEBAR_WIDTH_MAX = 520;
export const SIDEBAR_WIDTH_DEFAULT = 256;

function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, width));
}

function loadSidebarWidth(): number {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
    const n = raw === null ? NaN : Number(raw);
    if (!Number.isFinite(n)) return SIDEBAR_WIDTH_DEFAULT;
    return clampSidebarWidth(n);
  } catch {
    return SIDEBAR_WIDTH_DEFAULT;
  }
}

function saveSidebarWidth(width: number): void {
  try {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(width)));
  } catch {
    /* quota / disabled storage — best effort */
  }
}

// ─── Terminal dock height persistence (same mirror pattern as the
// sidebar width above). One number per browser; the sash on the
// dock's top edge drives it and double-click resets. `max` is the
// drag-time clamp (container height minus the editor reserve) —
// without it a big stored height could push the editor off-screen
// on a small window, so the loader clamps to the absolute max and
// the drag clamps tighter.

const TERMINAL_HEIGHT_KEY = "lattice.workspace.terminalHeight.v1";
export const TERMINAL_HEIGHT_MIN = 120;
export const TERMINAL_HEIGHT_MAX = 720;
export const TERMINAL_HEIGHT_DEFAULT = 240;
// Vertical pixels kept visible above the dock while dragging — the
// editor tab strip + a few code lines never fully disappear (VS Code
// clamps panel drags the same way).
const TERMINAL_RESERVE_PX = 200;

function clampTerminalHeight(
  height: number,
  max: number = TERMINAL_HEIGHT_MAX,
): number {
  // Never let a bogus `max` push the floor below the minimum.
  const upper = Math.max(TERMINAL_HEIGHT_MIN + 40, max);
  return Math.min(upper, Math.max(TERMINAL_HEIGHT_MIN, height));
}

function loadTerminalHeight(): number {
  try {
    const raw = window.localStorage.getItem(TERMINAL_HEIGHT_KEY);
    const n = raw === null ? NaN : Number(raw);
    if (!Number.isFinite(n)) return TERMINAL_HEIGHT_DEFAULT;
    return clampTerminalHeight(n);
  } catch {
    return TERMINAL_HEIGHT_DEFAULT;
  }
}

function saveTerminalHeight(height: number): void {
  try {
    window.localStorage.setItem(
      TERMINAL_HEIGHT_KEY,
      String(Math.round(height)),
    );
  } catch {
    /* quota / disabled storage — best effort */
  }
}

export function WorkspacePage() {
  const t = useT();
  const {
    workspace,
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
    problems,
    lspDiagnostics,
    subscribeToWatcher,
    watcherOnline,
  } = useDevServer();

  // ─── Tab / content state ──────────────────────────────────────
  const [openPaths, setOpenPaths] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [tabContent, setTabContent] = useState<Map<string, string>>(new Map());
  // The folder the user currently has open. Read off the dev-server
  // context — `null` when no folder is picked. We use it as the
  // scoping segment of the localStorage key for the tab persistence
  // effects below, so a switch between folders within the same
  // project+env swaps the tab set instead of bleeding one folder's
  // paths into another.
  const folderPath = workspaceRoot?.path ?? null;

  // ─── Language-server doc sync (Phase 1) ────────────────────────
  // tsserver only publishes diagnostics for documents it knows about,
  // so every file the editor opens or changes is mirrored through the
  // LSP bridge. The vehicle is a throwaway `textDocument/hover` — the
  // backend syncs the doc first (didOpen on first sight, didChange
  // after) and the hover result is discarded; it doubles as a
  // liveness ack. Fire-and-forget by design: a failed sync degrades
  // to "no diagnostics", never an error toast.
  const lspSyncTimersRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());
  const syncLspDoc = useCallback(
    (path: string, content: string) => {
      if (!workspace?.id || !workspaceRoot?.path) return;
      void devServerApi
        .lspRequest({
          workspaceId: workspace.id,
          root: workspaceRoot.path,
          method: "textDocument/hover",
          params: { path, position: { line: 0, character: 0 } },
          doc: { path, content },
        })
        .catch(() => undefined);
    },
    [workspace?.id, workspaceRoot?.path],
  );

  // Load tabs from localStorage when (workspace identity + folder)
  // combo changes. On a fresh load this restores the open files + the
  // active tab so a refresh (or a browser close+reopen) returns the
  // editor to the exact view the user left. On a folder switch the
  // new folder loads its own tab set; closing the folder resets to
  // empty. We track the key we've seen so subsequent renders with the
  // same folder don't clobber the user's in-progress edits.
  const tabsLoadKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = [
      workspace?.userId ?? "",
      workspace?.projectId ?? "",
      workspace?.envSlug ?? "",
      folderPath ?? "",
    ].join("|");
    if (key === tabsLoadKeyRef.current) return;
    tabsLoadKeyRef.current = key;
    if (
      !workspace?.userId ||
      !workspace?.projectId ||
      !workspace?.envSlug ||
      !folderPath
    ) {
      setOpenPaths([]);
      setActivePath(null);
      setTabContent(new Map());
      return;
    }
    const loaded = loadWorkspaceTabs(
      workspace.userId,
      workspace.projectId,
      workspace.envSlug,
      folderPath,
    );
    const restoredPaths = loaded?.openPaths ?? [];
    setOpenPaths(restoredPaths);
    setActivePath(loaded?.activePath ?? null);
    // tabContent is in-memory only — re-fetch on demand. Wiping it on
    // a folder switch is the cheapest way to make sure stale cache
    // entries from a previous folder don't leak in.
    setTabContent(new Map());
    fileEolRef.current.clear();
    // Pre-fetch every restored tab's content so the user sees the
    // file body the moment the editor mounts — without this, opening
    // the page after a refresh would leave every tab visually empty
    // until the user clicked each one to trigger `openFile`.
    if (restoredPaths.length > 0) {
      void Promise.all(
        restoredPaths.map(async (path) => {
          try {
            const content = await readUserFile(path);
            fileEolRef.current.set(path, detectFileEol(content ?? ""));
            setTabContent((prev) => {
              const next = new Map(prev);
              next.set(path, content ?? "");
              return next;
            });
            // Restored tabs were never "opened" this page load — sync
            // them so diagnostics come back after a refresh too.
            syncLspDoc(path, content ?? "");
          } catch (err) {
            // Stale tabs (file deleted on disk between visits) just
            // toast and skip — the tab stays open but the editor
            // shows nothing, and the user can close it.
            toast.error(err instanceof Error ? err.message : String(err));
          }
        }),
      );
    }
  }, [
    workspace?.userId,
    workspace?.projectId,
    workspace?.envSlug,
    folderPath,
    readUserFile,
    syncLspDoc,
  ]);

  // Persist on every change while a folder is open. Mirrors the
  // `terminals` save effect below — same shape, same `(user, project,
  // env, folder)` scope, different model. `saveWorkspaceTabs` strips
  // empty state so a long-lived session doesn't accumulate stale
  // rows for one-off folders.
  useEffect(() => {
    if (
      !workspace?.userId ||
      !workspace?.projectId ||
      !workspace?.envSlug ||
      !folderPath
    ) {
      return;
    }
    saveWorkspaceTabs(
      workspace.userId,
      workspace.projectId,
      workspace.envSlug,
      folderPath,
      { openPaths, activePath },
    );
  }, [
    openPaths,
    activePath,
    workspace?.userId,
    workspace?.projectId,
    workspace?.envSlug,
    folderPath,
  ]);

  // External-change prompt — opened when the watcher fires a `change`
  // for a path that's currently open as a tab. Single-slot: only one
  // prompt at a time; if a second file changes while the first is
  // awaiting a decision, the second waits.
  const [externalChange, setExternalChange] = useState<{ path: string } | null>(
    null,
  );

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
  /** Timestamp (ms) of the most recent successful save. Used by the
   *  status bar to render "Saved {n}s ago". `0` = no save yet. */
  const [savedAt, setSavedAt] = useState(0);
  /** Auto-hide window — set to `Date.now() + SAVED_BADGE_VISIBLE_MS`
   *  right after a save. Status bar hides the "Saved" label once
   *  `Date.now() > hideSavedAt`. Mirrors the pattern in
   *  `TestCaseSpreadsheet.tsx:137-164`. */
  const [hideSavedAt, setHideSavedAt] = useState(-Infinity);
  // Map<path, timeoutId> — debounce handles for each in-flight write.
  const debounceTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  // Refs that mirror the state above so the debounced callbacks read
  // the latest content/path without forcing the page to re-create
  // every callback on every render.
  const tabContentRef = useRef<Map<string, string>>(new Map());
  // Per-open-file on-disk line ending, captured at every
  // `readUserFile` load point (open, restored tab, discard, reload).
  // `flushSave` converts the LF-only editor text back before writing
  // so CRLF files keep their endings and git diffs stay small.
  const fileEolRef = useRef<Map<string, FileEol>>(new Map());
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
  // ─── Git panel feed (Source Control) ────────────────────────────
  // The activity-bar badge + panel list track working-tree state.
  // Disk changes reach us two ways: the watcher SSE (external writes,
  // git operations) and this component's own autosaves — the watcher
  // deliberately drops autosave echoes, so `flushSave` bumps the
  // refresh itself. Both funnel into `scheduleGitRefresh`, coalesced
  // to at most one status fetch per second.
  const [gitChangedCount, setGitChangedCount] = useState(0);
  const [gitRefreshTick, setGitRefreshTick] = useState(0);
  const gitRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleGitRefresh = useCallback(() => {
    if (gitRefreshTimerRef.current) return;
    gitRefreshTimerRef.current = setTimeout(() => {
      gitRefreshTimerRef.current = null;
      setGitRefreshTick((t) => t + 1);
    }, 1_000);
  }, []);
  useEffect(
    () => () => {
      if (gitRefreshTimerRef.current) clearTimeout(gitRefreshTimerRef.current);
    },
    [],
  );
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
        // Editor text is LF-only (CM6 folds endings); write back in
        // the ending the file had on disk so CRLF repos don't see
        // their whole file rewritten on every keystroke save.
        const out = applyFileEol(content, fileEolRef.current.get(path) ?? "\n");
        await writeUserFile(path, out);
        // Only stamp `savedAt` when the write succeeded. The status
        // bar's "Saved Xs ago" badge tracks the most recent
        // successful PUT.
        setSavedAt(Date.now());
        setHideSavedAt(Date.now() + SAVED_BADGE_VISIBLE_MS);
        // The autosave echo never reaches the watcher (echo filter),
        // so tell the git panel the working tree just moved.
        scheduleGitRefresh();
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
    [writeUserFile, scheduleGitRefresh],
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

  // Expand state for folders. An empty set is the *default* — every
  // folder starts collapsed on mount / refresh / folder switch, and
  // the user opens individual folders by clicking the chevron. This
  // matches VS Code's behaviour (and avoids the "tree explodes open
  // on every reload" surprise that the previous `closedPaths` model
  // had, where an empty set meant *everything* was expanded).
  //
  // Named `expandedFolders` to disambiguate from the editor-tab
  // `openPaths` above (open files vs. open folders — different
  // domains, different shapes, and both legitimately named "open").
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set(),
  );

  // Editor fullscreen / zoom mode. When `true`, the page hides the
  // IDE chrome (page header, Explorer sidebar, status bar, terminal)
  // and renders just the editor column (breadcrumb + tabs + editor)
  // in a fixed-position overlay covering the entire viewport. Toggled
  // by the zoom button next to "Open folder" in the page header.
  //
  // Persisted per `(user, project, env)` — a refresh (or browser
  // close+reopen) restores the zoomed view so the user doesn't have
  // to re-click after every reload. Folder-independent: the zoom
  // preference is page-level, not file-level.
  // We can't read `workspace` synchronously on first render — the
  // `useDevServer` provider hydrates async, so a lazy `useState`
  // initializer would always see `workspace === null` and pin
  // `editorFullscreen` to `false`. That would clobber a stored
  // `true` once the persist effect fired (because
  // `saveWorkspaceFullscreen` interprets `false` as "remove the
  // row"). Instead we start at `false` and load via an effect that
  // keys on the workspace identity.
  const [editorFullscreen, setEditorFullscreen] = useState(false);
  const fullscreenLoadKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      !workspace?.userId ||
      !workspace?.projectId ||
      !workspace?.envSlug
    ) {
      return;
    }
    const key = `${workspace.userId}|${workspace.projectId}|${workspace.envSlug}`;
    if (key === fullscreenLoadKeyRef.current) return;
    fullscreenLoadKeyRef.current = key;
    setEditorFullscreen(
      loadWorkspaceFullscreen(
        workspace.userId,
        workspace.projectId,
        workspace.envSlug,
      ),
    );
  }, [workspace?.userId, workspace?.projectId, workspace?.envSlug]);
  const toggleEditorFullscreen = useCallback(() => {
    setEditorFullscreen((v) => !v);
  }, []);

  // Mirror the toggle to localStorage. Same `lattice.mirror.*.v1`
  // family as the tabs row above; `saveWorkspaceFullscreen` strips
  // the key when the flag is `false` so the default state doesn't
  // litter DevTools. The key guard mirrors the load effect so we
  // don't write a stale pre-load `false` over a stored `true`.
  useEffect(() => {
    if (
      !workspace?.userId ||
      !workspace?.projectId ||
      !workspace?.envSlug
    ) {
      return;
    }
    const key = `${workspace.userId}|${workspace.projectId}|${workspace.envSlug}`;
    if (key !== fullscreenLoadKeyRef.current) return;
    saveWorkspaceFullscreen(
      workspace.userId,
      workspace.projectId,
      workspace.envSlug,
      editorFullscreen,
    );
  }, [
    editorFullscreen,
    workspace?.userId,
    workspace?.projectId,
    workspace?.envSlug,
  ]);

  // Esc exits fullscreen — small QoL match for the visual cue (the
  // exit button is the same lucide `ZoomOut` icon, but the keyboard
  // shortcut is what power users reach for).
  useEffect(() => {
    if (!editorFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEditorFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editorFullscreen]);

  // Page-level horizontal scroll lockdown. At browser zoom levels ≠
  // 100%, fractional device-pixel rounding can push some element a
  // few px past the layout viewport; the document then grows a
  // full-width horizontal scrollbar, and scrolling right slides the
  // workspace content under the fixed navigation sidebar. Nothing on
  // this page has legitimate page-level horizontal overflow — the
  // IDE card is overflow-hidden and the breadcrumb/tab strips scroll
  // internally — so clip the overflow at the root while mounted.
  // Also zeroes a stuck horizontal offset left over from a session
  // where the scrollbar did appear. Vertical scrolling is untouched.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("overflow-x-hidden");
    if (window.scrollX !== 0) window.scrollTo(0, window.scrollY);
    return () => root.classList.remove("overflow-x-hidden");
  }, []);

  // Editor view ref — captured from EditorArea.onCreateEditor. The
  // header's Undo/Redo/Discard buttons dispatch directly on it. We
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
      if (tabContentRef.current.has(path)) {
        // Still mirror into the language server: the LSP session may
        // be younger than this tab (server restart, workspace
        // recycle) and its openDocs map won't know the file.
        syncLspDoc(path, tabContentRef.current.get(path) ?? "");
        return;
      }
      try {
        const content = await readUserFile(path);
        fileEolRef.current.set(path, detectFileEol(content ?? ""));
        setTabContent((prev) => {
          const next = new Map(prev);
          next.set(path, content ?? "");
          return next;
        });
        syncLspDoc(path, content ?? "");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    },
    [readUserFile, syncLspDoc],
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

  // ─── Unsaved-changes confirmation ───────────────────────────────
  // When the user tries to close a dirty tab, capture the intent and
  // show the dialog. The dialog buttons call the variants below.
  const [unsavedDialog, setUnsavedDialog] = useState<{ path: string } | null>(
    null,
  );

  // `closeTabForced` is the variant the dialog calls — bypasses the
  // dirty check and discards in-memory edits. For the case where the
  // user typed and the autosave already wrote the latest keystrokes to
  // disk, `pendingPaths.has(path)` is `false`; calling it is safe.
  const closeTabForced = useCallback((path: string) => {
    cancelAutosave(path);
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
  }, [cancelAutosave]);

  // Wrap `closeTab` so the dirty path triggers the dialog. The keyboard
  // shortcut and the EditorTabs close button call this. The dialog
  // itself re-invokes `closeTabForced` after the user picks Save /
  // Don't save / Cancel.
  const closeTabWithConfirm = useCallback(
    (path: string) => {
      if (pendingPathsRef.current.has(path)) {
        setUnsavedDialog({ path });
        return;
      }
      closeTab(path);
    },
    [closeTab],
  );

  // ─── Search panel state ────────────────────────────────────────
  // `searchOpen` toggled by the header button OR Cmd/Ctrl+Shift+F.
  // `onOpenResult` opens the file in the editor + jumps the cursor.
  const [searchOpen, setSearchOpen] = useState(false);

  // ─── Sidebar activity bar tab ──────────────────────────────────
  // Drives which sidebar panel renders to the left of the editor:
  // built-in tabs ("explorer", "extensions") + per enabled
  // extension-contributed panels (`ext:<extensionId>:<panelId>`).
  // Initial value `true` so Explorer still opens by default; in
  // fullscreen we keep the same default.
  const [sidebarTab, setSidebarTab] = useState<string>("explorer");

  // ─── Sidebar width (drag-to-resize) ────────────────────────────
  // Pixel width of the sidebar panel column (activity bar excluded —
  // VS Code keeps its activity bar fixed too). Persisted per browser;
  // the sash in `WorkspaceSidebar` drives it, double-click resets.
  const [sidebarWidth, setSidebarWidth] = useState<number>(loadSidebarWidth);

  // ─── Terminal dock (drag-to-resize + maximize) ─────────────────
  // Pixel height of the terminal dock (tabs strip + active panel).
  // Persisted per browser like the sidebar width; the horizontal
  // sash on the dock's top edge drives it, double-click resets.
  const [terminalHeight, setTerminalHeight] =
    useState<number>(loadTerminalHeight);
  // Maximize is session-only on purpose — a reload always restores
  // the split layout so a stale flag can't strand the user in front
  // of a bare terminal before the (async) collapse hydration runs.
  const [terminalMaximized, setTerminalMaximized] = useState(false);
  // Mirror of the active TerminalPanel's collapsed state. The real
  // state lives inside TerminalPanel (see its hydration comment);
  // this copy only drives the dock's sash visibility. Starts `true`
  // to match the panel's initial state, then the panel's hydration
  // effect syncs it.
  const [terminalCollapsed, setTerminalCollapsed] = useState(true);
  // Bounded IDE container (the `h-[calc(100vh-220px)]` card in the
  // normal layout, the fullscreen section otherwise). The dock's
  // drag clamp measures it at drag start. Only one branch renders
  // at a time, so a single ref serves both.
  const ideContainerRef = useRef<HTMLDivElement | null>(null);
  const toggleTerminalMaximized = useCallback(
    () => setTerminalMaximized((m) => !m),
    [],
  );
  const handleTerminalCollapsedChange = useCallback((collapsed: boolean) => {
    setTerminalCollapsed(collapsed);
    // Collapse wins over maximize — maximize only makes sense with
    // an expanded panel; otherwise the editor stays hidden behind a
    // 32px header row.
    if (collapsed) setTerminalMaximized(false);
  }, []);
  const installedExtensions = useInstalledExtensions();
  const activityBarItems = useMemo<ActivityBarItem[]>(() => {
    // Built-ins first; the Source Control entry carries the live
    // changed-file count as its badge (VS Code parity).
    const items: ActivityBarItem[] = BUILTIN_ITEMS.map((it) =>
      it.id === "git" && gitChangedCount > 0
        ? { ...it, badge: gitChangedCount }
        : it,
    );
    for (const ext of installedExtensions) {
      if (!ext.enabled) continue;
      const panels = ext.manifest.contributes?.panels ?? [];
      for (const panel of panels) {
        items.push({
          id: `ext:${ext.id}:${panel.id}`,
          label: panel.title,
          icon: resolveLucideIcon(panel.icon),
        });
      }
    }
    return items;
  }, [installedExtensions, gitChangedCount]);

  // LSP error+warning total (Phase 1) — merged into the status bar's
  // problems count. The backend `problems` list and the language
  // server's diagnostics are independent feeds, so the badge shows
  // their union; the Problems panel itself renders only the LSP side.
  const lspProblemCount = useMemo(
    () =>
      Object.values(lspDiagnostics).reduce(
        (n, list) => n + list.filter((d) => d.severity <= 2).length,
        0,
      ),
    [lspDiagnostics],
  );

  // Listen for navigation requests fired by the extension iframe via
  // postMessage (`ext:navigate` → custom event). v1 only switches the
  // sidebar tab; future versions can route to /chat, /notepad, etc.
  useEffect(() => {
    function onNavigate(e: Event) {
      const detail = (e as CustomEvent<{ extensionId: string; panelId: string }>).detail;
      if (!detail) return;
      setSidebarTab(`ext:${detail.extensionId}:${detail.panelId}`);
    }
    window.addEventListener("lattice-ext:navigate", onNavigate);
    return () => {
      window.removeEventListener("lattice-ext:navigate", onNavigate);
    };
  }, []);
  const openSearchResult = useCallback(
    async (path: string, line: number, column: number) => {
      await openFile(path);
      // Wait for the EditorArea to mount the new doc + read the view
      // back from EditorArea. Two-setTimeout is enough — CodeMirror's
      // initial transaction lands on the next microtask.
      window.setTimeout(() => {
        const view = editorViewRef.current;
        if (!view) return;
        try {
          const doc = view.state.doc;
          const safeLine = Math.max(1, Math.min(line, doc.lines));
          const lineInfo = doc.line(safeLine);
          const safeCol = Math.max(0, Math.min(column - 1, lineInfo.length));
          const pos = lineInfo.from + safeCol;
          view.dispatch({
            selection: { anchor: pos, head: pos },
            effects: EditorView.scrollIntoView(pos, { y: "center" }),
          });
          view.focus();
        } catch {
          // Position out of bounds — just open the file.
        }
      }, 50);
    },
    [openFile],
  );

  // ─── Editor change handler — schedules an autosave ────────────
  const handleEditorChange = useCallback(
    (value: string) => {
      const path = activePathRef.current;
      if (!path) return;
      // Programmatic doc replacements (reload-from-disk, discard)
      // arrive here as ordinary onChange calls. If the payload equals
      // what we already hold, there is nothing to save — skipping
      // keeps a reload from scheduling a pointless autosave of the
      // content it just loaded.
      if (tabContentRef.current.get(path) === value) return;
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
      // Same debounce shape for the language-server mirror — the
      // last keystroke's `value` wins when the timer finally fires.
      const pendingLsp = lspSyncTimersRef.current.get(path);
      if (pendingLsp !== undefined) clearTimeout(pendingLsp);
      lspSyncTimersRef.current.set(
        path,
        setTimeout(() => syncLspDoc(path, value), LSP_SYNC_DEBOUNCE_MS),
      );
    },
    [flushSave, syncLspDoc],
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
      fileEolRef.current.set(path, detectFileEol(next));
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
    setExpandedFolders((prev) => {
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
    setSavedAt(0);
    setHideSavedAt(-Infinity);
    setCursor(null);
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

  // ─── Cursor tracking (status bar) ──────────────────────────────
  const [cursor, setCursor] = useState<{ line: number; col: number } | null>(
    null,
  );
  const handleCursorChange = useCallback((line: number, col: number) => {
    setCursor({ line, col });
  }, []);
  // Reset cursor on tab switch so the old position doesn't flash
  // before the new editor's first updateListener tick.
  useEffect(() => {
    setCursor(null);
  }, [activePath]);

  // ─── Terminal tabs ────────────────────────────────────────────
  // Per-(workspaceId, cwd) list of independent terminals. Each
  // entry owns its own PTY on mcp-server (keyed by
  // `${workspaceId}:${cwd}:${terminalId}`); refreshing the page
  // re-loads the list from localStorage so tabs survive.
  //
  // When `workspaceRoot` or `workspace.id` changes (folder close
  // + reopen, or switching folders) we re-load from localStorage
  // rather than carry over the previous folder's tab list — the
  // PTY key is workspace-bound.
  const [terminals, setTerminals] = useState<TerminalInstance[]>(() =>
    defaultInstances(),
  );
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(
    () => defaultInstances()[0]?.id ?? null,
  );
  const terminalsRef = useRef(terminals);
  useEffect(() => {
    terminalsRef.current = terminals;
  }, [terminals]);

  // Load the saved tab list when the workspace/cwd changes.
  useEffect(() => {
    if (!workspace?.id || !workspaceRoot) return;
    const loaded = loadInstances(workspace.id, workspaceRoot.path);
    setTerminals(loaded);
    setActiveTerminalId((cur) => {
      if (cur && loaded.some((t) => t.id === cur)) return cur;
      return loaded[0]?.id ?? null;
    });
  }, [workspace?.id, workspaceRoot?.path]);

  // Persist on every change.
  useEffect(() => {
    if (!workspace?.id || !workspaceRoot) return;
    saveInstances(workspace.id, workspaceRoot.path, terminals);
  }, [terminals, workspace?.id, workspaceRoot?.path]);

  const onAddTerminal = useCallback(() => {
    setTerminals((prev) => {
      // Use a base36 millisecond stamp — short, monotonic per session,
      // collision-free across rapid `[+]` clicks (Date.now() doesn't
      // repeat within a single render's microtask).
      const generated = `term-${Date.now().toString(36)}`;
      const next: TerminalInstance = {
        id: generated,
        label: `Term ${prev.length + 1}`,
        shellId: null,
      };
      setActiveTerminalId(generated);
      return [...prev, next];
    });
  }, []);

  const onCloseTerminal = useCallback(
    (id: string) => {
      if (!workspace?.id || !workspaceRoot) return;
      // Best-effort PTY kill — the shell may already be dead (user
      // typed Ctrl+C). We don't surface errors here; the panel's
      // normal `onExit` path handles already-dead shells.
      void devServerApi.stopTerminal({
        workspaceId: workspace.id,
        cwd: workspaceRoot.path,
        terminalId: id,
      });
      setTerminals((prev) => {
        const filtered = prev.filter((t) => t.id !== id);
        const next = filtered.length === 0 ? defaultInstances() : filtered;
        setActiveTerminalId((cur) => {
          if (cur !== id) return cur;
          return next[next.length - 1]?.id ?? null;
        });
        return next;
      });
      // Scrub scrollback so a future WS attach to this id (impossible
      // now since the record is gone) wouldn't restore stale output.
      deleteScrubbedTerminalScrollback(workspace.id, workspaceRoot.path, id);
    },
    [workspace?.id, workspaceRoot?.path],
  );

  // ─── Tree counts + language (status bar) ──────────────────────
  const treeCounts = useMemo(() => countNodes(tree ?? []), [tree]);
  const language = useMemo(
    () => (activePath ? languageLabel(activePath) : null),
    [activePath],
  );

  // Derive the active save state for the status bar.
  const activeSaving = activePath ? savingPaths.has(activePath) : false;
  const activePending = activePath ? pendingPaths.has(activePath) : false;
  const showSaved =
    !activeSaving && !activePending && savedAt > 0 && savedAt > hideSavedAt - SAVED_BADGE_VISIBLE_MS;
  // We re-check `savedAt > hideSavedAt` to actually gate the badge
  // once the 1.5s window closes.
  const showSavedNow = showSaved && Date.now() < hideSavedAt;
  const saveState: SaveState = activeSaving
    ? "saving"
    : activePending
      ? "pending"
      : showSavedNow
        ? "saved"
        : "idle";

  // ─── File watcher subscription ──────────────────────────────────
  // Subscribe once when the page loads (the context owns the
  // underlying chokidar handle). For every `change` event whose
  // path matches an open tab AND isn't in the "just wrote" filter,
  // queue a "file changed on disk" prompt — single-slot, so a
  // rapid-fire edit storm only shows one dialog at a time.
  useEffect(() => {
    if (!workspaceRoot) return;
    const unsub = subscribeToWatcher((event) => {
      // Any disk activity can move the git working tree — feed the
      // Source Control badge (coalesced inside scheduleGitRefresh).
      scheduleGitRefresh();
      if (event.kind !== "change") return;
      const path = event.path;
      // Only prompt if the user has the file open in a tab. Closed
      // tabs don't need confirmation (they get the fresh disk version
      // when re-opened anyway).
      const isOpen = openPathsRef.current.includes(path);
      if (!isOpen) return;
      // Don't interrupt an active dialog for a second file — the
      // second change is queued via state but the dialog is single.
      // (If a third changes, it overwrites the second silently — the
      // user can re-trigger via the menu. Acceptable.)
      setExternalChange((cur) => cur ?? { path });
    });
    return unsub;
  }, [workspaceRoot, subscribeToWatcher, scheduleGitRefresh]);

  // ─── External-change handlers ─────────────────────────────────
  // "Reload" — overwrite the editor doc with the disk version.
  const handleReloadFromDisk = useCallback(async () => {
    if (!externalChange) return;
    const path = externalChange.path;
    setExternalChange(null);
    cancelAutosave(path);
    try {
      const fresh = await readUserFile(path);
      const next = fresh ?? "";
      fileEolRef.current.set(path, detectFileEol(next));
      setTabContent((prev) => {
        const m = new Map(prev);
        m.set(path, next);
        return m;
      });
      const view = editorViewRef.current;
      if (view && activePathRef.current === path && view.state.doc.toString() !== next) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: next },
        });
      }
      toast.success(`Reloaded ${basename(path)} from disk`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, [externalChange, cancelAutosave, readUserFile]);

  // "Keep mine" — drop the dialog. The disk version is left alone.
  const handleKeepMine = useCallback(() => {
    setExternalChange(null);
  }, []);

  // ─── Unsaved dialog handlers ──────────────────────────────────
  // Save → flushSave, then close the tab via closeTabForced (which
  // skips the dirty check the unsaved dialog just satisfied).
  const handleUnsavedSave = useCallback(async () => {
    if (!unsavedDialog) return;
    const path = unsavedDialog.path;
    setUnsavedDialog(null);
    await flushSave(path);
    closeTabForced(path);
  }, [unsavedDialog, flushSave, closeTabForced]);

  // Discard → close without saving.
  const handleUnsavedDiscard = useCallback(() => {
    if (!unsavedDialog) return;
    const path = unsavedDialog.path;
    setUnsavedDialog(null);
    closeTabForced(path);
  }, [unsavedDialog, closeTabForced]);

  // Cancel → drop the dialog.
  const handleUnsavedCancel = useCallback(() => {
    setUnsavedDialog(null);
  }, []);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!event.metaKey && !event.ctrlKey) return;
      const key = event.key.toLowerCase();
      // Cmd/Ctrl + Shift + F → open the project search panel.
      if (key === "f" && event.shiftKey) {
        if (!workspaceRoot) return;
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      // Cmd/Ctrl + W → close the active tab.
      if (key === "w") {
        const path = activePathRef.current;
        if (!path) return;
        event.preventDefault();
        closeTabWithConfirm(path);
        return;
      }
      // Cmd/Ctrl + S → flush any pending autosave immediately.
      if (key === "s") {
        event.preventDefault();
        const path = activePathRef.current;
        if (!path) return;
        if (pendingPathsRef.current.has(path)) {
          void flushSave(path);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeTabWithConfirm, flushSave, workspaceRoot]);

  // ─── Render ───────────────────────────────────────────────────

  const hasFolder = workspaceRoot !== null;

  // Fullscreen overlay — keeps the Explorer sidebar visible (so the
  // user can keep navigating files) but hides the Lattice app chrome
  // (Navigation, top bar), page header, status bar, and terminal panel.
  // The editor column expands to fill the remaining viewport width.
  // Used by the zoom button next to "Open folder" and dismissible via
  // the same button, the explicit exit button, or the Esc key.
  //
  // Rendered via `createPortal` to `document.body` so its
  // `position: fixed` is anchored to the viewport, not to whatever
  // stacked-context the React route happens to live in. Without the
  // portal, a chain of ancestors (Lattice sidebar-wrapper → main →
  // padded route container) caused the fixed element to land ~16px
  // below the top edge, leaving a visible band of the AI Assistant
  // launcher and the Lattice top app bar uncovered.
  //
  // Gated on `hasFolder` only — if the user closes the active tab
  // while in fullscreen, the EditorArea renders its own "No file
  // open" hint, so we don't need to bounce out of fullscreen just
  // because the active file changed.
  if (editorFullscreen && hasFolder) {
    const overlay = (
      <div
        // `fixed inset-0` covers the whole viewport, z-[60] to sit
        // above the Lattice page chrome (sidebar + top app bar) and
        // the AI Assistant launcher (z-40). `bg-card` matches the
        // IDE frame so the jump into fullscreen isn't a colour
        // flash. Deliberately NOT `w-screen h-screen`: `100vw/100vh`
        // include the classic (layout-reserving) scrollbar, so on a
        // machine with visible scrollbars the overlay lands ~17px
        // wider than the layout viewport and grows a page-level
        // horizontal scrollbar. Percentages on a fixed element
        // resolve against the viewport minus scrollbars — same
        // belt-and-braces as `inset-0`, without the overflow.
        className="fixed inset-0 z-[60] flex h-full w-full flex-col overflow-hidden bg-card"
        role="dialog"
        aria-modal="true"
        aria-label="Fullscreen editor"
      >
        <header className="flex h-9 shrink-0 items-center justify-between gap-1.5 border-b border-border bg-muted/30 px-3">
          <div className="flex items-center gap-1 truncate font-mono text-xs text-muted-foreground">
            <span className="truncate text-foreground/80">
              {workspaceRoot?.name ?? "Workspace"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
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
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSearchOpen(true)}
              disabled={!workspaceRoot}
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              aria-label="Search in project"
              title="Search in project (Cmd/Ctrl+Shift+F)"
            >
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
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
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleEditorFullscreen}
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              aria-label="Exit fullscreen"
              aria-pressed={editorFullscreen}
              title="Exit fullscreen (Esc)"
            >
              <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <WorkspaceSidebar
            sidebarTab={sidebarTab}
            setSidebarTab={setSidebarTab}
            sidebarWidth={sidebarWidth}
            onSidebarWidthChange={setSidebarWidth}
            activityBarItems={activityBarItems}
            installedExtensions={installedExtensions}
            tree={tree ?? null}
            expandedFolders={expandedFolders}
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
            treeLoading={Boolean(workspaceRoot && !tree)}
            onOpenProblem={openSearchResult}
            workspaceId={workspace?.id ?? null}
            workspaceRootPath={workspaceRoot?.path ?? null}
            onGitStatusCount={setGitChangedCount}
            gitRefreshSignal={gitRefreshTick}
          />
          <section
            ref={ideContainerRef}
            className="flex min-w-0 flex-1 flex-col"
          >
            {/* Maximizing the dock folds the editor chrome away —
                breadcrumb + tab strip unmount (stateless), the
                CodeMirror wrapper stays mounted but `hidden` so the
                doc, undo stack and cursor survive the toggle. */}
            {!terminalMaximized && (
              <WorkspaceBreadcrumb
                folderName={workspaceRoot?.name ?? null}
                activePath={activePath}
                onJumpToSegment={(path) => {
                  if (!path) {
                    if (activePath) closeTabWithConfirm(activePath);
                    return;
                  }
                  if (activePath) closeTabWithConfirm(activePath);
                }}
              />
            )}
            {!terminalMaximized && (
              <EditorTabs
                openPaths={openPaths}
                activePath={activePath}
                pendingPaths={pendingPaths}
                savingPaths={savingPaths}
                onFocusTab={focusTab}
                onCloseTab={closeTabWithConfirm}
              />
            )}
            <div
              className={
                terminalMaximized
                  ? "hidden"
                  : "flex min-h-0 flex-1 flex-col overflow-hidden"
              }
            >
              <EditorArea
                activePath={activePath}
                content={activePath ? tabContent.get(activePath) ?? "" : ""}
                hasFolder={hasFolder}
                diagnostics={activePath ? lspDiagnostics[activePath] ?? [] : []}
                onChange={handleEditorChange}
                onCreateEditor={handleEditorView}
                onCursorChange={handleCursorChange}
              />
            </div>
            {/* Terminal stays mounted across fullscreen entry / exit so
                each PTY survives — the dock owns tabs, panels and the
                resize sash. All tab instances render (inactive ones
                are CSS-hidden) — same pattern as the normal layout. */}
            <TerminalDock
              workspaceId={workspace!.id}
              cwd={workspaceRoot!.path}
              terminals={terminals}
              activeTerminalId={activeTerminalId}
              onFocusTerminal={setActiveTerminalId}
              onAddTerminal={onAddTerminal}
              onCloseTerminal={onCloseTerminal}
              height={terminalHeight}
              onHeightChange={setTerminalHeight}
              maximized={terminalMaximized}
              onToggleMaximize={toggleTerminalMaximized}
              collapsed={terminalCollapsed}
              onCollapsedChange={handleTerminalCollapsedChange}
              containerRef={ideContainerRef}
            />
          </section>
        </div>
      </div>
    );
    // SSR guard — `createPortal` needs a real DOM node. During the
    // first render (or in a test environment without `document`)
    // we fall back to rendering inline. The page is client-only
    // anyway, so this branch is hit at most once on hydration.
    if (typeof document !== "undefined") {
      return createPortal(overlay, document.body);
    }
    return overlay;
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-muted text-primary"
          >
            <FolderTree className="h-4 w-4" />
          </span>
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
        <p className="text-sm text-muted-foreground">
          {t(
            "issueTracker.workspace.subtitle",
            "Open a folder and edit files like VS Code. Changes autosave to disk.",
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-1.5">
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
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSearchOpen(true)}
          disabled={!workspaceRoot}
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          aria-label="Search in project"
          title="Search in project (Cmd/Ctrl+Shift+F)"
        >
          <Search className="h-3.5 w-3.5" aria-hidden="true" />
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
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleEditorFullscreen}
          disabled={!hasFolder}
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          aria-label={editorFullscreen ? "Exit fullscreen" : "Maximize editor"}
          aria-pressed={editorFullscreen}
          title={
            editorFullscreen
              ? "Exit fullscreen (Esc)"
              : "Maximize editor (fullscreen)"
          }
        >
          {editorFullscreen ? (
            <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </Button>
      </div>

      <div
        ref={ideContainerRef}
        className="-mx-4 sm:-mx-6 flex h-[calc(100vh-220px)] min-h-[520px] flex-col overflow-hidden rounded-lg border border-border bg-card"
      >
        {/* Maximize folds this whole column away — `hidden`, not
            unmount (the CodeMirror doc, undo stack and open tabs all
            survive). The column itself must hide, not just the row
            inside it: an empty flex-1 container would still claim
            half the card and the dock would only fill the rest. */}
        <div
          className={
            terminalMaximized
              ? "hidden"
              : "flex min-h-0 flex-1 flex-col"
          }
        >
          <div className="flex min-h-0 flex-1">
            <WorkspaceSidebar
              sidebarTab={sidebarTab}
              setSidebarTab={setSidebarTab}
              sidebarWidth={sidebarWidth}
              onSidebarWidthChange={setSidebarWidth}
              activityBarItems={activityBarItems}
              installedExtensions={installedExtensions}
              tree={tree ?? null}
              expandedFolders={expandedFolders}
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
              treeLoading={Boolean(workspaceRoot && !tree)}
              onOpenProblem={openSearchResult}
              workspaceId={workspace?.id ?? null}
              workspaceRootPath={workspaceRoot?.path ?? null}
              onGitStatusCount={setGitChangedCount}
              gitRefreshSignal={gitRefreshTick}
            />

            <section className="flex min-w-0 flex-1 flex-col">
              {hasFolder && (
                <WorkspaceBreadcrumb
                  folderName={workspaceRoot?.name ?? null}
                  activePath={activePath}
                  onJumpToSegment={(path) => {
                    if (!path) {
                      // Folder root click → drop the active tab so
                      // the right column collapses to its
                      // "no file open" hint.
                      if (activePath) closeTabWithConfirm(activePath);
                      return;
                    }
                    // Segment click on a parent dir — VS Code's
                    // behaviour is "collapse the active tab and
                    // focus the parent" but the Explorer only
                    // supports file clicks, so the simplest honest
                    // behaviour is to drop the tab and let the
                    // user open a sibling from the tree.
                    if (activePath) closeTabWithConfirm(activePath);
                  }}
                />
              )}
              <EditorTabs
                openPaths={openPaths}
                activePath={activePath}
                pendingPaths={pendingPaths}
                savingPaths={savingPaths}
                onFocusTab={focusTab}
                onCloseTab={closeTabWithConfirm}
              />
              {hasFolder ? (
                <EditorArea
                  activePath={activePath}
                  content={activePath ? tabContent.get(activePath) ?? "" : ""}
                  hasFolder={hasFolder}
                  diagnostics={activePath ? lspDiagnostics[activePath] ?? [] : []}
                  onChange={handleEditorChange}
                  onCreateEditor={handleEditorView}
                  onCursorChange={handleCursorChange}
                />
              ) : (
                <WorkspaceEmptyState
                  onOpenFolder={() => void onOpenFolder()}
                  onTypePath={startTypePath}
                />
              )}
            </section>
          </div>
        </div>

        {hasFolder && workspaceRoot && workspace?.id && (
          <TerminalDock
            workspaceId={workspace.id}
            cwd={workspaceRoot.path}
            terminals={terminals}
            activeTerminalId={activeTerminalId}
            onFocusTerminal={setActiveTerminalId}
            onAddTerminal={onAddTerminal}
            onCloseTerminal={onCloseTerminal}
            height={terminalHeight}
            onHeightChange={setTerminalHeight}
            maximized={terminalMaximized}
            onToggleMaximize={toggleTerminalMaximized}
            collapsed={terminalCollapsed}
            onCollapsedChange={handleTerminalCollapsedChange}
            containerRef={ideContainerRef}
          />
        )}
      </div>

      <WorkspaceStatusBar
        cursor={cursor}
        language={language}
        saveState={saveState}
        lastSavedAt={savedAt > 0 ? savedAt : null}
        fileCount={treeCounts.files}
        folderCount={treeCounts.dirs}
        problemsCount={problems.length + lspProblemCount}
        onShowProblems={() => setSidebarTab("problems")}
      />

      {/* Hidden filename indicator so screen readers can announce the
          active tab. Keeps the visual UI clean. */}
      <span className="sr-only" aria-live="polite">
        {activePath ? basename(activePath) : ""}
      </span>
      {!watcherOnline && workspaceRoot && (
        <span className="sr-only" aria-live="polite">
          File watcher is offline. External edits won't be detected.
        </span>
      )}

      {/* Project-wide search panel (Cmd/Ctrl+Shift+F). */}
      <SearchPanel
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onOpenResult={openSearchResult}
      />

      {/* Unsaved-changes confirmation. */}
      <UnsavedConfirmDialog
        open={unsavedDialog !== null}
        path={unsavedDialog?.path ?? ""}
        onSave={() => void handleUnsavedSave()}
        onDiscard={handleUnsavedDiscard}
        onCancel={handleUnsavedCancel}
      />

      {/* External-change prompt — fires when the watcher reports a
          `change` for an open tab's path. */}
      <ExternalChangeDialog
        open={externalChange !== null}
        path={externalChange?.path ?? ""}
        onReload={() => void handleReloadFromDisk()}
        onKeepMine={handleKeepMine}
      />
    </div>
  );
}

// ─── WorkspaceSidebar ──────────────────────────────────────────────────
//
// VS Code-style sidebar: a vertical activity bar (icon strip) plus the
// currently-selected panel (Explorer / Extensions / extension-contributed
// panel). Both render branches of `WorkspacePage` use this so the
// sidebar stays in sync regardless of fullscreen mode.
//
// `sidebarTab` ids:
//   • `"explorer"`    → <ExplorerSidebar />
//   • `"extensions"`  → <ExtensionsManagerPanel />
//   • `"ext:<extId>:<panelId>"` → <ExtensionIframeView />
//
// Anything else falls back to `"explorer"` (covers the case where an
// extension was disabled while its tab was active).

interface WorkspaceSidebarProps {
  sidebarTab: string;
  setSidebarTab: (id: string) => void;
  /** Pixel width of the panel column (activity bar excluded). */
  sidebarWidth: number;
  /** Live width updates while the sash is being dragged. */
  onSidebarWidthChange: (width: number) => void;
  activityBarItems: ActivityBarItem[];
  installedExtensions: import("@/lib/extensions/types").InstalledExtension[];
  // All the props <ExplorerSidebar> needs (lifted from WorkspacePage).
  tree: ReturnType<typeof useDevServer>["tree"];
  expandedFolders: Set<string>;
  activePath: string | null;
  renamingPath: string | null;
  renameError: string | null;
  creatingSubfolderPath: string | null;
  subfolderCreateError: string | null;
  creatingFilePath: string | null;
  createFileError: string | null;
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
  onStartCreateSubfolder: (path: string) => void;
  onCommitCreateSubfolder: (parent: string, name: string) => void;
  onCancelCreateSubfolder: () => void;
  onStartCreateFileInFolder: (path: string) => void;
  onCommitCreateFileInFolder: (parent: string, name: string) => void;
  onCancelCreateFile: () => void;
  onStartDelete: (path: string) => void;
  onCancelDelete: () => void;
  onCommitDelete: (path: string) => void;
  onRefresh: () => void;
  rootFolderName: string | null;
  treeLoading: boolean;
  /** Click-to-source for a Problems row (1-indexed line/column). */
  onOpenProblem: (path: string, line: number, column: number) => void;
  /** Source Control panel identity — null until the workspace
   *  scaffold is ready, in which case the git tab renders nothing. */
  workspaceId: string | null;
  workspaceRootPath: string | null;
  /** Lifts the changed-file count for the activity-bar badge. */
  onGitStatusCount: (count: number) => void;
  /** Bumped (throttled) whenever the file watcher or an autosave
   *  moves the working tree. */
  gitRefreshSignal: number;
}

function WorkspaceSidebar(props: WorkspaceSidebarProps) {
  const {
    sidebarTab,
    setSidebarTab,
    sidebarWidth,
    onSidebarWidthChange,
    activityBarItems,
    installedExtensions,
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
    onOpenProblem,
    workspaceId,
    workspaceRootPath,
    onGitStatusCount,
    gitRefreshSignal,
  } = props;

  // Resolve the active panel content. If the tab references an
  // extension that's no longer enabled, fall back to Explorer.
  let effectiveTab = sidebarTab;
  if (sidebarTab.startsWith("ext:")) {
    const [, extId, panelId] = sidebarTab.split(":");
    const ext = installedExtensions.find((e) => e.id === extId);
    if (!ext || !ext.enabled) {
      effectiveTab = "explorer";
    } else if (
      panelId &&
      !ext.manifest.contributes?.panels?.some((p) => p.id === panelId)
    ) {
      effectiveTab = "explorer";
    }
  }

  // ─── Drag-to-resize sash (VS Code-style side bar) ──────────────
  // Pointer-capture based: `setPointerCapture` on pointerdown routes
  // every subsequent pointermove to the sash even when the cursor
  // crosses into the editor column or an extension iframe (which
  // would otherwise swallow the events and stall the drag).
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{
    startX: number;
    startWidth: number;
    width: number;
  } | null>(null);

  const handleResizeStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    resizeRef.current = {
      startX: e.clientX,
      startWidth: sidebarWidth,
      width: sidebarWidth,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsResizing(true);
    // Keep the resize cursor + stop text selection while dragging
    // outside the sash's own bounds.
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const handleResizeMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = resizeRef.current;
    if (!s) return;
    const next = clampSidebarWidth(s.startWidth + (e.clientX - s.startX));
    s.width = next;
    onSidebarWidthChange(next);
  };

  const endResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = resizeRef.current;
    if (!s) return;
    resizeRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
    setIsResizing(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    // Save the ref value, not the `sidebarWidth` prop — the prop can
    // be one render behind the final pointermove.
    saveSidebarWidth(s.width);
  };

  const resetResize = () => {
    onSidebarWidthChange(SIDEBAR_WIDTH_DEFAULT);
    saveSidebarWidth(SIDEBAR_WIDTH_DEFAULT);
  };

  return (
    <aside className="flex min-h-0">
      <SidebarActivityBar
        items={activityBarItems}
        activeId={effectiveTab}
        onSelect={setSidebarTab}
      />
      <div
        className="relative flex shrink-0 flex-col border-r border-border bg-muted/30"
        style={{ width: sidebarWidth }}
      >
        {/* Resize sash — invisible 8px hit area over the border,
            lights up on hover/drag like VS Code's sash. Double-click
            snaps back to the default width. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          title="Drag to resize · double-click to reset"
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          onDoubleClick={resetResize}
          className={`absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:rounded-full after:content-[''] ${
            isResizing
              ? "after:bg-primary/70"
              : "after:bg-transparent hover:after:bg-primary/40"
          }`}
        />
        {effectiveTab === "explorer" && (
          <ExplorerSidebar
            tree={tree}
            expandedFolders={expandedFolders}
            activePath={activePath}
            renamingPath={renamingPath}
            renameError={renameError}
            creatingSubfolderPath={creatingSubfolderPath}
            subfolderCreateError={subfolderCreateError}
            creatingFilePath={creatingFilePath}
            createFileError={createFileError}
            confirmingDeletePath={confirmingDeletePath}
            onToggleOpen={onToggleOpen}
            onOpenFile={onOpenFile}
            onStartCreateRootFile={onStartCreateRootFile}
            onStartCreateRootFolder={onStartCreateRootFolder}
            onCommitCreateRootFile={onCommitCreateRootFile}
            onCancelCreateRootFile={onCancelCreateRootFile}
            onCommitCreateRootFolder={onCommitCreateRootFolder}
            onCancelCreateRootFolder={onCancelCreateRootFolder}
            onStartRenameFile={onStartRenameFile}
            onCancelRename={onCancelRename}
            onCommitRenameFile={onCommitRenameFile}
            onStartCreateSubfolder={onStartCreateSubfolder}
            onCommitCreateSubfolder={onCommitCreateSubfolder}
            onCancelCreateSubfolder={onCancelCreateSubfolder}
            onStartCreateFileInFolder={onStartCreateFileInFolder}
            onCommitCreateFileInFolder={onCommitCreateFileInFolder}
            onCancelCreateFile={onCancelCreateFile}
            onStartDelete={onStartDelete}
            onCancelDelete={onCancelDelete}
            onCommitDelete={onCommitDelete}
            onRefresh={onRefresh}
            rootFolderName={rootFolderName}
            treeLoading={treeLoading}
          />
        )}
        {effectiveTab === "problems" && (
          <ProblemsPanel onOpen={onOpenProblem} />
        )}
        {effectiveTab === "git" && workspaceId && workspaceRootPath && (
          <GitPanel
            workspaceId={workspaceId}
            root={workspaceRootPath}
            onOpenFile={onOpenFile}
            onStatusCountChange={onGitStatusCount}
            refreshSignal={gitRefreshSignal}
          />
        )}
        {effectiveTab === "extensions" && <ExtensionsManagerPanel />}
        {effectiveTab.startsWith("ext:") && (
          <ExtensionPanelContent
            sidebarTab={effectiveTab}
            installedExtensions={installedExtensions}
          />
        )}
      </div>
    </aside>
  );
}

// ─── Terminal dock (tabs + panels + resize sash) ────────────────
// Shared by both render branches (normal IDE + editor fullscreen).
// Owns the horizontal resize sash on the dock's top edge — same
// pointer-capture pattern as the sidebar's sash, but `row`
// orientation: dragging UP grows the dock. The height persists per
// browser alongside the sidebar width. Maximize flips the
// surrounding layout (the parent hides the editor rows); collapse
// lives inside TerminalPanel and is mirrored up via
// `onCollapsedChange` so the sash can hide itself while there is
// nothing to drag.
interface TerminalDockProps {
  workspaceId: string;
  cwd: string;
  terminals: TerminalInstance[];
  activeTerminalId: string | null;
  onFocusTerminal: (id: string) => void;
  onAddTerminal: () => void;
  onCloseTerminal: (id: string) => void;
  /** Resizable dock height in pixels (persisted by the parent). */
  height: number;
  onHeightChange: (height: number) => void;
  maximized: boolean;
  onToggleMaximize: () => void;
  /** Mirror of the active panel's collapsed state — hides the sash. */
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** Bounded IDE container — source of the drag clamp. Structural
   *  ref type so it accepts either React 18 `MutableRefObject` or
   *  React 19 `RefObject` from the parent's `useRef` call. */
  containerRef: { current: HTMLDivElement | null };
}

function TerminalDock({
  workspaceId,
  cwd,
  terminals,
  activeTerminalId,
  onFocusTerminal,
  onAddTerminal,
  onCloseTerminal,
  height,
  onHeightChange,
  maximized,
  onToggleMaximize,
  collapsed,
  onCollapsedChange,
  containerRef,
}: TerminalDockProps) {
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{
    startY: number;
    startHeight: number;
    height: number;
    maxHeight: number;
  } | null>(null);

  const handleResizeStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // Clamp against the live container so the dock can't push the
    // editor fully off-screen on a small window. Falls back to the
    // absolute max when the ref hasn't attached yet.
    const containerH = containerRef.current?.clientHeight ?? 0;
    const maxHeight =
      containerH > 0
        ? containerH - TERMINAL_RESERVE_PX
        : TERMINAL_HEIGHT_MAX;
    resizeRef.current = {
      startY: e.clientY,
      startHeight: height,
      height,
      maxHeight,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsResizing(true);
    // Keep the resize cursor + stop text selection while dragging
    // outside the sash's own bounds.
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  };

  const handleResizeMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = resizeRef.current;
    if (!s) return;
    // Bottom-docked: dragging up (clientY shrinks) grows the panel,
    // mirroring VS Code's panel sash.
    const next = clampTerminalHeight(
      s.startHeight + (s.startY - e.clientY),
      s.maxHeight,
    );
    s.height = next;
    onHeightChange(next);
  };

  const endResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = resizeRef.current;
    if (!s) return;
    resizeRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
    setIsResizing(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    // Save the ref value, not the `height` prop — the prop can be
    // one render behind the final pointermove (same as the sidebar).
    saveTerminalHeight(s.height);
  };

  const resetResize = () => {
    onHeightChange(TERMINAL_HEIGHT_DEFAULT);
    saveTerminalHeight(TERMINAL_HEIGHT_DEFAULT);
  };

  return (
    // `relative` anchors the sash; `shrink-0` keeps the natural-height
    // dock from flex-shrinking in the parent column (the editor row's
    // `flex-1 min-h-0` absorbs all size changes instead). Maximized:
    // the dock becomes the flex remainder — the parent hides the
    // editor rows to open the slot up.
    <div
      className={`relative ${
        maximized ? "flex min-h-0 flex-1 flex-col" : "shrink-0"
      }`}
    >
      {/* No sash while maximized (restore first, like VS Code) or
          collapsed (a 32px header has nothing to resize). */}
      {!maximized && !collapsed && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize terminal"
          title="Drag to resize · double-click to reset"
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          onDoubleClick={resetResize}
          className={`absolute inset-x-0 -top-1 z-20 h-2 cursor-row-resize touch-none before:absolute before:inset-x-0 before:top-1/2 before:h-0.5 before:-translate-y-1/2 before:rounded-full before:content-[''] ${
            isResizing
              ? "before:bg-primary/70"
              : "before:bg-transparent hover:before:bg-primary/40"
          }`}
        />
      )}
      <TerminalTabs
        terminals={terminals}
        activeId={activeTerminalId}
        onFocus={onFocusTerminal}
        onAdd={onAddTerminal}
        onClose={onCloseTerminal}
      />
      {terminals.map((t) => {
        const isActive = t.id === activeTerminalId;
        return (
          // Inactive tabs use `visibility: hidden` (not
          // `display: none`) so xterm's CharSizeService keeps valid
          // dimensions — a hidden-via-display-none panel throws
          // "Cannot read properties of undefined (reading
          // 'dimensions')" from Viewport.syncScrollArea on every
          // output frame. `visibility: hidden` + `position: absolute`
          // keeps the panel in the DOM and laid out but out of the
          // document flow, so the active panel sits at its natural
          // position.
          <div
            key={t.id}
            aria-hidden={!isActive}
            className={
              isActive && maximized ? "flex min-h-0 flex-1 flex-col" : undefined
            }
            style={
              isActive
                ? undefined
                : {
                    visibility: "hidden",
                    position: "absolute",
                    inset: "0 0 0 0",
                    pointerEvents: "none",
                  }
            }
          >
            <TerminalPanel
              workspaceId={workspaceId}
              cwd={cwd}
              terminalId={t.id}
              shellIdOverride={t.shellId}
              height={height}
              maximized={maximized}
              resizing={isResizing}
              onToggleMaximize={isActive ? onToggleMaximize : undefined}
              onCollapsedChange={onCollapsedChange}
            />
          </div>
        );
      })}
    </div>
  );
}

function ExtensionPanelContent({
  sidebarTab,
  installedExtensions,
}: {
  sidebarTab: string;
  installedExtensions: import("@/lib/extensions/types").InstalledExtension[];
}) {
  const [, extId, panelId] = sidebarTab.split(":");
  const ext = installedExtensions.find((e) => e.id === extId);
  if (!ext) return null;
  return <ExtensionIframeView extension={ext} panelId={panelId} />;
}
