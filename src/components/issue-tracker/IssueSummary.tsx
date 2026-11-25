// Top-line summary tiles for the issues section (spec section 22).

import { AlertOctagon, AlertTriangle, AlertCircle, Info, ListChecks } from "lucide-react";
import { Card } from "@/components/ui/card";

interface Counts {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  open: number;
}

interface Props {
  counts: Counts;
}

export function IssueSummary({ counts }: Props) {
  const tiles: { label: string; value: number; icon: typeof AlertOctagon; tone: string }[] = [
    { label: "Total", value: counts.total, icon: ListChecks, tone: "text-muted-foreground" },
    {
      label: "Critical",
      value: counts.critical,
      icon: AlertOctagon,
      tone: "text-red-600 dark:text-red-400",
    },
    {
      label: "High",
      value: counts.high,
      icon: AlertTriangle,
      tone: "text-amber-600 dark:text-amber-400",
    },
    {
      label: "Medium",
      value: counts.medium,
      icon: AlertCircle,
      tone: "text-yellow-600 dark:text-yellow-400",
    },
    {
      label: "Low",
      value: counts.low,
      icon: Info,
      tone: "text-sky-600 dark:text-sky-400",
    },
    { label: "Open", value: counts.open, icon: AlertCircle, tone: "text-foreground" },
  ];

  return (
    <div
      className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
      role="group"
      aria-label="Issue summary"
    >
      {tiles.map((t) => {
        const Icon = t.icon;
        return (
          // Single-line compact tile: icon + label left, count right —
          // keeps the six-tile strip to one tight row instead of a
          // card wall eating the page's vertical space.
          <Card
            key={t.label}
            className="flex items-center gap-2 px-2.5 py-2"
          >
            <Icon className={`h-3.5 w-3.5 shrink-0 ${t.tone}`} aria-hidden="true" />
            <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t.label}
            </p>
            <p
              className={`ml-auto text-base font-semibold tabular-nums ${t.tone}`}
            >
              {t.value}
            </p>
          </Card>
        );
      })}
    </div>
  );
}
