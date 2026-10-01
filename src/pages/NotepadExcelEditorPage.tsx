// Notepad → Excel → editor for a single grid. Mounted at
// `/notepad/excel/:padId`. Same auto-save pattern as the text
// editor — loads the full pad list, mutates the matching entry on
// every change, debounces the save.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  Eraser,
  Plus,
  RowsIcon,
  ColumnsIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/blocks/i18n";
import {
  loadExcelPads,
  saveExcelPads,
  type ExcelPad,
} from "@/lib/notepad/storage";

const SAVE_DEBOUNCE_MS = 400;
const DEFAULT_ROWS = 3;
const DEFAULT_COLS = 3;
const MAX_COLS = 26;
const MAX_ROWS = 50;

function blankGrid(): string[][] {
  return Array.from({ length: DEFAULT_ROWS }, () =>
    Array.from({ length: DEFAULT_COLS }, () => ""),
  );
}

function columnLabel(index: number): string {
  return String.fromCharCode(65 + index);
}

export function NotepadExcelEditorPage() {
  const t = useT();
  const { padId } = useParams<{ padId: string }>();
  const [pads, setPads] = useState<ExcelPad[]>(() => loadExcelPads());

  const [savedAt, setSavedAt] = useState<number>(0);
  const [hideSavedAt, setHideSavedAt] = useState<number>(-Infinity);
  const debounceRef = useRef<number | null>(null);

  const padsRef = useRef(pads);
  padsRef.current = pads;

  const pad = useMemo(
    () => pads.find((p) => p.id === padId) ?? null,
    [pads, padId],
  );

  useEffect(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      try {
        saveExcelPads(padsRef.current);
        setSavedAt(Date.now());
      } catch {
        // Swallow.
      }
    }, SAVE_DEBOUNCE_MS);
    return () => {
      try {
        saveExcelPads(padsRef.current);
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

  if (!padId) {
    return <Navigate to="/notepad/excel" replace />;
  }
  if (!pad) {
    return <Navigate to="/notepad/excel" replace />;
  }

  const grid = pad.grid;

  // All mutators below replace the matching pad's grid (or just
  // its size) in the list. React state identity matters — mutating
  // in place would skip the render and miss the auto-save effect.
  const mutateGrid = (nextGrid: string[][]) => {
    setPads((prev) =>
      prev.map((p) =>
        p.id === padId ? { ...p, grid: nextGrid } : p,
      ),
    );
  };

  const setCell = (rowIdx: number, colIdx: number, value: string) => {
    setPads((prev) =>
      prev.map((p) => {
        if (p.id !== padId) return p;
        const nextGrid = p.grid.map((r, i) =>
          i === rowIdx ? r.map((c, j) => (j === colIdx ? value : c)) : r,
        );
        return { ...p, grid: nextGrid };
      }),
    );
  };

  const addRow = () => {
    setPads((prev) =>
      prev.map((p) => {
        if (p.id !== padId) return p;
        if (p.grid.length >= MAX_ROWS) return p;
        const cols = p.grid[0]?.length ?? DEFAULT_COLS;
        return {
          ...p,
          grid: [...p.grid, Array.from({ length: cols }, () => "")],
        };
      }),
    );
  };

  const addCol = () => {
    setPads((prev) =>
      prev.map((p) => {
        if (p.id !== padId) return p;
        if (p.grid.length === 0) return p;
        if (p.grid[0].length >= MAX_COLS) return p;
        return { ...p, grid: p.grid.map((r) => [...r, ""]) };
      }),
    );
  };

  const resetGrid = () => {
    mutateGrid(blankGrid());
  };

  const rowCount = grid.length;
  const colCount = grid[0]?.length ?? 0;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
            <Link to="/notepad/excel">
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {t("notepad.backToExcelList", "Back to grids")}
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold text-foreground">
            {pad.name || t("notepad.untitledExcel", "Untitled grid")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "notepad.excelDescription",
              "A small editable grid for quick tables. Auto-saves to your browser.",
            )}
          </p>
        </div>
        <div className="flex flex-wrap shrink-0 items-center gap-2">
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
            onClick={addRow}
            disabled={rowCount >= MAX_ROWS}
          >
            <RowsIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {t("notepad.addRow", "Add row")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addCol}
            disabled={colCount >= MAX_COLS}
          >
            <ColumnsIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {t("notepad.addCol", "Add column")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={resetGrid}>
            <Eraser className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {t("notepad.clear", "Clear")}
          </Button>
        </div>
      </header>

      <div className="overflow-auto rounded-lg border border-border bg-card">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/80">
            <tr>
              <th className="sticky left-0 z-10 w-10 border-b border-r border-border bg-muted/80 px-2 py-2 text-center text-xs font-medium uppercase tracking-wider text-muted-foreground">
                #
              </th>
              {Array.from({ length: colCount }, (_, j) => (
                <th
                  key={j}
                  className="min-w-[8rem] border-b border-border px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
                >
                  {columnLabel(j)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, i) => (
              <tr key={i} className="group hover:bg-muted/30">
                <td className="sticky left-0 z-10 w-10 border-b border-r border-border bg-card px-2 py-2 text-center text-xs text-muted-foreground group-hover:bg-muted/30">
                  {i + 1}
                </td>
                {row.map((cell, j) => (
                  <td
                    key={j}
                    className="border-b border-r border-border p-0 align-top last:border-r-0"
                  >
                    <input
                      aria-label={`${columnLabel(j)}${i + 1}`}
                      type="text"
                      value={cell}
                      onChange={(e) => setCell(i, j, e.target.value)}
                      className="h-9 w-full border-0 bg-transparent px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-inset focus:ring-ring"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Recovery hint — only visible when the grid has been
          collapsed to zero rows. Reaching this state means the
          user explicitly cleared a saved grid. Add row is the only
          useful action here. */}
      {rowCount === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            {t(
              "notepad.excelClearedHint",
              "Grid is empty. Add a row to get started.",
            )}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={addRow}>
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {t("notepad.addRow", "Add row")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
