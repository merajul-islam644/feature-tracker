// Excel-like test case spreadsheet for a single Flow.
//
// Cells are inline-editable: click a cell to focus a textarea/input,
// blur or Enter to commit. Status and priority cells open a small popover
// instead of an input — they're constrained vocabularies and free-text
// here would produce unfilterable noise.
//
// Dependencies are deliberately minimal — no TanStack Table, no AG Grid.
// Plain HTML `<table>` + React state is enough for an MVP and avoids a
// 50-100kb dependency for what's effectively a list of editable rows.
// When the row count grows past a few hundred or we need virtual scroll,
// promote to TanStack Table; until then the simple form keeps the cell
// edit / blur-commit pattern dead simple.

import { useEffect, useRef, useState, useMemo, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Loader2,
  Maximize2,
  Minimize2,
  MoreVertical,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RowKebabMenu } from "@/components/ui/row-kebab";
import { Select } from "@/components/ui/select";
import { useToast } from "@/hooks/useToast";
import {
  useAddTestCase,
  useDeleteTestCase,
  useTestCases,
  useUpdateTestCase,
} from "@/lib/blocks/hooks";
import {
  TEST_CASE_PRIORITY_VALUES,
  TEST_CASE_STATUS_VALUES,
  type TestCase,
  type TestCasePriority,
  type TestCaseStatus,
} from "@/lib/blocks/data";
import { useT } from "@/lib/blocks/i18n";
import { cn } from "@/lib/utils";

// Per-column placeholder copy shown inside an empty editable cell.
// Two surfaces use this map: the read-only empty cell (which used
// to show the generic "Click to edit") and the HTML `placeholder`
// attribute on the input/textarea while the user is editing — so
// the hint reappears the moment they clear the field. Wording is
// column-specific so the user can tell at a glance which field
// they're in without re-reading the column header.
//
// Declared at module top (next to imports) rather than at the
// bottom of the file because `EditableCell` references it during
// render. With Vite Fast Refresh, a module-level `const` declared
// *below* its only consumer can land in the temporal dead zone
// after a hot edit, throwing `ReferenceError: COLUMN_PLACEHOLDER
// is not defined` and crashing the entire spreadsheet. Keeping it
// at the top guarantees the binding is initialised before any
// function captures it.
const COLUMN_PLACEHOLDER: Record<string, string> = {
  title: "Click to edit title",
  steps: "Click to edit steps",
  expectedResult: "Click to edit expected result",
  actualResult: "Click to edit actual result",
};

interface TestCaseSpreadsheetProps {
  /** Owning flow id — required, the spreadsheet renders nothing without it. */
  flowId: string;
  /**
   * Optional. Stamped onto every created/updated row so schema
   * validation passes (`featureId` is `requiredOn: "Both"` in the
   * TestCase schema) and the `featureId` column stays populated for
   * traceability. The FlowDetailsDrawer knows the parent feature id
   * and passes it down; other callers may omit it.
   */
  featureId?: string;
  /** Whether the parent drawer is currently in expanded (full-width) mode. */
  expanded?: boolean;
  /** Toggle the drawer between its default test-tab width and full viewport width. */
  onToggleExpanded?: () => void;
}

export function TestCaseSpreadsheet({
  flowId,
  featureId: featureIdProp,
  expanded = false,
  onToggleExpanded,
}: TestCaseSpreadsheetProps) {
  // Normalize `featureId` once at the top so every mutation payload
  // below can stamp it without remembering that the prop is optional.
  const featureId = featureIdProp ?? "";
  const t = useT();
  const casesQuery = useTestCases(flowId);
  const addCase = useAddTestCase();
  const updateCase = useUpdateTestCase();
  const deleteCase = useDeleteTestCase();
  const toast = useToast();
  // `editingCell` tracks the cell currently focused for inline edit.
  // Format: `${rowId}:${columnId}`. Empty string when no cell is being
  // edited — the row's existing value is shown as read-only text.
  const [editingCell, setEditingCell] = useState<string>("");
  const [draft, setDraft] = useState<string>("");
  // Save indicator — drives the "Saving…" / "Saved" badge in the
  // toolbar. `savedAt` is bumped on every successful mutation (add /
  // update / delete) so the badge can show "Saved" briefly. The
  // matching `hideSavedAt` is bumped 1.5s later by the effect below
  // so the badge disappears without manual cleanup.
  const [savedAt, setSavedAt] = useState<number>(0);
  const [hideSavedAt, setHideSavedAt] = useState<number>(-Infinity);
  // `isSaving` collapses the three mutations' pending flags into one
  // boolean so the toolbar shows a single spinner regardless of which
  // mutation is in flight. Without this, three concurrent mutations
  // (rare but possible when the user is fast) would each want to
  // claim the indicator.
  const isSaving =
    addCase.isPending || updateCase.isPending || deleteCase.isPending;
  // "Saved" badge is visible only between `savedAt` and `hideSavedAt`,
  // and only when no mutation is currently in flight (so a slow
  // follow-up save replaces "Saved" with "Saving…" instead of stacking
  // them). Initial state (`-Infinity`) keeps the badge hidden until
  // the first successful save.
  const showSaved = !isSaving && savedAt > hideSavedAt;
  // Auto-hide the "Saved" badge 1.5s after it appears. The cleanup
  // cancels the timer on unmount or when a fresh save resets the
  // window, so a stale badge never lingers across drawer re-opens or
  // races against itself.
  useEffect(() => {
    if (!showSaved) return;
    const id = window.setTimeout(() => setHideSavedAt(Date.now()), 1500);
    return () => window.clearTimeout(id);
  }, [savedAt, hideSavedAt, showSaved]);

  const cases = casesQuery.data ?? [];

  const sortedRows = useMemo(() => cases, [cases]);

  // Auto-create 10 placeholder rows on first load. We track which
  // `flowId` has already been seeded in a `ref` (instead of state)
  // so the check is synchronous and doesn't trigger a re-render — we
  // only want this effect to run once per flow, not on every
  // query/cache update. The ref persists across re-renders but
  // resets when the component unmounts (the drawer closing & opening
  // a different flow counts as a remount via `key` if the parent
  // uses one, or a fresh flowId-driven effect otherwise).
  //
  // Gating conditions, in order:
  //   1. Query must have settled (`!casesQuery.isLoading`) — otherwise
  //      we'd race the first GET and could double-seed.
  //   2. Query must not be errored (`!casesQuery.isError`) — seeding
  //      on top of a failed load would just bury the error.
  //   3. `flowId` must differ from the last one we seeded for —
  //      so flipping between flows in the same component instance
  //      re-runs the seed instead of being silently swallowed by the
  //      ref.
  //   4. Sheet must be empty — `cases.length === 0`. If the user
  //      already has rows (either user-created or from a previous
  //      seed before the ref was cleared), leave them alone.
  //
  // Each row is created with `isDeletable: false` so the row's
  // kebab shows Delete but rendered as disabled (greyed out, click-
  // blocked) and `handleDeleteRow` refuses the mutation. The
  // skeleton is visible but undeletable — the QA fills it in, not
  // trims it.
  const autoCreateRef = useRef<string | null>(null);
  useEffect(() => {
    if (casesQuery.isLoading || casesQuery.isError) return;
    if (autoCreateRef.current === flowId) return;
    if (sortedRows.length !== 0) {
      // Mark the flow as "seen" even when non-empty so a stale
      // cache that later empties (e.g. user deletes all rows) doesn't
      // re-trigger a seed. If they really want a fresh skeleton they
      // can reload — same as Excel's empty-sheet state.
      autoCreateRef.current = flowId;
      return;
    }
    autoCreateRef.current = flowId;
    for (let i = 0; i < 10; i += 1) {
      addCase.mutate(
        {
          featureId,
          flowId,
          // Placeholder rows get a numbered default title — the
          // Blocks API rejects empty `title` with
          // `VALIDATION_ERROR: Field 'title' is required for insert`,
          // so we can't seed with `""`. The cell still renders the
          // `Click to edit title` placeholder when this default is
          // present (the cell value is replaced by the placeholder
          // copy the moment the user clears it via inline edit).
          title: `Test case ${i + 1}`,
          // Sparse orders 0/10/20/... so any subsequent mid-sheet
          // insert has at least one slot's worth of room on either
          // side of the placeholder block.
          order: String(i * 10),
          status: "untested",
          priority: "medium",
          isDeletable: false,
        },
        {
          // No shared toast on success — seeding 10 rows in quick
          // succession would surface 10 corner toasts. The toolbar's
          // "Saving…" / "Saved" badge already reflects progress.
          onError: (err) =>
            toast.error(
              err instanceof Error
                ? err.message
                : "Could not create placeholder rows.",
            ),
        },
      );
    }
    // `addCase` is intentionally omitted — the mutation reference is
    // stable per `useAddTestCase` hook instance and including it
    // would re-run the effect on every mutation lifecycle change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowId, featureId, casesQuery.isLoading, casesQuery.isError, sortedRows.length]);

  const beginEdit = (rowId: string, columnId: string, value: string) => {
    setEditingCell(`${rowId}:${columnId}`);
    setDraft(value);
  };

  const commitEdit = (row: TestCase, columnId: string) => {
    const trimmed = draft.trim();
    // Don't PATCH when the value is unchanged — avoids an unnecessary
    // round-trip + invalidation cascade.
    const next = (() => {
      switch (columnId) {
        case "title":
          return row.title === trimmed ? null : { title: trimmed };
        case "steps":
          return row.steps === draft ? null : { steps: draft };
        case "expectedResult":
          return row.expectedResult === draft
            ? null
            : { expectedResult: draft };
        case "actualResult":
          return row.actualResult === draft
            ? null
            : { actualResult: draft };
        default:
          return null;
      }
    })();
    setEditingCell("");
    setDraft("");
    if (!next || Object.keys(next).length === 0) return;
    // Title is required in the schema — refuse to save an empty title
    // and toast so the user knows the row wasn't updated.
    if (columnId === "title" && trimmed.length === 0) {
      toast.error("Title can't be empty.");
      return;
    }
    // The four `requiredOn: "Both"` fields (`featureId`, `flowId`,
    // `status`, `title`) ride along on every PATCH — the Blocks API
    // rejects any update that omits a required field. When editing
    // Title itself, `next.title` is the new value; when editing any
    // other cell, `row.title` / `row.status` are the unchanged values
    // to forward. Same `title` validation: refuse to blank it on the
    // title cell.
    updateCase.mutate(
      {
        id: row.id,
        featureId,
        flowId,
        status: row.status,
        title: columnId === "title" ? trimmed : row.title,
        ...next,
      },
      {
        // Toolbar "Saved" badge drives the in-context feedback (the
        // user explicitly opted out of corner toasts for routine saves
        // — they're noisy when editing many rows). Errors still toast
        // because they signal something the user needs to act on.
        onSuccess: () => setSavedAt(Date.now()),
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "Could not save change.",
          ),
      },
    );
  };

  const cancelEdit = () => {
    setEditingCell("");
    setDraft("");
  };

  const handleDeleteRow = (row: TestCase) => {
    // Defense-in-depth: even though the kebab menu renders Delete as
    // disabled for `isDeletable: false` rows, an API client could
    // still hit the mutation directly. Refuse here so a misbehaving
    // caller (or a future UI bug that forgets to pass
    // `deleteDisabled`) can't remove the skeleton placeholder rows.
    if (!row.isDeletable) {
      toast.error("This row can't be deleted.");
      return;
    }
    deleteCase.mutate(
      { id: row.id, flowId },
      {
        onSuccess: () => setSavedAt(Date.now()),
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "Could not delete row.",
          ),
      },
    );
  };

  // Kebab → Rename. Drops the user straight into the title cell's
  // existing edit path (same `beginEdit` the inline click uses), so
  // the focus + autoselect + Enter-to-commit behavior stays
  // identical to clicking the cell directly.
  const handleRenameRow = (row: TestCase) => {
    beginEdit(row.id, "title", row.title);
  };

  // Compute a fresh `order` string that slots the new row at
  // `targetIndex` (0-based) in the current `sortedRows` array.
  // Strategy: midpoint between the neighbours' `order` values when
  // both exist, otherwise ±10 off the single neighbour (or a
  // starting value when the sheet is empty). Uses numeric
  // midpoint so adjacent rows stay numerically close — repeated
  // inserts eventually need a re-balance but that's a one-line
  // "if midpoint is integer, bump by 1" follow-up if it bites.
  const orderForInsertAt = (targetIndex: number): string => {
    const parseOrder = (s: string | undefined): number | null => {
      const n = parseInt(s ?? "", 10);
      return Number.isFinite(n) ? n : null;
    };
    const prev = parseOrder(sortedRows[targetIndex - 1]?.order);
    const next = parseOrder(sortedRows[targetIndex]?.order);
    if (prev !== null && next !== null) {
      return String(Math.floor((prev + next) / 2));
    }
    if (prev !== null) return String(prev + 10);
    if (next !== null) return String(next - 10);
    return "0";
  };

  // Kebab → Insert Above. Add a new test case positioned just
  // above the target row. Uses `useAddTestCase` so cache
  // invalidation + error path stay identical to the
  // auto-created placeholder rows. `isDeletable: true` so the new
  // row is user-owned and removable — only the auto-created skeleton
  // rows are locked.
  const handleInsertAbove = (row: TestCase) => {
    const targetIndex = sortedRows.findIndex((r) => r.id === row.id);
    if (targetIndex < 0) return;
    addCase.mutate(
      {
        featureId,
        flowId,
        // The Blocks API rejects an empty `title` with
        // `VALIDATION_ERROR: Field 'title' is required for insert`,
        // so we can't insert with `""` even though the column's
        // "Click to edit title" placeholder would have shown through.
        // Stamp a `New test case` default and let the user rename via
        // the existing kebab Rename action or by clicking the cell.
        title: "New test case",
        order: orderForInsertAt(targetIndex),
        status: "untested",
        priority: "medium",
        isDeletable: true,
      },
      {
        onSuccess: () => setSavedAt(Date.now()),
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "Could not insert row.",
          ),
      },
    );
  };

  // Kebab → Insert Below. Mirror of `handleInsertAbove`, slotting
  // the new row at `targetIndex + 1`.
  const handleInsertBelow = (row: TestCase) => {
    const targetIndex = sortedRows.findIndex((r) => r.id === row.id);
    if (targetIndex < 0) return;
    addCase.mutate(
      {
        featureId,
        flowId,
        // Same rationale as `handleInsertAbove` — gateway rejects
        // empty `title` so we stamp a default the user can rename.
        title: "New test case",
        order: orderForInsertAt(targetIndex + 1),
        status: "untested",
        priority: "medium",
        isDeletable: true,
      },
      {
        onSuccess: () => setSavedAt(Date.now()),
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "Could not insert row.",
          ),
      },
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar — case count on the left, controls on the right.
          Status legend and filter chips land here in v2 once the row
          count justifies the chrome. `shrink-0` so the toolbar stays
          pinned when the table below scrolls. */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {sortedRows.length} {sortedRows.length === 1 ? "case" : "cases"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Save status — lives to the LEFT of the zoom icon so the
              user's eye lands on it right next to the row they're
              editing. Both states use the same emerald/green palette
              so the badge reads as one consistent "your change was
              acknowledged" signal — the spinner shows progress, the
              check confirms success. `aria-live="polite"` announces
              the transition to screen-readers without stealing focus. */}
          {isSaving && (
            <span
              aria-live="polite"
              className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
            >
              <Loader2
                className="h-3 w-3 animate-spin"
                aria-hidden="true"
              />
              Saving…
            </span>
          )}
          {!isSaving && showSaved && (
            <span
              aria-live="polite"
              className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
            >
              <Check className="h-3 w-3" aria-hidden="true" />
              Saved
            </span>
          )}
          {/* Expand / collapse the parent drawer across the full
              viewport. The icon swaps with the state so the affordance
              reads correctly at a glance; `aria-label` and the `title`
              tooltip mirror that for screen-readers and hover.
              `onToggleExpanded` is optional so the spreadsheet stays
              usable in contexts (tests, embedded views) where the
              drawer isn't resizable. */}
          {onToggleExpanded && (
            <Button
              size="sm"
              variant="outline"
              onClick={onToggleExpanded}
              aria-label={
                expanded
                  ? t(
                      "testCases.collapse",
                      "Collapse to default width",
                    )
                  : t(
                      "testCases.expand",
                      "Expand across the screen",
                    )
              }
              title={
                expanded
                  ? "Collapse to default width"
                  : "Expand across the screen"
              }
            >
              {expanded ? (
                <Minimize2 className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Maximize2 className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>
          )}
          {/* Add-row button removed: the sheet auto-creates 10
              placeholder rows on first open (see the `autoCreateRef`
              effect below), and from there every existing row's kebab
              menu has Insert Above / Insert Below so new rows are
              always one click away from the row they're inserting
              next to. A toolbar "+ Add row" button would only insert
              at the end with no positional context. */}
        </div>
      </div>

      {/* Scroll container — `min-h-0` is the standard flex-shrink
          override that lets the child shrink below its content size so
          the overflow can engage. The sheet this lives in has a
          defined height, so without `min-h-0` the table would push
          the toolbar off the bottom of the drawer. */}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
            <tr className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <th className="w-10 border-b border-border px-2 py-2 text-center font-medium">
                #
              </th>
              <th className="w-16 border-b border-border px-2 py-2 text-center font-medium">
                Action
              </th>
              <th className="border-b border-border px-3 py-2">Title</th>
              <th className="w-32 border-b border-border px-3 py-2">
                Status
              </th>
              <th className="w-28 border-b border-border px-3 py-2">
                Priority
              </th>
              <th className="border-b border-border px-3 py-2">Steps</th>
              <th className="border-b border-border px-3 py-2">
                Expected
              </th>
              <th className="border-b border-border px-3 py-2">Actual</th>
            </tr>
          </thead>
          <tbody>
            {casesQuery.isLoading ? (
              <tr>
                <td
                  colSpan={8}
                  className="border-b border-border px-3 py-6 text-center text-sm text-muted-foreground"
                >
                  Loading…
                </td>
              </tr>
            ) : sortedRows.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="border-b border-border px-3 py-6 text-center text-sm text-muted-foreground"
                >
                  No test cases yet — placeholders are being added.
                </td>
              </tr>
            ) : (
              sortedRows.map((row, index) => (
                <tr
                  key={row.id}
                  className="group hover:bg-muted/40"
                >
                  <td className="border-b border-border px-2 py-2 align-top text-center text-xs text-muted-foreground">
                    {index + 1}
                  </td>
                  <td className="border-b border-border px-2 py-2 align-top">
                    {/* Per-row options — kebab opens Insert Above /
                        Insert Below / Rename / Delete. Always visible
                        so the affordance is discoverable on every row
                        without hover; matches the discoverability of
                        the Status / Priority dropdowns in the same row.
                        Insert actions sit at the top so the
                        destructive Delete stays anchored at the
                        bottom (RowKebabMenu's `extraItems` slot
                        already renders above Rename). `deleteDisabled`
                        renders the Delete entry greyed-out (and the
                        click blocked) for the 10 auto-created
                        placeholder rows so the skeleton stays
                        visible-but-undeletable; Rename and the
                        insert actions still work so the row remains
                        inspectable. */}
                    <RowKebabMenu
                      ariaLabel="Row actions"
                      renameLabel="Rename"
                      deleteLabel="Delete"
                      // Placeholder rows (`isDeletable: false`) get
                      // the Delete entry rendered-but-greyed-out so
                      // the user can see Delete exists on the row
                      // but can't fire it; user-owned rows are fully
                      // enabled. `handleDeleteRow` itself guards
                      // `isDeletable` as defense-in-depth.
                      deleteDisabled={!row.isDeletable}
                      onRename={() => handleRenameRow(row)}
                      onDelete={() => handleDeleteRow(row)}
                      extraItems={
                        <>
                          <DropdownMenuItem
                            onSelect={() => handleInsertAbove(row)}
                          >
                            <ArrowUp
                              className="h-4 w-4"
                              aria-hidden="true"
                            />
                            <span>Insert above</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => handleInsertBelow(row)}
                          >
                            <ArrowDown
                              className="h-4 w-4"
                              aria-hidden="true"
                            />
                            <span>Insert below</span>
                          </DropdownMenuItem>
                        </>
                      }
                    />
                  </td>
                  <EditableCell
                    row={row}
                    columnId="title"
                    editing={editingCell === `${row.id}:title`}
                    draft={draft}
                    onBegin={() => beginEdit(row.id, "title", row.title)}
                    onChange={setDraft}
                    onCommit={() => commitEdit(row, "title")}
                    onCancel={cancelEdit}
                    onRename={() => handleRenameRow(row)}
                    onDelete={() => handleDeleteRow(row)}
                    deleteDisabled={!row.isDeletable}
                    onInsertAbove={() => handleInsertAbove(row)}
                    onInsertBelow={() => handleInsertBelow(row)}
                    className="font-medium"
                  />
                  <td className="border-b border-border px-3 py-2 align-top">
                    <StatusPicker
                      row={row}
                      featureId={featureId}
                      flowId={flowId}
                      onSaved={() => setSavedAt(Date.now())}
                    />
                  </td>
                  <td className="border-b border-border px-3 py-2 align-top">
                    <PriorityPicker
                      row={row}
                      featureId={featureId}
                      flowId={flowId}
                      onSaved={() => setSavedAt(Date.now())}
                    />
                  </td>
                  <EditableCell
                    row={row}
                    columnId="steps"
                    editing={editingCell === `${row.id}:steps`}
                    draft={draft}
                    onBegin={() => beginEdit(row.id, "steps", row.steps)}
                    onChange={setDraft}
                    onCommit={() => commitEdit(row, "steps")}
                    onCancel={cancelEdit}
                    multiline
                    onRename={() => handleRenameRow(row)}
                    onDelete={() => handleDeleteRow(row)}
                    deleteDisabled={!row.isDeletable}
                    onInsertAbove={() => handleInsertAbove(row)}
                    onInsertBelow={() => handleInsertBelow(row)}
                  />
                  <EditableCell
                    row={row}
                    columnId="expectedResult"
                    editing={
                      editingCell === `${row.id}:expectedResult`
                    }
                    draft={draft}
                    onBegin={() =>
                      beginEdit(row.id, "expectedResult", row.expectedResult)
                    }
                    onChange={setDraft}
                    onCommit={() => commitEdit(row, "expectedResult")}
                    onCancel={cancelEdit}
                    multiline
                    onRename={() => handleRenameRow(row)}
                    onDelete={() => handleDeleteRow(row)}
                    deleteDisabled={!row.isDeletable}
                    onInsertAbove={() => handleInsertAbove(row)}
                    onInsertBelow={() => handleInsertBelow(row)}
                  />
                  <EditableCell
                    row={row}
                    columnId="actualResult"
                    editing={editingCell === `${row.id}:actualResult`}
                    draft={draft}
                    onBegin={() =>
                      beginEdit(row.id, "actualResult", row.actualResult)
                    }
                    onChange={setDraft}
                    onCommit={() => commitEdit(row, "actualResult")}
                    onCancel={cancelEdit}
                    multiline
                    onRename={() => handleRenameRow(row)}
                    onDelete={() => handleDeleteRow(row)}
                    deleteDisabled={!row.isDeletable}
                    onInsertAbove={() => handleInsertAbove(row)}
                    onInsertBelow={() => handleInsertBelow(row)}
                  />
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface EditableCellProps {
  row: TestCase;
  columnId: string;
  editing: boolean;
  draft: string;
  onBegin: () => void;
  onChange: (next: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  multiline?: boolean;
  className?: string;
  // Row-level actions surfaced as a hover-revealed kebab on the right
  // edge of the cell (so each cell carries the same row operations
  // regardless of which column the user is looking at — Rename lives
  // near the title, but Insert Above/Below and Delete are useful from
  // any cell). The kebab is hidden while `editing` is true so it
  // doesn't fight the cursor in an active input/textarea.
  onRename?: () => void;
  onDelete?: () => void;
  /**
   * Mirrors RowKebabMenu's `deleteDisabled`: when true, the cell-
   * level Delete entry is rendered but greyed-out. Always pass
   * `onDelete` alongside this (we render the entry whenever
   * `onDelete` is set); `deleteDisabled` only flips the visual +
   * click state. The mutation handler guards `isDeletable` itself
   * so a stray click that bypasses the disabled state still no-ops.
   */
  deleteDisabled?: boolean;
  onInsertAbove?: () => void;
  onInsertBelow?: () => void;
}

/**
 * One spreadsheet cell. Renders as plain text when not being edited;
 * flips to a textarea/input on click. Auto-resizes the textarea to its
 * content so multi-line `steps` / `expectedResult` / `actualResult`
 * cells grow with the text instead of forcing a horizontal scroll.
 *
 * Read-only state also carries a hover-revealed kebab (right side)
 * that mirrors the row-level RowKebabMenu actions — Insert Above /
 * Insert Below / Rename / Delete. The kebab is hidden while editing
 * to keep the input's caret area uncluttered.
 */
function EditableCell({
  row,
  columnId,
  editing,
  draft,
  onBegin,
  onChange,
  onCommit,
  onCancel,
  multiline = false,
  className,
  onRename,
  onDelete,
  deleteDisabled = false,
  onInsertAbove,
  onInsertBelow,
}: EditableCellProps): ReactNode {
  const value =
    columnId === "title"
      ? row.title
      : columnId === "steps"
        ? row.steps
        : columnId === "expectedResult"
          ? row.expectedResult
          : columnId === "actualResult"
            ? row.actualResult
            : "";

  // Per-column placeholder copy. Used in two places: as the
  // read-only "this is an editable empty cell" hint when the cell
  // has no value, and as the HTML `placeholder` attribute on the
  // input/textarea so the hint is also visible mid-edit when the
  // user has cleared the field. Column-specific wording ("Click to
  // edit title" vs "Click to edit steps") tells the user which
  // field they're looking at without needing to read the column
  // header.
  const placeholder = COLUMN_PLACEHOLDER[columnId] ?? "Click to edit";

  if (editing) {
    if (multiline) {
      return (
        <td className="border border-primary/40 bg-background px-3 py-1 align-top">
          <textarea
            autoFocus
            value={draft}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onCommit}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onCancel();
              }
              // Cmd/Ctrl+Enter commits — Enter alone inserts a newline.
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onCommit();
              }
            }}
            // `rows` starts at 2 so the cell doesn't shrink to a single
            // visible line mid-edit; the auto-resize below keeps it in
            // step with the typed content.
            rows={2}
            className="w-full resize-none border-0 bg-transparent p-0 text-sm text-foreground placeholder:text-muted-foreground placeholder:italic focus:outline-none focus:ring-0"
          />
        </td>
      );
    }
    return (
      <td className="border border-primary/40 bg-background px-3 py-1 align-top">
        <input
          autoFocus
          type="text"
          value={draft}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onCommit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onCommit();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          className="w-full border-0 bg-transparent p-0 text-sm text-foreground placeholder:text-muted-foreground placeholder:italic focus:outline-none focus:ring-0"
        />
      </td>
    );
  }

  // Read-only state — show a placeholder when the cell is empty so
  // the user knows the cell is editable (an empty cell with no visual
  // hint looks like a missing column). Also carries a hover-revealed
  // kebab on the right edge so every cell exposes the same row-level
  // actions (Insert Above / Insert Below / Rename / Delete) without
  // forcing the user to hunt for the row-level kebab on the far left.
  //
  // The kebab sits in a `relative` wrapper and uses a Tailwind named
  // group (`group/cell` + `group-hover/cell:opacity-100`) so each
  // cell's kebab reveals independently on its own hover — the parent
  // `<tr>` already uses `group` (for the row hover bg) which would
  // collide with an unnamed group selector, hence the scoped name.
  //
  // Stop-propagation on the kebab trigger so clicking it doesn't
  // bubble to the `<td>` and trigger `onBegin` (which would put the
  // cell into edit mode behind the dropdown). Same guard the
  // row-level RowKebabMenu uses.
  return (
    <td
      className={cn(
        "group/cell cursor-text border-b border-border px-3 py-2 align-top text-sm text-foreground",
        !value && "text-muted-foreground italic",
        className,
      )}
      onClick={onBegin}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onBegin();
        }
      }}
    >
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
          {value ? value : placeholder}
        </span>
        {(onRename ||
          onDelete ||
          onInsertAbove ||
          onInsertBelow) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Cell actions"
                // The trigger lives inside a clickable `<td>` (calls
                // `onBegin`). Stop propagation so opening the menu
                // doesn't simultaneously put the cell into edit mode.
                // Hidden until the cell is hovered so the cell row
                // reads cleanly when idle; opacity (not `hidden`) so
                // keyboard focus (Tab onto the cell) still surfaces
                // it — `focus-visible:` keeps the focus ring visible
                // even when the hover affordance is suppressed.
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:opacity-100 group-hover/cell:opacity-100"
              >
                <MoreVertical
                  className="h-3.5 w-3.5"
                  aria-hidden="true"
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              {onInsertAbove && (
                <DropdownMenuItem onSelect={onInsertAbove}>
                  <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  <span>Insert above</span>
                </DropdownMenuItem>
              )}
              {onInsertBelow && (
                <DropdownMenuItem onSelect={onInsertBelow}>
                  <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  <span>Insert below</span>
                </DropdownMenuItem>
              )}
              {onRename && (
                <DropdownMenuItem onSelect={onRename}>
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                  <span>Rename</span>
                </DropdownMenuItem>
              )}
              {onDelete && (
                <DropdownMenuItem
                  onSelect={onDelete}
                  disabled={deleteDisabled}
                  // `disabled:` utilities keep the red label legible
                  // but dial back opacity + hover background so the
                  // entry reads as "off" — same treatment as the
                  // row-level RowKebabMenu so the two surfaces look
                  // identical for the same row state.
                  className="text-red-600 focus:bg-red-50 focus:text-red-700 disabled:opacity-50 disabled:focus:bg-transparent"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  <span>Delete</span>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </td>
  );
}

interface StatusPickerProps {
  row: TestCase;
  featureId: string;
  flowId: string;
  /**
   * Called when the status PATCH succeeds. Lets the parent spreadsheet
   * light up the shared "Saved" badge + success toast in the toolbar —
   * the picker itself stays stateless so the user-visible confirmation
   * lives in one place.
   */
  onSaved?: () => void;
}

/**
 * Status cell — a coloured badge that opens the browser's native
 * select dropdown on click. The select writes through
 * `useUpdateTestCase`, same as inline edit, so the cache
 * invalidation + toast-error paths stay identical.
 *
 * The chevron is a separate `<svg>` rather than an SVG `data:` URL
 * in the background. `currentColor` inside a CSS data URL is
 * evaluated by the browser when the image is decoded — and Chrome
 * in particular resolves it to the canvas `color`, *not* the
 * select's `color`, so the arrow renders with the page's default
 * text colour instead of the pill's. A standalone `<svg>` child
 * simply inherits `color` from the pill like normal text.
 */
function StatusPicker({ row, featureId, flowId, onSaved }: StatusPickerProps) {
  const updateCase = useUpdateTestCase();
  const toast = useToast();
  const handleChange = (next: string) => {
    if (next === row.status) return;
    updateCase.mutate(
      {
        id: row.id,
        featureId,
        flowId,
        // Forward the new status, not the row's current one — `next`
        // is what the user just picked. `featureId`, `flowId`, and
        // `title` ride along unchanged because the schema marks all
        // three `requiredOn: "Both"` and a PATCH that omits any 400s.
        status: next as TestCaseStatus,
        title: row.title,
      },
      {
        // Status is owned by the parent spreadsheet (it's the source of
        // truth that drives the toolbar's save indicator), so call up to
        // the shared `setSavedAt` instead of duplicating the timestamp
        // logic here.
        onSuccess: () => onSaved?.(),
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "Could not update status.",
          ),
      },
    );
  };
  return (
    <div className="relative">
      <select
        aria-label="Test status"
        value={row.status}
        onChange={(e) => handleChange(e.target.value)}
        // `pr-7` leaves room for the chevron, `appearance-none` strips
        // the browser's native arrow so our overlay is the only one
        // visible. The `bg-...` utilities drive the pill colour; the
        // chevron's `color` is inherited from `text-` utilities on
        // the same element so light + dark mode both keep contrast.
        className={cn(
          "h-7 w-full cursor-pointer appearance-none rounded-md border-0 bg-[length:10px_10px] bg-no-repeat px-2 pr-7 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-ring",
          STATUS_COLOR[row.status],
        )}
      >
        {TEST_CASE_STATUS_VALUES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      <ChevronIcon className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-current opacity-80" />
    </div>
  );
}

interface PriorityPickerProps {
  row: TestCase;
  featureId: string;
  flowId: string;
  /**
   * Called when the priority PATCH succeeds. Same pattern as
   * StatusPicker — keeps the toolbar's save indicator + toast
   * centralised in the parent.
   */
  onSaved?: () => void;
}

/**
 * Priority cell — same shape as `StatusPicker` (native `<select>`
 * + overlay chevron) and the same coloured-pill treatment, so each
 * priority level (low / medium / high) reads at a glance against the
 * row surface. Writes the same way through `useUpdateTestCase`.
 * `status`, `title`, `featureId`, and `flowId` ride along unchanged
 * because all four are `requiredOn: "Both"` and a PATCH that omits
 * any of them 400s.
 */
function PriorityPicker({ row, featureId, flowId, onSaved }: PriorityPickerProps) {
  const updateCase = useUpdateTestCase();
  const toast = useToast();
  const handleChange = (next: string) => {
    if (next === row.priority) return;
    updateCase.mutate(
      {
        id: row.id,
        featureId,
        flowId,
        // `status` and `title` ride along unchanged — both are
        // `requiredOn: "Both"` and a PATCH that omits either 400s.
        status: row.status,
        title: row.title,
        priority: next as TestCasePriority,
      },
      {
        // Same shared indicator hook as StatusPicker — keeps the
        // toolbar badge consistent across all three writers.
        onSuccess: () => onSaved?.(),
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "Could not update priority.",
          ),
      },
    );
  };
  return (
    <div className="relative">
      <select
        aria-label="Priority"
        value={row.priority}
        onChange={(e) => handleChange(e.target.value)}
        // `pr-7` leaves room for the chevron, `appearance-none` strips
        // the browser's native arrow so our overlay is the only one
        // visible. The `bg-...` utilities drive the pill colour — same
        // approach as StatusPicker — and the chevron's `color` is
        // inherited from `text-current` on the same element so light +
        // dark mode both keep contrast.
        className={cn(
          "h-7 w-full cursor-pointer appearance-none rounded-md border-0 bg-[length:10px_10px] bg-no-repeat px-2 pr-7 text-xs font-medium capitalize focus:outline-none focus:ring-1 focus:ring-ring",
          PRIORITY_COLOR[row.priority],
        )}
      >
        {TEST_CASE_PRIORITY_VALUES.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <ChevronIcon className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-current opacity-80" />
    </div>
  );
}

/**
 * Small inline chevron used by the Status / Priority pickers. Pulled
 * out as its own component so both pickers share the same SVG and so
 * a future tweak (size, stroke, animation) lands in one place.
 */
function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

const STATUS_LABEL: Record<TestCaseStatus, string> = {
  untested: "Untested",
  pass: "Pass",
  fail: "Fail",
  blocked: "Blocked",
  skipped: "Skipped",
};

// Cell colours keyed by status — saturated enough to read against the
// table's neutral surface, gentle enough not to fight the row-hover
// tint. `dark:` variants bump lightness for legibility on dark mode.
const STATUS_COLOR: Record<TestCaseStatus, string> = {
  untested:
    "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100",
  pass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  fail: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
  blocked: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  skipped:
    "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

// Cell colours keyed by priority — same palette family as STATUS_COLOR
// so the table reads as one consistent colour system. `low` leans cool
// (sky/blue) to suggest "not urgent"; `medium` is neutral amber so it
// neither shouts nor recedes; `high` is warm red to match the urgency
// bias teams expect from a red priority badge.
const PRIORITY_COLOR: Record<TestCasePriority, string> = {
  low: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  medium:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  high: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
};
