import * as React from "react";
import { X, Check, ChevronsUpDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface MultiSelectOption {
  value: string;
  label: string;
}

export interface MultiSelectProps {
  label?: string;
  /**
   * Currently-selected option values. The component is controlled —
   * pass the parent's state in via this prop, react to changes through
   * `onChange`. Treating the array as immutable keeps referential
   * equality stable across renders and lets memoisation work.
   */
  value: string[];
  onChange: (next: string[]) => void;
  options: MultiSelectOption[];
  /**
   * Shown in the trigger area when no items are selected. Also shown
   * when the option list is empty (the 403 / empty-roster fallback
   * path) so the user still sees a usable, non-broken control.
   */
  placeholder?: string;
  /**
   * Disabled state mirrors the underlying Popover / Checkbox. The
   * trigger still shows the current selection but no popover opens
   * and no chips can be removed.
   */
  disabled?: boolean;
  /** Optional id passthrough for the trigger button. */
  id?: string;
  className?: string;
  /**
   * Single-line trigger with overflow hidden. When a card grid wants
   * all cards at uniform height (Members page), chips that don't fit
   * on one line are clipped — the "+N more" badge already covers
   * >3 selections, and the popover always shows the full list. The
   * full multi-line trigger is the default; pass `true` here only
   * when the trigger lives in a height-sensitive row.
   */
  compact?: boolean;
}

// Wrap the rendered labels in this many chips before switching to a
// "N selected" pill. Keeping the cap small prevents the trigger row
// from blowing out vertically when a feature has many assignees.
const MAX_VISIBLE_CHIPS = 3;

// Multi-select primitive. Same external label style as the single-
// value `Select` so the Add Feature modal's left-column rhythm
// carries through unchanged. Internally: a Popover opens a checkbox
// list — clicking an option toggles it in the controlled `value`
// array via `onChange`. Selected items also render as removable
// chips inside the trigger so the user can deselect without opening
// the popover (handy when they only want to drop one assignee).
//
// Empty option list degrades to the same disabled "—" surface the
// single-value `Select` shows — the placeholder text drives the
// copy (typically a hint that the roster is unavailable).
export function MultiSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  id,
  className,
  compact = false,
}: MultiSelectProps) {
  const triggerId = id ?? React.useId();
  const labelId = `${triggerId}-label`;
  // Stable set for O(1) selection checks. Rebuilt only when `value`
  // identity flips, so each render doesn't allocate a new Set.
  const selectedSet = React.useMemo(() => new Set(value), [value]);
  // Toggle a single option's membership in the controlled array.
  // Reuses the existing array reference when nothing actually
  // changed (e.g. user clicked an already-selected option outside
  // the popover) — keeps downstream memoisation stable.
  const toggle = React.useCallback(
    (optionValue: string) => {
      const next = selectedSet.has(optionValue)
        ? value.filter((v) => v !== optionValue)
        : [...value, optionValue];
      onChange(next);
    },
    [onChange, selectedSet, value],
  );
  // Remove the chip directly (called from the trigger's × button).
  // Allocated only when value identity flips.
  const removeValue = React.useCallback(
    (optionValue: string) => {
      onChange(value.filter((v) => v !== optionValue));
    },
    [onChange, value],
  );
  // Look up the human-readable label for a selected value so the
  // chip text reads "Meraj Zoarder" rather than the raw id. Falls
  // back to the raw id when the option list doesn't yet know about
  // it (e.g. a stale assignment pointing at a deleted user) so the
  // chip stays informative rather than vanishing.
  const labelFor = React.useCallback(
    (optionValue: string) =>
      options.find((o) => o.value === optionValue)?.label ?? optionValue,
    [options],
  );
  const noOptions = options.length === 0;
  // We disable the trigger when the user has passed `disabled` OR
  // when the option list is empty (no IAM roster, can't pick anyone
  // — the placeholder doubles as the explanation so we don't open
  // an empty popover).
  const effectivelyDisabled = disabled || noOptions;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label
          id={labelId}
          htmlFor={triggerId}
          className="text-sm font-medium text-foreground"
        >
          {label}
        </label>
      )}
      <Popover>
        <PopoverTrigger asChild>
          <button
            id={triggerId}
            type="button"
            aria-labelledby={label ? labelId : undefined}
            aria-haspopup="listbox"
            disabled={effectivelyDisabled}
            className={cn(
              // `flex-wrap` lets long chip lists wrap to a second
              // row; `flex-nowrap overflow-hidden` (set when
              // `compact`) clamps the trigger to one row so cards
              // sharing a grid row don't desync their heights as
              // chips are added.
              compact
                ? "flex min-h-10 max-h-10 w-full flex-nowrap items-center gap-1.5 overflow-hidden rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground transition-colors"
                : "flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              "disabled:cursor-not-allowed disabled:opacity-50",
              // Right-side chevron mirrors the single-value Select's
              // affordance so the trigger clearly reads as a picker.
              "relative",
            )}
          >
            {value.length === 0 ? (
              <span className="text-muted-foreground">{placeholder}</span>
            ) : (
              <>
                {value.slice(0, MAX_VISIBLE_CHIPS).map((v) => (
                  <Badge key={v} variant="secondary" className="pr-1 pl-2">
                    <span className="max-w-[12rem] truncate">
                      {labelFor(v)}
                    </span>
                    {/* Stop propagation so clicking the × doesn't
                        toggle the popover open. The remove is the
                        primary action of the chip; the popover is
                        for batch picks. */}
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Remove ${labelFor(v)}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeValue(v);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          removeValue(v);
                        }
                      }}
                      className="ml-0.5 inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </span>
                  </Badge>
                ))}
                {value.length > MAX_VISIBLE_CHIPS && (
                  <Badge variant="muted">
                    +{value.length - MAX_VISIBLE_CHIPS} more
                  </Badge>
                )}
              </>
            )}
            <ChevronsUpDown
              className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
          </button>
        </PopoverTrigger>
        {/* Popover stays mounted even when effectivelyDisabled is
            false — we want a real checkbox list when the user opens
            the picker. Width matches the trigger so the labels line
            up without horizontal reflow. */}
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] p-2"
          align="start"
        >
          {noOptions ? (
            <div className="px-2 py-3 text-sm text-muted-foreground">
              {placeholder}
            </div>
          ) : (
            // Cap the popover height — list scrolls if the roster is
            // bigger than the viewport. Keyboard users tab through
            // the checkboxes; Arrow keys are wired up by Radix.
            <ul
              role="listbox"
              aria-multiselectable
              className="max-h-64 space-y-1 overflow-y-auto"
            >
              {options.map((opt) => {
                const isSelected = selectedSet.has(opt.value);
                return (
                  <li key={opt.value}>
                    <label
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                        "hover:bg-accent hover:text-accent-foreground",
                        isSelected && "bg-accent/40",
                      )}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggle(opt.value)}
                        aria-label={opt.label}
                      />
                      <span className="truncate">{opt.label}</span>
                      {isSelected && (
                        <Check
                          className="ml-auto h-3.5 w-3.5 text-primary"
                          aria-hidden="true"
                        />
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

MultiSelect.displayName = "MultiSelect";
