// Issues sub-page — summary + filters + list + the `?developer=`
// scoped view that a tester lands on after assigning an issue group.
// All store interactions and the `useSearchParams`-backed developer
// filter move over from the parent page verbatim.

import { useMemo, useState } from "react";
import { useSearchParams, useParams } from "react-router-dom";
import { CircleSlash, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIssueTrackerStore } from "@/hooks/issueTrackerStore";
import { useAuth, useIsRole } from "@/hooks/useAuth";
import { lookupRoleById, lookupUserById, useUsersByRole } from "@/lib/blocks/users";
import { useMemberProjectAssignments } from "@/lib/blocks/hooks";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { IssueSummary } from "@/components/issue-tracker/IssueSummary";
import { IssueFilters } from "@/components/issue-tracker/IssueFilters";
import { IssueList } from "@/components/issue-tracker/IssueList";
import { IssueBoard } from "@/components/issue-tracker/IssueBoard";
import { IssueDetailsDrawer } from "@/components/issue-tracker/IssueDetailsDrawer";
import { AddIssueDialog } from "@/components/issue-tracker/AddIssueDialog";
import { EnvHeaderChip } from "@/components/project/EnvHeaderChip";
import { BackToProjectsLink } from "@/components/layout/BackToProjectsLink";
import { useT } from "@/lib/blocks/i18n";
import { cn } from "@/lib/utils";

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

  // Manual issue entry — the route carries the env context the new row
  // is stamped with (same (projectId, envSlug) pair EnvHeaderChip reads).
  // Deliberately NOT role-gated: developer, tester, and manager can all
  // file an issue by hand — the triage flow (tester approval → developer
  // assignment) takes over after the row exists.
  const { projectId, envSlug } = useParams<{
    projectId: string;
    envSlug: string;
  }>();
  const [addOpen, setAddOpen] = useState(false);
  // Board is the primary surface (GitHub Projects-style viewer); the
  // date-grouped list stays reachable through the toggle.
  const [viewMode, setViewMode] = useState<"board" | "list">("board");

  // Assignment visibility gate (user request 2026-11-25): a member only
  // sees issues for projects assigned to their Members-page card; the
  // manager role bypasses it — managers do the assigning, so they keep
  // full visibility (user-confirmed). While the assignment lookup is
  // still loading we fail OPEN, so a member isn't flashed a "not
  // assigned" wall that resolves to content a beat later; the settled
  // state is authoritative.
  const isManager = useIsRole("manager");
  const { currentUser } = useAuth();
  const assignmentsQuery = useMemberProjectAssignments();
  const myAssignedProjectIds = useMemo(
    () =>
      assignmentsQuery.data?.find((a) => a.userId === currentUser?.id)
        ?.projectIds ?? [],
    [assignmentsQuery.data, currentUser?.id],
  );
  const canViewIssues =
    isManager ||
    assignmentsQuery.isLoading ||
    myAssignedProjectIds.includes(projectId ?? "");

  // Shown in place of the whole issues surface when the viewer isn't
  // assigned to this project (a non-manager without the Members-page
  // assignment). The Add-issue button in the header stays available by
  // design — filing is all-roles; viewing is assignment-gated.
  const notAssignedCard = (
    <div
      role="status"
      className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-6 py-12 text-center"
    >
      <CircleSlash
        className="h-6 w-6 text-muted-foreground"
        aria-hidden="true"
      />
      <p className="text-sm font-medium text-foreground">
        {t(
          "issueTracker.issues.notAssignedTitle",
          "You're not assigned to this project.",
        )}
      </p>
      <p className="max-w-sm text-xs text-muted-foreground">
        {t(
          "issueTracker.issues.notAssignedHint",
          "Issues here are only visible to members assigned to this project. Ask a manager to add it to your card on the Members page.",
        )}
      </p>
    </div>
  );

  return (
    // Viewport-fit: the page never scrolls vertically itself — it
    // fills the space below the topbar AND claims the layout's bottom
    // padding (-mb-6 / md:-mb-8 + matching height calc), so the board
    // sits flush against the viewport bottom with no dead gap under
    // its scrollbar. (Shell above the root = topbar + pt; the margin
    // math works out to exactly 100vh at both breakpoints.)
    <div className="-mb-6 flex h-[calc(100vh-5.5rem)] min-h-[26rem] flex-col gap-4 md:-mb-8 md:h-[calc(100vh-6rem)]">
      <BackToProjectsLink />

      {/* Single compact header row: title + env chip left, view toggle
          + Add issue right. The old duplicated "Issues" sub-heading and
          separate toggle row are gone (user: the header ate too much
          vertical space). */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-foreground">
              {t("issueTracker.issues.title", "Issues")}
            </h1>
            <EnvHeaderChip />
          </div>
          <div className="flex items-center gap-2">
            <div
              role="group"
              aria-label={t("issueTracker.issues.viewToggle", "Issue view")}
              className="flex items-center rounded-md border border-border bg-card p-0.5"
            >
              {(["board", "list"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  aria-pressed={viewMode === mode}
                  className={cn(
                    "rounded px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    viewMode === mode
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {mode === "board"
                    ? t("issueTracker.issues.boardView", "Board")
                    : t("issueTracker.issues.listView", "List")}
                </button>
              ))}
            </div>
            {projectId && envSlug && (
              <Button type="button" size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t("issueTracker.issues.add", "Add issue")}
              </Button>
            )}
          </div>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {t(
            "issueTracker.issues.description",
            "What the latest verification run surfaced. Filter by status, severity, or application, then open a row for details.",
          )}
        </p>
      </div>

      {canViewIssues ? (
        <>
      <section
        aria-label={t("issueTracker.issues.heading", "Issues")}
        className="flex min-h-0 flex-1 flex-col gap-3"
      >
        <div className="shrink-0">
          <IssueSummary counts={issueCounts} />
        </div>
        <div className="shrink-0">
          <IssueFilters
            filters={filters}
            applications={applications}
            onChange={setFilters}
            onClear={clearFilters}
          />
        </div>
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
        {/* Board / list region — takes the remaining viewport height.
            The board fills it exactly and scrolls horizontally inside;
            the list scrolls vertically inside. overflow-x-hidden here:
            the board's -mx-1 padding bleed otherwise trips a SECOND
            horizontal scrollbar on this wrapper (overflow-y:auto
            forces overflow-x to auto too) — the board owns the only
            h-scrollbar. */}
        <div className="issues-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          {viewMode === "board" ? (
            <IssueBoard
              issues={scopedIssues}
              selectedIssueId={selectedIssueId}
              onSelect={setSelectedIssueId}
              onMoveStatus={(id, status) =>
                void updateIssueStatus(id, status)
              }
            />
          ) : (
            <IssueList
              issues={scopedIssues}
              selectedIssueId={selectedIssueId}
              onSelect={setSelectedIssueId}
              loading={loading.issues}
              canApprove={isTester}
              onApprove={approveIssue}
            />
          )}
        </div>
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
      </>
      ) : (
        notAssignedCard
      )}

      {projectId && envSlug && (
        <AddIssueDialog
          open={addOpen}
          onClose={() => setAddOpen(false)}
          projectId={projectId}
          envSlug={envSlug}
        />
      )}
    </div>
  );
}
