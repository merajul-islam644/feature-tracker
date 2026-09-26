// Run History sub-page — past verification runs fetched via the
// `issueTrackerApi.listRuns()` TanStack query. The card self-manages
// state, so the page is effectively just a wrapper.

import { RunHistory } from "@/components/issue-tracker/RunHistory";
import { useT } from "@/lib/blocks/i18n";

export function HistoryPage() {
  const t = useT();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">
          {t(
            "issueTracker.history.title",
            "Run History",
          )}
        </h1>
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
