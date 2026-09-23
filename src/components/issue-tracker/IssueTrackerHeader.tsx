// Top-of-page header: title, description, primary CTA. CTA morphs between
// Start / Pause / Stop / Resume depending on the run state (spec §6.5).
// "Last run X ago" pill next to the title when a run has finished.

import { History, Pause, Play, Square, Bug } from "lucide-react";
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
    <header className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300"
            aria-hidden="true"
          >
            <Bug className="h-4 w-4" />
          </span>
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
        <p className="max-w-2xl text-sm text-muted-foreground">
          AI-powered application verification across your configured targets.
          Run Playwright against every target, capture console / network /
          heading failures, and turn them into actionable issues.
        </p>
      </div>
      <div className="flex items-center gap-2">
        {isRunning && (
          <>
            <Button variant="outline" size="default" onClick={onPause}>
              <Pause className="h-4 w-4" aria-hidden="true" />
              Pause
            </Button>
            <Button variant="destructive" size="default" onClick={onStop}>
              <Square className="h-4 w-4" aria-hidden="true" />
              Stop
            </Button>
          </>
        )}
        {isPaused && (
          <>
            <Button size="default" onClick={onResume}>
              <Play className="h-4 w-4" aria-hidden="true" />
              Resume
            </Button>
            <Button variant="destructive" size="default" onClick={onStop}>
              <Square className="h-4 w-4" aria-hidden="true" />
              Stop
            </Button>
          </>
        )}
        {!isRunning && !isPaused && (
          <Button variant="ai" size="lg" onClick={onStart} disabled={loading}>
            {loading ? (
              <>
                <Spinner className="h-4 w-4" aria-hidden="true" />
                Starting…
              </>
            ) : (
              <>
                <Play className="h-4 w-4" aria-hidden="true" />
                Run verification
              </>
            )}
          </Button>
        )}
      </div>
    </header>
  );
}
