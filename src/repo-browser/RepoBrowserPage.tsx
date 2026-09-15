import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import CodeMirror from "@uiw/react-codemirror";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  ClipboardPaste,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileCode2,
  FlaskConical,
  Folder,
  FolderOpen,
  GitBranch,
  KeyRound,
  Loader2,
  ListChecks,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ActionButton } from "../shared/ui/ActionButton";
import { PageHeader } from "../shared/ui/PageHeader";
import {
  playwrightGutter,
  playwrightGutterTheme,
  type PlaywrightKind,
} from "./playwrightGutter";
import {
  loadEntries,
  saveEntries,
  type EnvEntry,
} from "../playwright/envStore";
import { setPendingPlaywrightSource } from "../playwright/pwPendingSource";
import { RunSummary } from "../playwright/PlaywrightPage";
import {
  runPlaywright,
  type RunnerLog,
  type RunnerLogKind,
} from "../playwright/playwrightRunner";

const DEFAULT_OWNER = "merajul-islam644";
const DEFAULT_REPO = "Login-with-BLOCKS";
const DEFAULT_BRANCH = "main";
const GITHUB_API = "https://api.github.com";
const RAW_BASE = "https://raw.githubusercontent.com";

/**
 * localStorage key for the last (owner, repo, branch, path) the user
 * looked at. We persist just the "where am I" tuple -- not the loaded
 * tree or any selected file -- so a refresh restores the same view
 * without re-downloading gigabytes of cached state.
 *
 * Why localStorage and not sessionStorage: the user expects the
 * repo they cloned to survive both a refresh and a re-open of the
 * tab. sessionStorage would drop the moment they closed the tab.
 */
const REPO_BROWSER_STORAGE_KEY = "blocks-app:repo-browser";
/**
 * localStorage key for the user's GitHub Personal Access Token. Authenticated
 * requests get 5000 req/hr instead of the unauthenticated 60 req/hr, which
 * is enough to remove the "rate limit hit" error during normal browsing.
 *
 * The token never leaves the browser -- it's only attached to outbound
 * requests to api.github.com. Stored verbatim (no trimming, no
 * normalization) so a user can paste a token with embedded spaces and
 * have it work as-is. We don't validate the shape; a malformed token
 * will simply produce a 401 from GitHub that surfaces as the same
 * error card as a missing one.
 */
const GITHUB_TOKEN_STORAGE_KEY = "blocks-app:github-token";

function loadStoredGitHubToken(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = window.localStorage.getItem(GITHUB_TOKEN_STORAGE_KEY);
    return typeof raw === "string" ? raw : "";
  } catch {
    return "";
  }
}

function saveStoredGitHubToken(token: string): void {
  if (typeof window === "undefined") return;
  try {
    if (token) {
      window.localStorage.setItem(GITHUB_TOKEN_STORAGE_KEY, token);
    } else {
      // Empty token = remove the entry so the next visit doesn't see a
      // stale blank row in the UI. We never persist an empty string
      // (a missing entry and an empty entry are equivalent).
      window.localStorage.removeItem(GITHUB_TOKEN_STORAGE_KEY);
    }
  } catch {
    // Quota / private-mode failure -- ignore, the user can re-enter.
  }
}

/**
 * Headers for any GitHub REST API call. Adds `Authorization: token <PAT>`
 * when a non-empty token is present so authenticated users get the 5000
 * req/hr tier. Unauthenticated callers get the base headers only.
 *
 * Note: `raw.githubusercontent.com` doesn't accept auth, so the raw-URL
 * branch of `openFile` deliberately bypasses it.
 */
function ghHeaders(token: string): Record<string, string> {
  const base: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) {
    // `token` prefix works for both classic PATs (ghp_*) and fine-grained
    // PATs (github_pat_*). `Bearer` also works for fine-grained; `token`
    // is the older, broader form that's safe for both.
    base.Authorization = `token ${token}`;
  }
  return base;
}

type StoredRepoRef = {
  owner: string;
  repo: string;
  branch: string;
  path: string;
};

function loadStoredRepoRef(): StoredRepoRef | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(REPO_BROWSER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredRepoRef>;
    if (
      typeof parsed.owner === "string" &&
      typeof parsed.repo === "string" &&
      typeof parsed.branch === "string" &&
      typeof parsed.path === "string" &&
      parsed.owner.length > 0 &&
      parsed.repo.length > 0 &&
      parsed.branch.length > 0
    ) {
      return {
        owner: parsed.owner,
        repo: parsed.repo,
        branch: parsed.branch,
        path: parsed.path,
      };
    }
    return null;
  } catch {
    // Corrupt JSON, quota error, private-mode restrictions -- fall
    // back to defaults rather than blowing up the page.
    return null;
  }
}

function saveStoredRepoRef(ref: StoredRepoRef): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(REPO_BROWSER_STORAGE_KEY, JSON.stringify(ref));
  } catch {
    // Same reasoning -- silently ignore so the page keeps working
    // even if storage is unavailable.
  }
}

/**
 * Repos that get the Playwright-aware outline panel. The repo browser
 * surfaces this only for these repos so we don't sprinkle Play buttons
 * on files that aren't actually Playwright suites. Match is
 * case-insensitive on the `(owner, repo)` pair.
 */
const PLAYWRIGHT_REPOS: ReadonlyArray<{ owner: string; repo: string }> = [
  { owner: "SELISEdigitalplatforms", repo: "blocks-app-playwright-e2e" },
  { owner: "playwright", repo: "playwright" },
];

type Entry = {
  name: string;
  path: string;
  type: "file" | "dir";
  size: number;
};

type SelectedFile = {
  path: string;
  size: number;
  text: string;
};

type FetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string; detail?: string };

/**
 * Build the immediate children of `dirPath` from a flat list of tree
 * entries (the shape returned by the git tree API's recursive call).
 *
 * Example, with paths from the tree = [
 *   "Dockerfile", "README.md", "src/main.js", "src/utils/x.ts"
 * ] and dirPath = "src", we return:
 *   [{ name: "main.js", type: "file", ... }, { name: "utils", type: "dir", ... }]
 */
function childrenOf(flat: Entry[], dirPath: string): Entry[] {
  const prefix = dirPath ? `${dirPath}/` : "";
  const seen = new Map<string, Entry>();
  for (const entry of flat) {
    if (!entry.path.startsWith(prefix)) continue;
    const remainder = entry.path.slice(prefix.length);
    if (!remainder) continue;
    const slashIndex = remainder.indexOf("/");
    const isDirInTree = slashIndex !== -1;
    // A tree entry only counts as a "directory" here if it has a child
    // somewhere deeper -- blob entries with a name containing "/" are
    // already filtered out by the git tree API (it only returns real
    // directories, not files with slashes in their names).
    if (isDirInTree) {
      const childName = remainder.slice(0, slashIndex);
      const childPath = prefix + childName;
      const existing = seen.get(childPath);
      if (!existing || existing.type !== "dir") {
        seen.set(childPath, {
          name: childName,
          path: childPath,
          type: "dir",
          size: 0,
        });
      }
    } else {
      // Skip entries that exactly match dirPath itself (the dir's own blob
      // entry, if any) -- those aren't children.
      if (entry.path === dirPath) continue;
      seen.set(entry.path, { ...entry, type: "file" });
    }
  }
  const list = Array.from(seen.values());
  // Folders first, then files; both alpha-sorted case-insensitively.
  list.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return list;
}

function decodeBase64(content: string): string {
  // GitHub inserts a newline every 60 chars; strip them before decoding.
  const cleaned = content.replace(/\s/g, "");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function languageFor(path: string) {
  if (/\.tsx?$/.test(path))
    return [javascript({ typescript: true, jsx: true })];
  if (/\.jsx?$/.test(path)) return [javascript({ jsx: true })];
  return [];
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/* ------------------------------------------------------------------ */
/* Playwright block detection                                         */
/* ------------------------------------------------------------------ */

type BlockKind = "test" | "describe" | "step";

type PlaywrightBlock = {
  kind: BlockKind;
  name: string;
  startLine: number;
  endLine: number;
  source: string;
};

/**
 * Find the matching `)` for the `(` at `openIdx`, skipping over
 * balanced parens, single/double/backtick strings (with `\` escapes),
 * and `//` / `/* * /` comments. Returns -1 if no match — meaning the
 * block is unterminated and we should skip it rather than guess.
 */
function findMatchingParen(source: string, openIdx: number): number {
  let depth = 0;
  let inString: string | null = null;
  let inComment: "line" | "block" | null = null;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i]!;
    const next = source[i + 1];
    if (inString) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (inComment === "line") {
      if (ch === "\n") inComment = null;
      continue;
    }
    if (inComment === "block") {
      if (ch === "*" && next === "/") {
        inComment = null;
        i++;
      }
      continue;
    }
    if (ch === "/" && next === "/") {
      inComment = "line";
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inComment = "block";
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Extract the first string literal in `source[start..end]`, or null. */
function extractFirstStringLiteral(
  source: string,
  start: number,
  end: number,
): string | null {
  let i = start;
  while (i < end && /\s/.test(source[i]!)) i++;
  if (i >= end) return null;
  const open = source[i]!;
  if (open !== '"' && open !== "'" && open !== "`") return null;
  i++;
  let out = "";
  while (i < end && source[i] !== open) {
    if (source[i] === "\\" && i + 1 < end) {
      out += source[i + 1];
      i += 2;
    } else {
      out += source[i];
      i++;
    }
  }
  return out.length > 0 ? out : null;
}

/** Count newlines in `source[0..idx]`. Used to convert offsets to 0-indexed lines. */
function lineNumberAt(source: string, idx: number): number {
  let line = 0;
  for (let i = 0; i < idx && i < source.length; i++) {
    if (source[i] === "\n") line++;
  }
  return line;
}

/**
 * Detect Playwright test blocks in `source`. Each block is the full
 * `test(...)` / `test.describe(...)` / `test.step(...)` call, from the
 * `t` in `test` to the matching `)`. Detection is intentionally cheap:
 * regex for the call shape + bracket counting for the matching paren.
 * We don't try to understand fixtures, async modifiers, or anything else
 * beyond "is this a single self-contained call?".
 */
function detectPlaywrightBlocks(source: string): PlaywrightBlock[] {
  const blocks: PlaywrightBlock[] = [];
  const regex = /\b(test\.describe|test\.step|test)(?=\s*\()/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    const kindStr = match[1]!;
    const kind: BlockKind =
      kindStr === "test.describe"
        ? "describe"
        : kindStr === "test.step"
          ? "step"
          : "test";

    let i = regex.lastIndex;
    while (i < source.length && /\s/.test(source[i]!)) i++;
    if (source[i] !== "(") continue;

    const openParen = i;
    const closeParen = findMatchingParen(source, openParen);
    if (closeParen === -1) {
      // Unterminated block — skip rather than emit a half-block. The
      // next pass after the user fixes it will pick it up.
      continue;
    }

    const blockSource = source.slice(match.index, closeParen + 1);
    const name =
      extractFirstStringLiteral(source, openParen + 1, closeParen) ??
      "<anonymous>";

    blocks.push({
      kind,
      name,
      startLine: lineNumberAt(source, match.index),
      endLine: lineNumberAt(source, closeParen),
      source: blockSource,
    });
  }
  return blocks;
}

/** Cheap test: does this file look like a Playwright spec?
 *
 * The filename match is preferred (`.spec.ts` / `.test.ts`) because
 * it's a strong, false-positive-resistant signal. We also accept
 * `.playwright.*` and any `.ts`/`.js` file that **imports from
 * `@playwright/test`** OR contains a clear Playwright block opener
 * (`test(`, `test.describe`, `test.step`). The wider net stops the
 * gutter from staying blank on files that are clearly Playwright but
 * haven't been renamed to a spec convention. */
function looksLikePlaywrightFile(path: string, source: string): boolean {
  if (/\.(spec|test|playwright)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) {
    return (
      /from\s+["']@playwright\/test["']/.test(source) ||
      /\btest(?:\.describe|\.step|\()/.test(source)
    );
  }
  // Fallback: any .ts/.js/.tsx/.jsx file that actually looks like
  // Playwright code gets the gutter too. This is gated on the import
  // (strong signal) — alone, `test(` would false-positive on Jest files,
  // so we require the import OR a `test.describe(` block.
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) {
    return (
      /from\s+["']@playwright\/test["']/.test(source) ||
      /\btest\.describe\s*\(/.test(source)
    );
  }
  return false;
}

function isPlaywrightRepo(owner: string, repo: string): boolean {
  const o = owner.trim().toLowerCase();
  const r = repo.trim().toLowerCase();
  return PLAYWRIGHT_REPOS.some(
    (entry) =>
      entry.owner.toLowerCase() === o && entry.repo.toLowerCase() === r,
  );
}

/**
 * Look up the default branch for a public repo via the GitHub REST API.
 *
 * We don't ship a hardcoded `main` -> `master` fallback because (a) some
 * repos default to `develop`, `trunk`, or anything else, and (b) the
 * metadata endpoint is the authoritative source. Returns null on any
 * failure (rate limit, 404, parse error) so the caller can decide
 * whether to retry, fall back, or surface an error.
 */
async function fetchDefaultBranch(
  owner: string,
  repo: string,
  token: string,
): Promise<string | null> {
  const url = `${GITHUB_API}/repos/${owner}/${repo}`;
  try {
    const response = await fetch(url, {
      headers: ghHeaders(token),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { default_branch?: unknown };
    return typeof payload.default_branch === "string" &&
      payload.default_branch.length > 0
      ? payload.default_branch
      : null;
  } catch {
    return null;
  }
}

/**
 * Lightweight existence probe for a branch. Hits the dedicated
 * `/branches/{branch}` endpoint which returns 200 with branch metadata
 * if the branch exists, 404 if it doesn't. Doesn't pull the whole tree.
 */
async function branchHasTree(
  owner: string,
  repo: string,
  branch: string,
  token: string,
): Promise<boolean> {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`;
  try {
    const response = await fetch(url, {
      headers: ghHeaders(token),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Pick a working default branch for `owner/repo`.
 *
 * Strategy:
 *   1. Ask GitHub's metadata endpoint for `default_branch` -- it's
 *      the authoritative source and usually right.
 *   2. Verify the branch actually exists (the metadata endpoint can
 *      lag a rename / force-push, so this is a sanity check).
 *   3. If metadata fails or its branch doesn't exist, try common
 *      defaults in order: main -> master -> develop -> trunk.
 *
 * Returns null only if every candidate 404s, which usually means
 * the repo is private (no anonymous read access), doesn't exist, or
 * we're hitting GitHub's rate limit.
 */
async function resolveBranch(
  owner: string,
  repo: string,
  token: string,
): Promise<string | null> {
  const fromMeta = await fetchDefaultBranch(owner, repo, token);
  if (fromMeta && (await branchHasTree(owner, repo, fromMeta, token))) {
    return fromMeta;
  }
  const candidates = ["main", "master", "develop", "trunk"];
  for (const candidate of candidates) {
    if (candidate === fromMeta) continue;
    if (await branchHasTree(owner, repo, candidate, token)) {
      return candidate;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* GitHub URL parser (for the "Clone" input)                          */
/* ------------------------------------------------------------------ */

type ParsedGitHubRef = {
  owner: string;
  repo: string;
  branch?: string;
  /** Subdirectory within the repo. Empty means "the repo root". */
  path?: string;
};

/**
 * Parse a user-pasted string into (owner, repo, branch?, path?).
 *
 * Accepted shapes:
 *   - https://github.com/owner/repo
 *   - https://github.com/owner/repo.git
 *   - https://github.com/owner/repo/tree/<branch>[/<subdir>...]
 *   - https://github.com/owner/repo/blob/<branch>/<file>
 *   - git@github.com:owner/repo.git
 *   - owner/repo  (shorthand)
 *
 * The parser is deliberately tolerant — branch and path are
 * best-effort. If they're absent we fall back to the repo defaults.
 */
function parseGitHubRef(input: string): ParsedGitHubRef | null {
  const raw = input.trim();
  if (!raw) return null;

  // SSH shorthand: git@github.com:owner/repo[.git]
  const ssh = raw.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  if (ssh) return { owner: ssh[1]!, repo: ssh[2]! };

  // Plain "owner/repo" or "owner/repo.git" — only valid if there's no
  // scheme and exactly one slash between two non-slash segments.
  // We accept the optional `.git` suffix here to mirror the URL
  // branch, so `learning-playwright.git` works the same as
  // `https://github.com/.../learning-playwright.git`.
  if (!/^https?:\/\//.test(raw) && !raw.includes("@")) {
    const short = raw.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
    if (short) return { owner: short[1]!, repo: short[2]! };
  }

  // Anything else must be a parseable URL.
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!/(^|\.)github\.com$/i.test(url.hostname)) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2) return null;

  const owner = decodeURIComponent(segments[0]!);
  const repo = decodeURIComponent(segments[1]!).replace(/\.git$/, "");
  // GitHub allows '.' / '_' / '-' in owner+repo names. Reject anything
  // weird so we don't fire a request that 404s for a typo.
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;

  let branch: string | undefined;
  let path: string | undefined;
  // /owner/repo/tree/<branch>[/<subdir>...]
  // /owner/repo/blob/<branch>[/<file>]
  if (
    (segments[2] === "tree" || segments[2] === "blob") &&
    segments.length >= 4
  ) {
    branch = decodeURIComponent(segments[3]!);
    if (segments.length > 4) {
      path = segments
        .slice(4)
        .map((s) => decodeURIComponent(s))
        .join("/");
    }
  }

  return { owner, repo, branch, path };
}

function describeResponse(response: Response): Promise<string> {
  return response.text().then((text) => {
    const head = text.length > 320 ? `${text.slice(0, 320)}…` : text;
    return `${response.status} ${response.statusText}\n${head}`;
  });
}

export function RepoBrowserPage() {
  const navigate = useNavigate();
  // Hydrate from localStorage on first mount so a refresh (or tab
  // reopen) lands the user back on whatever they were last browsing.
  // loadStoredRepoRef is wrapped in try/catch internally, so a bad
  // / missing / corrupt entry just falls through to the defaults.
  const initialRef = loadStoredRepoRef();
  const [owner, setOwner] = useState(() => initialRef?.owner ?? DEFAULT_OWNER);
  const [repo, setRepo] = useState(() => initialRef?.repo ?? DEFAULT_REPO);
  const [branch, setBranch] = useState(
    () => initialRef?.branch ?? DEFAULT_BRANCH,
  );
  const [path, setPath] = useState(() => initialRef?.path ?? "");
  const [tree, setTree] = useState<Entry[]>([]);
  const [treeTruncated, setTreeTruncated] = useState(false);
  const [selected, setSelected] = useState<SelectedFile | null>(null);
  const [originalText, setOriginalText] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState<FetchState>({ kind: "idle" });
  const [pathInput, setPathInput] = useState("");
  const [treeKey, setTreeKey] = useState(
    () =>
      `${initialRef?.owner ?? DEFAULT_OWNER}/${initialRef?.repo ?? DEFAULT_REPO}@${
        initialRef?.branch ?? DEFAULT_BRANCH
      }`,
  );
  // The "Clone" input is decoupled from the toolbar fields -- the
  // user types a URL here, presses Enter (or clicks Clone), and we
  // parse it into (owner, repo, branch, path). A separate state
  // avoids the user's in-progress URL overwriting the toolbar.
  const [cloneInput, setCloneInput] = useState("");
  const [cloneError, setCloneError] = useState<string | null>(null);
  // True while we're looking up the repo's default branch. Drives
  // the spinner on the Clone button so the user knows the click
  // registered -- handleClone does one extra round-trip on the way.
  const [cloning, setCloning] = useState(false);
  const cloneInputRef = useRef<HTMLInputElement | null>(null);
  const envCardRef = useRef<HTMLDivElement | null>(null);

  // GitHub Personal Access Token. Hydrated from localStorage on mount so
  // a refresh restores the auth state without re-pasting. Attached to
  // every outbound api.github.com request to lift us from the 60
  // req/hr anonymous tier to 5000 req/hr.
  const [githubToken, setGithubToken] = useState<string>(() =>
    loadStoredGitHubToken(),
  );
  const [githubTokenVisible, setGithubTokenVisible] = useState(false);
  const githubTokenFilled = githubToken.trim().length > 0;

  // Secrets / .env section. The user types into two inputs (name + value)
  // and clicks "Add Property" to grow the list one row at a time. We
  // persist the structured entries to localStorage; on every load we
  // also migrate from the old text-based shape so existing users keep
  // their values. The Playwright runner consumes the entries via
  // `loadEnv()` and exposes them as the global `env` object.
  const [envEntries, setEnvEntries] = useState<EnvEntry[]>(() => loadEntries());
  const [draftKey, setDraftKey] = useState("");
  const [draftValue, setDraftValue] = useState("");
  const [envValuesHidden, setEnvValuesHidden] = useState(true);
  const [envExpanded, setEnvExpanded] = useState(false);
  const envFilledCount = useMemo(
    () => envEntries.filter((entry) => entry.key.trim().length > 0).length,
    [envEntries],
  );

  // Remember the most recent request token so a slow response can't
  // overwrite a fresher one (e.g. user clicked folder A, then folder B).
  const requestToken = useRef(0);
  // File content cache keyed by file path -- avoids re-downloading when
  // the user clicks the same file twice.
  const fileCache = useRef<Map<string, SelectedFile>>(new Map());

  // Inline-run output drawer state. A click on a gutter Play button runs
  // the block in-browser against `runPlaywright(...)`; logs stream into
  // `inlineLogs`. The drawer slides up from the bottom of the viewport
  // while a run is in flight and stays open after, showing a summary
  // header plus the log list. The mounted guard + cancellation ref
  // mirror the PlaywrightPage pattern so a navigation away mid-run
  // doesn't trip React's setState-after-unmount warning.
  const [inlineLogs, setInlineLogs] = useState<RunnerLog[]>([]);
  const [inlineRunning, setInlineRunning] = useState(false);
  const [inlineLabel, setInlineLabel] = useState<string | null>(null);
  const [inlineDrawerOpen, setInlineDrawerOpen] = useState(false);
  /**
   * When true, only the drawer's header bar is visible (peek row).
   * The header still shows the run label + verdict so the user knows
   * whether a run is in progress without having to expand the panel.
   * Default false (expanded) on first open, then user-controlled via
   * the chevron toggle in the header.
   */
  const [inlineDrawerCollapsed, setInlineDrawerCollapsed] = useState(false);
  const inlineCancelRef = useRef<(() => void) | null>(null);
  const inlineMountedRef = useRef(true);
  const inlineLogCounterRef = useRef(0);
  useEffect(() => {
    inlineMountedRef.current = true;
    return () => {
      inlineMountedRef.current = false;
      inlineCancelRef.current?.();
    };
  }, []);
  const inlineCounts = useMemo<Partial<Record<RunnerLogKind, number>>>(() => {
    const out: Partial<Record<RunnerLogKind, number>> = {};
    for (const log of inlineLogs) {
      out[log.kind] = (out[log.kind] ?? 0) + 1;
    }
    return out;
  }, [inlineLogs]);

  /**
   * Esc closes the run drawer while it's open. Mirrors the secrets
   * drawer pattern so keyboard handling stays consistent across the
   * two overlays.
   */
  useEffect(() => {
    if (!inlineDrawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setInlineDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inlineDrawerOpen]);

  const repoLabel = `${owner}/${repo}`;

  useEffect(() => {
    setPathInput(path);
  }, [path]);

  /**
   * Mirror the four-up of (owner, repo, branch, path) into localStorage
   * on every change so the next visit (or refresh) lands the user
   * back on the same repo. The effect fires after render, so the
   * values stored always match what's on screen.
   */
  useEffect(() => {
    if (!owner || !repo || !branch) return;
    saveStoredRepoRef({ owner, repo, branch, path });
  }, [owner, repo, branch, path]);

  /**
   * Mirror the .env textarea into localStorage on every keystroke.
   * We save the raw text rather than the parsed record so the user
   * keeps their comments, blank lines, and quoted values verbatim.
   */
  useEffect(() => {
    saveEntries(envEntries);
  }, [envEntries]);

  /**
   * Mirror the GitHub PAT into localStorage on every change. We persist
   * the raw input (no trim) so a token pasted with leading whitespace
   * round-trips identically. Empty value -> remove the key, so a "Clear"
   * action actually clears storage.
   */
  useEffect(() => {
    saveStoredGitHubToken(githubToken);
  }, [githubToken]);

  /**
   * Esc closes the Secrets drawer while it's open. The listener is
   * attached only when `envExpanded` is true so it doesn't fight with
   * other handlers (e.g. the audit page's own keyboard shortcuts).
   */
  useEffect(() => {
    if (!envExpanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setEnvExpanded(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [envExpanded]);

  /**
   * Fetch the full recursive tree for the (owner, repo, branch) tuple
   * and store it in `tree`. From there, `entries` is derived from
   * `childrenOf(tree, path)` and navigation is instant.
   */
  const loadTree = useCallback(
    async (force: boolean) => {
      const key = `${owner}/${repo}@${branch}`;
      if (!force && key === treeKey && tree.length > 0) return;
      const token = ++requestToken.current;
      setState({ kind: "loading" });
      setSelected(null);

      const url = `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
      try {
        const response = await fetch(url, {
          headers: ghHeaders(githubToken),
        });
        if (token !== requestToken.current) return;
        if (!response.ok) {
          const detail = await describeResponse(response);
          const message =
            response.status === 403
              ? `GitHub API rate limit hit. Add a token or wait.`
              : response.status === 404
                ? `Repo or branch not found: ${owner}/${repo}@${branch}`
                : `Tree request failed.`;
          setState({ kind: "error", message, detail });
          return;
        }
        const payload = (await response.json()) as Record<string, unknown>;
        if (token !== requestToken.current) return;
        const rawTree = Array.isArray(payload.tree) ? payload.tree : [];
        const entries: Entry[] = [];
        for (const item of rawTree) {
          if (!item || typeof item !== "object") continue;
          const obj = item as Record<string, unknown>;
          const entryPath = typeof obj.path === "string" ? obj.path : "";
          if (!entryPath) continue;
          // type === "blob" -> file, "tree" -> directory. Some repos
          // use "commit" for gitlink submodules -- render those as dirs
          // so they're clickable too.
          const entryType =
            obj.type === "blob"
              ? "file"
              : obj.type === "tree" || obj.type === "commit"
                ? "dir"
                : null;
          if (!entryType) continue;
          entries.push({
            name: entryPath.split("/").pop() ?? entryPath,
            path: entryPath,
            type: entryType,
            size: typeof obj.size === "number" ? obj.size : 0,
          });
        }
        setTree(entries);
        setTreeTruncated(payload.truncated === true);
        setTreeKey(key);
        setState({ kind: "ready" });
      } catch (err) {
        if (token !== requestToken.current) return;
        setState({ kind: "error", message: (err as Error).message });
      }
    },
    [owner, repo, branch, treeKey, tree.length, githubToken],
  );

  useEffect(() => {
    void loadTree(false);
  }, [loadTree]);

  /** Children of the current path, derived from the cached tree. */
  const entries = useMemo(() => childrenOf(tree, path), [tree, path]);

  /** True if any entry under the current path is a file (means directory exists in tree). */
  const pathExists = useMemo(() => {
    if (path === "") return tree.length > 0;
    const prefix = `${path}/`;
    return tree.some(
      (entry) => entry.path === path || entry.path.startsWith(prefix),
    );
  }, [tree, path]);

  function openEntry(entry: Entry) {
    if (entry.type === "dir") {
      setPath(entry.path);
    } else {
      void openFile(entry);
    }
  }

  async function openFile(entry: Entry) {
    const cached = fileCache.current.get(entry.path);
    if (cached) {
      setSelected(cached);
      setState({ kind: "ready" });
      return;
    }
    const token = ++requestToken.current;
    setState({ kind: "loading" });
    setSelected(null);

    // First try the Contents API -- it returns base64-encoded content for
    // files and works for public repos without auth.
    const contentsUrl = `${GITHUB_API}/repos/${owner}/${repo}/contents/${entry.path}?ref=${encodeURIComponent(branch)}`;
    try {
      const response = await fetch(contentsUrl, {
        headers: ghHeaders(githubToken),
      });
      if (token !== requestToken.current) return;
      if (response.ok) {
        const payload = (await response.json()) as Record<string, unknown>;
        if (token !== requestToken.current) return;
        if (typeof payload.content === "string") {
          const text =
            payload.encoding === "base64"
              ? decodeBase64(payload.content)
              : payload.content;
          const file: SelectedFile = {
            path: String(payload.path ?? entry.path),
            size: typeof payload.size === "number" ? payload.size : text.length,
            text,
          };
          fileCache.current.set(entry.path, file);
          selectFile(file);
          setState({ kind: "ready" });
          return;
        }
        // Fall through to raw URL on unexpected shape.
      } else if (response.status !== 404) {
        const detail = await describeResponse(response);
        setState({
          kind: "error",
          message: `Contents request failed for ${entry.path}`,
          detail,
        });
        return;
      }

      // 404 from Contents API (or unexpected shape): fall back to the
      // raw.githubusercontent.com mirror. It's plain text and bypasses
      // any Contents-API quirks.
      const rawUrl = `${RAW_BASE}/${owner}/${repo}/${branch}/${entry.path}`;
      const rawResponse = await fetch(rawUrl);
      if (token !== requestToken.current) return;
      if (!rawResponse.ok) {
        const detail = await describeResponse(rawResponse);
        setState({
          kind: "error",
          message: `Both Contents API and raw URL failed for ${entry.path}`,
          detail,
        });
        return;
      }
      const text = await rawResponse.text();
      const file: SelectedFile = {
        path: entry.path,
        size: text.length,
        text,
      };
      fileCache.current.set(entry.path, file);
      selectFile(file);
      setState({ kind: "ready" });
    } catch (err) {
      if (token !== requestToken.current) return;
      setState({ kind: "error", message: (err as Error).message });
    }
  }

  function navigateBreadcrumb(target: string) {
    setPath(target);
  }

  /**
   * Switch the editor to a freshly loaded file. Resets the dirty flag
   * and captures the original text so the user can later discard edits.
   */
  function selectFile(file: SelectedFile) {
    setSelected(file);
    setOriginalText(file.text);
    setDirty(false);
  }

  function onEditorChange(nextValue: string) {
    setSelected((current) => {
      if (!current) return current;
      const updated = { ...current, text: nextValue, size: nextValue.length };
      fileCache.current.set(current.path, updated);
      return updated;
    });
    setDirty(true);
  }

  function discardEdits() {
    if (!selected || originalText === null) return;
    const restored: SelectedFile = {
      ...selected,
      text: originalText,
      size: originalText.length,
    };
    fileCache.current.set(selected.path, restored);
    setSelected(restored);
    setDirty(false);
  }

  function refresh() {
    fileCache.current.clear();
    void loadTree(true);
  }

  /**
   * Toggle the Secrets/.env drawer from the header button. The drawer
   * slides in from the right edge; clicking the same button again, or
   * the X / backdrop inside the drawer, closes it. Esc is handled by a
   * separate effect so it works even when the button isn't focused.
   */
  function focusSecrets() {
    setEnvExpanded((current) => !current);
  }

  /**
   * Append a new env entry from the draft inputs and reset the draft.
   * We trim the key so stray whitespace doesn't end up in the stored
   * identifier, but values are kept verbatim (a value with leading or
   * trailing spaces is sometimes intentional, e.g. API keys).
   */
  function addEnvProperty() {
    const key = draftKey.trim();
    if (!key) return;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2, 10);
    setEnvEntries((current) => [...current, { id, key, value: draftValue }]);
    setDraftKey("");
    setDraftValue("");
  }

  /** Patch a stored entry by id. Used by the inline row inputs. */
  function updateEnvEntry(id: string, patch: Partial<EnvEntry>) {
    setEnvEntries((current) =>
      current.map((entry) =>
        entry.id === id ? { ...entry, ...patch } : entry,
      ),
    );
  }

  /** Remove a stored entry by id. */
  function removeEnvEntry(id: string) {
    setEnvEntries((current) => current.filter((entry) => entry.id !== id));
  }

  /**
   * Apply a parsed GitHub ref to the page state and force a tree
   * reload. Bumping `treeKey` with a timestamp suffix is what makes
   * "Clone the same URL again" actually re-fetch -- otherwise the
   * loadTree guard short-circuits on the unchanged key.
   *
   * `resolvedBranch` is the branch we actually want to load, which
   * may differ from `ref.branch` (we fill it in when the URL didn't
   * include one). Pass it explicitly so the treeKey string matches
   * the state we just set -- otherwise the loadTree short-circuit
   * misfires on the next render.
   */
  function applyRef(ref: ParsedGitHubRef, resolvedBranch: string) {
    setOwner(ref.owner);
    setRepo(ref.repo);
    setBranch(resolvedBranch);
    setPath(ref.path ?? "");
    setTreeKey(`${ref.owner}/${ref.repo}@${resolvedBranch}#${Date.now()}`);
    setCloneInput("");
    setCloneError(null);
    cloneInputRef.current?.focus();
  }

  async function handleClone() {
    const parsed = parseGitHubRef(cloneInput);
    if (!parsed) {
      setCloneError(
        "Couldn't read that as a GitHub URL. Try https://github.com/owner/repo or owner/repo.",
      );
      return;
    }

    setCloning(true);
    setCloneError(null);

    // The URL might already pin a branch (e.g. /tree/master/sub).
    // If so, use it directly -- no resolver call needed.
    if (parsed.branch) {
      applyRef(parsed, parsed.branch);
      setCloning(false);
      return;
    }

    // Otherwise, figure out which branch to use. resolveBranch tries
    // GitHub's metadata first (authoritative), then falls back to
    // common defaults (main / master / develop / trunk). If it can't
    // find any working branch, we surface a clear error instead of
    // silently loading a 404.
    const resolvedBranch = await resolveBranch(
      parsed.owner,
      parsed.repo,
      githubToken,
    );
    if (resolvedBranch) {
      applyRef(parsed, resolvedBranch);
    } else {
      setCloneError(
        `Couldn't find a working branch for ${parsed.owner}/${parsed.repo}. ` +
          `Tried main / master / develop / trunk. The repo may be private, ` +
          `empty, or GitHub may be rate-limiting. Type a branch name in the Branch field below to try a specific one.`,
      );
    }
    setCloning(false);
  }

  async function pasteFromClipboard() {
    if (!navigator.clipboard?.readText) {
      setCloneError("Clipboard read isn't available in this browser.");
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      setCloneInput(text);
      setCloneError(null);
    } catch {
      setCloneError("Clipboard read was blocked. Paste manually with Ctrl+V.");
    }
  }

  const breadcrumbs = useMemo(() => {
    const segments = path ? path.split("/").filter(Boolean) : [];
    const items: { label: string; path: string }[] = [
      { label: repo, path: "" },
    ];
    let running = "";
    for (const segment of segments) {
      running = running ? `${running}/${segment}` : segment;
      items.push({ label: segment, path: running });
    }
    return items;
  }, [path, repo]);

  const editorLang = useMemo(() => {
    if (!selected) return [];
    const lang = languageFor(selected.path);
    if (!looksLikePlaywrightFile(selected.path, selected.text)) return lang;
    // Show a Play button in the gutter for each detected block.
    return [
      ...lang,
      playwrightGutterTheme,
      playwrightGutter(launchBlockFromLine),
    ];
  }, [selected]);

  /**
   * Outline panel is gated on two things:
   *   - The current owner/repo is a known Playwright repo
   *   - The currently-open file looks like a Playwright spec
   * AND there's a file open. When both hold, `blocks` lists every
   * detected test/test.describe/test.step call in source order.
   */
  const playwrightRepoActive = useMemo(
    () => isPlaywrightRepo(owner, repo),
    [owner, repo],
  );
  const blocks = useMemo(() => {
    if (!selected) return [];
    if (!playwrightRepoActive) return [];
    if (!looksLikePlaywrightFile(selected.path, selected.text)) return [];
    return detectPlaywrightBlocks(selected.text);
  }, [selected, playwrightRepoActive]);

  /**
   * Run a single Playwright block in-browser against the shared
   * `runPlaywright` engine. Results stream into the inline output panel
   * below the editor. Each call is a fresh run — clicks while a run is
   * already in flight are ignored so logs don't interleave across
   * blocks. Edits to the file are picked up automatically because
   * `blocks` is recomputed from the latest `selected.text`.
   */
  async function runBlockInline(block: PlaywrightBlock) {
    // `import.meta.env` is Vite-injected; in some build contexts it's
    // undefined and reading `.DEV` would throw, which would abort the
    // whole click handler before any state update. Read once into a
    // local that's safe to test.
    const dev =
      typeof import.meta !== "undefined" &&
      (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
    if (inlineRunning) {
      if (dev) {
        // eslint-disable-next-line no-console
        console.warn("[rb] runBlockInline ignored: another run is in flight");
      }
      return;
    }
    if (!selected) return;

    // Synchronously commit the drawer-open state BEFORE any await.
    // React 18 batches updates, so without flushSync a synchronous
    // runner that blocks the main thread can starve the render and
    // the drawer appears to never open. flushSync forces the DOM
    // commit immediately so the user always sees the panel slide up.
    setInlineLogs([]);
    setInlineRunning(true);
    setInlineLabel(`${selected.path} · ${block.kind}('${block.name}')`);
    setInlineDrawerOpen(true);
    flushSync(() => {
      // No-op; flushSync just forces pending state updates to flush.
    });
    inlineLogCounterRef.current = 0;

    // Always emit an entry log first so the panel shows "yes, the click
    // registered" even if runPlaywright exits immediately or fails.
    if (inlineMountedRef.current) {
      inlineLogCounterRef.current += 1;
      // CRITICAL: capture the id in a local. The setState updater runs
      // LATER (React batches it). If we read inlineLogCounterRef.current
      // inside the updater, multiple synchronous writeLog calls would
      // ALL see the final counter value, producing duplicate keys and
      // an infinite React warning loop. See the `writeLog` definition
      // below for the same pattern.
      const infoId = inlineLogCounterRef.current;
      setInlineLogs((current) => [
        ...current,
        {
          id: infoId,
          kind: "info",
          text: `▶ running ${block.kind}('${block.name}')`,
        },
      ]);
    }

    let cancel!: () => void;
    const cancelled = new Promise<void>((resolve) => {
      cancel = resolve;
    });
    inlineCancelRef.current = cancel;

    // Hard timeout: even if the runner's own promise never settles
    // (e.g. infinite loop in user code, hung network request, or a
    // locator filter that takes forever), we cancel after 30s so the
    // UI can never permanently freeze. The user can also hit Stop
    // earlier via the button in the drawer header.
    const HARD_TIMEOUT_MS = 30_000;
    const timeoutHandle = window.setTimeout(() => {
      const e = new Error(
        `Run aborted after ${HARD_TIMEOUT_MS / 1000}s. ` +
          `The runner couldn't finish — likely an infinite loop or a hung locator query. ` +
          `Use locator(...) with a CSS selector for faster, narrower queries.`,
      );
      e.name = "TimeoutError";
      try {
        cancel();
      } catch {
        // ignore
      }
      writeLog({
        kind: "error",
        text: `[runner] ${e.message}`,
      });
    }, HARD_TIMEOUT_MS);

    const writeLog: (entry: Omit<RunnerLog, "id">) => void = (entry) => {
      if (!inlineMountedRef.current) return;
      inlineLogCounterRef.current += 1;
      // Capture id in a local — see the comment above the info-log
      // block. Without this, multiple synchronous writeLog calls all
      // close over the same final ref value and emit duplicate keys,
      // which makes React log warnings in a tight loop and never
      // finish rendering.
      const id = inlineLogCounterRef.current;
      setInlineLogs((current) => [...current, { id, ...entry }]);
    };

    try {
      await runPlaywright(block.source, writeLog, cancelled);
    } catch (err) {
      // Catch anything that escapes runPlaywright (e.g. malformed snippet
      // rejected by `new Function(...)`). Without this, the error would
      // vanish into the finally block and the panel would look like
      // nothing happened.
      const e = err as Error;
      writeLog({
        kind: "error",
        text: `[runner] ${e.name ?? "Error"} ${e.message}`,
        detail: e.stack,
      });
      if (dev) {
        // eslint-disable-next-line no-console
        console.error("[rb] runPlaywright threw:", err);
      }
    } finally {
      window.clearTimeout(timeoutHandle);
      if (inlineMountedRef.current) {
        setInlineRunning(false);
      }
      inlineCancelRef.current = null;
    }
  }

  /**
   * Find the block that starts on the given 1-based line and run it
   * inline. Used by the editor gutter's Play button.
   *
   * Important: we **re-detect** the blocks from `selected.text` on every
   * click rather than reading from the cached `blocks` memo. The cached
   * `blocks` is gated on `playwrightRepoActive` (the outline panel
   * whitelist) so a file in any other repo would yield an empty list
   * here -- which made clicks appear to do nothing. The gutter, by
   * contrast, is per-file and renders for any spec-shaped file
   * regardless of repo. Resolving from `selected.text` keeps the two
   * in sync: if the gutter decided to draw a Play button, the click
   * must always find a matching block.
   *
   * Falls back silently if the line no longer matches a block (the
   * source may have been edited since the gutter scanned it).
   */
  function launchBlockFromLine(lineNumber: number, _kind: PlaywrightKind) {
    const dev =
      typeof import.meta !== "undefined" &&
      (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
    if (!selected) {
      if (dev) {
        // eslint-disable-next-line no-console
        console.warn("[rb] launchBlockFromLine: no selected file");
      }
      return;
    }
    const live = detectPlaywrightBlocks(selected.text);
    // eslint-disable-next-line no-console
    console.log(
      `[rb] launchBlockFromLine line=${lineNumber} detected=${live.length}`,
      live.map((b) => `${b.kind}('${b.name}')@${b.startLine + 1}`),
    );
    // Don't rely on `block.startLine + 1 === lineNumber` -- if the user
    // edited the file between gutter render and click, the line numbers
    // can drift. Try the line-number match first, then fall back to
    // 1-based index into the detected list (matches the gutter's
    // line-by-line ordering), then a text-signature match as a last
    // resort.
    const target =
      live.find((block) => block.startLine + 1 === lineNumber) ??
      live[lineNumber - 1] ??
      null;
    if (!target) {
      if (dev) {
        // eslint-disable-next-line no-console
        console.warn(
          "[rb] no block for line",
          lineNumber,
          "blocks:",
          live.length,
        );
      }
      // Surface the failure so the user knows the click registered
      // even if the line no longer corresponds to a Playwright block.
      // Append to existing logs rather than replacing them so a
      // previous run's output isn't wiped out.
      setInlineDrawerOpen(true);
      setInlineRunning(false);
      setInlineLabel(`line ${lineNumber}`);
      inlineLogCounterRef.current += 1;
      const id = inlineLogCounterRef.current;
      setInlineLogs((current) => [
        ...current,
        {
          id,
          kind: "warn",
          text: `No Playwright block found on line ${lineNumber} (current file has ${live.length} block${live.length === 1 ? "" : "s"}).`,
        },
      ]);
      return;
    }
    void runBlockInline(target);
  }

  function launchAllBlocks() {
    if (!selected) return;
    // Wrap each block in a `test.step` so the runner logs a clear
    // narrative when the user runs the whole file from one button.
    const wrapped = blocks
      .map(
        (block, idx) =>
          `await test.step(\`${idx + 1}. ${block.kind} '${block.name.replace(/`/g, "\\`")}'\`, async () => {\n${block.source
            .split("\n")
            .map((line) => `  ${line}`)
            .join("\n")}\n});`,
      )
      .join("\n\n");
    setPendingPlaywrightSource({
      source: wrapped,
      label: `${selected.path} · all ${blocks.length} blocks`,
      autoRun: true,
    });
    navigate("/playwright");
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="Repo browser"
        subtitle="Browse the GitHub repo and open any file in the code editor."
        actions={
          <div className="row-actions">
            <ActionButton
              variant="primary"
              onClick={focusSecrets}
              icon={<KeyRound size={16} />}
              aria-expanded={envExpanded}
              title={envExpanded ? "Hide secrets panel" : "Show secrets panel"}
            >
              Secrets
            </ActionButton>
            <ActionButton
              variant="primary"
              onClick={refresh}
              icon={<RefreshCw size={16} />}
            >
              Refresh
            </ActionButton>
            <ActionButton
              variant="accent"
              onClick={() => navigate("/playwright")}
              icon={<FileCode2 size={16} />}
              title="Open the Playwright runner"
            >
              Playwright
            </ActionButton>
          </div>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground flex-1 min-w-0 min-w-[260px]">
          <span>Clone by URL</span>
          <div className="relative flex items-center">
            <input
              ref={cloneInputRef}
              value={cloneInput}
              placeholder="Paste a GitHub URL — e.g. https://github.com/owner/repo or git@github.com:owner/repo.git"
              onChange={(event) => {
                setCloneInput(event.target.value);
                if (cloneError) setCloneError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleClone();
                }
              }}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
            {cloneInput ? (
              <button
                type="button"
                className="absolute right-2 inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                onClick={() => {
                  setCloneInput("");
                  setCloneError(null);
                  cloneInputRef.current?.focus();
                }}
                title="Clear"
                aria-label="Clear clone input"
              >
                <X size={12} />
              </button>
            ) : null}
            <ActionButton
              variant="icon"
              onClick={pasteFromClipboard}
              icon={<ClipboardPaste size={14} />}
              title="Paste from clipboard"
            />
          </div>
        </label>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          onClick={handleClone}
          disabled={!cloneInput.trim() || cloning}
          title="Load this repo into the browser"
        >
          {cloning ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Download size={14} />
          )}
          {cloning ? "Cloning…" : "Clone"}
        </button>
      </div>
      {cloneError ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle size={14} />
          <span>{cloneError}</span>
          <button
            type="button"
            className="ml-auto inline-flex h-5 w-5 items-center justify-center rounded text-destructive hover:bg-destructive/20"
            onClick={() => setCloneError(null)}
            aria-label="Dismiss"
          >
            <X size={12} />
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground flex-1 min-w-0">
          <span>Owner</span>
          <input
            value={owner}
            onChange={(event) => setOwner(event.target.value.trim())}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground flex-1 min-w-0">
          <span>Repo</span>
          <input
            value={repo}
            onChange={(event) => setRepo(event.target.value.trim())}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          <span>Branch</span>
          <input
            value={branch}
            onChange={(event) => setBranch(event.target.value.trim())}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground flex-1 min-w-0">
          <span>Path</span>
          <input
            value={pathInput}
            placeholder="(root)"
            onChange={(event) => setPathInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter")
                setPath(pathInput.trim().replace(/^\/+|\/+$/g, ""));
            }}
          />
        </label>
        <a
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          href={`https://github.com/${owner}/${repo}`}
          target="_blank"
          rel="noreferrer"
          title="Open on GitHub"
        >
          <GitBranch size={14} /> {repoLabel} <ExternalLink size={12} />
        </a>
        {playwrightRepoActive ? (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
            title="Playwright outline is enabled for this repo."
          >
            <FlaskConical size={12} /> Playwright mode
          </span>
        ) : null}
      </div>

      <nav className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground" aria-label="Path">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
          onClick={() => navigateBreadcrumb("")}
          disabled={!path}
        >
          <GitBranch size={12} /> {owner}
        </button>
        {breadcrumbs.map((crumb, index) => (
          <span key={crumb.path} className="inline-flex items-center gap-1">
            <ChevronRight size={12} />
            <button
              type="button"
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground${index === breadcrumbs.length - 1 ? " bg-muted text-foreground" : ""}`}
              onClick={() => navigateBreadcrumb(crumb.path)}
              disabled={index === breadcrumbs.length - 1}
            >
              {crumb.label}
            </button>
          </span>
        ))}
      </nav>

      {state.kind === "error" ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle size={16} />
          <div>
            <strong>{state.message}</strong>
            {state.detail ? <pre>{state.detail}</pre> : null}
          </div>
          <button type="button" className="link-button" onClick={refresh}>
            Retry
          </button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)_minmax(0,260px)]">
        <aside className="flex max-h-[calc(100vh-22rem)] flex-col rounded-lg border border-border bg-card overflow-hidden">
          <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2 text-sm font-medium text-foreground">
            <Folder size={14} />
            <span>{path || "(root)"}</span>
            {state.kind === "loading" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : null}
            {treeTruncated ? (
              <span className="text-xs font-normal text-muted-foreground">tree truncated</span>
            ) : null}
          </header>
          {state.kind === "loading" && tree.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">Loading…</div>
          ) : !pathExists ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">Path not found in tree.</div>
          ) : entries.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">Empty directory.</div>
          ) : (
            <ul className="flex-1 overflow-y-auto p-1 text-sm">
              {entries.map((entry) => {
                const isOpen = selected?.path === entry.path;
                return (
                  <li key={entry.path}>
                    <button
                      type="button"
                      className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-foreground hover:bg-muted${isOpen ? " bg-muted text-foreground" : ""}`}
                      onClick={() => openEntry(entry)}
                      title={entry.path}
                    >
                      {entry.type === "dir" ? (
                        <FolderOpen size={14} />
                      ) : (
                        <FileCode2 size={14} />
                      )}
                      <span className="truncate">{entry.name}</span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {entry.type === "file" ? humanSize(entry.size) : "dir"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <article className="flex min-h-[400px] flex-col rounded-lg border border-border bg-card overflow-hidden">
          <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2 text-sm font-medium text-foreground">
            <FileCode2 size={14} />
            <span>
              {selected ? selected.path : "Pick a file from the tree"}
            </span>
            {selected ? (
              <>
                {dirty ? (
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    title="This file has unsaved local edits."
                  >
                    <CircleAlert size={11} /> Modified
                  </span>
                ) : null}
                <span className="text-xs font-normal text-muted-foreground">{humanSize(selected.size)}</span>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                  onClick={discardEdits}
                  disabled={!dirty}
                  title={dirty ? "Discard local edits" : "No unsaved edits"}
                >
                  <RotateCcw size={12} /> Reset
                </button>
              </>
            ) : null}
          </header>
          <div className="flex-1 overflow-auto">
            {selected ? (
              <CodeMirror
                value={selected.text}
                theme={oneDark}
                extensions={editorLang}
                editable={true}
                onChange={onEditorChange}
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: true,
                  highlightActiveLine: true,
                  highlightActiveLineGutter: true,
                  bracketMatching: true,
                  highlightSelectionMatches: true,
                  autocompletion: false,
                }}
                aria-label={`Contents of ${selected.path}`}
                height="100%"
              />
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
                <FileCode2 size={28} />
                <p>Click a file on the left to load it here.</p>
                <small>
                  Editor uses CodeMirror with one-dark syntax highlighting.
                </small>
              </div>
            )}
          </div>
        </article>
      </div>

      {playwrightRepoActive && selected && blocks.length > 0 ? (
        <aside className="flex max-h-[calc(100vh-22rem)] flex-col rounded-lg border border-border bg-card overflow-hidden">
          <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2 text-sm font-medium text-foreground">
            <ListChecks size={14} />
            <span>
              Test blocks · {blocks.length}{" "}
              {blocks.length === 1 ? "block" : "blocks"}
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              {blocks.filter((b) => b.kind === "test").length} test
              {blocks.filter((b) => b.kind === "test").length === 1 ? "" : "s"}
              {" · "}
              {blocks.filter((b) => b.kind === "describe").length} describe
              {" · "}
              {blocks.filter((b) => b.kind === "step").length} step
              {blocks.filter((b) => b.kind === "step").length === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
              onClick={launchAllBlocks}
              title="Run every block in this file as one script"
            >
              <Play size={12} /> Run all
            </button>
          </header>
          <ul className="flex-1 overflow-y-auto p-1 text-sm">
            {blocks.map((block, idx) => (
              <li
                key={`${block.startLine}-${idx}`}
                className={`flex items-center gap-2 px-2 py-1 hover:bg-muted`}
              >
                <span
                  className="w-8 text-right text-xs tabular-nums text-muted-foreground"
                  title={`starts at line ${block.startLine + 1}`}
                >
                  L{block.startLine + 1}
                </span>
                <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{block.kind}</span>
                <span className="flex-1 truncate" title={block.source}>
                  {block.name}
                </span>
                <button
                  type="button"
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-primary/10 hover:text-primary"
                  onClick={() => runBlockInline(block)}
                  title={`Run this ${block.kind} block in the Playwright runner`}
                  aria-label={`Run ${block.kind} ${block.name}`}
                >
                  <Play size={12} />
                </button>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}

      <div
        className={`fixed inset-0 flex pointer-events-none${envExpanded ? " pointer-events-auto" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-hidden={!envExpanded}
        aria-label="Secrets · .env"
        ref={envCardRef}
      >
        <button
          type="button"
          className="fixed inset-0 bg-black/40"
          tabIndex={envExpanded ? 0 : -1}
          aria-label="Close secrets panel"
          onClick={() => setEnvExpanded(false)}
        />
        <aside className="pointer-events-auto relative ml-auto flex h-full w-full max-w-md flex-col border-l border-border shadow-lg bg-card">
          <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <KeyRound size={14} />
            <span>Secrets · .env</span>
            <span className="text-xs font-normal text-muted-foreground">
              {envFilledCount} {envFilledCount === 1 ? "key" : "keys"}
              {envEntries.length === 0 ? " · empty" : ""}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                onClick={() => setEnvValuesHidden((current) => !current)}
                aria-label={envValuesHidden ? "Reveal values" : "Hide values"}
                title={
                  envValuesHidden
                    ? "Reveal values in the rows"
                    : "Hide values in the rows"
                }
              >
                {envValuesHidden ? <Eye size={12} /> : <EyeOff size={12} />}
                {envValuesHidden ? " Reveal" : " Hide"}
              </button>
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setEnvExpanded(false)}
                aria-label="Close secrets panel"
                title="Close"
              >
                <X size={14} />
              </button>
            </div>
          </header>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/*
              GitHub Personal Access Token. Authenticated requests get
              5000 req/hr instead of the 60 req/hr anonymous tier, which
              is the difference between "browsing works" and "rate limit
              errors". The token is stored only in localStorage in this
              browser -- it never leaves the device.
            */}
            <section className="space-y-3">
              <header className="flex items-center justify-between gap-2">
                <KeyRound size={14} />
                <span>GitHub Personal Access Token</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {githubTokenFilled
                    ? "authed · 5000 req/hr"
                    : "anonymous · 60 req/hr"}
                </span>
              </header>
              <div className="flex items-center gap-2">
                <input
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={githubToken}
                  onChange={(event) => setGithubToken(event.target.value)}
                  type={githubTokenVisible ? "text" : "password"}
                  placeholder="ghp_… or github_pat_…"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  autoComplete="off"
                  aria-label="GitHub Personal Access Token"
                />
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                  onClick={() => setGithubTokenVisible((current) => !current)}
                  aria-label={
                    githubTokenVisible ? "Hide token" : "Reveal token"
                  }
                  title={githubTokenVisible ? "Hide token" : "Reveal token"}
                >
                  {githubTokenVisible ? (
                    <EyeOff size={12} />
                  ) : (
                    <Eye size={12} />
                  )}
                  {githubTokenVisible ? " Hide" : " Reveal"}
                </button>
                {githubTokenFilled ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted"
                    onClick={() => {
                      setGithubToken("");
                      setGithubTokenVisible(false);
                    }}
                    aria-label="Clear token"
                    title="Remove the saved token"
                  >
                    <Trash2 size={12} /> Clear
                  </button>
                ) : null}
              </div>
              <span className="text-xs text-muted-foreground text-xs text-muted-foreground">
                Optional. Create one at{" "}
                <a
                  href="https://github.com/settings/tokens?type=beta"
                  target="_blank"
                  rel="noreferrer"
                >
                  github.com/settings/tokens
                </a>{" "}
                (no scopes needed for public repos). Stored only in this
                browser.
              </span>
            </section>

            <hr className="border-border" />

            <span className="text-xs text-muted-foreground">
              Saved automatically. In Playwright snippets use{" "}
              <code>env.KEY_NAME</code>.
            </span>

            <div className="space-y-2">
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                  <span>Key</span>
                  <input
                    value={draftKey}
                    onChange={(event) => setDraftKey(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addEnvProperty();
                      }
                    }}
                    placeholder="GITHUB_TOKEN"
                    spellCheck={false}
                    autoCapitalize="characters"
                    autoCorrect="off"
                    aria-label="New property key"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground flex-1 min-w-[160px]">
                  <span>Value</span>
                  <input
                    value={draftValue}
                    onChange={(event) => setDraftValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addEnvProperty();
                      }
                    }}
                    placeholder="ghp_xxx…"
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    aria-label="New property value"
                  />
                </label>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                  onClick={addEnvProperty}
                  disabled={!draftKey.trim()}
                  title="Add a new key/value pair"
                >
                  <Plus size={14} /> Add Property
                </button>
              </div>
            </div>

            {envEntries.length > 0 ? (
              <ul className="space-y-1.5">
                {envEntries.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
                    <input
                      className="font-mono text-xs"
                      value={entry.key}
                      onChange={(event) =>
                        updateEnvEntry(entry.id, { key: event.target.value })
                      }
                      spellCheck={false}
                      autoCapitalize="characters"
                      autoCorrect="off"
                      aria-label={`Key for entry ${entry.key || "untitled"}`}
                    />
                    <span className="text-xs text-muted-foreground">=</span>
                    <input
                      className="flex-1 truncate font-mono text-xs text-muted-foreground"
                      value={entry.value}
                      type={envValuesHidden ? "password" : "text"}
                      onChange={(event) =>
                        updateEnvEntry(entry.id, { value: event.target.value })
                      }
                      spellCheck={false}
                      autoCapitalize="off"
                      autoCorrect="off"
                      aria-label={`Value for entry ${entry.key || "untitled"}`}
                    />
                    <button
                      type="button"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => removeEnvEntry(entry.id)}
                      aria-label={`Remove ${entry.key || "untitled"}`}
                      title="Remove this property"
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </aside>
      </div>

      {/*
        Run output drawer. Slides up from the bottom of the viewport when
        a gutter Play button is clicked. Fixed-position so it stays
        anchored over the editor + tree, regardless of where the user has
        scrolled. The backdrop is invisible (just a transparent hit
        target) so the drawer doesn't visually compete with the editor.
      */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-40 flex justify-center px-4 pb-4 pointer-events-none${inlineDrawerOpen ? " pointer-events-auto" : ""}${
          inlineRunning ? " " : ""
        }${inlineDrawerCollapsed ? " max-w-md" : ""}`}
        role="dialog"
        aria-modal="false"
        aria-hidden={!inlineDrawerOpen}
        aria-label="Run output"
      >
        <div
          className="fixed inset-0 z-40 bg-black/40"
          onClick={() => setInlineDrawerOpen(false)}
          aria-hidden="true"
        />
        <aside className="pointer-events-auto relative z-50 flex w-full max-w-3xl flex-col rounded-lg border border-border bg-card shadow-lg overflow-hidden">
          <header className="pw-card-header flex items-center justify-between gap-2 border-b border-border px-4 py-2">
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
              onClick={() => setInlineDrawerCollapsed((current) => !current)}
              aria-label={
                inlineDrawerCollapsed
                  ? "Expand run output"
                  : "Collapse run output"
              }
              aria-expanded={!inlineDrawerCollapsed}
              title={inlineDrawerCollapsed ? "Expand" : "Collapse"}
            >
              {inlineDrawerCollapsed ? (
                <ChevronUp size={14} />
              ) : (
                <ChevronDown size={14} />
              )}
            </button>
            <Play size={14} />
            <span className="text-xs font-medium text-muted-foreground truncate">{inlineLabel ?? "Run output"}</span>
            {inlineRunning ? (
              <Loader2 size={14} className="animate-spin" />
            ) : null}
            <RunSummary
              counts={inlineCounts}
              running={inlineRunning}
              total={inlineLogs.length}
            />
            <div className="flex items-center gap-1">
              {inlineRunning ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => inlineCancelRef.current?.()}
                  aria-label="Stop run"
                  title="Stop run"
                >
                  <Square size={12} /> Stop
                </button>
              ) : null}
              {inlineLogs.length > 0 && !inlineRunning ? (
                <button
                  type="button"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                  onClick={() => {
                    setInlineLogs([]);
                    setInlineLabel(null);
                    setInlineDrawerOpen(false);
                  }}
                  title="Clear output"
                  aria-label="Clear output"
                >
                  <RotateCcw size={12} /> Clear
                </button>
              ) : null}
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                onClick={() => setInlineDrawerOpen(false)}
                aria-label="Close run drawer"
                title="Close"
              >
                <X size={14} />
              </button>
            </div>
          </header>
          <div className="max-h-[40vh] overflow-y-auto">
            {inlineLogs.length === 0 ? (
              <div className="pw-empty">Waiting for logs…</div>
            ) : (
              <ul className="pw-log-list">
                {inlineLogs.map((log) => (
                  <li key={log.id} className={`pw-log pw-log-${log.kind}`}>
                    <span className="pw-log-kind">{log.kind}</span>
                    <span className="pw-log-text">
                      {log.text}
                      {log.detail ? (
                        <pre className="pw-log-detail">
                          <X
                            size={12}
                            style={{ float: "right", cursor: "pointer" }}
                            onClick={() =>
                              setInlineLogs((current) =>
                                current.filter((item) => item.id !== log.id),
                              )
                            }
                            aria-label="Dismiss entry"
                          />
                          {log.detail}
                        </pre>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
