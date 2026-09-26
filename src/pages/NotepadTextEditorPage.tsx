// Notepad → Plain Text → editor for a single pad. Mounted at
// `/notepad/text/:padId`. Loads the matching pad from the shared
// `loadTextPads` list and renders the same textarea + counts UI the
// previous combined page had. Auto-saves the full pad list on every
// change (debounced) so the list page stays in sync.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/blocks/i18n";
import {
  loadTextPads,
  saveTextPads,
  type TextPad,
} from "@/lib/notepad/storage";

// Debounce window — small enough that the "Saved" badge feels live,
// large enough that a fast typist doesn't write on every keystroke.
const SAVE_DEBOUNCE_MS = 400;

export function NotepadTextEditorPage() {
  const t = useT();
  const { padId } = useParams<{ padId: string }>();
  // Load the full list (rather than just the one pad) so we can
  // write the whole list back on every change without disturbing
  // sibling pads. Cheap for the size we're talking about — even 50
  // pads serialize to a few KB.
  const [pads, setPads] = useState<TextPad[]>(() => loadTextPads());

  const [savedAt, setSavedAt] = useState<number>(0);
  const [hideSavedAt, setHideSavedAt] = useState<number>(-Infinity);
  const debounceRef = useRef<number | null>(null);

  // Ref-mirror so the debounce cleanup can flush the latest pads on
  // unmount without re-creating the timer on every keystroke.
  const padsRef = useRef(pads);
  padsRef.current = pads;

  const pad = useMemo(
    () => pads.find((p) => p.id === padId) ?? null,
    [pads, padId],
  );

  // Debounced auto-save. Re-runs on any list change, including a
  // switch between pads (the `setBody` call replaces the matching
  // entry, so the list identity changes).
  useEffect(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      try {
        saveTextPads(padsRef.current);
        setSavedAt(Date.now());
      } catch {
        // Swallow — quota / private mode.
      }
    }, SAVE_DEBOUNCE_MS);
    return () => {
      // Flush on unmount so navigating away mid-edit doesn't drop
      // the last few characters that hadn't hit the debounce.
      try {
        saveTextPads(padsRef.current);
        setSavedAt(Date.now());
      } catch {
        // Swallow.
      }
    };
  }, [pads]);

  useEffect(() => {
    if (savedAt <= hideSavedAt) return;
    const id = window.setTimeout(() => setHideSavedAt(Date.now()), 1500);
    return () => window.clearTimeout(id);
  }, [savedAt, hideSavedAt]);

  const showSaved = savedAt > hideSavedAt;

  // Defensive redirects — if the URL is missing a padId or points
  // at a pad that no longer exists (renamed? deleted from another
  // tab?), send the user back to the list rather than rendering a
  // blank editor.
  if (!padId) {
    return <Navigate to="/notepad/text" replace />;
  }
  if (!pad) {
    return <Navigate to="/notepad/text" replace />;
  }

  // Body update — replaces the matching pad's `body` in the list
  // and lets the auto-save effect pick the change up.
  const setBody = (next: string) => {
    setPads((prev) =>
      prev.map((p) => (p.id === padId ? { ...p, body: next } : p)),
    );
  };

  const handleClear = () => {
    setBody("");
    // Force an immediate save so Clear takes effect even if the
    // debounce timer hasn't fired (otherwise a quick navigation
    // away could keep the old body).
    try {
      saveTextPads(padsRef.current);
    } catch {
      // Swallow.
    }
  };

  // Cheap word/char count — split on whitespace runs. Empty /
  // pure-whitespace input renders "0 words" so the badge stays
  // stable across clearing the field.
  const wordCount =
    pad.body.trim() === "" ? 0 : pad.body.trim().split(/\s+/).length;
  const charCount = pad.body.length;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
            <Link to="/notepad/text">
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {t("notepad.backToTextList", "Back to pads")}
            </Link>
          </Button>
          {/* Pad name as the H1 — falls back to "Untitled pad" for
              legacy pads that were migrated without a name. The
              type description stays as the subtitle so the user
              still sees "this is a Plain Text pad" at a glance. */}
          <h1 className="text-2xl font-semibold text-foreground">
            {pad.name || t("notepad.untitledText", "Untitled pad")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "notepad.textDescription",
              "A free-form scratchpad. Auto-saves to your browser.",
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {showSaved && (
            <span
              aria-live="polite"
              className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
            >
              <Check className="h-3 w-3" aria-hidden="true" />
              {t("notepad.saved", "Saved")}
            </span>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleClear}
            disabled={pad.body.length === 0}
          >
            <Eraser className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {t("notepad.clear", "Clear")}
          </Button>
        </div>
      </header>

      <div className="rounded-lg border border-border bg-card">
        <textarea
          aria-label={pad.name || t("notepad.textTitle", "Plain Text")}
          value={pad.body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("notepad.textPlaceholder", "Start typing…")}
          className="min-h-[60vh] w-full resize-y rounded-lg border-0 bg-transparent p-4 text-sm text-foreground placeholder:text-muted-foreground placeholder:italic focus:outline-none focus:ring-0"
        />
      </div>

      <div
        aria-live="polite"
        className="flex items-center justify-between text-xs text-muted-foreground"
      >
        <span>
          {wordCount}{" "}
          {wordCount === 1
            ? t("notepad.word", "word")
            : t("notepad.words", "words")}
        </span>
        <span>
          {charCount}{" "}
          {charCount === 1
            ? t("notepad.character", "character")
            : t("notepad.characters", "characters")}
        </span>
      </div>
    </div>
  );
}
