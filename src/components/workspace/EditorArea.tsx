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
import { oneDark } from "@codemirror/theme-one-dark";
import { languages } from "@codemirror/language-data";
import { LanguageDescription } from "@codemirror/language";
import CodeMirror from "@uiw/react-codemirror";
import { FileCode2 } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";

interface EditorAreaProps {
  activePath: string | null;
  /** Current content for the active file. */
  content: string;
  /** Per-path dirty flag — disables edits when a save is in flight. */
  readOnly?: boolean;
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

export function EditorArea({
  activePath,
  content,
  readOnly,
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
          autocompletion: false,
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
