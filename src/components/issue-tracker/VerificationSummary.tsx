// Top-line summary cards for the verification run (spec section 16, 30).
// Five tiles: total / completed / failed / duration / last run.

import {
  CheckCircle2,
  AlertTriangle,
  ListChecks,
  Clock,
  History,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import type { VerificationRun } from "@/types/issue-tracker";

interface Props {
  run: VerificationRun;
}

export function VerificationSummary({ run }: Props) {
  const duration = formatDuration(run);
  const lastRun = formatRelativeIso(run.completedAt);
  // Spec 30: "Last Run" only renders once the run has actually completed.
  // Until then there's no honest value to show.
  const tiles: {
    label: string;
    value: string;
    icon: typeof CheckCircle2;
    tone: string;
  }[] = [
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
      className={`grid grid-cols-2 gap-2 ${lastRun ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}
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

      {lastRun && (
        <Card className="p-3" aria-label="Last completed run">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Last run
            </p>
          </div>
          <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">
            {lastRun}
          </p>
        </Card>
      )}
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

// Same shape as `lastCompletedRun` in the page-level hook. Duplicated here
// rather than exported to a util file — this card may render before the
// hook's lastRunAgo is wired through, and the formatter is tiny.
function formatRelativeIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const diffMs = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diffMs)) return null;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
