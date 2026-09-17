// Verification Targets card (spec section 9, 14).
// One row per configured target. Each row exposes:
//   - enabled toggle (skipped rows are excluded from verification runs)
//   - last-verified timestamp + status pill
//   - inline "Test Connection" button (spec 14)
//   - remove action
// Plus a single empty input row for adding a new URL.

import { Plus, Globe, Plug, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { UrlInput, validateUrl } from "./UrlInput";
import type { VerificationTarget, TargetStatus } from "@/types/issue-tracker";

interface Props {
  targets: VerificationTarget[];
  draftUrl: string;
  draftError: string | null;
  onDraftChange: (value: string) => void;
  onAddDraft: () => void;
  onRemoveTarget: (id: string) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onTestConnection: (target: VerificationTarget) => void;
  // While a row's Test Connection is in flight, the spinner replaces the
  // button. The parent owns the "currently-testing" id (one at a time).
  testingTargetId?: string | null;
  canAdd: boolean;
}

export function VerificationTargets({
  targets,
  draftUrl,
  draftError,
  onDraftChange,
  onAddDraft,
  onRemoveTarget,
  onToggleEnabled,
  onTestConnection,
  testingTargetId,
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
              <li key={t.id}>
                <TargetRow
                  target={t}
                  isTesting={testingTargetId === t.id}
                  onToggleEnabled={onToggleEnabled}
                  onRemove={onRemoveTarget}
                  onTestConnection={onTestConnection}
                />
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

interface RowProps {
  target: VerificationTarget;
  isTesting: boolean;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onRemove: (id: string) => void;
  onTestConnection: (target: VerificationTarget) => void;
}

function TargetRow({
  target,
  isTesting,
  onToggleEnabled,
  onRemove,
  onTestConnection,
}: RowProps) {
  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-3 py-2 ${
        target.enabled ? "" : "opacity-60"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">
            {target.applicationName}
          </p>
          <Badge variant={target.enabled ? "default" : "muted"}>
            {target.enabled ? "Enabled" : "Disabled"}
          </Badge>
          {target.lastStatus && (
            <StatusPill status={target.lastStatus} />
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">{target.url}</p>
        {target.lastVerifiedAt && (
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Last verified {formatRelativeTime(target.lastVerifiedAt)}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onToggleEnabled(target.id, !target.enabled)}
          aria-pressed={target.enabled}
          aria-label={`${target.enabled ? "Disable" : "Enable"} ${target.applicationName}`}
          className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          {target.enabled ? "Disable" : "Enable"}
        </Button>

        {isTesting ? (
          <span
            className="inline-flex h-8 items-center gap-1 px-2 text-xs text-muted-foreground"
            aria-live="polite"
          >
            <Spinner className="h-3.5 w-3.5" aria-hidden="true" />
            Testing…
          </span>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onTestConnection(target)}
            aria-label={`Test connection for ${target.applicationName}`}
            className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <Plug className="h-3.5 w-3.5" aria-hidden="true" />
            Test
          </Button>
        )}

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onRemove(target.id)}
          aria-label={`Remove ${target.applicationName}`}
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: TargetStatus }) {
  const tone: string =
    status === "healthy" || status === "completed"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : status === "issues_found" ||
          status === "verification_failed" ||
          status === "authentication_failed" ||
          status === "unreachable"
        ? "border-destructive/40 bg-destructive/10 text-destructive"
        : "border-border text-muted-foreground";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tone}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diffMs)) return "";
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
