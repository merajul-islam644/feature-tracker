// Wrapper card for the verification panel: summary tiles + live progress.

import { Activity } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { VerificationSummary } from "./VerificationSummary";
import { VerificationProgress } from "./VerificationProgress";
import type { VerificationRun } from "@/types/issue-tracker";

interface Props {
  run: VerificationRun;
}

export function VerificationPanel({ run }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Verification Panel
        </CardTitle>
        <CardDescription>
          Live status of the most recent verification run.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <VerificationSummary run={run} />
        <VerificationProgress run={run} />
      </CardContent>
    </Card>
  );
}
