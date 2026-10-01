// Run History sub-page — past verification runs fetched via the
// `issueTrackerApi.listRuns()` TanStack query. The card self-manages
// state, so the page is effectively just a wrapper.

import { RunHistory } from "@/components/issue-tracker/RunHistory";
import { EnvHeaderChip } from "@/components/project/EnvHeaderChip";
import { BackToProjectsLink } from "@/components/layout/BackToProjectsLink";
import { useT } from "@/lib/blocks/i18n";

export function HistoryPage() {
  const t = useT();

  return (
    <div className="space-y-6">
      <BackToProjectsLink />

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-foreground">
            {t(
              "issueTracker.history.title",
              "History",
            )}
          </h1>
          <EnvHeaderChip />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "issueTracker.history.description",
            "Past verification runs, persisted across server restarts. Open the latest from the Verification Panel for live progress and a markdown export.",
          )}
        </p>
      </div>

      <RunHistory />
    </div>
  );
}
