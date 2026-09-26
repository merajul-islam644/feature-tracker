// Verification Targets sub-page (split out from IssueTrackerPage).
// Hosts only the `<VerificationTargets>` card for now — the rest of the
// Issue Tracker sections (Secrets / Scope / Panel / Run History / Issues)
// still live on the parent `/issue-tracker` route. When the user asks
// to extract the next section, copy this file's recipe: pull the card
// into its own page, route it under `/issue-tracker/<key>`, and wire
// the matching sidebar sub-item to it.

import { useState } from "react";
import { useIssueTrackerStore } from "@/hooks/issueTrackerStore";
import { validateUrl } from "@/components/issue-tracker/UrlInput";
import { VerificationTargets } from "@/components/issue-tracker/VerificationTargets";
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

  // Same dedupe pattern as `IssueTrackerPage` — `validateUrl` checks
  // the trimmed draft against the existing target list and the draft
  // itself for format/duplicate errors.
  const existingUrls = targets.map((t) => t.url);
  const draftError = (() => {
    const trimmed = draftUrl.trim();
    if (!trimmed) return null;
    return validateUrl(trimmed, existingUrls.concat(trimmed));
  })();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">
          {t("nav.issueTracker.targets", "Verification Targets")}
        </h1>
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
        onDraftChange={setDraftUrl}
        onAddDraft={async () => {
          const clean = draftUrl.trim();
          if (
            !clean ||
            validateUrl(clean, existingUrls.concat(clean))
          )
            return;
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
    </div>
  );
}
