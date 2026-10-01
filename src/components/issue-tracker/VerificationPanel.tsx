// Wrapper card for the verification panel: summary tiles + live progress,
// plus the application map and report export once the run has produced them.

import { Activity, Download, Map as MapIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { VerificationSummary } from "./VerificationSummary";
import { VerificationProgress } from "./VerificationProgress";
import { ApplicationMap } from "./ApplicationMap";
import type { VerificationRun } from "@/types/issue-tracker";

interface Props {
  run: VerificationRun;
  // Downloads the Markdown report built from the run (test plan, results,
  // issues, application map). Optional so the panel renders standalone in
  // isolated/storybook usage.
  onExportReport?: () => void;
}

export function VerificationPanel({ run, onExportReport }: Props) {
  const hasAppMap = Boolean(run.appMaps && Object.keys(run.appMaps).length > 0);
  const settled = run.status !== "running" && run.status !== "paused";

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Verification Panel
          </CardTitle>
          <CardDescription>
            Live status of the most recent verification run.
          </CardDescription>
        </div>
        {settled && onExportReport && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onExportReport}
            className="shrink-0"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Export report
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <VerificationSummary run={run} />
        <VerificationProgress run={run} />
        {hasAppMap && (
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <MapIcon className="h-3.5 w-3.5" aria-hidden="true" />
              Application map
            </p>
            <ApplicationMap appMaps={run.appMaps!} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
