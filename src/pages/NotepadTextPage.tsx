// Notepad → Plain Text → list view. Renders all of the user's
// plain-text pads as clickable rows. Clicking a row navigates to
// `/notepad/text/<padId>` (handled by `NotepadTextEditorPage`). The
// "+ New pad" button (and the empty state's Create button) opens a
// name modal; on submit, a fresh pad is appended to the list, the
// list is persisted, and the user is taken to the editor for the
// new pad.

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, FileText, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useLocale } from "@/lib/blocks/i18n";
import { useToast } from "@/hooks/useToast";
import {
  genPadId,
  loadTextPads,
  saveTextPads,
  type TextPad,
} from "@/lib/notepad/storage";
import { NotepadCreateModal } from "@/components/notepad/NotepadCreateModal";
import { NotepadDeleteDialog } from "@/components/notepad/NotepadDeleteDialog";

export function NotepadTextPage() {
  const { t, formatRelativeTime } = useLocale();
  const toast = useToast();
  const navigate = useNavigate();
  // Load the full pad list once on mount. The list page is read-
  // only here — the editor page handles its own writes via the
  // same storage helpers. We keep the list in state so a new
  // creation immediately shows up in the rendered list without
  // waiting for the route to change.
  const [pads, setPads] = useState<TextPad[]>(() => loadTextPads());
  const [nameDialogOpen, setNameDialogOpen] = useState(false);
  // Pad queued for deletion. The row's trash button sets this; the
  // confirmation dialog reads from it on submit and clears it
  // once the delete is committed (or cancelled).
  const [pendingDelete, setPendingDelete] = useState<TextPad | null>(null);

  // Modal submit → create + persist + jump to editor. We commit
  // before navigating so a fast browser-back doesn't show a stale
  // empty list.
  const handleCreateWithName = (name: string) => {
    const newPad: TextPad = {
      id: genPadId(),
      name,
      body: "",
      createdAt: Date.now(),
    };
    const next = [...pads, newPad];
    saveTextPads(next);
    setPads(next);
    setNameDialogOpen(false);
    navigate(`/notepad/text/${newPad.id}`);
  };

  // Delete handler — filter out the queued pad, persist the rest,
  // close the dialog. The editor's "pad not found" guard handles
  // the case where the deleted pad was open in another tab.
  const handleDeleteConfirm = () => {
    if (!pendingDelete) return;
    const next = pads.filter((p) => p.id !== pendingDelete.id);
    saveTextPads(next);
    setPads(next);
    setPendingDelete(null);
    toast.success(
      t("notepad.deletedToast", "{name} deleted.", {
        name: pendingDelete.name || t("notepad.untitledText", "Untitled pad"),
      }),
    );
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
            <Link to="/notepad">
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {t("notepad.back", "Back to Notepad")}
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold text-foreground">
            {t("notepad.textTitle", "Plain Text")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "notepad.listDescription",
              "Pick a pad to keep working, or start a new one.",
            )}
          </p>
        </div>
        {/* Top-right "New pad" button only shows once there's at
            least one pad — the empty state's Create button covers
            the very first run, and we don't want two Create CTAs
            fighting for attention. */}
        {pads.length > 0 && (
          <Button type="button" onClick={() => setNameDialogOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {t("notepad.newPad", "New pad")}
          </Button>
        )}
      </header>

      {pads.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-7 w-7" aria-hidden="true" />}
          title={t("notepad.textEmptyTitle", "No plain-text pads yet")}
          description={t(
            "notepad.textEmptyDescription",
            "Create one to start typing. Your drafts auto-save to this browser.",
          )}
          action={
            <Button type="button" onClick={() => setNameDialogOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {t("notepad.create", "Create")}
            </Button>
          }
        />
      ) : (
        <ul className="space-y-2">
          {pads.map((pad) => {
            const wordCount =
              pad.body.trim() === ""
                ? 0
                : pad.body.trim().split(/\s+/).length;
            const displayName =
              pad.name || t("notepad.untitledText", "Untitled pad");
            return (
              <li
                key={pad.id}
                className="group flex items-stretch rounded-lg border border-border bg-card transition-colors hover:border-primary"
              >
                <Link
                  to={`/notepad/text/${pad.id}`}
                  className="flex flex-1 items-center gap-3 px-4 py-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-l-lg"
                >
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-medium text-foreground">
                      {displayName}
                    </h3>
                    {/* Created date — directly under the name, as
                        a small muted line. Uses the i18n helper's
                        relative formatter so the same label reads
                        "just now" / "5 minutes ago" / "Sep 26,
                        2026" depending on age. */}
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t("notepad.createdAgo", "Created {when}", {
                        when: formatRelativeTime(
                          new Date(pad.createdAt).toISOString(),
                        ),
                      })}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {wordCount === 0
                        ? t("notepad.empty", "Empty")
                        : t("notepad.wordCount", "{count} words", {
                            count: wordCount,
                          })}
                    </p>
                  </div>
                  <ArrowRight
                    className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </Link>
                {/* Trash icon — sits outside the Link so clicking
                    it doesn't navigate to the editor. No button
                    chrome (no background, no border); the icon
                    itself just tints red on hover to telegraph
                    the destructive intent. Confirmation happens
                    in the dialog below, so a stray click can't
                    take the pad out. */}
                <button
                  type="button"
                  onClick={() => setPendingDelete(pad)}
                  aria-label={t("notepad.deleteAria", "Delete {name}", {
                    name: displayName,
                  })}
                  className="inline-flex shrink-0 items-center justify-center p-2 text-muted-foreground transition-colors hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <NotepadCreateModal
        open={nameDialogOpen}
        onClose={() => setNameDialogOpen(false)}
        onSubmit={handleCreateWithName}
        titleKey="notepad.createDialog.textTitle"
        titleFallback="Create Plain Text Pad"
        placeholderKey="notepad.createDialog.namePlaceholderText"
        placeholderFallback="e.g. Meeting Notes"
      />

      <NotepadDeleteDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={handleDeleteConfirm}
        titleKey="notepad.deleteDialog.textTitle"
        titleFallback="Delete plain-text pad?"
        descriptionKey="notepad.deleteDialog.textDescription"
        descriptionFallback="This will permanently remove the pad and its content. This action cannot be undone."
        confirmLabelKey="notepad.deleteDialog.textConfirm"
        confirmLabelFallback="Delete pad"
        padName={
          pendingDelete?.name ||
          t("notepad.untitledText", "Untitled pad")
        }
      />
    </div>
  );
}
