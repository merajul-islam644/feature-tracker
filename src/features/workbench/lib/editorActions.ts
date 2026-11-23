// Registry for the ACTIVE plain editor instance. The tab strip's
// undo/redo buttons live far away from EditorHost (which owns the
// Monaco instance), so the host registers its editor here on mount and
// the strip fires undo/redo at whatever model is on screen -- no prop
// drilling through Workbench, and no re-render needed (a click reads
// the registry at call time).

import type { OnMount } from "@monaco-editor/react";

type StandaloneEditor = Parameters<OnMount>[0];

let activeEditor: StandaloneEditor | null = null;

export function setActiveEditor(editor: StandaloneEditor | null): void {
  activeEditor = editor;
}

/** Whether an editor is currently registered — Problems-view jumps poll
 *  this instead of guessing a fixed mount delay. */
export function hasActiveEditor(): boolean {
  return activeEditor !== null;
}

export function undoActive(): void {
  activeEditor?.trigger("editor-tabs", "undo", null);
}

export function redoActive(): void {
  activeEditor?.trigger("editor-tabs", "redo", null);
}

/** Jump the active editor to a problem's location (Problems view click).
 *  fire-and-forget: when no editor is on screen yet the tab open flow
 *  retries after Monaco mounts (the caller handles that timing). */
export function jumpActive(line: number, column: number = 1): void {
  if (!activeEditor) return;
  activeEditor.revealLineInCenter(line);
  activeEditor.setPosition({ lineNumber: line, column });
  activeEditor.focus();
}
