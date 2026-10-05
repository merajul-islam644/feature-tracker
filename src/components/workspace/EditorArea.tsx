// CodeMirror editor area — generic text editor with no language-
// specific extensions (the Playwright panel forced
// `@codemirror/lang-javascript`). Adding language packs like
// `@codemirror/lang-json` / `@codemirror/lang-markdown` is a one-
// import change when they're needed; for now we keep deps minimal.
//
// Lifted and adapted from `PlaywrightEditorPanel.tsx:3093-3153`.

import type { EditorView } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import CodeMirror from "@uiw/react-codemirror";
import { FileCode2 } from "lucide-react";

interface EditorAreaProps {
  activePath: string | null;
  /** Current content for the active file. */
  content: string;
  /** Per-path dirty flag — disables edits when a save is in flight. */
  readOnly?: boolean;
  onChange: (value: string) => void;
  /**
   * Fires once when the CodeMirror view is created. WorkspacePage
   * uses this to keep a ref to the live view so the toolbar's
   * Undo/Redo/Discard buttons can dispatch transactions directly.
   */
  onCreateEditor?: (view: EditorView) => void;
}

export function EditorArea({
  activePath,
  content,
  readOnly,
  onChange,
  onCreateEditor,
}: EditorAreaProps) {
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
            Pick a file from the Explorer, or click <kbd className="rounded border border-border bg-background px-1">+</kbd>{" "}
            in the sidebar to create one.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto">
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
        minHeight="100%"
        height="100%"
        onCreateEditor={onCreateEditor}
      />
    </div>
  );
}