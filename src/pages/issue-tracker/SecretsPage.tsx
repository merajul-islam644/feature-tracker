// Verification Secrets sub-page (split out from IssueTrackerPage).
// Hosts only the `<SecretsPanel>` card for now — the rest of the Issue
// Tracker sections (Scope / Panel / Run History / Issues) live on
// sibling sub-routes. Same recipe as `TargetsPage.tsx`: pull the
// section out, route it under `/issue-tracker/<key>`, wire the
// sidebar sub-item to it.

import { useIssueTrackerStore } from "@/hooks/issueTrackerStore";
import { SecretsPanel } from "@/components/issue-tracker/SecretsPanel";
import { useT } from "@/lib/blocks/i18n";

export function SecretsPage() {
  const t = useT();
  const tracker = useIssueTrackerStore();
  const {
    secrets,
    targets,
    addSecret,
    editSecret,
    deleteSecret,
    bindSecret,
  } = tracker;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">
          {t("nav.issueTracker.secrets", "Verification Secrets")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "issueTracker.secrets.description",
            "Saved credentials you bind to a verification target so the AI assistant can sign in before each run. Plaintext is masked on the wire; binding can be cleared or moved between targets at any time.",
          )}
        </p>
      </div>

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
    </div>
  );
}
