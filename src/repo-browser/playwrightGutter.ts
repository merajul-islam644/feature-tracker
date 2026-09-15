/**
 * CodeMirror 6 gutter that draws a Play button next to every line that
 * starts a Playwright-style block (`test`, `test.describe`,
 * `test.step`). The marker is wired to a host-supplied `onPlayLine`
 * callback so the page can launch the block when the user clicks.
 *
 * Why a gutter (vs. inline widgets or decorations):
 *  - Gutter markers are positioned by line, so they automatically
 *    scroll with the source and never overlap text.
 *  - They live in their own DOM column, so we don't have to worry
 *    about fighting the editor's read-only state or selection.
 *  - The marker class is just a CSS hook, so we can size + colour it
 *    with regular CSS rules.
 *
 * Click wiring approach: each marker attaches its own DOM `click`
 * listener inside `toDOM()`, capturing its own lineNumber at
 * construction. This deliberately bypasses CodeMirror's
 * `domEventHandlers` because:
 *  - Real exceptions thrown inside `domEventHandlers` are silently
 *    swallowed by CodeMirror and the event disappears (a guard is
 *    not enough — CodeMirror's own handler may also mutate the
 *    selection/focus before our handler runs).
 *  - `domEventHandlers` rely on CodeMirror's coordinate resolution
 *    (`getBoundingClientRect` + a click position), which has been
 *    a source of "click did nothing" reports in this project.
 * By listening on the DOM directly, every click goes to its button
 * with no intermediate layer that can drop it.
 *
 * We re-scan the document on every update because Playwright files can
 * be hundreds of lines long and a full re-scan is cheaper than
 * tracking edits incrementally.
 */

import { EditorView, gutter, GutterMarker } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

export type PlaywrightKind = "test" | "describe" | "step";

class PlaywrightMarker extends GutterMarker {
  readonly kind: PlaywrightKind;
  readonly lineNumber: number;
  private readonly onPlayLine: (lineNumber: number, kind: PlaywrightKind) => void;

  constructor(
    kind: PlaywrightKind,
    lineNumber: number,
    onPlayLine: (lineNumber: number, kind: PlaywrightKind) => void
  ) {
    super();
    this.kind = kind;
    this.lineNumber = lineNumber;
    this.onPlayLine = onPlayLine;
  }

  toDOM() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `cm-pw-gutter-play cm-pw-gutter-play-${this.kind}`;
    button.title = `Run this ${this.kind} block in the Playwright runner`;
    button.setAttribute("aria-label", `Run ${this.kind} block`);
    // Capture the line number directly on the DOM so keyboard /
    // accessibility tooling, automated tests, and right-click "Copy"
    // all see where the button is anchored — even if the marker
    // instance is replaced, the DOM keeps the most recent value.
    button.dataset.line = String(this.lineNumber);
    button.dataset.kind = this.kind;

    // Belt-and-suspenders click wiring. We attach to four events
    // because each browser (and CodeMirror's own gutter click handler)
    // handles them slightly differently. The first one that fires
    // wins; subsequent ones are no-ops via a flag. We deliberately do
    // NOT call preventDefault on mousedown -- in Chromium that can
    // suppress the synthesized click on buttons that would otherwise
    // receive focus.
    let fired = false;
    const fire = (origin: string) => {
      if (fired) return;
      fired = true;
      // eslint-disable-next-line no-console
      console.log(`[pw-gutter] fired (${origin}) line=${this.lineNumber} kind=${this.kind}`);
      try {
        this.onPlayLine(this.lineNumber, this.kind);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[pw-gutter] onPlayLine threw:", err);
      } finally {
        // Allow a fresh click cycle after the synchronous chain
        // settles -- otherwise a fast double-click would be dropped.
        queueMicrotask(() => {
          fired = false;
        });
      }
    };
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      fire("click");
    });
    button.addEventListener("mousedown", (event) => {
      event.stopPropagation();
      fire("mousedown");
    });
    button.addEventListener("pointerup", (event) => {
      event.stopPropagation();
      fire("pointerup");
    });
    // Touch / pen users (CodeMirror's own gutter also listens to
    // `pointerdown` for hover highlighting) -- listen to both up
    // and down so we don't miss a fast tap.
    button.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      // No fire() here -- pointerdown is paired with pointerup
      // and we don't want to double-fire. pointerup handles it.
    });

    // Glyph rendered via CSS (background-image SVG) so we don't drag
    // the lucide-react icon tree into the editor bundle.
    return button;
  }

  /**
   * Markers are equal iff they refer to the same line and same kind.
   * Returning the same marker for an unchanged line lets CodeMirror
   * reuse the DOM (and its listeners) instead of recreating it.
   */
  eq(other: GutterMarker): boolean {
    if (!(other instanceof PlaywrightMarker)) return false;
    return other.kind === this.kind && other.lineNumber === this.lineNumber;
  }
}

const TEST_LINE = /^\s*(test|test\.describe|test\.step)\s*(?:\.\w+\s*)?\(/;

function classify(head: string): PlaywrightKind {
  if (head === "test.describe") return "describe";
  if (head === "test.step") return "step";
  return "test";
}

/**
 * Build the CodeMirror extension for the Playwright gutter. Pass
 * `onPlayLine` to be notified when the user clicks a Play button —
 * the line number (1-based) and block kind are passed so the caller
 * can look up the matching block from its own block-detection scan.
 */
export function playwrightGutter(
  onPlayLine: (lineNumber: number, kind: PlaywrightKind) => void
): Extension {
  return gutter({
    class: "cm-pw-gutter",
    side: "before",
    lineMarker(view, line) {
      const text = view.state.doc.lineAt(line.from).text;
      const match = text.match(TEST_LINE);
      if (!match) return null;
      const kind = classify(match[1]!);
      const lineNumber = view.state.doc.lineAt(line.from).number;
      return new PlaywrightMarker(kind, lineNumber, onPlayLine);
    }
  });
}

/**
 * Theme rules for the Playwright gutter. The marker is rendered as a
 * 14x14 SVG triangle so it looks like a real Play button instead of a
 * unicode glyph (which renders inconsistently across platforms).
 */
export const playwrightGutterTheme = EditorView.theme({
  "& .cm-pw-gutter": { width: "22px" },
  "& .cm-pw-gutter .cm-gutterElement": {
    alignItems: "center",
    display: "flex",
    justifyContent: "center"
  },
  "& .cm-pw-gutter-play": {
    alignItems: "center",
    appearance: "none",
    background:
      "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><polygon points='3,2 13,8 3,14' fill='%237dd3fc'/></svg>\") no-repeat center / 10px 10px",
    border: "0",
    borderRadius: "3px",
    cursor: "pointer",
    height: "16px",
    padding: "0",
    width: "16px"
  },
  "& .cm-pw-gutter-play:hover": {
    backgroundColor: "rgba(125, 211, 252, 0.18)"
  },
  "& .cm-pw-gutter-play-describe": {
    background:
      "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><polygon points='3,2 13,8 3,14' fill='%23a78bfa'/></svg>\") no-repeat center / 10px 10px"
  },
  "& .cm-pw-gutter-play-step": {
    background:
      "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><polygon points='3,2 13,8 3,14' fill='%23fde68a'/></svg>\") no-repeat center / 8px 8px"
  }
});
