// Filter bar for the issues section (spec section 21).
// Search, severity chips, application select, sort select, clear.

import { Search, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type { IssueFilters as Filters, IssueSeverity } from "@/types/issue-tracker";

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

export function IssueFilters({ filters, applications, onChange, onClear }: Props) {
  const activeSeverities = new Set(filters.severities);

  const toggleSeverity = (s: IssueSeverity) => {
    const next = new Set(activeSeverities);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    onChange({ ...filters, severities: Array.from(next) });
  };

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

        <div className="flex flex-wrap items-center gap-1.5">
          {severities.map((s) => {
            const on = activeSeverities.has(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => toggleSeverity(s.id)}
                aria-pressed={on}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  on
                    ? s.tone
                    : "border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground"
                }`}
              >
                {s.label}
              </button>
            );
          })}
          {filterCount > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClear}
              className="ml-auto h-7 px-2 text-xs"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Clear filters
              <Badge variant="muted">{filterCount}</Badge>
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
