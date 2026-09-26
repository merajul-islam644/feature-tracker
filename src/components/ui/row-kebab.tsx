// Vertical 3-dot kebab menu for list rows. Two modes:
//
//   * default (editable rows in dev envs)
//       Trigger opens a Radix DropdownMenu with Rename + Delete,
//       plus an optional `extraItems` slot the caller fills in for
//       row-specific actions (e.g. "Feature Details" above
//       Rename/Delete so the destructive Delete stays anchored at
//       the bottom).
//
//   * readOnly (non-dev envs)
//       Only a "View Details" entry is rendered. Rename and Delete
//       are deliberately hidden — non-dev envs are read-only views
//       of what was authored in dev, so destructive actions have
//       no meaning here. The View Details entry opens the row's
//       existing details drawer (FeatureDetailsDrawer /
//       FlowDetailsDrawer).
//
// The button stops pointer/keyboard event propagation so it doesn't
// bubble up to a parent click target (e.g. the FeatureItem expand/
// collapse handler). This is true in both modes.

import type { ReactNode } from "react";
import { Info, MoreVertical, Pencil, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface RowKebabMenuProps {
  ariaLabel: string;
  /** Required in editable mode. Ignored in readOnly mode. */
  renameLabel?: string;
  /** Required in editable mode. Ignored in readOnly mode. */
  deleteLabel?: string;
  onRename?: () => void;
  onDelete?: () => void;
  /**
   * When true, the Delete entry is rendered but disabled (greyed
   * out, not clickable). Used by the TestCaseSpreadsheet for the
   * 10 auto-created default rows so the option is visible-but-
   * blocked: the user can see Delete exists, but the click is
   * intercepted so the mutation never fires. The mutation handler
   * itself guards `isDeletable` as defense-in-depth, so a stray
   * click that bypasses the visual state still no-ops. Defaults
   * to `false` (Delete enabled).
   */
  deleteDisabled?: boolean;
  /** When true, hide Rename/Delete and render only a single "View
   *  Details" entry using `viewDetailsLabel` + `onViewDetails`.
   *  Defaults to false (existing editable-row behavior). */
  readOnly?: boolean;
  /** Required when readOnly is true. Localized label for the
   *  read-only menu's sole entry (e.g. "Feature Details",
   *  "Flow Details"). Ignored in editable mode. */
  viewDetailsLabel?: string;
  /** Required when readOnly is true. Triggered by the read-only
   *  menu's sole entry. Ignored in editable mode. */
  onViewDetails?: () => void;
  /** Caller-supplied items rendered between the trigger and Rename.
   *  Use for row-specific actions that don't fit Rename/Delete.
   *  Ignored in readOnly mode — read-only rows should use the
   *  explicit `viewDetailsLabel`/`onViewDetails` props instead. */
  extraItems?: ReactNode;
}

export function RowKebabMenu({
  ariaLabel,
  renameLabel,
  deleteLabel,
  onRename,
  onDelete,
  deleteDisabled = false,
  readOnly = false,
  viewDetailsLabel,
  onViewDetails,
  extraItems,
}: RowKebabMenuProps) {
  // Stop pointer and keyboard events from bubbling up to a parent click
  // target (e.g. the FeatureItem expand/collapse handler). We use
  // stopPropagation only — preventing defaults here would also block
  // Radix's own keydown handling on the trigger button.
  const swallow = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          onClick={swallow}
          onKeyDown={swallow}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent"
        >
          <MoreVertical className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {readOnly ? (
          // Read-only rows: only the "View Details" entry. The Info
          // icon mirrors the dev-mode `extraItems` entry so the two
          // modes read as the same affordance, just with the
          // destructive options stripped. Renders nothing if
          // `onViewDetails` was omitted — the trigger still opens
          // but the menu would be empty, so guard explicitly.
          onViewDetails && (
            <DropdownMenuItem onSelect={onViewDetails}>
              <Info className="h-4 w-4" aria-hidden="true" />
              <span>{viewDetailsLabel}</span>
            </DropdownMenuItem>
          )
        ) : (
          // Editable rows (dev mode): existing behavior — extra
          // items at the top, then Rename, then Delete at the
          // bottom (red) so the destructive action stays anchored.
          // The Delete entry is always rendered (so the option is
          // discoverable) but `disabled` when `deleteDisabled` is
          // true — the user can see Delete exists on the row but
          // the click is blocked. Rename / extraItems remain
          // active so the row stays inspectable.
          <>
            {extraItems}
            <DropdownMenuItem onSelect={onRename}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
              <span>{renameLabel}</span>
            </DropdownMenuItem>
            {onDelete && (
              <DropdownMenuItem
                onSelect={onDelete}
                disabled={deleteDisabled}
                // `disabled:` utilities keep the red label legible
                // but dial back opacity + hover background so the
                // entry reads as "off" rather than as an active
                // destructive button.
                className="text-red-600 focus:bg-red-50 focus:text-red-700 disabled:opacity-50 disabled:focus:bg-transparent"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                <span>{deleteLabel}</span>
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
