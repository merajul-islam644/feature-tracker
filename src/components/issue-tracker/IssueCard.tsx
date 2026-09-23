// Compact issue card — see DESIGN-APP-v1.md §7.27.
//
// Severity rail (3px) on the left; type + environment + flow + feature on
// top; title + description; occurrences + timestamp + actions at the
// bottom. Hover lifts shadow-card-hover; selected uses indigo ring.

import {
  AlertOctagon,
  AlertTriangle,
  AlertCircle,
  Info,
  BadgeCheck,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EnvChip } from "@/components/ui/env-chip";
import { cn } from "@/lib/utils";
import type { Issue, IssueSeverity, IssueStatus } from "@/types/issue-tracker";

interface Props {
  issue: Issue;
  onOpen: (id: string) => void;
  selected: boolean;
  canApprove?: boolean;
  onApprove?: (id: string) => void;
}

const severityRail: Record<IssueSeverity, string> = {
  critical: "bg-red-500",
  high: "bg-amber-500",
  medium: "bg-amber-500",
  low: "bg-sky-500",
};

const severityTone: Record<IssueSeverity, string> = {
  critical: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  high: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  medium: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  low: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
};

const severityIcon: Record<IssueSeverity, typeof AlertOctagon> = {
  critical: AlertOctagon,
  high: AlertTriangle,
  medium: AlertCircle,
  low: Info,
};

const statusLabel: Record<IssueStatus, string> = {
  open: "Open",
  investigating: "Investigating",
  confirmed: "Confirmed",
  fixed: "Fixed",
  resolved: "Resolved",
  wont_fix: "Won't fix",
  ignored: "Ignored",
  reopened: "Reopened",
};

const statusTone: Record<IssueStatus, string> = {
  open: "bg-destructive/10 text-destructive",
  investigating: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  confirmed: "bg-destructive/10 text-destructive",
  fixed: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  resolved: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  wont_fix: "bg-muted text-muted-foreground",
  ignored: "bg-muted text-muted-foreground",
  reopened: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
};

export function IssueCard({ issue, onOpen, selected, canApprove = false, onApprove }: Props) {
  const Icon = severityIcon[issue.severity];
  const approved = !!issue.approvedById;

  return (
    // Root is a div, not a button: the Approve action must sit BESIDE the
    // open-drawer button as a sibling (a button can't nest a button).
    <div
      className={cn(
        "group flex w-full overflow-hidden rounded-xl border bg-card text-left shadow-soft",
        "transition-all duration-200 hover:shadow-card-hover",
        selected
          ? "border-indigo-500 ring-1 ring-indigo-500/20"
          : "border-border hover:border-indigo-500/40",
      )}
    >
      {/* Severity rail — 3px wide per §7.27 */}
      <div
        className={cn("w-[3px] shrink-0 self-stretch", severityRail[issue.severity])}
        aria-hidden="true"
      />

      <button
        type="button"
        onClick={() => onOpen(issue.id)}
        aria-pressed={selected}
        className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <div
          className={cn(
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border",
            severityTone[issue.severity],
          )}
          aria-hidden="true"
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate text-sm font-semibold text-foreground">{issue.title}</p>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                statusTone[issue.status],
              )}
            >
              {statusLabel[issue.status]}
            </span>
            {issue.environment && (
              <EnvChip
                env={issue.environment as any}
                label={issue.environment}
                className="shrink-0"
              />
            )}
            {approved && (
              <span
                className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400"
                title="Manually re-tested and approved by a tester"
              >
                <BadgeCheck className="h-3 w-3" aria-hidden="true" />
                Approved
              </span>
            )}
            {(issue.occurrenceCount ?? 1) > 1 && (
              <span
                className="shrink-0 rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-400"
                title={`Re-detected across ${issue.occurrenceCount} runs`}
              >
                ×{issue.occurrenceCount}
              </span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {issue.description}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="font-mono">{issue.id}</span>
            <span aria-hidden="true">•</span>
            <span>{issue.applicationName}</span>
            <span aria-hidden="true">•</span>
            <span>{issue.category.replace("_", " ")}</span>
            <span aria-hidden="true">•</span>
            <span>{new Date(issue.detectedAt).toLocaleDateString()}</span>
          </div>
        </div>
      </button>
      <div className="flex shrink-0 flex-col items-end justify-between gap-1 px-4 py-3">
        {canApprove && !approved && onApprove && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onApprove(issue.id)}
            className="border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
          >
            <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Approve
          </Button>
        )}
        <ChevronRight
          className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
