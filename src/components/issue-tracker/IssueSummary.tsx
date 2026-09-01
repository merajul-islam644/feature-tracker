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
          <Card key={t.label} className="p-3">
            <div className="flex items-center gap-2">
              <Icon className={`h-4 w-4 shrink-0 ${t.tone}`} aria-hidden="true" />
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t.label}
              </p>
            </div>
            <p className={`mt-1 text-xl font-semibold tabular-nums ${t.tone}`}>
              {t.value}
            </p>
          </Card>
        );
      })}
    </div>
  );
}
