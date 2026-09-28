// Verification Scopes sub-page. Hosts the `<VerificationScope>` card
// (which checkboxes run + device picker) and reads `toggleScope` /
// `setDevice` from the same store used by the parent page.
//
// In addition to the shipped catalog (`verificationChecks`), users
// can define their own scopes via `useCustomVerificationChecks` —
// these live in localStorage and render in the "Custom" section of
// the card. They participate in the same scope toggle list, so a
// selected custom scope reaches the AI in the next run alongside
// any built-ins the user enabled.

import { useIssueTrackerStore } from "@/hooks/issueTrackerStore";
import { VerificationScope } from "@/components/issue-tracker/VerificationScope";
import { verificationChecks } from "@/data/issueTrackerConstants";
import { useCustomVerificationChecks } from "@/hooks/useCustomVerificationChecks";
import { useT } from "@/lib/blocks/i18n";

export function ScopePage() {
  const t = useT();
  const tracker = useIssueTrackerStore();
  const { scope, toggleScope, device, setDevice } = tracker;
  const {
    customChecks,
    addCustomCheck,
    updateCustomCheck,
    deleteCustomCheck,
  } = useCustomVerificationChecks();

  // Built-in IDs merged with custom ones — `Select all` and `Clear`
  // both need the full universe, not just the shipped set.
  const allIds = [
    ...verificationChecks.map((c) => c.id),
    ...customChecks.map((c) => c.id),
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">
          {t("nav.issueTracker.scope", "Scopes")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "issueTracker.scope.description",
            "Pick which checks run during verification. Recommended checks are on by default — toggle them off one at a time, or use Select all / Clear. Pick a device preset to size the run's browser viewport.",
          )}
        </p>
      </div>

      <VerificationScope
        checks={verificationChecks}
        customChecks={customChecks}
        selectedIds={scope}
        onToggle={(id) => toggleScope(id)}
        onSelectAll={() => {
          allIds.forEach((id) => {
            if (!scope.includes(id)) toggleScope(id);
          });
        }}
        onClear={() => {
          scope.forEach((id) => toggleScope(id));
        }}
        device={device}
        onDeviceChange={setDevice}
        onAddCustom={addCustomCheck}
        onUpdateCustom={updateCustomCheck}
        onDeleteCustom={deleteCustomCheck}
      />
    </div>
  );
}
