// Issue Tracker — main page.
// Two-column desktop layout (chat on left, controls + issues on right),
// stacked on mobile. Spec section 5.

import { useState } from "react";
import { useIssueTracker } from "@/hooks/useIssueTracker";
import { verificationChecks } from "@/data/mockIssueTrackerData";
import { validateUrl } from "@/components/issue-tracker/UrlInput";
import { IssueTrackerHeader } from "@/components/issue-tracker/IssueTrackerHeader";
import { ChatPanel } from "@/components/issue-tracker/ChatPanel";
import { VerificationTargets } from "@/components/issue-tracker/VerificationTargets";
import { SecretsPanel } from "@/components/issue-tracker/SecretsPanel";
import { VerificationScope } from "@/components/issue-tracker/VerificationScope";
import { VerificationPanel } from "@/components/issue-tracker/VerificationPanel";
import { IssueSummary } from "@/components/issue-tracker/IssueSummary";
import { IssueFilters } from "@/components/issue-tracker/IssueFilters";
import { IssueList } from "@/components/issue-tracker/IssueList";
import { IssueDetailsDrawer } from "@/components/issue-tracker/IssueDetailsDrawer";

export function IssueTrackerPage() {
  const tracker = useIssueTracker();
  const {
    targets,
    secrets,
    issues,
    filteredIssues,
    groupedIssues,
    run,
    scope,
    chat,
    filters,
    selectedIssueId,
    issueCounts,
    applications,
    loading,
    sendingMessage,
    testingTargetId,
    addTarget,
    removeTarget,
    setTargetEnabled,
    testConnection,
    addSecret,
    deleteSecret,
    setFilters,
    clearFilters,
    setSelectedIssueId,
    updateIssueStatus,
    startVerification,
    pauseVerification,
    resumeVerification,
    stopVerification,
    toggleScope,
    sendMessage,
    applyChatAction,
    sessions,
    sessionsLoading,
    currentSessionId,
    startNewSession,
    switchSession,
    lastRunAgo,
  } = tracker;

  const [draftUrl, setDraftUrl] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  const draftError =
    draftUrl.trim() && validateUrl(draftUrl, [draftUrl]) ? validateUrl(draftUrl, [draftUrl]) : null;

  const selectedIssue = issues.find((i) => i.id === selectedIssueId) ?? null;

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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        {/* Left column: AI Assistant */}
        <aside className="order-2 lg:order-1">
          <div className="lg:sticky lg:top-20 lg:h-[calc(100vh-6rem)]">
            <ChatPanel
              messages={chat}
              sending={sendingMessage}
              onSend={sendMessage}
              onAction={applyChatAction}
              sessions={sessions}
              sessionsLoading={sessionsLoading}
              currentSessionId={currentSessionId}
              onNewSession={startNewSession}
              onSelectSession={(id) => {
                switchSession(id);
                setHistoryOpen(false);
              }}
              historyOpen={historyOpen}
              onHistoryOpenChange={setHistoryOpen}
            />
          </div>
        </aside>

        {/* Right column: configuration + issues */}
        <div className="order-1 space-y-6 lg:order-2">
          <VerificationTargets
            targets={targets}
            draftUrl={draftUrl}
            draftError={draftError}
            onDraftChange={setDraftUrl}
            onAddDraft={async () => {
              const clean = draftUrl.trim();
              if (!clean || validateUrl(clean, [clean])) return;
              await addTarget({ url: clean });
              setDraftUrl("");
            }}
            onRemoveTarget={removeTarget}
            onToggleEnabled={setTargetEnabled}
            onTestConnection={(target) => void testConnection(target)}
            testingTargetId={testingTargetId}
            canAdd={!loading.targets}
          />

          <SecretsPanel
            secrets={secrets}
            onAdd={async (payload) => {
              await addSecret(payload);
            }}
            onDelete={deleteSecret}
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
          />

          <VerificationPanel run={run} />

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
            <IssueList
              issues={filteredIssues}
              groupedIssues={groupedIssues}
              selectedIssueId={selectedIssueId}
              onSelect={setSelectedIssueId}
              loading={loading.issues}
            />
          </section>
        </div>
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
