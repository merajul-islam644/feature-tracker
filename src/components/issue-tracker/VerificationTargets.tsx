// Verification Targets card (spec section 9).
// One row per configured target, plus a single empty input row for adding a new URL.

import { Plus, Globe } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UrlInput, validateUrl } from "./UrlInput";
import type { VerificationTarget } from "@/types/issue-tracker";

interface Props {
  targets: VerificationTarget[];
  draftUrl: string;
  draftError: string | null;
  onDraftChange: (value: string) => void;
  onAddDraft: () => void;
  onRemoveTarget: (id: string) => void;
  canAdd: boolean;
}

export function VerificationTargets({
  targets,
  draftUrl,
  draftError,
  onDraftChange,
  onAddDraft,
  onRemoveTarget,
  canAdd,
}: Props) {
  // Validate draft inline as the user types.
  const inlineError =
    draftError ??
    (draftUrl.trim() ? validateUrl(draftUrl, [draftUrl]) : null);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Verification Targets
          </CardTitle>
          <CardDescription>
            Application URLs the AI will visit during verification.
          </CardDescription>
        </div>
        <Badge variant="muted">{targets.length}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {targets.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
            No verification targets yet. Add an application URL to start verification.
          </p>
        ) : (
          <ul className="space-y-2">
            {targets.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {t.applicationName}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{t.url}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={t.enabled ? "default" : "muted"}>
                    {t.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => onRemoveTarget(t.id)}
                    aria-label={`Remove ${t.applicationName}`}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <TrashIcon />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2 border-t border-border pt-3">
          <UrlInput
            id="draft"
            value={draftUrl}
            error={inlineError}
            onChange={onDraftChange}
            onRemove={() => onDraftChange("")}
            canRemove={canAdd && draftUrl.length > 0}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAddDraft}
            disabled={!canAdd || !!inlineError || !draftUrl.trim()}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add URL
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TrashIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}
