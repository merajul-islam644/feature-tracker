// Top-of-page header: title, description, primary CTA. CTA morphs between
// Start / Pause / Stop / Resume depending on the run state (spec section 6).
// A small "Last run X ago" pill sits next to the title once a run has
// finished — disappears entirely when there is no completed run yet.

import { History, Pause, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { VerificationRunStatus } from "@/types/issue-tracker";

interface Props {
  runStatus: VerificationRunStatus;
  loading: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  // Relative-time string ("2m ago") for the most recent completed run.
  // Optional: omit or pass null to hide the pill entirely.
  lastRunAgo?: string | null;
}

export function IssueTrackerHeader({
  runStatus,
  loading,
  onStart,
  onPause,
  onResume,
  onStop,
  lastRunAgo,
}: Props) {
  const isRunning = runStatus === "running";
  const isPaused = runStatus === "paused";

  return (
    <header className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Issue Tracker
          </h1>
          {lastRunAgo && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
              aria-label={`Last completed run ${lastRunAgo}`}
              title={`Last completed run ${lastRunAgo}`}
            >
              <History className="h-3 w-3" aria-hidden="true" />
              Last run {lastRunAgo}
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          AI-powered application verification across your configured targets.
        </p>
      </div>
      <div className="flex items-center gap-2">
        {isRunning && (
          <>
            <Button variant="outline" size="sm" onClick={onPause}>
              <Pause className="h-4 w-4" aria-hidden="true" />
              Pause
            </Button>
            <Button variant="destructive" size="sm" onClick={onStop}>
              <Square className="h-4 w-4" aria-hidden="true" />
              Stop
            </Button>
          </>
        )}
        {isPaused && (
          <>
            <Button size="sm" onClick={onResume}>
              <Play className="h-4 w-4" aria-hidden="true" />
              Resume
            </Button>
            <Button variant="destructive" size="sm" onClick={onStop}>
              <Square className="h-4 w-4" aria-hidden="true" />
              Stop
            </Button>
          </>
        )}
        {!isRunning && !isPaused && (
          <Button size="sm" onClick={onStart} disabled={loading}>
            {loading ? (
              <>
                <Spinner className="h-4 w-4" aria-hidden="true" />
                Starting…
              </>
            ) : (
              <>
                <Play className="h-4 w-4" aria-hidden="true" />
                Start Verification
              </>
            )}
          </Button>
        )}
      </div>
    </header>
  );
}
