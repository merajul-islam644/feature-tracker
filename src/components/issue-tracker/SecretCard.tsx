// One saved credential — name, email, masked password, edit/delete actions.
// Spec section 12.

import { KeyRound, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Secret } from "@/types/issue-tracker";

interface Props {
  secret: Secret;
  onDelete: (id: string) => void;
}

export function SecretCard({ secret, onDelete }: Props) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
            aria-hidden="true"
          >
            <KeyRound className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{secret.name}</p>
            <p className="truncate text-xs text-muted-foreground">{secret.email}</p>
            <p className="mt-1 font-mono text-xs text-foreground">{secret.passwordMasked}</p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onDelete(secret.id)}
          aria-label={`Delete ${secret.name}`}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </Card>
  );
}
