// Issues sub-page — summary + filters + list + the `?developer=`
// scoped view that a tester lands on after assigning an issue group.
// All store interactions and the `useSearchParams`-backed developer
// filter move over from the parent page verbatim.

import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { X } from "lucide-react";
import { useIssueTrackerStore } from "@/hooks/issueTrackerStore";
import { useIsRole } from "@/hooks/useAuth";
import { lookupRoleById, lookupUserById, useUsersByRole } from "@/lib/blocks/users";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { IssueSummary } from "@/components/issue-tracker/IssueSummary";
import { IssueFilters } from "@/components/issue-tracker/IssueFilters";
import { IssueList } from "@/components/issue-tracker/IssueList";
import { IssueDetailsDrawer } from "@/components/issue-tracker/IssueDetailsDrawer";
import { useT } from "@/lib/blocks/i18n";

export function IssuesPage() {
  const t = useT();
  const tracker = useIssueTrackerStore();
  const {
    issues,
    filteredIssues,
    filters,
    selectedIssueId,
    issueCounts,
    applications,
    loading,
    setFilters,
    clearFilters,
    setSelectedIssueId,
    updateIssueStatus,
    toggleIssuesAssignee,
    approveIssue,
    applyChatAction,
  } = tracker;

  // Developer-scoped view (`?developer=<sub>`): ticking a member on
  // an issue-group dropdown assigns that group's issues to them and
  // lands here. Resolve the member through the live rosters, with the
  // hardcoded id→user map as fallback; the raw param still filters even
  // when neither resolves (the id is the truth). Issues can carry several
  // assignees, so scope to rows whose list contains the param. The
  // approval gate is role-aware: a DEVELOPER's page only shows rows a
  // tester has approved (their work queue), while a TESTER's page shows
  // their queue in any state — those unapproved rows are exactly what
  // they still have to re-test.
  const [searchParams, setSearchParams] = useSearchParams();
  const developerParam = searchParams.get("developer");
  const developerRoster = useUsersByRole("developer").data ?? [];
  const testerRoster = useUsersByRole("tester").data ?? [];
  const roster = [...developerRoster, ...testerRoster];
  const scopedDeveloper = developerParam
    ? (roster.find((d) => d.id === developerParam) ??
      lookupUserById(developerParam))
    : undefined;
  const scopedRole =
    developerParam
      ? developerRoster.some((d) => d.id === developerParam)
        ? "developer"
        : testerRoster.some((t) => t.id === developerParam)
          ? "tester"
          : lookupRoleById(developerParam)
      : undefined;
  const scopedIssues = useMemo(
    () =>
      developerParam
        ? filteredIssues.filter(
            (i) =>
              (i.assignedDeveloperIds ?? []).includes(developerParam) &&
              (scopedRole !== "developer" || !!i.approvedById),
          )
        : filteredIssues,
    [filteredIssues, developerParam, scopedRole],
  );

  // Manual approval is a tester-only action (re-test after the AI run).
  const isTester = useIsRole("tester");
  const selectedIssue =
    issues.find((i) => i.id === selectedIssueId) ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">
          {t("issueTracker.issues.title", "Issues")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "issueTracker.issues.description",
            "What the latest verification run surfaced. Filter by status, severity, or application, then open a row for details.",
          )}
        </p>
      </div>

      <section aria-labelledby="issues-heading" className="space-y-4">
        <h2
          id="issues-heading"
          className="text-base font-semibold text-foreground"
        >
          {t("issueTracker.issues.heading", "Issues")}
        </h2>
        <IssueSummary counts={issueCounts} />
        <IssueFilters
          filters={filters}
          applications={applications}
          onChange={setFilters}
          onClear={clearFilters}
        />
        {developerParam && (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
            <UserAvatar
              userId={scopedDeveloper?.id}
              name={scopedDeveloper?.name ?? "?"}
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {scopedDeveloper?.displayName ?? developerParam}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {scopedDeveloper?.email ?? "unresolved developer id"} ·{" "}
                {scopedIssues.length} assigned issue
                {scopedIssues.length === 1 ? "" : "s"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSearchParams({}, { replace: true })}
              className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Clear
            </button>
          </div>
        )}
        <IssueList
          issues={scopedIssues}
          selectedIssueId={selectedIssueId}
          onSelect={setSelectedIssueId}
          loading={loading.issues}
          onToggleDeveloper={toggleIssuesAssignee}
          canApprove={isTester}
          onApprove={approveIssue}
        />
      </section>

      <IssueDetailsDrawer
        issue={selectedIssue}
        onClose={() => setSelectedIssueId(null)}
        onChangeStatus={updateIssueStatus}
        onVerifyAgain={(id) =>
          void applyChatAction({
            id: `verify-again-${id}`,
            label: "Verify Again",
            kind: "verify_again",
            payload: { issueId: id },
          })
        }
      />
    </div>
  );
}
