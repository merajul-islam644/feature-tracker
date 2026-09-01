// Compact issue row (spec section 23). Click → open drawer.

import { ChevronRight, AlertOctagon, AlertTriangle, AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Issue, IssueSeverity, IssueStatus } from "@/types/issue-tracker";

interface Props {
  issue: Issue;
  onOpen: (id: string) => void;
  selected: boolean;
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

export function IssueCard({ issue, onOpen, selected }: Props) {
  const Icon = severityIcon[issue.severity];

  return (
    <button
      type="button"
      onClick={() => onOpen(issue.id)}
      aria-pressed={selected}
      className={cn(
        "group flex w-full items-start gap-3 rounded-md border border-border bg-card p-3 text-left transition-colors",
        "hover:border-primary/40 hover:bg-accent/30",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected && "border-primary bg-accent/40",
      )}
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
      <ChevronRight
        className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </button>
  );
}
