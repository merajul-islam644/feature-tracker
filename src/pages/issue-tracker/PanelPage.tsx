// Verification Panel — the de-facto Issue Tracker landing page after
// the index was removed. Hosts the run start / pause / resume / stop
// controls plus the live progress card. Per-section actions (export
// report) live here.
//
// The Run verification CTA sits on the same row as the page's H1 (right
// side, baseline-aligned). The "Last run X ago" status pill lives on the
// description row so it doesn't compete with the button on the title row.

import { History } from "lucide-react";
import { useIssueTrackerStore } from "@/hooks/issueTrackerStore";
import {
  RunVerificationActions,
} from "@/components/issue-tracker/IssueTrackerHeader";
import { VerificationPanel } from "@/components/issue-tracker/VerificationPanel";
import { useT } from "@/lib/blocks/i18n";

export function PanelPage() {
  const t = useT();
  const tracker = useIssueTrackerStore();
  const {
    run,
    loading,
    exportRunReport,
    startVerification,
    pauseVerification,
    resumeVerification,
    stopVerification,
    lastRunAgo,
  } = tracker;

  return (
    <div className="space-y-6">
      {/* Title row: H1 on the left, Run verification CTA on the right.
          Same flex alignment as other section headers so the button
          reads as belonging to this page (not as a stuck-on toolbar). */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold text-foreground">
          {t("issueTracker.panel.title", "Verification Panel")}
        </h1>
        <RunVerificationActions
          runStatus={run.status}
          loading={loading.run}
          onStart={() => void startVerification()}
          onPause={pauseVerification}
          onResume={resumeVerification}
          onStop={stopVerification}
        />
      </div>

      {/* Description + last-run status pill. Pill stays muted below the
          title so it doesn't draw the eye away from the CTA. */}
      <div className="space-y-2">
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t(
            "issueTracker.panel.description",
            "Live status of the most recent verification run — progress, application map, and a markdown export you can share.",
          )}
        </p>
        {lastRunAgo && (
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

      <VerificationPanel run={run} onExportReport={exportRunReport} />
    </div>
  );
}
