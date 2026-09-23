// Issue Tracker — main page.
// Single-column layout: controls + issues across the full width. The AI
// Assistant chat lives behind the app-wide floating launcher mounted in
// AppLayout (GlobalChatAssistant) — it shares this page's store, so the
// conversation continues from anywhere in the app. Spec section 5.

import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { X } from "lucide-react";
import { useIssueTrackerStore } from "@/hooks/issueTrackerStore";
import { useIsRole } from "@/hooks/useAuth";
import { verificationChecks } from "@/data/issueTrackerConstants";
import { lookupRoleById, lookupUserById, useUsersByRole } from "@/lib/blocks/users";
import { validateUrl } from "@/components/issue-tracker/UrlInput";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { IssueTrackerHeader } from "@/components/issue-tracker/IssueTrackerHeader";
import { VerificationTargets } from "@/components/issue-tracker/VerificationTargets";
import { RunHistory } from "@/components/issue-tracker/RunHistory";
import { SecretsPanel } from "@/components/issue-tracker/SecretsPanel";
import { VerificationScope } from "@/components/issue-tracker/VerificationScope";
import { VerificationPanel } from "@/components/issue-tracker/VerificationPanel";
import { IssueSummary } from "@/components/issue-tracker/IssueSummary";
import { IssueFilters } from "@/components/issue-tracker/IssueFilters";
import { IssueList } from "@/components/issue-tracker/IssueList";
import { IssueDetailsDrawer } from "@/components/issue-tracker/IssueDetailsDrawer";
// The live-preview overlay was removed: the Playwright agent now runs in
// headed mode, so the actual browser window is the preview. No in-app
// mirror.

export function IssueTrackerPage() {
  const tracker = useIssueTrackerStore();
  const {
    targets,
    secrets,
    issues,
    filteredIssues,
    run,
    scope,
    filters,
    selectedIssueId,
    issueCounts,
    applications,
    loading,
    testingTargetId,
    addTarget,
    removeTarget,
    setTargetEnabled,
    editTarget,
    testConnection,
    addSecret,
    editSecret,
    deleteSecret,
    bindSecret,
    setFilters,
    clearFilters,
    setSelectedIssueId,
    updateIssueStatus,
    toggleIssuesAssignee,
    approveIssue,
    startVerification,
    pauseVerification,
    resumeVerification,
    stopVerification,
    toggleScope,
    device,
    setDevice,
    exportRunReport,
    applyChatAction,
    lastRunAgo,
  } = tracker;

  const [draftUrl, setDraftUrl] = useState("");

  // Memo the dedupe list so the validation result doesn't recompute its
  // argument array on every render. `validateUrl` is intentionally called
  // once per change rather than twice — earlier version called it twice
  // (once as a truthiness gate, once as the value), which meant every
  // keystroke ran the loop twice.
  const existingUrls = targets.map((t) => t.url);
  const draftError = (() => {
    const trimmed = draftUrl.trim();
    if (!trimmed) return null;
    return validateUrl(trimmed, existingUrls.concat(trimmed));
  })();

  const selectedIssue = issues.find((i) => i.id === selectedIssueId) ?? null;

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

  return (
    <div className="space-y-6">
      <IssueTrackerHeader
        runStatus={run.status}
        loading={loading.run}
        onStart={() => void startVerification()}
        onPause={pauseVerification}
        onResume={resumeVerification}
        onStop={stopVerification}
        lastRunAgo={lastRunAgo}
      />

      {/* Configuration + issues across the full width — the AI Assistant
          chat opens from the floating launcher at the bottom of the page
          (ChatLauncher renders it fixed, outside this flow). */}
      <div className="space-y-6">
          <VerificationTargets
            targets={targets}
            draftUrl={draftUrl}
            draftError={draftError}
            onDraftChange={setDraftUrl}
            onAddDraft={async () => {
              const clean = draftUrl.trim();
              if (!clean || validateUrl(clean, existingUrls.concat(clean))) return;
              await addTarget({ url: clean });
              setDraftUrl("");
            }}
            onRemoveTarget={removeTarget}
            onToggleEnabled={setTargetEnabled}
            onEditTarget={(id, patch) => void editTarget(id, patch)}
            onTestConnection={(target) => void testConnection(target)}
            testingTargetId={testingTargetId}
            canAdd={!loading.targets}
          />

          <SecretsPanel
            secrets={secrets}
            targets={targets}
            onAdd={async (payload) => {
              await addSecret(payload);
            }}
            onEdit={(id, patch) => void editSecret(id, patch)}
            onDelete={deleteSecret}
            onBind={async (secretId, targetId) => {
              await bindSecret(secretId, targetId);
            }}
          />

          <VerificationScope
            checks={verificationChecks}
            selectedIds={scope}
            onToggle={(id) => toggleScope(id as Parameters<typeof toggleScope>[0])}
            onSelectAll={() =>
              verificationChecks.forEach((c) => {
                if (!scope.includes(c.id)) toggleScope(c.id);
              })
            }
            onClear={() => {
              scope.forEach((id) => toggleScope(id));
            }}
            device={device}
            onDeviceChange={setDevice}
          />

          <VerificationPanel run={run} onExportReport={exportRunReport} />

          <RunHistory />

          <section aria-labelledby="issues-heading" className="space-y-4">
            <h2 id="issues-heading" className="text-base font-semibold text-foreground">
              Issues
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
      </div>

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
