// Verification Scope card (spec section 11) — pick which checks run during
// verification. Recommended checks are pre-selected; users can opt in/out.

import { ListChecks } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { VerificationCheck } from "@/types/issue-tracker";

interface Props {
  checks: VerificationCheck[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
}

export function VerificationScope({
  checks,
  selectedIds,
  onToggle,
  onSelectAll,
  onClear,
}: Props) {
  const recommended = checks.filter((c) => c.recommended);
  const optional = checks.filter((c) => !c.recommended);

  const selected = new Set(selectedIds);
  const allCount = checks.length;
  const selectedCount = selectedIds.length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <ListChecks className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Verification Scope
          </CardTitle>
          <CardDescription>
            {selectedCount}/{allCount} checks selected
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onSelectAll}
            disabled={selectedCount === allCount}
          >
            Select all
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClear}
            disabled={selectedCount === 0}
          >
            Clear
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ScopeGroup
          title="Recommended"
          description="Enabled by default — the AI always runs these checks."
          checks={recommended}
          selected={selected}
          onToggle={onToggle}
        />
        <ScopeGroup
          title="Optional"
          description="Pick additional checks for this run."
          checks={optional}
          selected={selected}
          onToggle={onToggle}
        />
      </CardContent>
    </Card>
  );
}

interface GroupProps {
  title: string;
  description: string;
  checks: VerificationCheck[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}

function ScopeGroup({ title, description, checks, selected, onToggle }: GroupProps) {
  if (checks.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        <Badge variant="muted">{checks.length}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
      <ul className="space-y-2">
        {checks.map((c) => {
          const isOn = selected.has(c.id);
          return (
            <li
              key={c.id}
              className="flex items-start gap-3 rounded-md border border-border bg-card p-3"
            >
              <Checkbox
                id={`scope-${c.id}`}
                checked={isOn}
                onCheckedChange={() => onToggle(c.id)}
                className="mt-0.5"
              />
              <Label htmlFor={`scope-${c.id}`} className="flex-1 cursor-pointer">
                <span className="block text-sm font-medium text-foreground">{c.label}</span>
                {c.description && (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {c.description}
                  </span>
                )}
              </Label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
