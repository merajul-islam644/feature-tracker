// Top-line summary cards for the verification run (spec section 16).
// Four tiles: total / completed / failed / duration.

import { CheckCircle2, AlertTriangle, ListChecks, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { VerificationRun } from "@/types/issue-tracker";

interface Props {
  run: VerificationRun;
}

export function VerificationSummary({ run }: Props) {
  const duration = formatDuration(run);
  const tiles: { label: string; value: string; icon: typeof CheckCircle2; tone: string }[] = [
    {
      label: "Targets",
      value: String(run.totalTargets),
      icon: ListChecks,
      tone: "text-muted-foreground",
    },
    {
      label: "Completed",
      value: `${run.completedTargets}/${run.totalTargets}`,
      icon: CheckCircle2,
      tone: "text-emerald-600 dark:text-emerald-400",
    },
    {
      label: "Failed",
      value: String(run.failedTargets),
      icon: AlertTriangle,
      tone: run.failedTargets > 0 ? "text-destructive" : "text-muted-foreground",
    },
    {
      label: "Duration",
      value: duration,
      icon: Clock,
      tone: "text-muted-foreground",
    },
  ];

  return (
    <div
      className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      role="group"
      aria-label="Verification run summary"
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
            <p className={`mt-1 text-xl font-semibold tabular-nums ${t.tone}`}>{t.value}</p>
          </Card>
        );
      })}
    </div>
  );
}

function formatDuration(run: VerificationRun): string {
  if (!run.startedAt) return "—";
  const start = new Date(run.startedAt).getTime();
  const end = run.completedAt ? new Date(run.completedAt).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}
