// Verification Scopes sub-page. Hosts the `<VerificationScope>` card
// (which checkboxes run + device picker) and reads `toggleScope` /
// `setDevice` from the same store used by the parent page.

import { useIssueTrackerStore } from "@/hooks/issueTrackerStore";
import { VerificationScope } from "@/components/issue-tracker/VerificationScope";
import { verificationChecks } from "@/data/issueTrackerConstants";
import { useT } from "@/lib/blocks/i18n";

export function ScopePage() {
  const t = useT();
  const tracker = useIssueTrackerStore();
  const { scope, toggleScope, device, setDevice } = tracker;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">
          {t("nav.issueTracker.scope", "Verification Scopes")}
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
        selectedIds={scope}
        onToggle={(id) =>
          toggleScope(id as Parameters<typeof toggleScope>[0])
        }
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
    </div>
  );
}
