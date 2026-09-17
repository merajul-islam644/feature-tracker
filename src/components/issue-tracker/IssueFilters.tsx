// Filter bar for the issues section (spec section 21, 31).
// Search, application select, sort, severity / status / category chip rows.

import { Search, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
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

const severities: { id: IssueSeverity; label: string; tone: string }[] = [
  { id: "critical", label: "Critical", tone: "border-red-500/40 text-red-600 dark:text-red-400" },
  { id: "high", label: "High", tone: "border-amber-500/40 text-amber-600 dark:text-amber-400" },
  { id: "medium", label: "Medium", tone: "border-yellow-500/40 text-yellow-600 dark:text-yellow-400" },
  { id: "low", label: "Low", tone: "border-sky-500/40 text-sky-600 dark:text-sky-400" },
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
  const activeSeverities = new Set(filters.severities);
  const activeStatuses = new Set(filters.statuses);
  const activeCategories = new Set(filters.categories);

  // Generic toggle for any axis. Reuses the existing chip pattern from
  // severity (border + active/inactive palette) so the three rows share
  // their visual grammar.
  function toggle<T extends string>(
    key: "severities" | "statuses" | "categories",
    current: Set<T>,
    value: T,
  ) {
    const next = new Set(current);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange({ ...filters, [key]: Array.from(next) });
  }

  const filterCount =
    filters.severities.length +
    filters.statuses.length +
    filters.categories.length +
    (filters.application ? 1 : 0);

  return (
    <Card className="p-3">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
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
          <div className="flex items-center gap-2">
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
              className="min-w-[10rem]"
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
              className="min-w-[8rem]"
            />
          </div>
        </div>

        <ChipRow label="Severity">
          {severities.map((s) => {
            const on = activeSeverities.has(s.id);
            return (
              <Chip
                key={s.id}
                pressed={on}
                pressedTone={s.tone}
                onClick={() => toggle("severities", activeSeverities, s.id)}
                ariaLabel={s.label}
              >
                {s.label}
              </Chip>
            );
          })}
        </ChipRow>

        <ChipRow label="Status">
          {statuses.map((s) => {
            const on = activeStatuses.has(s.id);
            return (
              <Chip
                key={s.id}
                pressed={on}
                pressedTone="border-primary/40 bg-primary/10 text-primary"
                onClick={() => toggle("statuses", activeStatuses, s.id)}
                ariaLabel={`Status: ${s.label}`}
              >
                {s.label}
              </Chip>
            );
          })}
        </ChipRow>

        <ChipRow label="Category">
          {categories.map((c) => {
            const on = activeCategories.has(c.id);
            return (
              <Chip
                key={c.id}
                pressed={on}
                pressedTone="border-foreground/40 bg-foreground/10 text-foreground"
                onClick={() => toggle("categories", activeCategories, c.id)}
                ariaLabel={`Category: ${c.label}`}
              >
                {c.label}
              </Chip>
            );
          })}
        </ChipRow>

        {filterCount > 0 && (
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClear}
              className="h-7 px-2 text-xs"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Clear filters
              <Badge variant="muted">{filterCount}</Badge>
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

// Visual label + chip rail wrapper. Keeps the three filter rows visually
// parallel ("Severity", "Status", "Category") without re-stating layout
// each time.
function ChipRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({
  pressed,
  pressedTone,
  onClick,
  ariaLabel,
  children,
}: {
  pressed: boolean;
  pressedTone: string;
  onClick: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        pressed
          ? pressedTone
          : "border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

