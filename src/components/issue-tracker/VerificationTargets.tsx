// Verification Targets card (spec section 9, 14).
// One row per configured target. Each row exposes:
//   - enabled toggle (skipped rows are excluded from verification runs)
//   - last-verified timestamp + status pill
//   - inline edit (URL + applicationName) via a pencil icon — collapses
//     the row into two inputs with Save / Cancel actions, validates the
//     new URL against the other configured targets, and reverts on cancel.
//   - inline "Test Connection" button (spec 14)
//   - remove action
// Plus a single empty input row for adding a new URL.

import { useEffect, useState } from "react";
import { Plus, Globe, Plug, Trash2, Pencil, Check, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
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
  onEditTarget: (
    id: string,
    patch: { applicationName: string; url: string },
  ) => void;
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
  onEditTarget,
  onTestConnection,
  testingTargetId,
  canAdd,
}: Props) {
  // Validate draft inline as the user types. The parent already passes
  // its own error in `draftError` (which is what knows about the existing
  // target list — see `IssueTrackerPage`); we only fall back to the
  // draft-self check if no error was provided.
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
                  otherUrls={targets
                    .filter((other) => other.id !== t.id)
                    .map((other) => other.url)}
                  isTesting={testingTargetId === t.id}
                  onToggleEnabled={onToggleEnabled}
                  onRemove={onRemoveTarget}
                  onEdit={onEditTarget}
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
  // URLs of every OTHER target — used to flag the new URL as a duplicate
  // if the user edits one row to match an existing one.
  otherUrls: string[];
  isTesting: boolean;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onRemove: (id: string) => void;
  onEdit: (id: string, patch: { applicationName: string; url: string }) => void;
  onTestConnection: (target: VerificationTarget) => void;
}

function TargetRow({
  target,
  otherUrls,
  isTesting,
  onToggleEnabled,
  onRemove,
  onEdit,
  onTestConnection,
}: RowProps) {
  // One row is in edit mode at a time, tracked by the row's id. When the
  // user clicks the pencil we lift the row into a small inline form: the
  // original row contents stay visible above for context, but the action
  // buttons collapse to Save / Cancel so the user can't accidentally fire
  // a Test or Remove while the form is dirty.
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(target.applicationName);
  const [draftUrl, setDraftUrl] = useState(target.url);

  // Reset the local form whenever the row leaves edit mode, or when the
  // underlying target changes underneath us (e.g. another tab updates it
  // through the cache). We deliberately only re-sync on the edit-flip /
  // target id change — not on every render — otherwise typing in the
  // inputs would clobber the user's text.
  useEffect(() => {
    if (!editing) {
      setDraftName(target.applicationName);
      setDraftUrl(target.url);
    }
  }, [editing, target.applicationName, target.url, target.id]);

  // Validate the in-flight URL the same way the add-row does — this gives
  // consistent messaging ("URL is required", "Please enter a valid URL.",
  // "This URL has already been added.") so the user knows exactly what's
  // wrong before they hit Save.
  const trimmedUrl = draftUrl.trim();
  const urlError = validateUrl(trimmedUrl, otherUrls.concat([trimmedUrl]));
  const nameError =
    !draftName.trim() ? "Display name is required." : null;
  const canSave = !urlError && !nameError && !isTesting;

  const startEditing = () => {
    setDraftName(target.applicationName);
    setDraftUrl(target.url);
    setEditing(true);
  };
  const cancelEditing = () => setEditing(false);
  const saveEditing = () => {
    if (!canSave) return;
    onEdit(target.id, {
      applicationName: draftName.trim(),
      url: trimmedUrl,
    });
    setEditing(false);
  };

  return (
    <div
      className={`flex flex-col gap-3 rounded-md border border-border bg-card px-3 py-2 ${
        target.enabled ? "" : "opacity-60"
      }`}
    >
      <div className="flex flex-wrap items-center gap-3">
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
              disabled={editing}
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
            onClick={startEditing}
            disabled={editing || isTesting}
            aria-label={`Edit ${target.applicationName}`}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onRemove(target.id)}
            disabled={editing}
            aria-label={`Remove ${target.applicationName}`}
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {editing && (
        <div className="space-y-2 border-t border-border pt-3">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <div className="space-y-1">
              <label
                htmlFor={`edit-name-${target.id}`}
                className="text-xs font-medium text-muted-foreground"
              >
                Display name
              </label>
              <Input
                id={`edit-name-${target.id}`}
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                aria-invalid={!!nameError}
                placeholder="My App"
                className={
                  nameError
                    ? "border-destructive focus-visible:ring-destructive"
                    : undefined
                }
              />
              {nameError && (
                <p className="text-xs text-destructive">{nameError}</p>
              )}
            </div>
            <div className="space-y-1">
              <label
                htmlFor={`edit-url-${target.id}`}
                className="text-xs font-medium text-muted-foreground"
              >
                Application URL
              </label>
              <UrlInput
                id={`edit-${target.id}`}
                value={draftUrl}
                error={urlError}
                onChange={setDraftUrl}
                onRemove={() => setDraftUrl("")}
                canRemove={draftUrl.length > 0}
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={cancelEditing}
              aria-label={`Cancel editing ${target.applicationName}`}
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Cancel
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={saveEditing}
              disabled={!canSave}
              aria-label={`Save changes to ${target.applicationName}`}
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              Save
            </Button>
          </div>
        </div>
      )}
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
