// Verification Scope card (spec section 11) — pick which checks run during
// verification. Recommended checks are pre-selected; users can opt in/out.
// The device picker sizes the run's browser context (viewport + touch) so
// responsive layouts actually get exercised differently per preset.
//
// In addition to the shipped catalog (`verificationChecks`), the user can
// add their own custom scopes (see `useCustomVerificationChecks`). They
// render in their own section with edit / delete actions so the user can
// prune the list at any time. Custom scopes are stored in localStorage
// (per-device) and the AI uses the label/description as guidance at
// run-time — there's no fixed backend behaviour for them, just like the
// built-ins when the AI picks an ad-hoc walk.

import { useEffect, useState } from "react";
import {
  ListChecks,
  MonitorSmartphone,
  Pencil,
  Plus,
  Save,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { VerificationCheck } from "@/types/issue-tracker";
import type { CustomVerificationCheck } from "@/hooks/useCustomVerificationChecks";

export type VerificationDevice = "desktop" | "mobile" | "tablet";

const DEVICE_OPTIONS: { value: VerificationDevice; label: string }[] = [
  { value: "desktop", label: "Desktop · 1280×800" },
  { value: "mobile", label: "Mobile · 390×844 (touch)" },
  { value: "tablet", label: "Tablet · 820×1180 (touch)" },
];

interface Props {
  checks: VerificationCheck[];
  customChecks: CustomVerificationCheck[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
  device: VerificationDevice;
  onDeviceChange: (device: VerificationDevice) => void;
  // Custom-check CRUD — surfaced as inline add/edit/delete in the
  // "Custom" section below. Add returns the created row so the parent
  // can immediately enable the freshly-added scope by its id.
  onAddCustom: (input: {
    label: string;
    description: string;
    recommended: boolean;
  }) => CustomVerificationCheck;
  onUpdateCustom: (
    id: string,
    patch: Partial<
      Pick<CustomVerificationCheck, "label" | "description" | "recommended">
    >,
  ) => void;
  onDeleteCustom: (id: string) => void;
}

export function VerificationScope({
  checks,
  customChecks,
  selectedIds,
  onToggle,
  onSelectAll,
  onClear,
  device,
  onDeviceChange,
  onAddCustom,
  onUpdateCustom,
  onDeleteCustom,
}: Props) {
  const recommended = checks.filter((c) => c.recommended);
  const optional = checks.filter((c) => !c.recommended);
  const selectedRecommended = customChecks.filter((c) => c.recommended);
  const selectedOptional = customChecks.filter((c) => !c.recommended);

  const selected = new Set(selectedIds);
  const allCount = checks.length + customChecks.length;
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
        <div className="flex items-center gap-3 rounded-md border border-border bg-card p-3">
          <MonitorSmartphone
            className="h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <div className="flex-1">
            <Label htmlFor="verification-device" className="cursor-pointer">
              <span className="block text-sm font-medium text-foreground">Device</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Viewport + touch emulation the next run uses.
              </span>
            </Label>
          </div>
          <Select
            id="verification-device"
            className="h-9 w-52 shrink-0"
            value={device}
            onChange={(e) =>
              onDeviceChange(e.target.value as VerificationDevice)
            }
            options={DEVICE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
        </div>
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
        <CustomScopeGroup
          recommended={selectedRecommended}
          optional={selectedOptional}
          selected={selected}
          onToggle={onToggle}
          onAddCustom={onAddCustom}
          onUpdateCustom={onUpdateCustom}
          onDeleteCustom={onDeleteCustom}
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

// ────────────────────────────────────────────────────────────────────────────
//  Custom scope group — user-defined checks with inline add / edit / delete.
//  Mirrors the layout of `ScopeGroup` but each row gets a small kebab
//  (pencil + trash) so the user can manage their personal catalog without
//  leaving the page. The add row lives at the bottom; clicking "+ Add
//  custom scope" expands an inline form (label + description + recommended
//  toggle) that commits on Save.
// ────────────────────────────────────────────────────────────────────────────

interface CustomGroupProps {
  recommended: CustomVerificationCheck[];
  optional: CustomVerificationCheck[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onAddCustom: (input: {
    label: string;
    description: string;
    recommended: boolean;
  }) => CustomVerificationCheck;
  onUpdateCustom: (
    id: string,
    patch: Partial<
      Pick<CustomVerificationCheck, "label" | "description" | "recommended">
    >,
  ) => void;
  onDeleteCustom: (id: string) => void;
}

function CustomScopeGroup({
  recommended,
  optional,
  selected,
  onToggle,
  onAddCustom,
  onUpdateCustom,
  onDeleteCustom,
}: CustomGroupProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Sparkles className="h-3 w-3" aria-hidden="true" />
          Custom
        </p>
        <Badge variant="muted">{recommended.length + optional.length}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Your own checks. The AI uses the label and description as guidance
        when running — there's no fixed behaviour for them.
      </p>
      {(recommended.length > 0 || optional.length > 0) && (
        <ul className="space-y-2">
          {recommended.map((c) => (
            <CustomScopeRow
              key={c.id}
              check={c}
              isOn={selected.has(c.id)}
              onToggle={onToggle}
              onUpdate={onUpdateCustom}
              onDelete={onDeleteCustom}
            />
          ))}
          {optional.map((c) => (
            <CustomScopeRow
              key={c.id}
              check={c}
              isOn={selected.has(c.id)}
              onToggle={onToggle}
              onUpdate={onUpdateCustom}
              onDelete={onDeleteCustom}
            />
          ))}
        </ul>
      )}
      <AddCustomScopeForm
        onAdd={(input) => {
          const created = onAddCustom(input);
          // Auto-enable the freshly-added scope so the user doesn't
          // have to remember to tick the box after creating it.
          onToggle(created.id);
          return created;
        }}
      />
    </div>
  );
}

interface RowProps {
  check: CustomVerificationCheck;
  isOn: boolean;
  onToggle: (id: string) => void;
  onUpdate: CustomGroupProps["onUpdateCustom"];
  onDelete: (id: string) => void;
}

function CustomScopeRow({ check, isOn, onToggle, onUpdate, onDelete }: RowProps) {
  // One row in edit mode at a time. We deliberately don't lift this
  // state up — only the row's own inputs need to know.
  const [editing, setEditing] = useState(false);
  const [draftLabel, setDraftLabel] = useState(check.label);
  const [draftDescription, setDraftDescription] = useState(check.description);
  const [draftRecommended, setDraftRecommended] = useState(check.recommended);

  // Re-sync the local form when the underlying check changes from
  // elsewhere (cross-tab storage event, or another consumer wrote to
  // localStorage). Same pattern as SecretCard's edit form.
  useEffect(() => {
    if (!editing) {
      setDraftLabel(check.label);
      setDraftDescription(check.description);
      setDraftRecommended(check.recommended);
    }
  }, [editing, check.label, check.description, check.recommended]);

  const trimmedLabel = draftLabel.trim();
  const labelError = !trimmedLabel ? "Label is required." : null;
  const canSave = !labelError;

  const cancel = () => {
    setEditing(false);
    setDraftLabel(check.label);
    setDraftDescription(check.description);
    setDraftRecommended(check.recommended);
  };
  const save = () => {
    if (!canSave) return;
    onUpdate(check.id, {
      label: trimmedLabel,
      description: draftDescription.trim(),
      recommended: draftRecommended,
    });
    setEditing(false);
  };

  if (editing) {
    return (
      <li className="space-y-2 rounded-md border border-border bg-card p-3">
        <div className="space-y-2">
          <Label htmlFor={`custom-label-${check.id}`} className="text-xs">
            Label
          </Label>
          <Input
            id={`custom-label-${check.id}`}
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            placeholder="My custom check"
            aria-invalid={!!labelError}
            className={labelError ? "border-destructive" : undefined}
          />
          {labelError && (
            <p className="text-xs text-destructive">{labelError}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor={`custom-desc-${check.id}`} className="text-xs">
            Description (helps the AI know what to look for)
          </Label>
          <Input
            id={`custom-desc-${check.id}`}
            value={draftDescription}
            onChange={(e) => setDraftDescription(e.target.value)}
            placeholder="What should this check look for?"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={draftRecommended}
            onCheckedChange={(v) => setDraftRecommended(v === true)}
          />
          Enable by default
        </label>
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={cancel}
            aria-label={`Cancel editing ${check.label}`}
          >
            <X className="h-4 w-4" aria-hidden="true" />
            Cancel
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={save}
            disabled={!canSave}
            aria-label={`Save changes to ${check.label}`}
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            Save
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-start gap-3 rounded-md border border-border bg-card p-3">
      <Checkbox
        id={`scope-${check.id}`}
        checked={isOn}
        onCheckedChange={() => onToggle(check.id)}
        className="mt-0.5"
      />
      <Label htmlFor={`scope-${check.id}`} className="flex-1 cursor-pointer">
        <span className="flex items-baseline gap-1.5">
          <span className="text-sm font-medium text-foreground">
            {check.label}
          </span>
          {check.recommended && (
            <Badge variant="muted" className="text-[10px]">
              Recommended
            </Badge>
          )}
        </span>
        {check.description && (
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {check.description}
          </span>
        )}
      </Label>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setEditing(true)}
          aria-label={`Edit ${check.label}`}
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onDelete(check.id)}
          aria-label={`Delete ${check.label}`}
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </li>
  );
}

interface AddFormProps {
  onAdd: (input: {
    label: string;
    description: string;
    recommended: boolean;
  }) => CustomVerificationCheck;
}

function AddCustomScopeForm({ onAdd }: AddFormProps) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [recommended, setRecommended] = useState(false);

  const trimmedLabel = label.trim();
  const labelError = !trimmedLabel ? "Label is required." : null;
  const canSave = !labelError;

  const reset = () => {
    setLabel("");
    setDescription("");
    setRecommended(false);
  };
  const cancel = () => {
    reset();
    setOpen(false);
  };
  const save = () => {
    if (!canSave) return;
    onAdd({
      label: trimmedLabel,
      description: description.trim(),
      recommended,
    });
    reset();
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        Add custom scope
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-dashed border-border bg-card p-3">
      <div className="space-y-2">
        <Label htmlFor="custom-add-label" className="text-xs">
          Label
        </Label>
        <Input
          id="custom-add-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="My custom check"
          aria-invalid={!!labelError}
          className={labelError ? "border-destructive" : undefined}
        />
        {labelError && <p className="text-xs text-destructive">{labelError}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="custom-add-desc" className="text-xs">
          Description (helps the AI know what to look for)
        </Label>
        <Input
          id="custom-add-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What should this check look for?"
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Checkbox
          checked={recommended}
          onCheckedChange={(v) => setRecommended(v === true)}
        />
        Enable by default
      </label>
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={cancel}
          aria-label="Cancel adding custom scope"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          Cancel
        </Button>
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={save}
          disabled={!canSave}
          aria-label="Add custom scope"
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          Add
        </Button>
      </div>
    </div>
  );
}
