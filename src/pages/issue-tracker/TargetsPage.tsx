// Verification Targets sub-page (split out from IssueTrackerPage).
// Hosts only the `<VerificationTargets>` card for now — the rest of the
// Issue Tracker sections (Secrets / Scope / Panel / Run History / Issues)
// also live as sibling pages on `/projects/:projectId/:envSlug/<key>`
// (same project + env as this page). When the user asks to extract
// another section, copy this file's recipe: pull the card into its own
// page, mount it at `/projects/:projectId/:envSlug/<key>`, and wire
// the matching sidebar sub-item to it.

import { useState } from "react";
import { useIssueTrackerStore } from "@/hooks/issueTrackerStore";
import { validateUrl } from "@/components/issue-tracker/UrlInput";
import { VerificationTargets } from "@/components/issue-tracker/VerificationTargets";
import { EnvHeaderChip } from "@/components/project/EnvHeaderChip";
import { BackToProjectsLink } from "@/components/layout/BackToProjectsLink";
import { useT } from "@/lib/blocks/i18n";

export function TargetsPage() {
  const t = useT();
  const tracker = useIssueTrackerStore();
  const {
    targets,
    addTarget,
    removeTarget,
    setTargetEnabled,
    editTarget,
    testConnection,
    testingTargetId,
    loading,
  } = tracker;

  const [draftUrl, setDraftUrl] = useState("");
  const [draftName, setDraftName] = useState("");

  // Same dedupe pattern as `IssueTrackerPage` — `validateUrl` checks
  // the trimmed draft against the existing target list and the draft
  // itself for format/duplicate errors.
  const existingUrls = targets.map((t) => t.url);
  const draftError = (() => {
    const trimmed = draftUrl.trim();
    if (!trimmed) return null;
    return validateUrl(trimmed, existingUrls.concat(trimmed));
  })();
  // Display name is required when the user is adding a new target —
  // mirrors the inline-edit form's own `nameError` rule. Empty
  // (untouched) draft doesn't block the Add button; the button
  // already requires a URL to enable, and once the URL is filled the
  // name error becomes meaningful.
  const draftNameError = draftName.trim()
    ? null
    : draftUrl.trim()
      ? "Display name is required."
      : null;

  return (
    <div className="space-y-6">
      <BackToProjectsLink />

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-foreground">
            {t("nav.issueTracker.targets", "Targets")}
          </h1>
          <EnvHeaderChip />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "issueTracker.targets.description",
            "Add the URLs you want the Issue Tracker to verify. Toggle each on or off, test a connection before running a full pass, and edit the application name as you rebrand.",
          )}
        </p>
      </div>

      <VerificationTargets
        targets={targets}
        draftUrl={draftUrl}
        draftError={draftError}
        draftName={draftName}
        draftNameError={draftNameError}
        onDraftChange={setDraftUrl}
        onDraftNameChange={setDraftName}
        onAddDraft={async () => {
          const clean = draftUrl.trim();
          const cleanName = draftName.trim();
          if (
            !clean ||
            !cleanName ||
            validateUrl(clean, existingUrls.concat(clean))
          )
            return;
          await addTarget({ url: clean, applicationName: cleanName });
          setDraftUrl("");
          setDraftName("");
        }}
        onRemoveTarget={removeTarget}
        onToggleEnabled={setTargetEnabled}
        onEditTarget={(id, patch) => void editTarget(id, patch)}
        onTestConnection={(target) => void testConnection(target)}
        testingTargetId={testingTargetId}
        canAdd={!loading.targets}
      />
    </div>
  );
}
