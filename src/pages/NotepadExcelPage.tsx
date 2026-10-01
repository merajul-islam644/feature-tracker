// Notepad → Excel → list view. Mirrors `NotepadTextPage` — renders
// all of the user's grids as clickable rows and lets them create a
// new one via the name modal. Clicking a row navigates to
// `/notepad/excel/<padId>` (handled by `NotepadExcelEditorPage`).

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Plus, Sheet, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useLocale } from "@/lib/blocks/i18n";
import { useToast } from "@/hooks/useToast";
import {
  genPadId,
  loadExcelPads,
  saveExcelPads,
  type ExcelPad,
} from "@/lib/notepad/storage";
import { NotepadCreateModal } from "@/components/notepad/NotepadCreateModal";
import { NotepadDeleteDialog } from "@/components/notepad/NotepadDeleteDialog";

// Default starting size for a brand-new grid. Mirrored in the
// storage module's `blankGrid` fallback so the editor opens at the
// same dimensions the list promised.
const DEFAULT_ROWS = 3;
const DEFAULT_COLS = 3;

function blankGrid(): string[][] {
  return Array.from({ length: DEFAULT_ROWS }, () =>
    Array.from({ length: DEFAULT_COLS }, () => ""),
  );
}

export function NotepadExcelPage() {
  const { t, formatRelativeTime } = useLocale();
  const toast = useToast();
  const navigate = useNavigate();
  const [pads, setPads] = useState<ExcelPad[]>(() => loadExcelPads());
  const [nameDialogOpen, setNameDialogOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ExcelPad | null>(null);

  const handleCreateWithName = (name: string) => {
    const newPad: ExcelPad = {
      id: genPadId(),
      name,
      grid: blankGrid(),
      createdAt: Date.now(),
    };
    const next = [...pads, newPad];
    saveExcelPads(next);
    setPads(next);
    setNameDialogOpen(false);
    navigate(`/notepad/excel/${newPad.id}`);
  };

  const handleDeleteConfirm = () => {
    if (!pendingDelete) return;
    const next = pads.filter((p) => p.id !== pendingDelete.id);
    saveExcelPads(next);
    setPads(next);
    setPendingDelete(null);
    toast.success(
      t("notepad.deletedToast", "{name} deleted.", {
        name: pendingDelete.name || t("notepad.untitledExcel", "Untitled grid"),
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
            {t("notepad.excelTitle", "Excel")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "notepad.listDescription",
              "Pick a pad to keep working, or start a new one.",
            )}
          </p>
        </div>
        {pads.length > 0 && (
          <Button type="button" onClick={() => setNameDialogOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {t("notepad.newGrid", "New grid")}
          </Button>
        )}
      </header>

      {pads.length === 0 ? (
        <EmptyState
          icon={<Sheet className="h-7 w-7" aria-hidden="true" />}
          title={t("notepad.excelEmptyTitle", "No Excel grids yet")}
          description={t(
            "notepad.excelEmptyDescription",
            "Create one to start a small editable grid. Your layouts auto-save to this browser.",
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
            const rows = pad.grid.length;
            const cols = pad.grid[0]?.length ?? 0;
            const displayName =
              pad.name || t("notepad.untitledExcel", "Untitled grid");
            return (
              <li
                key={pad.id}
                className="group flex items-stretch rounded-lg border border-border bg-card transition-colors hover:border-primary"
              >
                <Link
                  to={`/notepad/excel/${pad.id}`}
                  className="flex flex-1 items-center gap-3 px-4 py-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-l-lg"
                >
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-medium text-foreground">
                      {displayName}
                    </h3>
                    {/* Created date — same pattern as the text list. */}
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t("notepad.createdAgo", "Created {when}", {
                        when: formatRelativeTime(
                          new Date(pad.createdAt).toISOString(),
                        ),
                      })}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t(
                        "notepad.gridSize",
                        "{rows} × {cols}",
                        { rows, cols },
                      )}
                    </p>
                  </div>
                  <ArrowRight
                    className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </Link>
                {/* Trash icon — sibling of the Link so clicking
                    it doesn't navigate. No button chrome; just
                    the icon, tinted red on hover. Same flow as
                    the Plain Text list. */}
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
        titleKey="notepad.createDialog.excelTitle"
        titleFallback="Create Excel Grid"
        placeholderKey="notepad.createDialog.namePlaceholderExcel"
        placeholderFallback="e.g. Sprint Tracker"
      />

      <NotepadDeleteDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={handleDeleteConfirm}
        titleKey="notepad.deleteDialog.excelTitle"
        titleFallback="Delete Excel grid?"
        descriptionKey="notepad.deleteDialog.excelDescription"
        descriptionFallback="This will permanently remove the grid and its content. This action cannot be undone."
        confirmLabelKey="notepad.deleteDialog.excelConfirm"
        confirmLabelFallback="Delete grid"
        padName={
          pendingDelete?.name ||
          t("notepad.untitledExcel", "Untitled grid")
        }
      />
    </div>
  );
}
