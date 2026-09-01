// Wrapper for the Secrets section (spec section 12): empty state, list of
// saved credentials, and the add form.

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SecretCard } from "./SecretCard";
import { SecretForm } from "./SecretForm";
import type { Secret } from "@/types/issue-tracker";

interface Props {
  secrets: Secret[];
  onAdd: (payload: { name: string; email: string; password: string }) => Promise<void>;
  onDelete: (id: string) => void;
}

export function SecretsPanel({ secrets, onAdd, onDelete }: Props) {
  const [formOpen, setFormOpen] = useState(false);

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
                <SecretCard secret={s} onDelete={onDelete} />
              </li>
            ))}
          </ul>
        )}

        {formOpen ? (
          <SecretForm
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
