// Wrapper for the Secrets section (spec section 12): empty state, list of
// saved credentials, and the add form.
//
// The form shows a target-binding dropdown so the user can pick exactly one
// configured verification target to bind the credential to at creation time.
// Binding is enforced server-side too — only one credential can be active
// per target — so if the user picks an already-bound target, the existing
// binding is replaced.

import { useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SecretCard } from "./SecretCard";
import { SecretForm } from "./SecretForm";
import type { Secret, VerificationTarget } from "@/types/issue-tracker";

interface Props {
  secrets: Secret[];
  targets: VerificationTarget[];
  onAdd: (payload: {
    name: string;
    email: string;
    password: string;
    targetId?: string;
  }) => Promise<void>;
  onEdit: (id: string, patch: { name: string; email: string }) => void;
  onDelete: (id: string) => void;
  // Re-bind a saved secret to a different target (or clear the binding by
  // passing empty string). Receives the secretId and the new targetId.
  onBind: (secretId: string, targetId: string | null) => void;
}

export function SecretsPanel({
  secrets,
  targets,
  onAdd,
  onEdit,
  onDelete,
  onBind,
}: Props) {
  const [formOpen, setFormOpen] = useState(false);

  // Build a quick lookup of targetId → name of the secret currently bound
  // to it. The form uses this to warn the user before they overwrite an
  // existing binding.
  const boundSecretByTargetId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of targets) {
      if (t.credentialId) {
        const s = secrets.find((x) => x.id === t.credentialId);
        if (s) map[t.id] = s.name;
      }
    }
    return map;
  }, [targets, secrets]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Secrets
          </CardTitle>
          <CardDescription>
            Credentials the AI uses to sign into applications during verification.
            Each credential is scoped to one target — it will not be passed to
            any other URL.
          </CardDescription>
        </div>
        <Badge variant="muted">{secrets.length}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {secrets.length === 0 && !formOpen && (
          <div className="rounded-md border border-dashed border-border bg-muted/30 p-4 text-center">
            <p className="text-sm text-muted-foreground">No credentials configured.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Add a credential to verify authenticated applications.
            </p>
          </div>
        )}

        {secrets.length > 0 && (
          <ul className="space-y-2">
            {secrets.map((s) => (
              <li key={s.id}>
                <SecretCard
                  secret={s}
                  targets={targets}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onBind={onBind}
                />
              </li>
            ))}
          </ul>
        )}

        {formOpen ? (
          <SecretForm
            targets={targets}
            boundSecretByTargetId={boundSecretByTargetId}
            onSubmit={async (payload) => {
              await onAdd(payload);
              setFormOpen(false);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            + Add Secret
          </button>
        )}
      </CardContent>
    </Card>
  );
}
