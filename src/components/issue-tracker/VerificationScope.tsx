// Verification Scope card (spec section 11) — pick which checks run during
// verification. Recommended checks are pre-selected; users can opt in/out.
// The device picker sizes the run's browser context (viewport + touch) so
// responsive layouts actually get exercised differently per preset.
//
// Under schema v2.1 the selection is PER-ENVIRONMENT and lives in the
// cloud: the card renders `blx_VerificationChecks` rows (the env's check
// set — built-ins plus the user's custom ones), and every toggle writes
// the row's `enabled` flag through the parent's mutation. Custom checks
// are rows too (source "custom") with inline add / edit / delete — no
// more localStorage catalog, so the list follows the user across devices.
//
// `readOnly` is the non-tester hard gate: QA state, so manager/developer
// see the matrix but can't flip it (the mutations throw for them too —
// defense in depth).

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
import type { EnvVerificationCheck } from "@/lib/blocks/data";

export type VerificationDevice = "desktop" | "mobile" | "tablet";

const DEVICE_OPTIONS: { value: VerificationDevice; label: string }[] = [
  { value: "desktop", label: "Desktop · 1280×800" },
  { value: "mobile", label: "Mobile · 390×844 (touch)" },
  { value: "tablet", label: "Tablet · 820×1180 (touch)" },
];

export interface CustomCheckPatch {
  label?: string;
  description?: string;
  recommended?: boolean;
}

interface Props {
  /** The environment's check rows, built-ins first (the hook sorts). */
  checks: EnvVerificationCheck[];
  /** Non-tester gate — render the matrix read-only. */
  readOnly?: boolean;
  /** Flip a row's enabled flag. The id is the row's checkId. */
  onToggle: (checkId: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
  device: VerificationDevice;
  onDeviceChange: (device: VerificationDevice) => void;
  onAddCustom: (input: {
    label: string;
    description: string;
    recommended: boolean;
  }) => void;
  onUpdateCustom: (row: EnvVerificationCheck, patch: CustomCheckPatch) => void;
  onDeleteCustom: (row: EnvVerificationCheck) => void;
}

export function VerificationScope({
  checks,
  readOnly = false,
  onToggle,
  onSelectAll,
  onClear,
  device,
  onDeviceChange,
  onAddCustom,
  onUpdateCustom,
  onDeleteCustom,
}: Props) {
  const builtinRecommended = checks.filter(
    (c) => c.source === "builtin" && c.recommended,
  );
  const builtinOptional = checks.filter(
    (c) => c.source === "builtin" && !c.recommended,
  );
  const customRows = checks.filter((c) => c.source === "custom");

  const selected = new Set(
    checks.filter((c) => c.enabled).map((c) => c.checkId),
  );
  const allCount = checks.length;
  const selectedCount = selected.size;

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
            disabled={readOnly || selectedCount === allCount}
          >
            Select all
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClear}
            disabled={readOnly || selectedCount === 0}
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
          checks={builtinRecommended}
          selected={selected}
          readOnly={readOnly}
          onToggle={onToggle}
        />
        <ScopeGroup
          title="Optional"
          description="Pick additional checks for this run."
          checks={builtinOptional}
          selected={selected}
          readOnly={readOnly}
          onToggle={onToggle}
        />
        <CustomScopeGroup
          rows={customRows}
          selected={selected}
          readOnly={readOnly}
          onToggle={onToggle}
          onAddCustom={onAddCustom}
          onUpdateCustom={onUpdateCustom}
          onDeleteCustom={onDeleteCustom}
        />
        {readOnly && (
          <p className="text-xs text-muted-foreground">
            Only testers can change the verification scope for an
            environment — the matrix above reflects the tester's setup.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

interface GroupProps {
  title: string;
  description: string;
  checks: EnvVerificationCheck[];
  selected: Set<string>;
  readOnly: boolean;
  onToggle: (id: string) => void;
}

function ScopeGroup({
  title,
  description,
  checks,
  selected,
  readOnly,
  onToggle,
}: GroupProps) {
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
          const isOn = selected.has(c.checkId);
          return (
            <li
              key={c.id}
              className="flex items-start gap-3 rounded-md border border-border bg-card p-3"
            >
              <Checkbox
                id={`scope-${c.id}`}
                checked={isOn}
                onCheckedChange={() => onToggle(c.checkId)}
                disabled={readOnly}
                className="mt-0.5"
              />
              <Label
                htmlFor={`scope-${c.id}`}
                className={
                  readOnly
                    ? "flex-1 cursor-default opacity-80"
                    : "flex-1 cursor-pointer"
                }
              >
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
//  (pencil + trash) so the user can manage the env's custom catalog
//  without leaving the page. The add row lives at the bottom; clicking
//  "+ Add custom scope" expands an inline form (label + description +
//  recommended toggle) that commits on Save — the new row is created
//  enabled, so it starts running with the next verification.
// ────────────────────────────────────────────────────────────────────────────

interface CustomGroupProps {
  rows: EnvVerificationCheck[];
  selected: Set<string>;
  readOnly: boolean;
  onToggle: (id: string) => void;
  onAddCustom: Props["onAddCustom"];
  onUpdateCustom: Props["onUpdateCustom"];
  onDeleteCustom: Props["onDeleteCustom"];
}

function CustomScopeGroup({
  rows,
  selected,
  readOnly,
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
        <Badge variant="muted">{rows.length}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Your own checks for this environment. The AI uses the label and
        description as guidance when running — there's no fixed behaviour
        for them.
      </p>
      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((c) => (
            <CustomScopeRow
              key={c.id}
              check={c}
              isOn={selected.has(c.checkId)}
              readOnly={readOnly}
              onToggle={onToggle}
              onUpdate={onUpdateCustom}
              onDelete={onDeleteCustom}
            />
          ))}
        </ul>
      )}
      {!readOnly && <AddCustomScopeForm onAdd={onAddCustom} />}
    </div>
  );
}

interface RowProps {
  check: EnvVerificationCheck;
  isOn: boolean;
  readOnly: boolean;
  onToggle: (id: string) => void;
  onUpdate: CustomGroupProps["onUpdateCustom"];
  onDelete: CustomGroupProps["onDeleteCustom"];
}

function CustomScopeRow({
  check,
  isOn,
  readOnly,
  onToggle,
  onUpdate,
  onDelete,
}: RowProps) {
  // One row in edit mode at a time. We deliberately don't lift this
  // state up — only the row's own inputs need to know.
  const [editing, setEditing] = useState(false);
  const [draftLabel, setDraftLabel] = useState(check.label);
  const [draftDescription, setDraftDescription] = useState(check.description);
  const [draftRecommended, setDraftRecommended] = useState(check.recommended);

  // Re-sync the local form when the underlying row changes from
  // elsewhere (mutation invalidation, another tab). Same pattern as
  // SecretCard's edit form.
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
    onUpdate(check, {
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
          Recommended
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
        onCheckedChange={() => onToggle(check.checkId)}
        disabled={readOnly}
        className="mt-0.5"
      />
      <Label
        htmlFor={`scope-${check.id}`}
        className={
          readOnly
            ? "flex-1 cursor-default opacity-80"
            : "flex-1 cursor-pointer"
        }
      >
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
      {!readOnly && (
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
            onClick={() => onDelete(check)}
            aria-label={`Delete ${check.label}`}
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      )}
    </li>
  );
}

interface AddFormProps {
  onAdd: Props["onAddCustom"];
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
        Recommended
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
