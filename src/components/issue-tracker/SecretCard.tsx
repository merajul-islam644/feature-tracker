// One saved credential — name, email, masked password, edit/delete actions,
// and a target-binding control.
//
// Edit pencil sits to the left of the trash button and lifts the row into
// a small inline form. We intentionally only allow editing `name` and
// `email`: the *real* password never reaches the cloud (spec section 12.3)
// — only `passwordMasked` does — so there is no plaintext value to swap
// in place here. To change a password the user must delete the row and
// add a fresh credential through `SecretForm`.
//
// The binding row shows which target (if any) this credential is bound to.
// The user can change the binding without deleting the row — the binding
// is a separate field on the target (target.credentialId) and updating it
// is a single Blocks PATCH.

import { useEffect, useMemo, useState } from "react";
import { Check, KeyRound, Link2, Link2Off, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { Secret, VerificationTarget } from "@/types/issue-tracker";

interface Props {
  secret: Secret;
  targets: VerificationTarget[];
  onEdit: (id: string, patch: { name: string; email: string }) => void;
  onDelete: (id: string) => void;
  // Re-bind a saved secret to a different target (or clear the binding by
  // passing null / empty string).
  onBind: (secretId: string, targetId: string | null) => void;
}

export function SecretCard({
  secret,
  targets,
  onEdit,
  onDelete,
  onBind,
}: Props) {
  // When the user clicks the pencil we lift the row into a small inline
  // form. Save/Cancel replace the regular actions so a stale Delete
  // click can't drop the row while the form is dirty.
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(secret.name);
  const [draftEmail, setDraftEmail] = useState(secret.email);

  // Resolve which target currently holds this credential. The relationship
  // is stored on the target side (target.credentialId) — we scan the
  // targets list to find it. Memoised so we don't iterate on every render.
  const boundTarget = useMemo(
    () => targets.find((t) => t.credentialId === secret.id) ?? null,
    [targets, secret.id],
  );

  // Reset the local form whenever the row leaves edit mode, or when the
  // underlying row changes underneath us (e.g. another tab saves through
  // the cache). Deliberately only re-sync on the edit-flip / id change —
  // not on every render — otherwise typing would clobber the user.
  useEffect(() => {
    if (!editing) {
      setDraftName(secret.name);
      setDraftEmail(secret.email);
    }
  }, [editing, secret.name, secret.email, secret.id]);

  const trimmedName = draftName.trim();
  const trimmedEmail = draftEmail.trim();
  const emailError =
    !trimmedEmail
      ? "Email is required."
      : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)
        ? "Enter a valid email."
        : null;
  const nameError = !trimmedName ? "Name is required." : null;
  const canSave = !nameError && !emailError;

  const startEditing = () => {
    setDraftName(secret.name);
    setDraftEmail(secret.email);
    setEditing(true);
  };
  const cancelEditing = () => setEditing(false);
  const saveEditing = () => {
    if (!canSave) return;
    onEdit(secret.id, { name: trimmedName, email: trimmedEmail });
    setEditing(false);
  };

  const handleBindChange = (newTargetId: string) => {
    // Empty value = unbind. Pass null so the hook can clear the field.
    onBind(secret.id, newTargetId || null);
  };

  // Build the dropdown options. We include the "No target" sentinel so the
  // user can explicitly clear the binding from here.
  //
  // We deliberately don't filter out targets bound to a different
  // credential: the user needs a way to fix stale bindings (where a
  // target's `credentialId` points to a secret that's since been
  // deleted). Picking a new option here overwrites the binding; the other
  // secret's card flips back to "Not bound" on the next render.
  const bindOptions = [
    { value: "", label: "— Not bound to any target —" },
    ...targets.map((t) => ({
      value: t.id,
      label: `${t.applicationName} — ${t.url}`,
    })),
  ];

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
            aria-hidden="true"
          >
            <KeyRound className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {secret.name}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {secret.email}
            </p>
            <p className="mt-1 font-mono text-xs text-foreground">
              {secret.passwordMasked}
            </p>
            {/* Binding status pill — visible at-a-glance so the user
                remembers which target this credential is scoped to. */}
            <div className="mt-2 flex items-center gap-1.5 text-xs">
              {boundTarget ? (
                <>
                  <Link2
                    className="h-3.5 w-3.5 text-primary"
                    aria-hidden="true"
                  />
                  <span className="text-muted-foreground">Bound to</span>
                  <span className="font-mono text-foreground">
                    {boundTarget.applicationName} ({boundTarget.url})
                  </span>
                </>
              ) : (
                <>
                  <Link2Off
                    className="h-3.5 w-3.5 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="text-muted-foreground">
                    Not bound to any target
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={startEditing}
            disabled={editing}
            aria-label={`Edit ${secret.name}`}
            className="text-muted-foreground hover:text-foreground"
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onDelete(secret.id)}
            disabled={editing}
            aria-label={`Delete ${secret.name}`}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* Binding editor — always visible so the user can re-scope without
          entering edit mode. We hide it during edit so a stale binding
          change can't race with a credential rename. */}
      {!editing && (
        <div className="mt-3 space-y-1 border-t border-border pt-3">
          <Label
            htmlFor={`secret-bind-${secret.id}`}
            className="flex items-center gap-1.5 text-xs"
          >
            <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
            Bound target
          </Label>
          {targets.length === 0 ? (
            <p className="text-xs text-muted-foreground rounded-md border border-dashed border-border bg-background px-3 py-2">
              No verification targets yet. Add one to enable binding.
            </p>
          ) : (
            <Select
              id={`secret-bind-${secret.id}`}
              value={boundTarget?.id ?? ""}
              onChange={(e) => handleBindChange(e.target.value)}
              options={bindOptions}
            />
          )}
          <p className="text-xs text-muted-foreground">
            This credential will only be used for the selected target during
            verification.
          </p>
        </div>
      )}

      {editing && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`secret-edit-name-${secret.id}`}>
                Credential name
              </Label>
              <Input
                id={`secret-edit-name-${secret.id}`}
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="QA Account"
                aria-invalid={!!nameError}
                aria-describedby={
                  nameError ? `secret-edit-name-err-${secret.id}` : undefined
                }
              />
              {nameError && (
                <p
                  id={`secret-edit-name-err-${secret.id}`}
                  className="text-xs text-destructive"
                >
                  {nameError}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor={`secret-edit-email-${secret.id}`}>Email</Label>
              <Input
                id={`secret-edit-email-${secret.id}`}
                type="email"
                value={draftEmail}
                onChange={(e) => setDraftEmail(e.target.value)}
                placeholder="qa@example.com"
                aria-invalid={!!emailError}
                aria-describedby={
                  emailError
                    ? `secret-edit-email-err-${secret.id}`
                    : undefined
                }
              />
              {emailError && (
                <p
                  id={`secret-edit-email-err-${secret.id}`}
                  className="text-xs text-destructive"
                >
                  {emailError}
                </p>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Passwords are kept only for the current session and never written
            to local storage. To change a password, remove and re-add the
            credential.
          </p>
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={cancelEditing}
              aria-label={`Cancel editing ${secret.name}`}
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
              aria-label={`Save changes to ${secret.name}`}
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
