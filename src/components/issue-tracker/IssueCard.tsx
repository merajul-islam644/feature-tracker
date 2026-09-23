// Compact issue row (spec section 23). Click → open drawer.

import { BadgeCheck, ChevronRight, AlertOctagon, AlertTriangle, AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Issue, IssueSeverity, IssueStatus } from "@/types/issue-tracker";

interface Props {
  issue: Issue;
  onOpen: (id: string) => void;
  selected: boolean;
  /** True when the signed-in user holds the tester role — the only role
   *  that sees the Approve action (manual re-test after the AI run). */
  canApprove?: boolean;
  /** Approve as the signed-in tester (useIssueTracker.approveIssue). */
  onApprove?: (id: string) => void;
}

const severityTone: Record<IssueSeverity, string> = {
  critical: "border-red-500/40 bg-red-500/5 text-red-700 dark:text-red-300",
  high: "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300",
  medium: "border-yellow-500/40 bg-yellow-500/5 text-yellow-700 dark:text-yellow-300",
  low: "border-sky-500/40 bg-sky-500/5 text-sky-700 dark:text-sky-300",
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
    // open-drawer button as a sibling (a button can't nest a button), the
    // same two-sibling pattern the IssueGroup header uses.
    <div
      className={cn(
        "group flex w-full items-start gap-3 rounded-md border border-border bg-card p-3 text-left transition-colors",
        "hover:border-primary/40 hover:bg-accent/30",
        selected && "border-primary bg-accent/40",
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(issue.id)}
        aria-pressed={selected}
        className="flex min-w-0 flex-1 items-start gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-foreground">{issue.title}</p>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                statusTone[issue.status],
              )}
            >
              {statusLabel[issue.status]}
            </span>
            {/* Tester-approved marker — visible to every role. The
                developer-scoped view only surfaces approved rows, so this
                badge is what non-testers watch for. */}
            {approved && (
              <span
                className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400"
                title="Manually re-tested and approved by a tester"
              >
                <BadgeCheck className="h-3 w-3" aria-hidden="true" />
                Approved
              </span>
            )}
            {/* Recurrence badge — the fingerprint merge bumps this when a
                later run re-detects the same defect. Hidden on the first
                occurrence and on legacy rows without the field. */}
            {(issue.occurrenceCount ?? 1) > 1 && (
              <span
                className="shrink-0 rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-400"
                title={`Re-detected across ${issue.occurrenceCount} runs`}
              >
                ×{issue.occurrenceCount}
              </span>
            )}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
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
      <div className="flex shrink-0 flex-col items-end gap-1">
        {/* Manual approval — tester-only, hidden once approved (one-way
            decision; re-opening a resolved row is the status flow's job). */}
        {canApprove && !approved && onApprove && (
          <button
            type="button"
            onClick={() => onApprove(issue.id)}
            className="flex items-center gap-1 rounded-md border border-emerald-500/40 px-2 py-1 text-xs font-medium text-emerald-600 transition-colors hover:bg-emerald-500/10 dark:text-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="Approve this issue after manually re-testing it"
          >
            <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Approve
          </button>
        )}
        <ChevronRight
          className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
