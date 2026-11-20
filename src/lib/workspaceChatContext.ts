// Live bridge between the /panel workspace (WorkspacePage) and the
// global AI chat assistant (useIssueTracker).
//
// The chat assistant is mounted app-wide by GlobalChatAssistant, while
// the workspace lives under `useDevServer()` context scoped to the
// /projects/:projectId/:envSlug/panel route tree. The chat hook cannot
// reach that context, and the workspace can't reach the chat hook — so
// the workspace stamps its live state into this module-level store on
// mount (and clears it on unmount / folder close), and the chat's
// per-turn CURRENT STATE builder reads it back.
//
// Design notes:
// - Deliberately NOT a React context: the chat hook renders on pages
//   that have no DevServerProvider, so it needs a plain module read.
// - Only DATA flows through the snapshot (`getWorkspaceChatState`); the
//   `openFile` callback is kept out so the model never sees it and the
//   CURRENT STATE serializer stays JSON-safe.
// - Every field is re-stamped each render while the workspace page is
//   mounted, so a folder switch or tab change is visible to the next
//   chat turn without any subscription plumbing.

export interface WorkspaceChatData {
  // Dev-server workspace id (the `ws-…` uuid) — required by every
  // devServerApi route the chat tools call.
  workspaceId: string;
  // Absolute path of the folder the user picked ("Open folder"). Every
  // workspace file/git/search/exec tool is rooted here.
  root: string;
  // Editor tabs currently open, in tab order.
  openPaths: string[];
  // The file the user is looking at right now, if any.
  activePath: string | null;
}

interface WorkspaceChatRegistration extends WorkspaceChatData {
  openFile: (path: string) => void;
}

// Kept OUTSIDE `current` on purpose: the data registration only exists
// while a folder is open, but switching the root must work precisely
// when NO folder is open yet (the chat's `workspace_open_folder` tool
// is the way to bootstrap from a bare /panel page). Lives as long as
// the workspace page itself is mounted.
let rootSetter: ((path: string) => Promise<string>) | null = null;

let current: WorkspaceChatRegistration | null = null;

/**
 * Stamp (or clear) the live workspace state. Called by WorkspacePage in
 * an effect that re-runs whenever any stamped field changes; `null`
 * unmounts the registration so the chat stops claiming a workspace.
 */
export function setWorkspaceChatState(
  state: WorkspaceChatRegistration | null,
): void {
  current = state;
}

/**
 * Stamp (or clear) the live switch-folder callback. Called by
 * WorkspacePage whenever the dev-server workspace id exists — folder
 * open or not. `null` on unmount.
 */
export function setWorkspaceRootSetter(
  fn: ((path: string) => Promise<string>) | null,
): void {
  rootSetter = fn;
}

/**
 * Per-turn snapshot for the CURRENT STATE block. `null` when no
 * workspace page is mounted (or the user hasn't picked a folder yet) —
 * the chat's file/git tools then refuse with a clear hint instead of
 * guessing an id. (`workspace_open_folder` still works in that state —
 * see `getWorkspaceSetRoot`.)
 */
export function getWorkspaceChatState(): WorkspaceChatData | null {
  if (!current) return null;
  const { workspaceId, root, openPaths, activePath } = current;
  return { workspaceId, root, openPaths: [...openPaths], activePath };
}

/**
 * The live open-in-editor callback, for the `workspace_open_file` tool.
 * Null when no workspace is mounted.
 */
export function getWorkspaceOpenFile():
  | ((path: string) => void)
  | null {
  return current?.openFile ?? null;
}

/**
 * The live switch-folder callback, for the `workspace_open_folder`
 * tool. Resolves to a human-readable outcome (`Opened …` / `Refused — …`).
 * Null when no workspace page is mounted — the tool then asks the user
 * to open /panel first.
 */
export function getWorkspaceSetRoot():
  | ((path: string) => Promise<string>)
  | null {
  return rootSetter;
}
