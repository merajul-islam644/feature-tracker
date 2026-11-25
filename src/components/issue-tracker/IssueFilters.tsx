// Filter bar for the issues section (spec section 21, 31).
// Search + application select + sort, then the three multi-select
// dropdowns (Severity / Status / Category) — converted from the old
// chip rows to GitHub-style filter dropdowns (user request 2026-11-25):
// each is a button with a live selected-count badge that opens a
// checkbox panel; picking values never closes the panel, so several
// can be ticked in one sitting.

import { useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type {
  IssueFilters as Filters,
  IssueSeverity,
  IssueStatus,
  IssueCategory,
} from "@/types/issue-tracker";

interface Props {
  filters: Filters;
  applications: string[];
  onChange: (next: Filters) => void;
  onClear: () => void;
}

const severities: { id: IssueSeverity; label: string; dot: string }[] = [
  { id: "critical", label: "Critical", dot: "bg-red-500" },
  { id: "high", label: "High", dot: "bg-amber-500" },
  { id: "medium", label: "Medium", dot: "bg-yellow-500" },
  { id: "low", label: "Low", dot: "bg-sky-500" },
];

const statuses: { id: IssueStatus; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "investigating", label: "Investigating" },
  { id: "confirmed", label: "Confirmed" },
  { id: "fixed", label: "Fixed" },
  { id: "resolved", label: "Resolved" },
  { id: "wont_fix", label: "Won't fix" },
  { id: "ignored", label: "Ignored" },
  { id: "reopened", label: "Reopened" },
];

const categories: { id: IssueCategory; label: string }[] = [
  { id: "authentication", label: "Authentication" },
  { id: "authorization", label: "Authorization" },
  { id: "navigation", label: "Navigation" },
  { id: "ui", label: "UI" },
  { id: "functional", label: "Functional" },
  { id: "forms", label: "Forms" },
  { id: "api", label: "API" },
  { id: "performance", label: "Performance" },
  { id: "accessibility", label: "Accessibility" },
  { id: "other", label: "Other" },
];

export function IssueFilters({ filters, applications, onChange, onClear }: Props) {
  // Generic toggle for any axis — array in, array out, same order
  // stability as before.
  function toggle(key: "severities" | "statuses" | "categories", value: string) {
    const current = filters[key] as string[];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onChange({ ...filters, [key]: next });
  }

  const filterCount =
    filters.severities.length +
    filters.statuses.length +
    filters.categories.length +
    (filters.application ? 1 : 0);

  return (
    <Card className="p-3">
      {/* One-line filter bar (user request 2026-11-25): search, both
          selects, and the three multi-select dropdowns share a single
          row — `flex-wrap` degrades gracefully on narrow screens where
          the row legitimately can't fit. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            placeholder="Search issues…"
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
            className="pl-8"
            aria-label="Search issues"
          />
        </div>
        <Select
          aria-label="Application filter"
          value={filters.application ?? ""}
          onChange={(e) =>
            onChange({ ...filters, application: e.target.value || null })
          }
          options={[
            { value: "", label: "All applications" },
            ...applications.map((a) => ({ value: a, label: a })),
          ]}
          className="min-w-[9rem]"
        />
        <Select
          aria-label="Sort"
          value={filters.sort}
          onChange={(e) =>
            onChange({ ...filters, sort: e.target.value as Filters["sort"] })
          }
          options={[
            { value: "newest", label: "Newest" },
            { value: "oldest", label: "Oldest" },
            { value: "severity", label: "Severity" },
            { value: "application", label: "Application" },
          ]}
          className="min-w-[7.5rem]"
        />
        {/* Multi-select filter dropdowns. Each button carries a live
            count badge of how many values on that axis are active, and
            opens a checkbox panel; ticking stays open so multiple
            values land in one sitting. Severity options carry their
            color dot so the panel matches the board's severity dots. */}
        <FilterDropdown
          label="Severity"
          options={severities}
          selected={filters.severities}
          onToggle={(id) => toggle("severities", id)}
          onClear={() => onChange({ ...filters, severities: [] })}
        />
        <FilterDropdown
          label="Status"
          options={statuses}
          selected={filters.statuses}
          onToggle={(id) => toggle("statuses", id)}
          onClear={() => onChange({ ...filters, statuses: [] })}
        />
        <FilterDropdown
          label="Category"
          options={categories}
          selected={filters.categories}
          onToggle={(id) => toggle("categories", id)}
          onClear={() => onChange({ ...filters, categories: [] })}
        />
        {filterCount > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="h-8 px-2 text-xs"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Clear filters
            <Badge variant="muted">{filterCount}</Badge>
          </Button>
        )}
      </div>
    </Card>
  );
}

// One multi-select filter dropdown. The trigger shows the axis label,
// a live count badge (only when values are picked — the button then
// flips to the accent treatment so active filters are visible with the
// panel closed), and a chevron. The panel is a checkbox list keyed by
// option id; ticking toggles without closing.
function FilterDropdown({
  label,
  options,
  selected,
  onToggle,
  onClear,
}: {
  label: string;
  options: { id: string; label: string; dot?: string }[];
  selected: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const activeCount = selected.length;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Filter by ${label.toLowerCase()} — ${activeCount} selected`}
          aria-expanded={open}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            activeCount > 0
              ? "border-primary/40 bg-primary/5 text-foreground"
              : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {label}
          {activeCount > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold tabular-nums text-primary-foreground">
              {activeCount}
            </span>
          )}
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              open && "rotate-180",
            )}
            aria-hidden="true"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1.5">
        <div className="flex items-center justify-between px-2 pb-1.5 pt-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          {activeCount > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="text-[11px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Clear
            </button>
          )}
        </div>
        <ul role="listbox" aria-multiselectable className="max-h-60 overflow-y-auto">
          {options.map((opt) => {
            const isSelected = selected.includes(opt.id);
            return (
              <li key={opt.id}>
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                    "hover:bg-accent hover:text-accent-foreground",
                    isSelected && "bg-accent/40",
                  )}
                >
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => onToggle(opt.id)}
                    aria-label={opt.label}
                  />
                  {opt.dot && (
                    <span
                      className={cn("h-2 w-2 shrink-0 rounded-full", opt.dot)}
                      aria-hidden="true"
                    />
                  )}
                  <span className="flex-1">{opt.label}</span>
                  {isSelected && (
                    <Check
                      className="h-3.5 w-3.5 text-primary"
                      aria-hidden="true"
                    />
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
