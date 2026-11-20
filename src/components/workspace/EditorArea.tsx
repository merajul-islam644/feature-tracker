// CodeMirror editor area — VS Code-style file source view with
// syntax highlighting driven by `@codemirror/language-data` (which
// bundles grammars for JS/TS, JSON, HTML, CSS, Markdown, Python,
// Rust, Go, Java, SQL, YAML, TOML, etc.). The path-to-language
// mapping lives in `languageForPath` below — fall-through is
// "plain text" so an unknown extension still renders, just without
// tokens.
//
// Lifted and adapted from `PlaywrightEditorPanel.tsx:3093-3153`.
//
// Three render modes:
//   1. !hasFolder              → return null. The parent renders
//                                <WorkspaceEmptyState> in the
//                                right column instead.
//   2. hasFolder && !activePath → "no file open" hint (folded file
//                                picker — encourages Explorer use).
//   3. hasFolder && activePath  → CodeMirror with oneDark theme and
//                                a per-extension grammar.
//
// Scrolling: the outer wrapper is `min-h-0 flex-1 overflow-auto`
// so CodeMirror's inner scroller is bounded by the column height,
// not the document length — long files scroll within the editor
// area instead of pushing the page.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Decoration,
  EditorView,
  GutterMarker,
  hoverTooltip,
  keymap,
  WidgetType,
  gutter,
  type EditorView as EditorViewType,
} from "@codemirror/view";
import {
  EditorState,
  RangeSet,
  StateEffect,
  StateField,
  type Extension,
  type Range,
} from "@codemirror/state";
import {
  completeFromList,
  type Completion,
  type CompletionContext,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { linter, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
// Type-only — no runtime cycle (TestingPanel never imports this file).
import type { TestMark } from "./TestingPanel";
import { oneDark } from "@codemirror/theme-one-dark";
import { languages } from "@codemirror/language-data";
import { LanguageDescription } from "@codemirror/language";
import CodeMirror from "@uiw/react-codemirror";
import { FileCode2, X } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import type {
  LspDiagnostic,
  LspHover,
  LspLocation,
} from "@/types/dev-server";
import type { GitBlameLine, GitDiffHunk } from "@/types/git";
import { devServerApi } from "@/services/devServerApi";
import { useDevServer } from "@/contexts/DevServerContext";
import { basename } from "./treeHelpers";

interface EditorAreaProps {
  activePath: string | null;
  /** Current content for the active file. */
  content: string;
  /** Per-path dirty flag — disables edits when a save is in flight. */
  readOnly?: boolean;
  /** LSP diagnostics for the active file (Phase 1). Rendered as
   *  squiggly underlines + gutter markers via `@codemirror/lint`. */
  diagnostics?: LspDiagnostic[];
  /** When false, the parent owns the empty state (no folder picked
   *  yet). When true, this component falls back to its own "no file
   *  open" sub-state. */
  hasFolder: boolean;
  onChange: (value: string) => void;
  /**
   * Fires once when the CodeMirror view is created. WorkspacePage
   * uses this to keep a ref to the live view so the toolbar's
   * Undo/Redo/Discard buttons can dispatch transactions directly.
   */
  onCreateEditor?: (view: EditorViewType) => void;
  /**
   * Fires whenever the cursor moves (or the doc changes) with the
   * 1-indexed `(line, column)` of the selection head. The status bar
   * uses this to render "Ln N, Col M" without reading the editor
   * directly. Debounced upstream by CodeMirror's update cycle.
   */
  onCursorChange?: (line: number, col: number) => void;
  // ── Phase 2 LSP features ────────────────────────────────────────
  /** Hover lookup. Null → no tooltip; the editor renders the payload's
   *  `contents` as preformatted text pinned to the server's range. */
  onHover?: (pos: number) => Promise<LspHover | null>;
  /** Go-to-definition (Ctrl/Cmd+Click, F12, command palette). The
   *  parent navigates and toasts when nothing is found. */
  onDefinition?: (pos: number) => void;
  /** Find references (Shift+F12). Resolves to the hit list that the
   *  peek panel renders; null = lookup failed (toasted upstream). */
  onFindReferences?: (pos: number) => Promise<LspLocation[] | null>;
  /** Rename symbol (F2). The parent applies the WorkspaceEdit across
   *  open tabs and closed files; null = refused (toasted upstream). */
  onRename?: (
    pos: number,
    newName: string,
  ) => Promise<{ files: number; edits: number } | null>;
  /** Bump from 0 → opens the rename input at the cursor (the command
   *  palette's "Rename Symbol" has no cursor position of its own). */
  renameSignal?: number;
  /** Open a path at a 1-indexed line/column — how peek rows navigate. */
  onNavigate?: (path: string, line: number, column: number) => void;
  // ── Editor git integration ──────────────────────────────────────
  /** Inline blame readout on the cursor line. Gutter change-bars are
   *  always on; blame is toggled from the status bar (persisted). */
  blameEnabled?: boolean;
  // ── Testing integration ─────────────────────────────────────────
  /** Per-file pass/fail marks from the Testing panel's structured
   *  runs, keyed by rel path. The active file's marks render in the
   *  test gutter (right of the git bars' line-number column). */
  testMarks?: Record<string, TestMark[]>;
}

// Maps a file path to a CodeMirror language name. Mirrors
// `languageLabel.ts` so the status bar label and the editor grammar
// agree on what "TypeScript JSX" or "Shell Script" means — a
// unknown extension here falls through to undefined (no grammar,
// plain text).
const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  md: "markdown",
  mdx: "markdown",
  css: "css",
  scss: "css",
  sass: "sass",
  less: "less",
  html: "html",
  htm: "html",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "yaml",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  sql: "sql",
  vue: "vue",
  svelte: "svelte",
};

// Whole-filename matches for dotfiles / config-as-code:
// `.eslintrc`, `tsconfig.json`, `Dockerfile`, `Makefile`, etc.
// Keys are lowercased basenames.
const LANG_BY_FILENAME: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  ".eslintrc": "javascript",
  ".prettierrc": "json",
  ".gitignore": "shell",
  ".dockerignore": "shell",
  ".env": "shell",
};

function languageNameForPath(path: string): string | null {
  if (!path) return null;
  const lower = path.toLowerCase();
  const slash = lower.lastIndexOf("/");
  const basename = slash === -1 ? lower : lower.slice(slash + 1);
  // Whole-filename match wins (e.g. "Dockerfile" before the
  // "file" extension).
  if (LANG_BY_FILENAME[basename]) return LANG_BY_FILENAME[basename];
  const dot = basename.lastIndexOf(".");
  if (dot === -1) return null;
  const ext = basename.slice(dot + 1);
  return LANG_BY_EXT[ext] ?? null;
}

// ─── Phase 0 completions ────────────────────────────────────────
// Two dependency-free sources layered on top of whatever the loaded
// grammar registers (CSS/HTML ship their own via the language packs):
//   1. word completion — identifiers already present in the document
//   2. curated keyword/snippet lists for the languages people
//      actually type here
// The typed, backend-backed LSP (go-to-definition, hover, diagnostics)
// is Phase 1; these make typing comfortable without any server.

// Document-word completion — the poor man's symbol list. Caps keep a
// huge file (package-lock.json territory) from stalling the popup:
// stop after 2 MB scanned or 400 distinct words. Numbers are noise,
// as is the word currently being typed. `validFor` lets the popup
// filter the same option list while the typed text stays a word,
// instead of re-scanning the document per keystroke.
const wordCompletion: CompletionSource = (context) => {
  const word = context.matchBefore(/[\w$][\w$]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  // CM6 does NOT post-filter a source's options — the source itself
  // must only return completions matching the typed text
  // (completeFromList does the same internally). Case-insensitive
  // prefix match keeps the popup relevant.
  const typed = word.text.toLowerCase();
  const text = context.state.doc.toString();
  const seen = new Set<string>();
  const options: Completion[] = [];
  const re = /[\w$][\w$]*/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const w = match[0];
    if (w.length < 3 || /^\d/.test(w)) continue;
    if (w === word.text || seen.has(w)) continue;
    if (!w.toLowerCase().startsWith(typed)) continue;
    seen.add(w);
    options.push({ label: w, type: "variable" });
    if (options.length >= 200 || re.lastIndex > 2_000_000) break;
  }
  // No `validFor` on purpose: the list is prefix-filtered here, so it
  // must re-run on every keystroke to shrink as the user types.
  return { from: word.from, options };
};

// Keyword families — keyed by the language name this file's
// `languageNameForPath` resolves. tsx/jsx fold into the TS/JS lists.
const KEYWORDS_JS: readonly string[] = [
  "const", "let", "var", "function", "return", "if", "else", "for",
  "while", "do", "switch", "case", "break", "continue", "new", "class",
  "extends", "import", "export", "from", "default", "async", "await",
  "try", "catch", "finally", "throw", "typeof", "instanceof", "delete",
  "yield", "static", "super", "this", "null", "undefined", "true",
  "false",
];
const KEYWORDS_TS: readonly string[] = [
  ...KEYWORDS_JS,
  "interface", "type", "enum", "implements", "namespace", "declare",
  "abstract", "readonly", "public", "private", "protected", "keyof",
  "infer", "as", "satisfies",
];
const KEYWORDS_PY: readonly string[] = [
  "def", "return", "if", "elif", "else", "for", "while", "break",
  "continue", "import", "from", "as", "class", "try", "except",
  "finally", "raise", "with", "lambda", "pass", "global", "nonlocal",
  "assert", "yield", "del", "in", "is", "not", "and", "or", "None",
  "True", "False", "self", "print", "range", "len",
];
// A handful of high-frequency JS/TS snippets — the ones muscle
// memory reaches for. `snippetCompletion` fields: `${x}` tab stops,
// `${}` the final cursor.
const SNIPPETS_TS: readonly Completion[] = [
  { label: "log", detail: "console.log(…)", type: "function" },
  { label: "fn", detail: "arrow function", type: "keyword" },
  { label: "intf", detail: "interface", type: "keyword" },
  { label: "imp", detail: "named import", type: "keyword" },
  { label: "tryc", detail: "try/catch", type: "keyword" },
  { label: "forof", detail: "for…of loop", type: "keyword" },
];
const SNIPPET_TEMPLATES: Record<string, string> = {
  log: "console.log(${text});${}",
  fn: "(${params}) => {\n\t${}\n}",
  intf: "interface ${Name} {\n\t${}\n}",
  imp: 'import { ${name} } from "${module}";',
  tryc: "try {\n\t${}\n} catch (${error}) {\n\t${error};\n}",
  forof: "for (const ${item} of ${list}) {\n\t${}\n}",
};

function keywordCompletionsFor(langName: string | null): Completion[] {
  if (!langName) return [];
  let keywords: readonly string[];
  let snippets: readonly Completion[] = [];
  if (langName === "typescript" || langName === "tsx") {
    keywords = KEYWORDS_TS;
    snippets = SNIPPETS_TS;
  } else if (
    langName === "javascript" ||
    langName === "jsx"
  ) {
    keywords = KEYWORDS_JS;
    snippets = SNIPPETS_TS;
  } else if (langName === "python") {
    keywords = KEYWORDS_PY;
  } else {
    return [];
  }
  return [
    ...keywords.map((k) => ({ label: k, type: "keyword" as const })),
    ...snippets,
  ];
}

// Turns the keyword/snippet list into a completion source. Snippet
// labels get their template body attached via `apply` so the menu
// shows the short label but inserts the skeleton.
function listCompletionSource(list: Completion[]): CompletionSource | null {
  if (list.length === 0) return null;
  const enriched = list.map((c) =>
    SNIPPET_TEMPLATES[c.label]
      ? { ...c, apply: SNIPPET_TEMPLATES[c.label] }
      : c,
  );
  return completeFromList(enriched);
}

// Flattens an LSP hover payload into tooltip text. `contents` is
// string | MarkedString | MarkedString[] | MarkupContent depending on
// the server — every branch resolves to its plain text and the pieces
// join with a blank line. Markdown chrome (**bold**, ```fences```)
// is left in place: hover signatures read fine as preformatted text.
function hoverContentText(contents: unknown): string {
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) {
    return contents
      .map((c) => hoverContentText(c))
      .filter((t) => t.length > 0)
      .join("\n\n");
  }
  if (contents && typeof contents === "object") {
    const value = (contents as { value?: unknown }).value;
    if (typeof value === "string") return value;
  }
  return "";
}

// ─── Editor git integration ──────────────────────────────────────
// Two always-registered extensions fed from React via StateEffects:
//   1. diff gutter — a colored bar per changed line, from the server's
//      `git diff -U0 HEAD` hunk parse. Bars follow the doc through
//      edits (RangeSet.map) and are rebuilt wholesale on each fetch.
//   2. inline blame — a ghost-text widget at the end of the CURSOR
//      line (GitLens-style current-line blame), rebuilt whenever the
//      blame data lands or the selection moves.
// Both fields are module-level singletons: @uiw reconfigures the full
// extension list on every render, and a per-render StateField would
// reset its state each time. Gutter bars sit right of the line
// numbers (GitHub-web placement) — VS Code's left-of-numbers position
// would require rebuilding basicSetup's gutter order.

/** Apply a fresh hunk list (1-based lines, from the server). */
const applyDiffHunks = StateEffect.define<GitDiffHunk[]>();

class GitBarMarker extends GutterMarker {
  constructor(private kind: "added" | "modified" | "deleted") {
    super();
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = `cm-git-bar cm-git-bar-${this.kind}`;
    return el;
  }
}
const BAR_ADDED = new GitBarMarker("added");
const BAR_MODIFIED = new GitBarMarker("modified");
const BAR_DELETED = new GitBarMarker("deleted");
/** Invisible spacer — keeps the gutter a constant width so bars don't
 *  shift the line numbers on repos whose first view has no changes. */
const BAR_SPACER = new (class extends GutterMarker {
  toDOM() {
    const el = document.createElement("div");
    el.className = "cm-git-bar cm-git-bar-spacer";
    return el;
  }
})();

const diffField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    const effect = tr.effects.find((e) => e.is(applyDiffHunks));
    if (effect) {
      const doc = tr.state.doc;
      const ranges: Range<GutterMarker>[] = [];
      for (const h of effect.value) {
        const marker =
          h.kind === "added"
            ? BAR_ADDED
            : h.kind === "modified"
              ? BAR_MODIFIED
              : BAR_DELETED;
        // Pure-deletion hunks report the line that now sits where the
        // block was (1-based) — clamp to the last line at EOF.
        const firstLine = Math.min(Math.max(h.line, 1), doc.lines);
        for (let i = 0; i < Math.min(h.count, 400); i++) {
          const lineObj = doc.line(Math.min(firstLine + i, doc.lines));
          // Same-position duplicates (a deleted marker landing on the
          // next hunk's first line) are collapsed — RangeSet rejects
          // two side-0 ranges at one position.
          if (ranges.length > 0 && ranges[ranges.length - 1].from === lineObj.from) {
            continue;
          }
          ranges.push({ from: lineObj.from, to: lineObj.from, value: marker });
        }
      }
      return RangeSet.of(ranges, true);
    }
    if (tr.docChanged) return value.map(tr.changes);
    return value;
  },
});

const gitGutterExtension = gutter({
  class: "cm-gitgutter",
  markers: (view) => view.state.field(diffField, false) ?? RangeSet.empty,
  initialSpacer: () => BAR_SPACER,
});

// ── Testing gutter (Testing panel v2) ───────────────────────────────
// Per-line ✓/✗ from the Testing panel's structured runs. Same
// contract as the git bars: the field below is the single source of
// truth and MUST be pushed into `extensions` — the gutter only reads
// it via `markers` (registration lesson baked in above).

/** Apply a fresh mark list (1-based lines, from the Testing panel). */
const applyTestMarks = StateEffect.define<TestMark[]>();

class TestMarkMarker extends GutterMarker {
  constructor(private kind: "passed" | "failed") {
    super();
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = `cm-test-mark cm-test-mark-${this.kind}`;
    el.textContent = this.kind === "passed" ? "✓" : "✗";
    el.title = this.kind === "passed" ? "test passed" : "test failed";
    return el;
  }
}
const TEST_PASSED = new TestMarkMarker("passed");
const TEST_FAILED = new TestMarkMarker("failed");
/** Keeps the gutter from collapsing to zero-width before any run. */
const TEST_SPACER = new (class extends GutterMarker {
  toDOM() {
    const el = document.createElement("div");
    el.className = "cm-test-mark cm-test-mark-spacer";
    return el;
  }
})();

const testMarkField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    const effect = tr.effects.find((e) => e.is(applyTestMarks));
    if (effect) {
      const doc = tr.state.doc;
      const ranges: Range<GutterMarker>[] = [];
      // Reporter order isn't line order — sort before the same-line
      // dedupe (RangeSet rejects two side-0 ranges at one position).
      const sorted = [...effect.value].sort((a, b) => a.line - b.line);
      for (const m of sorted) {
        const lineObj = doc.line(Math.min(Math.max(m.line, 1), doc.lines));
        if (
          ranges.length > 0 &&
          ranges[ranges.length - 1].from === lineObj.from
        ) {
          continue;
        }
        ranges.push({
          from: lineObj.from,
          to: lineObj.from,
          value: m.status === "passed" ? TEST_PASSED : TEST_FAILED,
        });
      }
      return RangeSet.of(ranges, true);
    }
    // Edits shift marks like they shift git bars.
    if (tr.docChanged) return value.map(tr.changes);
    return value;
  },
});

const testGutterExtension = gutter({
  class: "cm-testgutter",
  markers: (view) => view.state.field(testMarkField, false) ?? RangeSet.empty,
  initialSpacer: () => TEST_SPACER,
});

/** Apply a fresh blame map (1-based line → row). */
const applyBlameData = StateEffect.define<Map<number, GitBlameLine>>();

class BlameWidget extends WidgetType {
  constructor(readonly row: GitBlameLine) {
    super();
  }
  eq(other: BlameWidget) {
    return (
      other.row.line === this.row.line &&
      other.row.hash === this.row.hash &&
      other.row.time === this.row.time
    );
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-git-blame";
    span.setAttribute("data-testid", "git-blame");
    span.textContent = `${this.row.hash} ${this.row.author} · ${blameRelativeTime(this.row.time)} · ${this.row.summary}`;
    return span;
  }
  ignoreEvent() {
    return true;
  }
}

/** "3 days ago" — GitLens-style compact author-time. Epoch seconds in,
 *  coarse human string out; future clocks round down to "just now". */
function blameRelativeTime(epochSeconds: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - epochSeconds));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (days < 30) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (days < 365) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

interface BlameFieldState {
  map: Map<number, GitBlameLine>;
  cursorLine: number;
  decos: RangeSet<Decoration>;
}

function blameDecos(
  state: EditorState,
  map: Map<number, GitBlameLine>,
  cursorLine: number,
): RangeSet<Decoration> {
  const row = map.get(cursorLine);
  if (!row) return RangeSet.empty;
  try {
    const line = state.doc.line(cursorLine);
    return RangeSet.of([
      Decoration.widget({ widget: new BlameWidget(row), side: 1 }).range(
        line.to,
      ),
    ]);
  } catch {
    return RangeSet.empty;
  }
}

const blameField = StateField.define<BlameFieldState>({
  create: () => ({
    map: new Map(),
    cursorLine: 1,
    decos: RangeSet.empty,
  }),
  update(value, tr) {
    const effect = tr.effects.find((e) => e.is(applyBlameData));
    const map = effect ? effect.value : value.map;
    const cursorLine = tr.state.doc.lineAt(tr.state.selection.main.head).number;
    if (!effect && cursorLine === value.cursorLine && !tr.docChanged) {
      return value;
    }
    return {
      map,
      cursorLine,
      decos: blameDecos(tr.state, map, cursorLine),
    };
  },
  // Field value is a BlameFieldState wrapper, not a bare RangeSet,
  // so derive the decoration facet from `.decos` instead of `.from`.
  provide: (f) =>
    EditorView.decorations.compute([f], (state) => state.field(f).decos),
});

export function EditorArea({
  activePath,
  content,
  readOnly,
  diagnostics,
  hasFolder,
  onChange,
  onCreateEditor,
  onCursorChange,
  onHover,
  onDefinition,
  onFindReferences,
  onRename,
  renameSignal,
  onNavigate,
  blameEnabled = true,
  testMarks,
}: EditorAreaProps) {
  // Build the updateListener extension once per `onCursorChange`
  // reference. The callback itself is captured at extension-create
  // time so the listener never reads a stale closure.
  const cursorExtension = useMemo(() => {
    if (!onCursorChange) return undefined;
    return EditorView.updateListener.of((u) => {
      if (!(u.selectionSet || u.docChanged)) return;
      const head = u.state.selection.main.head;
      const lineObj = u.state.doc.lineAt(head);
      const line = lineObj.number;
      const col = head - lineObj.from + 1;
      onCursorChange(line, col);
    });
  }, [onCursorChange]);

  // Resolve the language support for the current path. The grammar
  // packs are async-imported by `LanguageDescription.load()`, so we
  // track the loaded support in state and re-resolve when
  // `activePath` changes. The fallback `null` keeps the editor
  // usable while the pack is loading — CodeMirror starts with plain
  // text and re-renders once the grammar arrives.
  const langName = activePath ? languageNameForPath(activePath) : null;
  const [langSupport, setLangSupport] = useState<
    Awaited<ReturnType<LanguageDescription["load"]>> | null
  >(null);
  useEffect(() => {
    let cancelled = false;
    setLangSupport(null);
    if (!langName) return;
    const desc = LanguageDescription.matchLanguageName(languages, langName);
    if (!desc) return;
    desc
      .load()
      .then((support) => {
        if (!cancelled) setLangSupport(support);
      })
      .catch(() => {
        // Unknown language name (rare with language-data, but
        // possible if the registry drops one). Fall through to
        // plain text — better than blocking it on a missing pack.
        if (!cancelled) setLangSupport(null);
      });
    return () => {
      cancelled = true;
    };
  }, [langName]);

  // Phase 0 completions — document-word + keyword/snippet sources for
  // the active language, re-registered when the grammar changes.
  // `EditorState.languageData` is the facet `autocompletion()` reads
  // sources from (via `languageDataAt("autocomplete", pos)`), and
  // registering through it applies at every position — the sources
  // fire even before the language pack finishes loading. This hook
  // MUST stay above the early returns below: a hook after a
  // conditional return changes hook order when the workspace resolves
  // and the component starts rendering the editor (React throws
  // "Rendered more hooks than during the previous render").
  const completionExtension = useMemo(() => {
    const listSource = listCompletionSource(keywordCompletionsFor(langName));
    // One data-entry PER source: the autocomplete package's `asSource`
    // treats an `autocomplete` value that is an array as a LIST OF
    // COMPLETIONS (wrapping it in completeFromList), not as a list of
    // sources — so bundling both sources into one array silently
    // broke the popup. Separate entries each pass through asSource
    // untouched.
    return EditorState.languageData.of(() => {
      const entries: { autocomplete: CompletionSource }[] = [
        { autocomplete: wordCompletion },
      ];
      if (listSource) entries.push({ autocomplete: listSource });
      return entries;
    });
  }, [langName]);

  // Phase 1 LSP diagnostics → CodeMirror lint markers. The source
  // closure reads the `diagnostics` prop through the memo so each
  // server publish rebuilds the extension and @uiw reconfigures the
  // editor. LSP and CodeMirror both count lines/chars from 0; the
  // only conversion is character-clamping against the real line
  // (a diagnostic can outlive an edit that shortened the line).
  const lintExtension = useMemo(() => {
    if (!diagnostics || diagnostics.length === 0) return [];
    return [
      linter(
        (view) => {
          const out: CmDiagnostic[] = [];
          for (const d of diagnostics) {
            try {
              const doc = view.state.doc;
              const line = doc.line(
                Math.min(Math.max(d.range.start.line + 1, 1), doc.lines),
              );
              const from = line.from + Math.min(
                d.range.start.character,
                line.length,
              );
              const endLine = doc.line(
                Math.min(Math.max(d.range.end.line + 1, 1), doc.lines),
              );
              const to = endLine.from + Math.min(
                Math.max(d.range.end.character, d.range.start.character + 1),
                endLine.length,
              );
              out.push({
                from,
                to: Math.max(to, from + 1),
                message: d.message,
                severity:
                  d.severity === 1
                    ? "error"
                    : d.severity === 2
                      ? "warning"
                      : "info",
                source: d.source ?? "ts",
              });
            } catch {
              // Position outside the doc (stale diagnostics after a
              // big paste/delete) — skip rather than throw.
            }
          }
          return out;
        },
        { delay: 250 },
      ),
    ];
  }, [diagnostics]);

  // ─── Phase 2 LSP: view ref + hover / definition / references ───
  // Internal view ref — the rename input and references peek need
  // cursor positions without a parent callback round-trip.
  const viewRef = useRef<EditorViewType | null>(null);
  // Bumped once the CodeMirror view exists. The git dispatch effects
  // below depend on it: their fetches can resolve before the view is
  // created (Vite transform latency on first open), and the plain
  // `viewRef.current` guard would silently drop that first payload.
  const [editorReady, setEditorReady] = useState(false);
  const handleView = useCallback(
    (view: EditorViewType) => {
      viewRef.current = view;
      setEditorReady(true);
      onCreateEditor?.(view);
    },
    [onCreateEditor],
  );

  // Hover tooltip. The lookup rides the same doc-sync the diagnostics
  // use, so hovering an unsaved buffer keeps tsserver current. One
  // round-trip per hover-start (not per mousemove) — tsserver hover
  // is fast enough not to need a cache.
  const hoverExtension = useMemo(() => {
    if (!onHover) return [];
    return [
      hoverTooltip(
        async (view, pos) => {
          try {
            const result = await onHover(pos);
            if (!result || !result.contents) return null;
            const text = hoverContentText(result.contents);
            if (!text) return null;
            const dom = document.createElement("div");
            dom.className = "cm-lsp-hover";
            dom.textContent = text;
            // Pin to the server's range (falls back to the exact
            // cursor position if the range is outside the doc —
            // stale hover after a big edit).
            let start = pos;
            let end = pos;
            const r = result.range;
            if (r) {
              try {
                const doc = view.state.doc;
                const s = doc.line(
                  Math.min(Math.max(r.start.line + 1, 1), doc.lines),
                );
                start = s.from + Math.min(Math.max(r.start.character, 0), s.length);
                const e = doc.line(
                  Math.min(Math.max(r.end.line + 1, 1), doc.lines),
                );
                end = e.from + Math.min(
                  Math.max(r.end.character, r.start.character + 1),
                  e.length,
                );
              } catch {
                /* keep cursor pos */
              }
            }
            return { pos: start, end, create: () => ({ dom }), above: true };
          } catch {
            return null;
          }
        },
        { hoverTime: 450 },
      ),
    ];
  }, [onHover]);

  // Rename input state. F2 (or the palette's renameSignal bump) opens
  // it pre-filled with the word under the cursor; Enter submits,
  // Escape cancels.
  const [renameBox, setRenameBox] = useState<{
    pos: number;
    value: string;
    busy: boolean;
  } | null>(null);
  const openRenameAt = useCallback(
    (pos: number) => {
      const view = viewRef.current;
      if (!view || !onRename) return;
      const word =
        view.state.wordAt(pos) ?? view.state.wordAt(Math.max(0, pos - 1));
      const text = word ? view.state.sliceDoc(word.from, word.to) : "";
      setRenameBox({ pos, value: text, busy: false });
    },
    [onRename],
  );
  useEffect(() => {
    if (!renameSignal) return;
    const view = viewRef.current;
    if (view) openRenameAt(view.state.selection.main.head);
  }, [renameSignal, openRenameAt]);
  const submitRename = useCallback(async () => {
    const box = renameBox;
    if (!box || !onRename || box.busy) return;
    const name = box.value.trim();
    if (!name) {
      setRenameBox(null);
      return;
    }
    setRenameBox((b) => (b ? { ...b, busy: true } : b));
    try {
      await onRename(box.pos, name);
    } finally {
      setRenameBox(null);
    }
  }, [renameBox, onRename]);

  // References peek state. The peek dies with the file — a stale list
  // pointing at the previous doc's lines is worse than no list.
  const [peek, setPeek] = useState<{
    word: string;
    items: LspLocation[];
  } | null>(null);
  useEffect(() => {
    setPeek(null);
  }, [activePath]);
  const runFindReferences = useCallback(
    async (pos: number) => {
      if (!onFindReferences) return;
      const view = viewRef.current;
      const word = view?.state.wordAt(pos);
      const wordText =
        word && view ? view.state.sliceDoc(word.from, word.to) : "symbol";
      try {
        const items = await onFindReferences(pos);
        setPeek({ word: wordText, items: items ?? [] });
      } catch {
        // Upstream already toasts failures; keep the editor quiet.
      }
    },
    [onFindReferences],
  );

  // Keymap + Ctrl/Cmd+Click bindings for the nav features. Each key
  // returns `true` to keep basicSetup's defaults (none of which bind
  // these keys) from reacting.
  const lspNavExtensions = useMemo(() => {
    const exts: Extension[] = [];
    if (onDefinition) {
      exts.push(
        keymap.of([
          {
            key: "F12",
            run: (view) => {
              onDefinition(view.state.selection.main.head);
              return true;
            },
          },
        ]),
      );
      // Ctrl/Cmd+Click — VS Code's go-to-definition gesture. Returns
      // true so the editor doesn't ALSO move the cursor to the click
      // point underneath the navigation.
      exts.push(
        EditorView.domEventHandlers({
          mousedown(event, view) {
            if (!(event.ctrlKey || event.metaKey) || event.button !== 0) {
              return false;
            }
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos == null) return false;
            event.preventDefault();
            onDefinition(pos);
            return true;
          },
        }),
      );
    }
    if (onFindReferences) {
      exts.push(
        keymap.of([
          {
            key: "Shift-F12",
            run: (view) => {
              void runFindReferences(view.state.selection.main.head);
              return true;
            },
          },
        ]),
      );
    }
    if (onRename) {
      exts.push(
        keymap.of([
          {
            key: "F2",
            run: (view) => {
              openRenameAt(view.state.selection.main.head);
              return true;
            },
          },
        ]),
      );
    }
    return exts;
  }, [onDefinition, onFindReferences, onRename, openRenameAt, runFindReferences]);

  // Line texts of the active file — lets peek rows show the source
  // line they point at without re-reading the file.
  const activeLines = useMemo(() => content.split("\n"), [content]);

  // ─── Editor git integration: fetch + dispatch ───────────────────
  // The panel-level git data lives on the server; this component only
  // needs the per-file slices. Like OutlinePanel, it self-fetches via
  // devServerApi and feeds the editors' module-level fields through
  // StateEffects. Both fetches debounce behind the autosave rhythm so
  // a typing burst costs one git spawn, not one per keystroke.
  const { workspace, workspaceRoot } = useDevServer();
  const workspaceId = workspace?.id ?? null;
  const root = workspaceRoot?.path ?? null;

  // Diff hunks (gutter bars) — `git diff -U0 HEAD` server-side.
  const [diffHunks, setDiffHunks] = useState<GitDiffHunk[]>([]);
  useEffect(() => {
    setDiffHunks([]);
    if (!activePath || !workspaceId || !root) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      devServerApi
        .gitFileHunks({ workspaceId, root, path: activePath })
        .then((hunks) => {
          if (!cancelled) setDiffHunks(hunks);
        })
        .catch(() => {
          // Not a repo / git missing / file vanished — an empty gutter
          // is the honest state; the Source Control panel owns toasts.
          if (!cancelled) setDiffHunks([]);
        });
    }, 700);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activePath, content, workspaceId, root]);

  // Blame — heavier spawn, so it also rate-limits: while typing keeps
  // autosave firing, a refetch younger than 4s keeps the previous map
  // (lines drift by a few until it settles — invisible at a glance).
  const [blameMap, setBlameMap] = useState<Map<number, GitBlameLine> | null>(
    null,
  );
  const blameFetchedAt = useRef(0);
  useEffect(() => {
    if (!activePath || !workspaceId || !root) {
      setBlameMap(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      if (Date.now() - blameFetchedAt.current < 4_000) return;
      blameFetchedAt.current = Date.now();
      devServerApi
        .gitBlame({ workspaceId, root, path: activePath })
        .then((rows) => {
          if (cancelled) return;
          if (!rows) {
            setBlameMap(null);
            return;
          }
          const map = new Map<number, GitBlameLine>();
          for (const r of rows) map.set(r.line, r);
          setBlameMap(map);
        })
        .catch(() => {
          if (!cancelled) setBlameMap(null);
        });
    }, 900);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [blameEnabled, activePath, content, workspaceId, root]);

  // Feed the fields. The dispatches are idempotent — a re-render with
  // unchanged data re-applies the same payload and the fields no-op.
  // `editorReady` re-fires them once the view exists, covering the
  // fetch-won-the-race case above.
  useEffect(() => {
    if (!editorReady) return;
    viewRef.current?.dispatch({ effects: applyDiffHunks.of(diffHunks) });
  }, [diffHunks, editorReady]);

  useEffect(() => {
    if (!editorReady) return;
    viewRef.current?.dispatch({
      effects: applyBlameData.of(blameEnabled ? (blameMap ?? new Map()) : new Map()),
    });
  }, [blameMap, blameEnabled, editorReady]);

  // Testing marks for the active file — same editorReady gate as the
  // hunks/blame above (a run can finish before the view exists).
  // `content` re-fires the dispatch after the doc arrives/changes:
  // a run that finished before the file was opened still lands, and
  // each dispatch is idempotent (same marks re-applied).
  useEffect(() => {
    if (!editorReady) return;
    const marks = activePath ? (testMarks?.[activePath] ?? []) : [];
    viewRef.current?.dispatch({ effects: applyTestMarks.of(marks) });
  }, [testMarks, activePath, editorReady, content]);

  // No folder → parent owns the empty state.
  if (!hasFolder) return null;

  if (!activePath) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-sm text-center text-xs text-muted-foreground">
          <FileCode2
            className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40"
            aria-hidden="true"
          />
          <p className="mb-2 font-medium text-foreground">No file open</p>
          <p>
            Pick a file from the Explorer, or click <Kbd>+</Kbd> in
            the sidebar to create one.
          </p>
        </div>
      </div>
    );
  }
  // Compose the per-render extension list. Order doesn't matter
  // for these (they're independent Compartment-free extensions),
  // but keep cursor first so it's easier to spot in the array.
  const extensions: NonNullable<
    Parameters<typeof CodeMirror>[0]["extensions"]
  > = [];
  if (cursorExtension) extensions.push(cursorExtension);
  if (langSupport) extensions.push(langSupport);
  extensions.push(completionExtension);
  for (const l of lintExtension) extensions.push(l);
  for (const h of hoverExtension) extensions.push(h);
  extensions.push(...lspNavExtensions);
  // Editor git integration — change bars + inline blame (module-level
  // extensions; data flows in via the StateEffect dispatches above).
  // diffField MUST be registered on the editor state: the gutter only
  // READS it (`markers` callback); without registration every
  // applyDiffHunks dispatch lands on a field that doesn't exist.
  extensions.push(diffField);
  extensions.push(gitGutterExtension);
  extensions.push(blameField);
  // Testing v2 — same registration rule as diffField above.
  extensions.push(testMarkField);
  extensions.push(testGutterExtension);
  return (
    // The wrapper is the editor's flex slot (`flex-1` for height,
    // `overflow-hidden` so a too-tall canvas never escapes the column).
    //
    // The `<CodeMirror>` host div (`<div class="cm-theme">`) needs an
    // explicit height too — without it, the inner `.cm-editor`'s
    // `height: 100%` (set by the `height` prop) resolves against a
    // parent of unknown height and the editor expands to fit its
    // document. For package-lock.json that meant a 44565px tall
    // `.cm-editor` whose internal `.cm-scroller` had
    // `scrollHeight === clientHeight` (no scroll possible) and the
    // user saw only the first screen of lines. Setting
    // `style={{ height: "100%" }}` on the host makes `.cm-theme`
    // inherit the wrapper's bounded flex height, which lets the
    // inner `.cm-scroller` actually scroll. `relative` hosts the
    // rename + references overlays.
    <div className="scrollbar-hide relative min-h-0 flex-1 overflow-hidden bg-card">
      <CodeMirror
        value={content}
        theme={oneDark}
        onChange={onChange}
        editable={!readOnly}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          indentOnInput: true,
          bracketMatching: true,
          // Phase 0 completions — the languageData-registered sources
          // above do the matching; this switches the machinery
          // (popup, keymap, activate-on-typing) on.
          autocompletion: true,
          highlightSelectionMatches: true,
        }}
        aria-label="File source"
        height="100%"
        style={{ height: "100%" }}
        extensions={extensions}
        onCreateEditor={handleView}
      />

      {/* Rename symbol input (F2) — parked top-center like VS Code's. */}
      {renameBox && (
        <div
          className="absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-lg border bg-popover px-3 py-2 shadow-xl"
          data-testid="rename-box"
        >
          <label
            htmlFor="workspace-rename-input"
            className="mb-1 block text-[11px] font-medium text-muted-foreground"
          >
            Rename symbol
          </label>
          <div className="flex items-center gap-2">
            <input
              id="workspace-rename-input"
              autoFocus
              value={renameBox.value}
              disabled={renameBox.busy}
              onChange={(e) =>
                setRenameBox((b) => (b ? { ...b, value: e.target.value } : b))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submitRename();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setRenameBox(null);
                }
              }}
              data-testid="rename-input"
              spellCheck={false}
              autoComplete="off"
              className="h-7 w-64 rounded-md border bg-background px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
            />
            <span className="text-[10px] text-muted-foreground">
              {renameBox.busy ? "renaming…" : "↵ rename · esc cancel"}
            </span>
          </div>
        </div>
      )}

      {/* Find-references peek — bottom sheet over the editor, VS Code
          "peek" style. Rows navigate via the parent's open-at helper. */}
      {peek && (
        <div
          className="absolute bottom-3 left-3 right-3 z-20 flex max-h-56 flex-col overflow-hidden rounded-lg border bg-popover shadow-xl"
          data-testid="references-peek"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-border bg-muted/40 px-3 py-1.5">
            <span className="text-[11px] font-semibold text-foreground">
              {peek.items.length}{" "}
              {peek.items.length === 1 ? "reference" : "references"} to{" "}
              <span className="font-mono">{peek.word}</span>
            </span>
            <button
              type="button"
              onClick={() => setPeek(null)}
              aria-label="Close references"
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto py-1 text-xs">
            {peek.items.length === 0 && (
              <li className="px-3 py-2 text-muted-foreground">
                No references found.
              </li>
            )}
            {peek.items.map((item, i) => {
              const key = `${item.path}:${item.range.start.line}:${item.range.start.character}:${i}`;
              const lineText =
                item.path === activePath
                  ? activeLines[item.range.start.line]?.trim()
                  : null;
              return (
                <li key={key}>
                  <button
                    type="button"
                    data-testid="references-peek-item"
                    onClick={() => {
                      setPeek(null);
                      onNavigate?.(
                        item.path,
                        item.range.start.line + 1,
                        item.range.start.character + 1,
                      );
                    }}
                    className="flex w-full items-baseline gap-2 px-3 py-1 text-left hover:bg-muted/60"
                  >
                    <span className="shrink-0 font-mono text-muted-foreground">
                      {basename(item.path)}:{item.range.start.line + 1}
                    </span>
                    {lineText != null && (
                      <span className="truncate font-mono text-foreground/80">
                        {lineText}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
