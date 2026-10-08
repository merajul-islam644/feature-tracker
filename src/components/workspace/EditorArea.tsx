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

import { useEffect, useMemo, useState } from "react";
import {
  EditorView,
  type EditorView as EditorViewType,
} from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import {
  completeFromList,
  type Completion,
  type CompletionContext,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { linter, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { oneDark } from "@codemirror/theme-one-dark";
import { languages } from "@codemirror/language-data";
import { LanguageDescription } from "@codemirror/language";
import CodeMirror from "@uiw/react-codemirror";
import { FileCode2 } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import type { LspDiagnostic } from "@/types/dev-server";

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

export function EditorArea({
  activePath,
  content,
  readOnly,
  diagnostics,
  hasFolder,
  onChange,
  onCreateEditor,
  onCursorChange,
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
    // inner `.cm-scroller` actually scroll.
    <div className="scrollbar-hide min-h-0 flex-1 overflow-hidden bg-card">
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
        onCreateEditor={onCreateEditor}
      />
    </div>
  );
}
