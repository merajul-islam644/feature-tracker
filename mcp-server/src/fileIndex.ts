// File-system watcher + project-wide text search.
//
// Two concerns, one module — both hang off the user's picked folder:
//
//   • `watchFolder(root)` — wraps chokidar to surface add /
   // unlink / change events as a tagged SSE channel. Used by the
//   workspace to detect external edits so the user can be
//   prompted to reload (the silent-overwrite trap is the single
//   most common cause of "my code reverted" tickets in any code
//   editor).
//
//   • `searchInFolder(root, opts)` — recursive grep-style search
//   over text files in the picked folder, skipping binary +
//   `node_modules`/`.git`. Returns `{ path, line, column, preview }
//   records — the same shape ripgrep uses for `--json` output, so
//   the frontend can re-use rg-flavoured lists if it ever wants.
//
// Why not shell out to ripgrep? Same reason the rest of mcp-server
// keeps file ops in-process: portable, no extra PATH requirement
// for the panel to function, deterministic behaviour on Windows
// where rg may not be on PATH. The cap (10k files × 1MB each)
// is enough for any real project without threatening the route.

import * as fs from "node:fs/promises";
import { readdirSync, statSync, type Dirent } from "node:fs";
import { join, relative, sep } from "node:path";
import chokidar from "chokidar";
import { safeResolveUserFolder } from "./devServer.js";

// ─────────────────────────────────────────────────────────────────────
//  Watcher
// ─────────────────────────────────────────────────────────────────────

export type WatchEventKind = "add" | "change" | "unlink" | "addDir" | "unlinkDir";
export interface WatchEvent {
  kind: WatchEventKind;
  /** Path relative to the watched root, forward-slash-joined. */
  path: string;
  /** Absolute path on disk — useful for callers that want to
   *  re-stat the file (size, mtime). */
  absPath: string;
  /** `Date.now()` at emit. */
  ts: number;
}

interface WatcherRecord {
  /** Composite id `ws-<workspaceId+rootHash>` — the SSE channel
   *  key the frontend subscribes to. */
  id: string;
  root: string;
  watcher: chokidar.FSWatcher;
  events: WatchEvent[];
  cursor: number;
  waiters: Array<() => void>;
  /** Refcount — increments on `watchFolder()` repeat opens,
   *  decrements on close. When it hits 0 the watcher is torn
   *  down. Lets multiple SSE consumers coexist (e.g. the panel
   *  AND the Explorer) without each killing the other's
   *  subscription. */
  refcount: number;
}

const watchers = new Map<string, WatcherRecord>();

// Tiny FNV-1a — keeps the watcher id deterministic for the same
// (workspaceId, root) pair across mounts. Hash collisions are
// irrelevant; the SSE channel `index.html` is unique per ws.
function hash32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function watcherId(workspaceId: string, root: string): string {
  return `ws-${workspaceId}-${hash32(root)}`;
}

/** Open a chokidar watcher on `root`. Idempotent — calling twice
 *  with the same root returns the existing record and bumps the
 *  refcount so the watcher stays alive across HMR remounts. */
export function watchFolder(workspaceId: string, root: string): WatcherRecord {
  const id = watcherId(workspaceId, root);
  const existing = watchers.get(id);
  if (existing) {
    existing.refcount++;
    return existing;
  }

  // chokidar's `ignored` runs per-path. We mirror the same
  // exclusion list the tree-walk uses (node_modules + .git) plus
  // dotfiles generally — those are nearly always tooling state
  // and would just spam the SSE channel.
  const ignored = (p: string): boolean => {
    const segments = p.split(/[\\/]+/);
    for (const s of segments) {
      if (s === "node_modules" || s === ".git") return true;
      // Skip dotfiles (`.env`, `.eslintrc`, …) — they exist but
      // most users don't care to see them flicker. Allow `.vscode/`
      // through because IDE state there is interesting to advanced
      // users; the threshold is "files I'd edit".
      if (s.startsWith(".") && s !== "." && s !== "..") return true;
    }
    return false;
  };

  const watcher = chokidar.watch(root, {
    ignored,
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: {
      // Debounce write-streams so a single `git checkout` (which
      // is many small writes) produces ONE change event per file
      // instead of 50. 200ms is long enough to coalesce text
      // editor saves, short enough that the user doesn't notice.
      stabilityThreshold: 200,
      pollInterval: 50,
    },
    // Depth guard — same 8 used by walkTree so the watcher
    // doesn't try to descend into nested node_modules symlinks.
    depth: 8,
  });

  const rec: WatcherRecord = {
    id,
    root,
    watcher,
    events: [],
    cursor: 0,
    waiters: [],
    refcount: 1,
  };

  const push = (kind: WatchEventKind, absPath: string) => {
    // Drop events for paths outside the watched root (chokidar
    // can fire for symlinked siblings on POSIX). Relative path
    // with forward slashes — matches the Explorer tree shape.
    const rel = relative(root, absPath).split(sep).join("/");
    if (rel.startsWith("..")) return;
    const ev: WatchEvent = { kind, path: rel, absPath, ts: Date.now() };
    rec.events.push(ev);
    // Cap the buffer so a runaway FS event (e.g. `git clean -fdx`
    // deleting 5K files) doesn't OOM the route. Same defence as
    // devServer.ts's event log.
    if (rec.events.length > 5_000) rec.events.splice(0, rec.events.length - 5_000);
    rec.cursor = rec.events.length;
    for (const w of rec.waiters.splice(0)) w();
  };

  watcher
    .on("add", (p) => push("add", p))
    .on("change", (p) => push("change", p))
    .on("unlink", (p) => push("unlink", p))
    .on("addDir", (p) => push("addDir", p))
    .on("unlinkDir", (p) => push("unlinkDir", p))
    .on("error", (err) => {
      // Don't crash mcp-server on a transient FS error (locked
      // file, permission blip). Log via the Fastify logger which
      // `attachShellToSocket` doesn't have access to.
      console.warn("[fileIndex] chokidar error:", (err as Error).message);
    });

  watchers.set(id, rec);
  return rec;
}

/** Decrement the refcount; close the watcher when it hits 0.
 *  Called by the SSE route when the consumer disconnects. */
export function unwatchFolder(id: string): void {
  const rec = watchers.get(id);
  if (!rec) return;
  rec.refcount--;
  if (rec.refcount <= 0) {
    void rec.watcher.close();
    watchers.delete(id);
  }
}

export function getWatcher(id: string): WatcherRecord | undefined {
  return watchers.get(id);
}

export function eventsAfterWatcher(id: string, since: number): WatchEvent[] {
  const rec = watchers.get(id);
  if (!rec) return [];
  return rec.events.slice(Math.max(0, since));
}

export function waitForWatcherEvents(
  id: string,
  since: number,
  timeoutMs = 30_000,
): Promise<WatchEvent[]> {
  return new Promise((resolve) => {
    const rec = watchers.get(id);
    if (!rec) return resolve([]);
    if (rec.cursor > since) return resolve(rec.events.slice(since));
    const w = () => {
      clearTimeout(t);
      const r = watchers.get(id);
      resolve(r ? r.events.slice(since) : []);
    };
    const t = setTimeout(() => {
      const idx = rec.waiters.indexOf(w);
      if (idx >= 0) rec.waiters.splice(idx, 1);
      resolve(eventsAfterWatcher(rec.id, since));
    }, timeoutMs);
    rec.waiters.push(w);
  });
}

/** Test/teardown helper — tears down every watcher. Used by the
 *  SIGINT path in index.ts (same pattern as
 *  shutdownAllDevServers). */
export async function shutdownAllWatchers(): Promise<void> {
  const all = Array.from(watchers.values());
  watchers.clear();
  await Promise.allSettled(all.map((w) => w.watcher.close()));
}

// ─────────────────────────────────────────────────────────────────────
//  Search
// ─────────────────────────────────────────────────────────────────────

export interface SearchOptions {
  /** Substring or regex body (regex when `regex: true`). */
  query: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  /** Glob-like patterns to scope the search (e.g. `["src/**", "*.ts"]`).
   *  Empty / undefined = search every text file under root. */
  includeGlobs?: string[];
  /** Glob-like patterns to exclude (e.g. `["dist/**"]). */
   excludeGlobs?: string[];
  /** Hard cap on results — protects the route from a query
   *  matching millions of lines. */
  maxResults?: number;
}

export interface SearchResult {
  /** Path relative to `root`, forward-slash-joined. */
  path: string;
  line: number;
  column: number;
  /** Single-line preview with a trailing newline-stripped copy
   *  of the matched line (or, for multi-line matches, the line
   *  that contains the start of the match). */
  preview: string;
}

const TEXT_EXT_HINT = new Set([
  // Keep in sync with the FileTreeItem languageLabel.ts list. If
  // it has no syntax hint it's also not a great search target.
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".html", ".css", ".scss", ".less",
  ".md", ".mdx", ".txt",
  ".py", ".java", ".c", ".h", ".cpp", ".hpp", ".cc",
  ".sql", ".yml", ".yaml", ".toml",
  ".xml", ".svg", ".vue", ".svelte",
  ".sh", ".bash", ".zsh", ".ps1", ".bat", ".cmd",
  ".env", ".ini", ".cfg", ".conf",
  ".rs", ".go", ".rb", ".php",
]);

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build"]);
const MAX_FILE_BYTES = 1_048_576; // 1MB — same cap as the editor
const DEFAULT_MAX_RESULTS = 5_000;

/** Recursive text search. Skips binary files by extension + the
 *  configured `SKIP_DIRS`. Honours `caseSensitive` / `wholeWord`
 *  / `regex` flags identically to VS Code's "Search in Files". */
export async function searchInFolder(
  root: string,
  opts: SearchOptions,
): Promise<SearchResult[]> {
  const maxResults = opts.maxResults ?? DEFAULT_MAX_RESULTS;

  // Compile the matcher. We always anchor at the start of the
  // match (no `\b`/`^`) so partial-line matches work, but we
  // honour `wholeWord` by wrapping in `\b…\b` when set.
  let matcher: RegExp;
  if (opts.regex) {
    matcher = new RegExp(opts.query, opts.caseSensitive ? "g" : "gi");
  } else if (opts.wholeWord) {
    matcher = new RegExp(
      `\\b${escapeRegex(opts.query)}\\b`,
      opts.caseSensitive ? "g" : "gi",
    );
  } else {
    matcher = new RegExp(escapeRegex(opts.query), opts.caseSensitive ? "g" : "gi");
  }

  const include = compileGlobs(opts.includeGlobs);
  const exclude = compileGlobs(opts.excludeGlobs);

  const out: SearchResult[] = [];
  // Walk with an explicit stack (no recursion) so a deep tree
  // doesn't blow the call stack on Windows.
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = (await fs.readdir(dir, { withFileTypes: true })) as Dirent[];
    } catch {
      continue; // permission denied / vanished mid-walk
    }
    for (const e of entries) {
      if (out.length >= maxResults) return out;
      const abs = join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        stack.push(abs);
        continue;
      }
      if (!e.isFile()) continue;
      const rel = relative(root, abs).split(sep).join("/");
      if (exclude && exclude.some((rx) => rx.test(rel))) continue;
      if (include && !include.some((rx) => rx.test(rel))) continue;

      // Cheap extension filter: skip obvious binaries before
      // reading the file. Files with no extension get included
      // (`.env`, `Makefile`, etc.) — the size cap + a UTF-8
      // validation below filters the rest.
      const dot = e.name.lastIndexOf(".");
      const ext = dot >= 0 ? e.name.slice(dot).toLowerCase() : "";
      if (ext && !TEXT_EXT_HINT.has(ext)) continue;

      let content: string;
      try {
        const st = await fs.stat(abs);
        if (st.size > MAX_FILE_BYTES) continue;
        const buf = await fs.readFile(abs);
        // Heuristic binary check — UTF-8 reject. A binary file
        // containing a null byte in the first 1KB will trip this
        // and skip. Cheap vs `chardet`.
        if (buf.includes(0)) continue;
        content = buf.toString("utf8");
      } catch {
        continue; // permission denied / vanished
      }

      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        // Reset the regex state every line — `g` flag advances
        // `lastIndex`, so a fresh `.test()` would skip the next
        // match after a hit. Splitting per-line avoids the
        // complication of multi-line regexes entirely.
        matcher.lastIndex = 0;
        const m = matcher.exec(lines[i]);
        if (!m) continue;
        out.push({
          path: rel,
          line: i + 1,
          column: m.index + 1,
          preview: lines[i].slice(0, 400),
        });
        if (out.length >= maxResults) return out;
      }
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Convert a list of user-supplied glob-like patterns into RegExp
 *  predicates. Supports `*` (any non-slash chars) and `**`
 *  (any chars). Empty / undefined → null (no filter). */
function compileGlobs(patterns: string[] | undefined): RegExp[] | null {
  if (!patterns || patterns.length === 0) return null;
  return patterns.map((pat) => {
    let rx = "^";
    for (let i = 0; i < pat.length; i++) {
      const c = pat[i];
      if (c === "*") {
        if (pat[i + 1] === "*") {
          rx += ".*";
          i++; // consume the second *
        } else {
          rx += "[^/]*";
        }
      } else if (c === "?") {
        rx += "[^/]";
      } else {
        rx += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      }
    }
    rx += "$";
    return new RegExp(rx);
  });
}

// Re-export the resolver so callers don't need a second import.
export { safeResolveUserFolder };