// Top-of-page header: title, description, primary CTA. CTA morphs between
// Start / Pause / Stop / Resume depending on the run state (spec §6.5).
// "Last run X ago" pill next to the title when a run has finished.
//
// The CTA cluster is also exported standalone as `RunVerificationActions`
// so sub-pages that render their own H1 (e.g. the Verification Panel page
// after the Issue Tracker H1 was suppressed) can keep the "Run verification"
// button visually aligned with their heading row instead of with the
// header block.

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
  // Toggle the H1 + tagline block. The Panel page renders its own
  // "Verification Panel" H1 below the header, so it suppresses the
  // title block here to avoid two competing titles. The "last run"
  // pill stays visible in both modes since it's a status indicator.
  showTitle?: boolean;
}

export function IssueTrackerHeader({
  runStatus,
  loading,
  onStart,
  onPause,
  onResume,
  onStop,
  lastRunAgo,
  showTitle = true,
}: Props) {
  return (
    <header className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-2">
        {showTitle && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-muted text-primary"
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
          </>
        )}
        {/* The "Last run" pill is useful even when the title is hidden,
            so render it standalone when `showTitle` is false. */}
        {!showTitle && lastRunAgo && (
          <span
            className="inline-flex w-fit items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
            aria-label={`Last completed run ${lastRunAgo}`}
            title={`Last completed run ${lastRunAgo}`}
          >
            <History className="h-3 w-3" aria-hidden="true" />
            Last run {lastRunAgo}
          </span>
        )}
      </div>
      <RunVerificationActions
        runStatus={runStatus}
        loading={loading}
        onStart={onStart}
        onPause={onPause}
        onResume={onResume}
        onStop={onStop}
      />
    </header>
  );
}

// Standalone CTA cluster. Same shape as the button cluster the header
// renders by default, but exported so a sub-page can drop it next to its
// own H1 (e.g. Verification Panel places it inline with the "Verification
// Panel" heading instead of next to the suppressed Issue Tracker title).
interface ActionsProps {
  runStatus: VerificationRunStatus;
  loading: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

export function RunVerificationActions({
  runStatus,
  loading,
  onStart,
  onPause,
  onResume,
  onStop,
}: ActionsProps) {
  const isRunning = runStatus === "running";
  const isPaused = runStatus === "paused";

  return (
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
        <Button variant="default" size="lg" onClick={onStart} disabled={loading}>
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
  );
}
