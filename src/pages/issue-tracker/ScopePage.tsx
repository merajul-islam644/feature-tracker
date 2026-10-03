// Verification Scopes sub-page. Hosts the `<VerificationScope>` card
// (which checkboxes run + device picker), reading the env's check rows
// and the toggle/add/edit/delete callbacks from the same store the
// parent page uses.
//
// Under schema v2.1 the selection is per-environment: rows come from
// `blx_VerificationChecks` via `useVerificationChecks` (inside the
// store), keyed by the active env's row identity. Toggling writes the
// row's enabled flag — no more per-user localStorage catalog.
//
// Deployment-gap / load-window fallback: when the store reports ready
// but the row list is empty (schema undeployed, or the env genuinely
// has no rows), the shipped catalog renders as a read-only view with
// the recommended checks marked on — matching what a run would use —
// so the page never lies about the selection while writes are
// impossible.

import { useMemo } from "react";
import { useIssueTrackerStore } from "@/hooks/issueTrackerStore";
import { VerificationScope } from "@/components/issue-tracker/VerificationScope";
import { verificationChecks } from "@/data/issueTrackerConstants";
import { EnvHeaderChip } from "@/components/project/EnvHeaderChip";
import { BackToProjectsLink } from "@/components/layout/BackToProjectsLink";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/lib/blocks/i18n";
import type { EnvVerificationCheck } from "@/lib/blocks/data";

export function ScopePage() {
  const t = useT();
  const tracker = useIssueTrackerStore();
  const {
    checks,
    checksReady,
    checksReadOnly,
    toggleScope,
    device,
    setDevice,
    addCustomCheck,
    updateCustomCheck,
    deleteCustomCheck,
  } = tracker;

  // Deployment-gap fallback: pseudo rows built from the shipped catalog,
  // nothing pre-selected (matches the v2.1 seeds' default). Toggles are
  // disabled in this state — there's no row to PATCH.
  const displayChecks = useMemo<EnvVerificationCheck[]>(() => {
    if (checks.length > 0) return checks;
    return verificationChecks.map((c) => ({
      id: c.id,
      projectId: "",
      environmentId: "",
      source: "builtin" as const,
      checkId: c.id,
      label: c.label,
      description: c.description,
      recommended: c.recommended,
      enabled: false,
      createdAt: "",
      updatedAt: "",
    }));
  }, [checks]);
  const cloudRows = checks.length > 0;

  return (
    <div className="space-y-6">
      <BackToProjectsLink />

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-foreground">
            {t("nav.issueTracker.scope", "Scopes")}
          </h1>
          <EnvHeaderChip />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "issueTracker.scope.description",
            "Pick which checks run during verification. Nothing is selected by default — check the ones the AI should run, or use Select all / Clear. Pick a device preset to size the run's browser viewport.",
          )}
        </p>
      </div>

      {!checksReady ? (
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </CardContent>
        </Card>
      ) : (
        <VerificationScope
          checks={displayChecks}
          readOnly={checksReadOnly || !cloudRows}
          onToggle={(id) => toggleScope(id)}
          onSelectAll={() => {
            displayChecks.forEach((row) => {
              if (!row.enabled) toggleScope(row.checkId);
            });
          }}
          onClear={() => {
            displayChecks.forEach((row) => {
              if (row.enabled) toggleScope(row.checkId);
            });
          }}
          device={device}
          onDeviceChange={setDevice}
          onAddCustom={addCustomCheck}
          onUpdateCustom={updateCustomCheck}
          onDeleteCustom={deleteCustomCheck}
        />
      )}
    </div>
  );
}
