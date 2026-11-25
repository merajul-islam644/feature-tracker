// UI-only state for the Tests-tab workbench (VS Code layout).
//
// Data state (workspace files, run outcomes, base URL) lives in
// useTestWorkspace; everything the workbench chrome needs -- which
// sidebar view is showing, which tabs are open, which folders are
// expanded -- lives here, mirroring the app's other useSyncExternalStore
// domain stores. The editor session (open tabs, active file, expanded
// folders) persists per project in localStorage, so a refresh reopens
// exactly the files that were open -- like VS Code restoring a workspace.

import { useSyncExternalStore } from "react";

export type SidebarView = "explorer" | "search" | "scm" | "run" | "problems" | "ai";
export type PanelTab = "output" | "results" | "terminal" | "preview";
/** One AI-proposed file change awaiting the user's Accept/Reject. The
 *  proposal holds the FULL proposed content — the editor renders it as
 *  a diff against the current content. */
export type AiProposal = { path: string; content: string; summary: string };
export type PaletteMode = "commands" | "files";

/** Sidebar width bounds, matching VS Code's clamped sash drag. */
export const SIDEBAR_MIN_WIDTH = 190;
export const SIDEBAR_MAX_WIDTH = 720;
/** Right zone (AI chat column) width bounds for its sash drag. */
export const AI_RIGHT_MIN_WIDTH = 240;
export const AI_RIGHT_MAX_WIDTH = 760;

export type WorkbenchState = {
  sidebarView: SidebarView;
  sidebarVisible: boolean;
  /** Sidebar width in px while visible (dragged via the sash). */
  sidebarWidth: number;
  /** Width to return to after a minimize (last non-minimum size). */
  sidebarExpandedWidth: number;
  panelVisible: boolean;
  panelTab: PanelTab;
  /** Panel stretched tall (VS Code's maximize). */
  panelMaximized: boolean;
  /** GLOBAL AI panel — independent of sidebarView: once opened it stays
   *  visible across every sidebar view switch until the user closes it. */
  aiPanelVisible: boolean;
  /** ZEN — the whole workbench fills the viewport (fixed overlay above
   *  the app chrome), VS Code full-screen style. */
  zenMode: boolean;
  /** Right zone width — hosts the AI chat beside the editor. */
  aiRightWidth: number;
  openTabs: string[];
  /** Path shown in the editor; "" when nothing is open (watermark). */
  activePath: string;
  /** Open tabs currently rendered as a diff editor (opened from the
   *  Source Control changes list, VS Code-style). Never persisted: a
   *  refresh reloads from disk, so nothing is dirty -- and a diff of
   *  nothing is meaningless. */
  diffTabs: string[];
  /** Folder paths currently expanded in the explorer. */
  expanded: string[];
  /** Open command palette mode, or null when closed. */
  palette: PaletteMode | null;
  /** AI-proposed file changes awaiting Accept/Reject (reviewed in
   *  order — the editor shows proposals[0] as a diff). */
  aiProposals: AiProposal[];
};

let state: WorkbenchState = {
  sidebarView: "explorer",
  sidebarVisible: true,
  sidebarWidth: 264,
  sidebarExpandedWidth: 264,
  panelVisible: false,
  panelTab: "output",
  panelMaximized: false,
  aiPanelVisible: false,
  zenMode: false,
  aiRightWidth: 360,
  openTabs: [],
  activePath: "",
  diffTabs: [],
  expanded: [],
  palette: null,
  aiProposals: []
};

// --- Per-project session persistence -------------------------------------
// The saved record is exactly what a refresh needs to rebuild the
// editor: which tabs were open, which one was active, which folders
// were expanded. Keyed by project so two projects keep their own
// sessions (same pattern as the terminal's scrollback keys).
const SESSION_STORAGE_KEY = "wb-workbench-session.v1";
/** Project the store is currently bound to (null until Workbench mounts). */
let sessionKey: string | null = null;
/** Set right before an import: the next session reset must use the
 *  workspace defaults, not the saved record (its paths just changed). */
let freshSessionNext = false;

function persistSession(): void {
  if (!sessionKey) return;
  try {
    localStorage.setItem(
      `${SESSION_STORAGE_KEY}:${sessionKey}`,
      JSON.stringify({
        // The active sidebar view + visibility ride along: a refresh must
        // land back in Source Control if that's where the user was, not
        // default to Explorer (VS Code restores the view per workspace).
        sidebarView: state.sidebarView,
        sidebarVisible: state.sidebarVisible,
        openTabs: state.openTabs,
        activePath: state.activePath,
        expanded: state.expanded,
        sidebarWidth: state.sidebarWidth,
        sidebarExpandedWidth: state.sidebarExpandedWidth,
        // The bottom panel's chrome too — a refresh must reopen the
        // terminal where the user left it, not collapse the panel and
        // pretend no shell was ever on screen (the PTYs survive; only
        // this UI state was being dropped).
        panelVisible: state.panelVisible,
        panelTab: state.panelTab,
        panelMaximized: state.panelMaximized,
        aiPanelVisible: state.aiPanelVisible,
        zenMode: state.zenMode,
        aiRightWidth: state.aiRightWidth
      })
    );
  } catch {
    /* quota / private mode — best effort */
  }
}

/** Only these fields survive a reload; skip writes for pure chrome changes. */
const SESSION_FIELDS: (keyof WorkbenchState)[] = [
  "sidebarView",
  "sidebarVisible",
  "openTabs",
  "activePath",
  "expanded",
  "sidebarWidth",
  "sidebarExpandedWidth",
  "panelVisible",
  "panelTab",
  "panelMaximized",
  "aiPanelVisible",
  "zenMode",
  "aiRightWidth"
];

function clampWidth(width: number): number {
  return Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)));
}

function clampAiRightWidth(width: number): number {
  return Math.round(Math.min(AI_RIGHT_MAX_WIDTH, Math.max(AI_RIGHT_MIN_WIDTH, width)));
}

const listeners = new Set<() => void>();

function set(patch: Partial<WorkbenchState>, options?: { persist?: boolean }): void {
  const prev = state;
  state = { ...state, ...patch };
  const touchesSession = SESSION_FIELDS.some((field) => patch[field] !== undefined && patch[field] !== prev[field]);
  // persist:false marks a load, not a user edit — writing the loaded
  // record back would clobber it with an equivalent-but-new copy.
  if (touchesSession && options?.persist !== false) persistSession();
  for (const listener of listeners) listener();
}


/** Proposal persistence — full page reloads must not lose pending AI
 *  proposals (keyed per project like every other workbench state). */
const AI_PROPOSALS_KEY = "wb-ai-proposals.v1:";
/** The project the proposal cache currently belongs to (set by bindProject). */
let aiProposalsProject = "";
function loadAiProposals(projectId: string): AiProposal[] {
  try {
    const raw = localStorage.getItem(AI_PROPOSALS_KEY + projectId);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AiProposal[]) : [];
  } catch {
    return [];
  }
}
function saveAiProposals(projectId: string, proposals: AiProposal[]): void {
  try {
    localStorage.setItem(AI_PROPOSALS_KEY + projectId, JSON.stringify(proposals));
  } catch {
    /* quota — in-memory only */
  }
}

export const workbenchStore = {
  getState: (): WorkbenchState => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** The activity bar's AI icon: toggles the GLOBAL AI panel — it never
   *  touches sidebarView, so browsing other sidebar views never closes
   *  the chat. Only the user's explicit close does. */
  setSidebarView(view: SidebarView): void {
    if (view === "ai") {
      set({ aiPanelVisible: !state.aiPanelVisible });
      return;
    }
    if (state.sidebarView === view && state.sidebarVisible) set({ sidebarVisible: false });
    else set({ sidebarView: view, sidebarVisible: true });
  },
  /** The AI panel's own close button (and any programmatic close). */
  setAiPanelVisible(visible: boolean): void {
    set({ aiPanelVisible: visible });
  },
  toggleSidebar(): void {
    set({ sidebarVisible: !state.sidebarVisible });
  },
  /** Live resize from the sash: dragging past the minimum also raises
   *  the remembered expand size, so release restores what was last used. */
  setSidebarWidth(width: number): void {
    const sidebarWidth = clampWidth(width);
    if (sidebarWidth > SIDEBAR_MIN_WIDTH) set({ sidebarWidth, sidebarExpandedWidth: sidebarWidth });
    else set({ sidebarWidth });
  },
  /** Sash minimize: shrink to the minimum, keeping the old size for expand. */
  minimizeSidebar(): void {
    set({ sidebarExpandedWidth: clampWidth(state.sidebarWidth), sidebarWidth: SIDEBAR_MIN_WIDTH });
  },
  /** Sash expand: return to the remembered pre-minimize size. */
  restoreSidebar(): void {
    set({ sidebarWidth: clampWidth(state.sidebarExpandedWidth) });
  },
  /** Sash ‹ arrow: stretch to the widest the frame allows. */
  maximizeSidebar(max: number): void {
    const sidebarWidth = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(max)));
    set({ sidebarWidth, sidebarExpandedWidth: sidebarWidth });
  },
  togglePanel(): void {
    set({ panelVisible: !state.panelVisible });
  },
  togglePanelMaximize(): void {
    set({ panelMaximized: !state.panelMaximized });
  },
  /** ZEN: the whole workbench fills the viewport (fixed overlay above
   *  the app chrome). Escape also exits (the Workbench wires it). */
  toggleZen(): void {
    set({ zenMode: !state.zenMode });
  },
  setZenMode(zen: boolean): void {
    set({ zenMode: zen });
  },
  /** Zone sash (the editor ↔ AI boundary): resizes the AI column. */
  setAiRightWidth(width: number): void {
    set({ aiRightWidth: clampAiRightWidth(width) });
  },
  /** Open the bottom panel on a specific tab (used after a run). */
  showPanel(tab: PanelTab): void {
    set({ panelVisible: true, panelTab: tab });
  },
  setPanelTab(tab: PanelTab): void {
    set({ panelTab: tab });
  },
  /** Queue one AI-proposed file change (reviewed first-in-first-out). */
  pushAiProposal(proposal: AiProposal): void {
    const next = [...state.aiProposals, proposal];
    set({ aiProposals: next });
    saveAiProposals(aiProposalsProject, next);
  },
  /** Remove the front proposal after the user accepted or rejected it. */
  shiftAiProposal(): void {
    const next = state.aiProposals.slice(1);
    set({ aiProposals: next });
    saveAiProposals(aiProposalsProject, next);
  },
  /** Clear every pending proposal (Accept all / Reject all). */
  clearAiProposals(): void {
    set({ aiProposals: [] });
    saveAiProposals(aiProposalsProject, []);
  },

  openTab(path: string): void {
    const openTabs = state.openTabs.includes(path) ? state.openTabs : [...state.openTabs, path];
    set({ openTabs, activePath: path });
  },
  /** Open a path as a diff editor (saved-on-disk ↔ current edits), the
   *  way VS Code opens a file from the SCM changes list. */
  openDiff(path: string): void {
    const openTabs = state.openTabs.includes(path) ? state.openTabs : [...state.openTabs, path];
    const diffTabs = state.diffTabs.includes(path) ? state.diffTabs : [...state.diffTabs, path];
    set({ openTabs, activePath: path, diffTabs });
  },
  /** Leave diff view for a path; the tab stays open as a plain editor. */
  exitDiff(path: string): void {
    if (!state.diffTabs.includes(path)) return;
    set({ diffTabs: state.diffTabs.filter((entry) => entry !== path) });
  },
  /** Bind the store to a project and preload its saved editor session.
   *  Tabs pointing at files that no longer exist are pruned by the
   *  workspace once its file list arrives. */
  bindProject(projectId: string): void {
    aiProposalsProject = projectId || "default";
    set({ aiProposals: loadAiProposals(aiProposalsProject) });
    const key = projectId || "default";
    if (sessionKey === key) return;
    sessionKey = key;
    let saved: Partial<WorkbenchState> | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(`${SESSION_STORAGE_KEY}:${key}`) ?? "null") as Partial<WorkbenchState> | null;
    } catch {
      saved = null;
    }
    set({
      sidebarView:
        saved?.sidebarView === "explorer" || saved?.sidebarView === "search" || saved?.sidebarView === "scm" || saved?.sidebarView === "run"
          ? saved.sidebarView
          : "explorer",
      sidebarVisible: typeof saved?.sidebarVisible === "boolean" ? saved.sidebarVisible : true,
      openTabs: Array.isArray(saved?.openTabs) ? saved.openTabs.filter((p): p is string => typeof p === "string") : [],
      activePath: typeof saved?.activePath === "string" ? saved.activePath : "",
      diffTabs: [],
      expanded: Array.isArray(saved?.expanded) ? saved.expanded.filter((p): p is string => typeof p === "string") : [],
      sidebarWidth: typeof saved?.sidebarWidth === "number" ? clampWidth(saved.sidebarWidth) : 264,
      sidebarExpandedWidth: typeof saved?.sidebarExpandedWidth === "number" ? clampWidth(saved.sidebarExpandedWidth) : 264,
      panelVisible: typeof saved?.panelVisible === "boolean" ? saved.panelVisible : false,
      panelTab:
        saved?.panelTab === "output" || saved?.panelTab === "results" || saved?.panelTab === "terminal"
          ? saved.panelTab
          : "output",
      panelMaximized: typeof saved?.panelMaximized === "boolean" ? saved.panelMaximized : false,
      aiPanelVisible: typeof saved?.aiPanelVisible === "boolean" ? saved.aiPanelVisible : false,
      zenMode: typeof saved?.zenMode === "boolean" ? saved.zenMode : false,
      aiRightWidth: typeof saved?.aiRightWidth === "number" ? clampAiRightWidth(saved.aiRightWidth) : 360
    }, { persist: false });
  },
  /** Fresh workspace session (initial load or import): one tab open,
   *  the default folder expansion, nothing stale from the old file set. */
  resetSession(openPath: string, expanded: string[]): void {
    set({ openTabs: openPath ? [openPath] : [], activePath: openPath, diffTabs: [], expanded });
  },
  /** Reopen the saved session if every recorded path still exists.
   *  Returns false when there is nothing (valid) to restore, so the
   *  caller falls back to the default session. */
  restorePersistedSession(validPaths: string[]): boolean {
    if (!sessionKey) return false;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(`${SESSION_STORAGE_KEY}:${sessionKey}`);
    } catch {
      return false;
    }
    if (!raw) return false;
    let saved: Partial<WorkbenchState> | null = null;
    try {
      saved = JSON.parse(raw) as Partial<WorkbenchState> | null;
    } catch {
      return false;
    }
    const valid = new Set(validPaths);
    const openTabs = Array.isArray(saved?.openTabs)
      ? saved.openTabs.filter((p): p is string => typeof p === "string" && valid.has(p))
      : [];
    // An empty record carries no session worth reopening — fall back to
    // the workspace default (first runnable spec) instead of a watermark.
    if (openTabs.length === 0) return false;
    const activePath = typeof saved?.activePath === "string" && valid.has(saved.activePath)
      ? saved.activePath
      : openTabs[0];
    // A folder stays expanded only while it still contains something.
    const expanded = Array.isArray(saved?.expanded)
      ? saved.expanded.filter((p): p is string => typeof p === "string" && validPaths.some((v) => v.startsWith(`${p}/`)))
      : [];
    set({ openTabs, activePath, expanded });
    return true;
  },
  /** Imports replace the file set: forget the saved session for one reset. */
  beginFreshSession(): void {
    freshSessionNext = true;
  },
  /** Consume the fresh-session flag set by beginFreshSession(). */
  consumeFreshSession(): boolean {
    if (!freshSessionNext) return false;
    freshSessionNext = false;
    return true;
  },
  /** Close a tab; closing the active one focuses its right neighbour. */
  closeTab(path: string): void {
    const index = state.openTabs.indexOf(path);
    if (index === -1) return;
    const openTabs = state.openTabs.filter((entry) => entry !== path);
    const diffTabs = state.diffTabs.filter((entry) => entry !== path);
    const activePath = state.activePath === path ? (openTabs[Math.min(index, openTabs.length - 1)] ?? "") : state.activePath;
    set({ openTabs, diffTabs, activePath });
  },
  setActivePath(path: string): void {
    set({ activePath: path });
  },
  /** Drop tabs whose file disappeared (deleted / replaced workspace). */
  prune(validPaths: string[]): void {
    const valid = new Set(validPaths);
    const openTabs = state.openTabs.filter((path) => valid.has(path));
    const diffTabs = state.diffTabs.filter((path) => valid.has(path));
    if (openTabs.length === state.openTabs.length && diffTabs.length === state.diffTabs.length && valid.has(state.activePath)) return;
    set({
      openTabs,
      diffTabs,
      activePath: valid.has(state.activePath) ? state.activePath : (openTabs[0] ?? "")
    });
  },
  /** After a rename, retarget tabs, the active editor and folder expansion. */
  renamePaths(renames: Record<string, string>): void {
    const retarget = (path: string): string => {
      for (const [from, to] of Object.entries(renames)) {
        if (path === from || path.startsWith(`${from}/`)) return to + path.slice(from.length);
      }
      return path;
    };
    set({
      openTabs: state.openTabs.map(retarget),
      activePath: retarget(state.activePath),
      diffTabs: state.diffTabs.map(retarget),
      expanded: state.expanded.map(retarget)
    });
  },

  toggleDir(path: string): void {
    set({
      expanded: state.expanded.includes(path)
        ? state.expanded.filter((entry) => entry !== path)
        : [...state.expanded, path]
    });
  },
  setExpanded(paths: string[]): void {
    set({ expanded: paths });
  },

  openPalette(mode: PaletteMode): void {
    set({ palette: mode });
  },
  closePalette(): void {
    set({ palette: null });
  }
};

/**
 * Select a slice of the workbench state. Selectors must return
 * primitives or stable references (a store array) -- deriving new
 * objects here would loop useSyncExternalStore forever.
 */
export function useWorkbench<T>(selector: (s: WorkbenchState) => T): T {
  return useSyncExternalStore(workbenchStore.subscribe, () => selector(workbenchStore.getState()));
}
