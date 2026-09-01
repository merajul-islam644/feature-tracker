// Top-of-page header: title, description, primary CTA. CTA morphs between
// Start / Pause / Stop / Resume depending on the run state (spec section 6).

import { Pause, Play, Square } from "lucide-react";
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
}

export function IssueTrackerHeader({
  runStatus,
  loading,
  onStart,
  onPause,
  onResume,
  onStop,
}: Props) {
  const isRunning = runStatus === "running";
  const isPaused = runStatus === "paused";

  return (
    <header className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Issue Tracker
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
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
