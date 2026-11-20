// File / folder icon helper for the Explorer tree.
//
// Files & folders use the official Material Icon Theme SVGs from
// `material-extensions/vscode-material-icon-theme` — the most popular
// VS Code icon theme. They are real coloured SVGs shipped per language
// (TS=blue with `TS`, JS=yellow with `JS`, Python=yellow with a
// snake, etc.) so an Explorer row reads as "this is a TypeScript file"
// at a glance, exactly like VS Code with the Material Icon Theme
// extension installed.
//
// The lookup lives in `./materialIcons.ts`, which imports each variant
// through `vite-plugin-svgr`'s `?react` suffix. Extensions not in the
// curated map fall back to the `@vscode/codicons` glyph set VS Code
// ships (markdown, json, file-code, python, ruby) so an unknown file
// still gets a recognisable VS Code-style pictogram.
//
// Folder icons use the open / closed Material Icon Theme variants,
// amber-tinted as a final fallback so a folder name we haven't
// mapped still renders with VS Code's folder glyph.

import type { ReactElement } from "react";
import { basename } from "./treeHelpers";
import { getFileIcon as getMaterialFile, getFolderIcon } from "./materialIcons";

/**
 * Extension → codicon class fallback (no Material variant in the
 * curated subset, but VS Code's own codicon font ships a glyph for
 * it). Empty when an extension already has a Material icon — we only
 * list the languages whose Material artwork we deliberately omitted
 * (logo-style icons that read like brand marks rather than file
 * types).
 */
const CODICON_FALLBACK_BY_EXT: Record<string, string> = {
  // Markdown handled by Material above; this is a safety duplicate
  // for paths the curated registry doesn't cover.
};

/**
 * Build the file-icon React element for a tree row. Returns either a
 * Material SVG component, a codicon `<i>`, or a small generic
 * fallback for unknown extensions — never `undefined`.
 */
export function getFileIcon(filePath: string): ReactElement {
  const name = basename(filePath);
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const ext = dot === -1 ? "" : lower.slice(dot + 1);

  // Material registry first — basename exact match wins for configs,
  // then extension for the generic case.
  const Material = getMaterialFile(name);
  if (Material) {
    return <Material className="h-4 w-4" />;
  }

  // Codicon fallback for languages whose Material artwork we left
  // out (logo-style icons that compete with the rest of the tree).
  const codicon = CODICON_FALLBACK_BY_EXT[ext];
  if (codicon) {
    return (
      <i
        className={`codicon codicon-${codicon} text-[16px] leading-none`}
        aria-hidden="true"
      />
    );
  }

  // Last-resort generic file glyph.
  return (
    <i
      className="codicon codicon-file text-[16px] leading-none"
      aria-hidden="true"
    />
  );
}

/**
 * Folder icon element — Material SVG component when the basename is
 * in the curated map, else the amber `codicon-folder` / `folder-opened`
 * fallback. The tree row supplies the `open` flag based on whether
 * the folder is expanded.
 */
export function getFolderIconEl(folderName: string, open: boolean): ReactElement {
  const Material = getFolderIcon(folderName, open);
  if (Material) {
    return <Material className="h-4 w-4" />;
  }
  return open ? FOLDER_OPENED : FOLDER_CLOSED;
}

// Codicon-based folder icons — VS Code's own filled folder glyph,
// amber-tinted to match the Seti-theme folder colour. Used as the
// last-resort fallback when the folder basename isn't in the Material
// map (e.g. `.kilo`, `.claude`, or any custom dir).
export const FOLDER_CLOSED = (
  <i
    className="codicon codicon-folder text-[16px] leading-none text-amber-500"
    aria-hidden="true"
  />
);

export const FOLDER_OPENED = (
  <i
    className="codicon codicon-folder-opened text-[16px] leading-none text-amber-400"
    aria-hidden="true"
  />
);