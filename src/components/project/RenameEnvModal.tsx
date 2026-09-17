// Inline rename dialog for a project env — two Input fields (label + slug),
// validates the label with nameSchema and the slug with validateEnvSlug,
// persists via useRenameProjectEnv.
//
// The pencil trigger that opens this lives in the `/projects/:id/:envSlug`
// page header next to the env Badge; see ProjectDetailPage.tsx.
//
// The slug input is disabled for canonical envs (dev/stg/prod/uat) with a
// helper hint explaining why. The "rename to itself" short-circuit from
// RenameProjectModal applies here too: if both label and slug are unchanged
// the modal just closes without a network round-trip.

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/useToast";
import { useRenameProjectEnv } from "@/lib/blocks/hooks";
import { useT } from "@/lib/blocks/i18n";
import { nameSchema, validateEnvSlug } from "@/lib/validation";
import type { Project } from "@/lib/blocks/data";

interface RenameEnvModalProps {
  open: boolean;
  onClose: () => void;
  project: Project;
  // The slug the user is currently viewing. For canonical envs this is
  // "dev" / "stg" / "prod" / "uat"; for custom envs it's whatever they
  // picked at creation. The modal identifies which env to rename from
  // this slug + `project.customEnvs` lookup.
  envSlug: string;
  // True for user-added envs (slug editable), false for canonical envs
  // (slug locked). Mirrors `ResolvedEnvMeta.isCustom`.
  isCustom: boolean;
  // The current display label. Pre-filled on open. For canonical envs
  // this is the per-project override (if any) or the i18n label; for
  // custom envs it's the raw label stored in `customEnvs`.
  currentLabel: string;
  // Fires after a successful rename. The page uses this to navigate to
  // the new slug when the slug changed — the modal can't do that itself
  // because it doesn't own the router. Fires once per submit; the
  // mutation hook has already invalidated the affected queries by the
  // time this is called.
  onRenamed?: (result: { newSlug: string; oldSlug?: string }) => void;
}

export function RenameEnvModal({
  open,
  onClose,
  project,
  envSlug,
  isCustom,
  currentLabel,
  onRenamed,
}: RenameEnvModalProps) {
  const renameEnv = useRenameProjectEnv();
  const toast = useToast();
  const t = useT();

  const [label, setLabel] = useState(currentLabel);
  const [slug, setSlug] = useState(envSlug);
  const [labelError, setLabelError] = useState<string | null>(null);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset the inputs every time the dialog re-opens so the user always
  // sees the latest server values, never a stale edit from a previous
  // session. Same pattern as RenameProjectModal / RenameFeatureModal.
  useEffect(() => {
    if (open) {
      setLabel(currentLabel);
      setSlug(envSlug);
      setLabelError(null);
      setSlugError(null);
      setSubmitting(false);
    }
  }, [open, currentLabel, envSlug]);

  // Existing slugs for duplicate detection. The env being renamed is
  // excluded — passing it would produce a self-match on every keystroke
  // once the user has typed the current slug. Same exclusion rule as
  // validateFeatureName's helper for create-project forms.
  const existingSlugs = useMemo<string[]>(() => {
    const fromCustom =
      project.customEnvs?.map((e) => e.slug).filter((s) => s !== envSlug) ??
      [];
    // Canonical slugs are always present on every project, so they're
    // always "existing" for duplicate-detection purposes. The env being
    // renamed is a canonical slug itself when isCustom=false; in that
    // case the slug input is disabled and the user can't change it, so
    // the excluded-slug rule only really applies for custom renames.
    return [...fromCustom];
  }, [project, envSlug]);

  const handleOpenChange = (next: boolean) => {
    if (next) return;
    if (submitting) return;
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedLabel = label.trim();
    const trimmedSlug = slug.trim().toLowerCase();

    // Validate label.
    const labelResult = nameSchema.safeParse(trimmedLabel);
    if (!labelResult.success) {
      setLabelError(labelResult.error.issues[0]?.message ?? "Invalid name");
      return;
    }

    // Validate slug only when the user can change it (custom envs).
    // Canonical slugs are locked — we ignore whatever the disabled
    // input contains and pass the original `envSlug` to the mutation.
    let finalSlug = envSlug;
    if (isCustom) {
      const slugErr = validateEnvSlug(trimmedSlug, existingSlugs);
      if (slugErr) {
        setSlugError(slugErr);
        return;
      }
      finalSlug = trimmedSlug;
    }

    // No-op: label and slug both unchanged. Short-circuit to match the
    // other rename modals — no network round-trip when there's nothing
    // to save.
    const slugUnchanged = finalSlug === envSlug;
    const labelUnchanged = trimmedLabel === currentLabel;
    if (slugUnchanged && labelUnchanged) {
      onClose();
      return;
    }

    setLabelError(null);
    setSlugError(null);
    setSubmitting(true);
    try {
      const result = await renameEnv.mutateAsync({
        projectId: project.id,
        envSlug,
        isCustom,
        newLabel: trimmedLabel,
        ...(isCustom ? { newSlug: finalSlug } : {}),
      });
      if (result.oldSlug && result.oldSlug !== result.newSlug) {
        toast.success(
          t("toast.envSlugChanged", 'Environment moved to "{slug}".', {
            slug: result.newSlug,
          }),
        );
      } else {
        toast.success(
          t("toast.envRenamed", 'Environment renamed to "{label}".', {
            label: result.project.customEnvs?.find(
              (e) => e.slug === result.newSlug,
            )?.label ?? trimmedLabel,
          }),
        );
      }
      onRenamed?.({ newSlug: result.newSlug, oldSlug: result.oldSlug });
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("env.renameError", "Could not rename environment."),
      );
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="md">
        <DialogCloseButton />
        <DialogHeader>
          <DialogTitle>{t("env.renameTitle", "Rename Environment")}</DialogTitle>
          <DialogDescription>
            {t(
              "env.renameDescription",
              "Update the display label and URL slug.",
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form
            id="rename-env-form"
            onSubmit={handleSubmit}
            noValidate
            className="space-y-4"
          >
            <Input
              label={t("env.labelLabel", "Display label")}
              required
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                if (labelError) setLabelError(null);
              }}
              error={labelError ?? undefined}
              autoFocus
              maxLength={100}
            />
            <Input
              label={t("env.slugLabel", "URL slug")}
              required
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                if (slugError) setSlugError(null);
              }}
              error={slugError ?? undefined}
              hint={
                isCustom
                  ? t(
                      "env.slugHelp",
                      "Lowercase letters, digits, and dashes. Used in the URL.",
                    )
                  : t(
                      "env.slugLocked",
                      "Canonical env slugs (dev, stg, prod, uat) cannot be changed.",
                    )
              }
              disabled={!isCustom}
              readOnly={!isCustom}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={32}
            />
          </form>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
          >
            {t("cancel", "Cancel")}
          </Button>
          <Button
            type="submit"
            form="rename-env-form"
            loading={submitting}
          >
            {t("save", "Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
