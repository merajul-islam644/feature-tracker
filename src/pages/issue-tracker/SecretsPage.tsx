// Verification Secrets sub-page (split out from IssueTrackerPage).
// Hosts only the `<SecretsPanel>` card for now — the rest of the Issue
// Tracker sections (Scope / Panel / Run History / Issues) live on
// sibling sub-routes under `/projects/:projectId/:envSlug/<key>`.
// Same recipe as `TargetsPage.tsx`: pull the section out, mount it
// at `/projects/:projectId/:envSlug/<key>`, wire the sidebar
// sub-item to it.

import { useIssueTrackerStore } from "@/hooks/issueTrackerStore";
import { SecretsPanel } from "@/components/issue-tracker/SecretsPanel";
import { BackToProjectsLink } from "@/components/layout/BackToProjectsLink";
import { useT } from "@/lib/blocks/i18n";

export function SecretsPage() {
  const t = useT();
  const tracker = useIssueTrackerStore();
  const {
    secrets,
    targets,
    boundTargetsBySecretId,
    addSecret,
    editSecret,
    deleteSecret,
    bindSecret,
  } = tracker;

  return (
    <div className="space-y-6">
      <BackToProjectsLink />

      <div>
        <h1 className="text-xl font-semibold text-foreground">
          {t("nav.issueTracker.secrets", "Secrets")}
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
        boundTargetsBySecretId={boundTargetsBySecretId}
        onAdd={async (payload) => {
          await addSecret(payload);
        }}
        onEdit={(id, patch) => void editSecret(id, patch)}
        onDelete={deleteSecret}
        onBind={async (secretId, targetIds) => {
          await bindSecret(secretId, targetIds);
        }}
      />
    </div>
  );
}
