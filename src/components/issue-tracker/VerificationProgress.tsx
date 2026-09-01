// Live progress display: per-application status list + overall progress bar
// (spec sections 16–18).

import { CheckCircle2, Loader2, XCircle, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PerAppStatus, VerificationRun } from "@/types/issue-tracker";

interface Props {
  run: VerificationRun;
}

export function VerificationProgress({ run }: Props) {
  const pct =
    run.totalTargets === 0
      ? 0
      : Math.round((run.completedTargets / run.totalTargets) * 100);

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Verification progress"
        >
          <div
            className={cn(
              "h-full transition-all duration-500 ease-out",
              run.status === "completed" && pct === 100
                ? "bg-emerald-500"
                : run.failedTargets > 0
                  ? "bg-destructive"
                  : "bg-primary",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {pct}% — {statusLabel(run.status)}
        </p>
      </div>

      {run.perApp.length > 0 && (
        <ul className="space-y-1.5">
          {run.perApp.map((app) => (
            <li key={app.targetId} className="flex items-center gap-2 text-sm">
              <StatusIcon status={app.status} />
              <span className="truncate font-medium text-foreground">
                {app.applicationName}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {statusLabel(app.status)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {run.currentActivity.length > 0 && run.status === "running" && (
        <div className="space-y-1.5 border-t border-border pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Current activity
          </p>
          <ul className="space-y-1">
            {run.currentActivity.map((step, idx) => (
              <li key={idx} className="flex items-center gap-2 text-xs">
                {step.done ? (
                  <CheckCircle2
                    className="h-3.5 w-3.5 text-emerald-500"
                    aria-hidden="true"
                  />
                ) : idx === run.currentActivity.findIndex((s) => !s.done) ? (
                  <Loader2
                    className="h-3.5 w-3.5 animate-spin text-primary"
                    aria-hidden="true"
                  />
                ) : (
                  <Circle
                    className="h-3.5 w-3.5 text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
                <span
                  className={cn(
                    step.done ? "text-muted-foreground line-through" : "text-foreground",
                  )}
                >
                  {step.step}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: PerAppStatus["status"] }) {
  const className = "h-4 w-4 shrink-0";
  switch (status) {
    case "healthy":
    case "completed":
      return <CheckCircle2 className={`${className} text-emerald-500`} aria-hidden="true" />;
    case "issues_found":
    case "verification_failed":
    case "authentication_failed":
      return <XCircle className={`${className} text-destructive`} aria-hidden="true" />;
    case "queued":
    case "verifying":
      return <Loader2 className={`${className} animate-spin text-primary`} aria-hidden="true" />;
    default:
      return <Circle className={`${className} text-muted-foreground`} aria-hidden="true" />;
  }
}

function statusLabel(status: PerAppStatus["status"] | VerificationRun["status"]): string {
  switch (status) {
    case "not_verified":
      return "Not started";
    case "queued":
      return "Queued";
    case "verifying":
    case "running":
      return "Running";
    case "paused":
      return "Paused";
    case "healthy":
      return "Healthy";
    case "issues_found":
      return "Issues found";
    case "verification_failed":
      return "Verification failed";
    case "authentication_failed":
      return "Auth failed";
    case "unreachable":
      return "Unreachable";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "idle":
      return "Idle";
    default:
      return status;
  }
}
