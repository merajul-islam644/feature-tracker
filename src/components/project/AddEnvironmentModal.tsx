// Modal for adding a per-project environment. Opened from the
// `Add Environment` button on `/projects`. The modal collects a target
// project, an env slug (URL path segment), a display label, and a
// color, then dispatches `useCreateEnvironment`, which inserts a
// `blx_Environments` row and seeds its verification checks. The env
// appears as a new chip on only that project's card — not on any other
// project — per the per-project opt-in design.
//
// There is no Kind picker (user asked, 2026-10-02: drop the dropdown) —
// the kind is INFERRED from the slug: a canonical slug (dev/stg/prod/
// uat) names its own kind, anything else is custom. Kind still matters
// beyond the badge: only `kind: "dev"` envs surface the Add Feature CTA
// (`isDevEnv` in FeaturesPage / ProjectDetailPage), so slug "dev" is
// the one way a workspace gets a feature-authoring env. Typing a
// canonical slug pre-fills the display label with the kind's FULL form
// ("Development", …) — env page headers render the row label verbatim,
// so canonical rows must carry the long name (the card chips derive
// their short form from the kind). The reserved-slug rule bends to let
// `slug === kind` through (see `validateEnvSlug`).
//
// Validation runs locally (slug format + reserved + duplicate within the
// target project's current env rows); the mutation re-checks uniqueness
// against a fresh server list before the insert, so a stale local list
// can't produce a duplicate slug.

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogBody,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ColorPicker } from "@/components/ui/color-picker";
import {
  useCreateEnvironment,
  useEnvironments,
  useProjects,
} from "@/lib/blocks/hooks";
import { useToast } from "@/hooks/useToast";
import { useT } from "@/lib/blocks/i18n";
import { CANONICAL_ENV_SLUGS, validateEnvSlug } from "@/lib/validation";
import type { EnvironmentKind } from "@/lib/blocks/data";
import { envChipStyle } from "@/components/ui/color-picker";
// Event-time reads only (inside the kind handler) — this modal sits in an
// established import cycle with ProjectDetailPage, and touching its module
// constants at module-eval time would hit the TDZ.
import {
  PROJECT_ENV_META,
  type CanonicalEnvSlug,
} from "@/pages/ProjectDetailPage";

interface AddEnvironmentModalProps {
  open: boolean;
  onClose: () => void;
}

export function AddEnvironmentModal({
  open,
  onClose,
}: AddEnvironmentModalProps) {
  const projectsQuery = useProjects();
  const addEnv = useCreateEnvironment();
  const toast = useToast();
  const t = useT();

  const [projectId, setProjectId] = useState("");
  const [slug, setSlug] = useState("");
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("#0ea5e9");
  const [errors, setErrors] = useState<{
    projectId?: string;
    slug?: string;
    label?: string;
  }>({});
  const [submitting, setSubmitting] = useState(false);

  // Kind is inferred, not picked: canonical slug → that kind, anything
  // else is custom. The cast is safe — a canonical slug IS an
  // EnvironmentKind by definition.
  const trimmedSlug = slug.trim().toLowerCase();
  const kind: EnvironmentKind = (
    CANONICAL_ENV_SLUGS as readonly string[]
  ).includes(trimmedSlug)
    ? (trimmedSlug as EnvironmentKind)
    : "custom";

  // The target project's env rows power duplicate detection. Canonical
  // slugs are rows too under v2.1, so the row list alone covers the
  // reserved set — no need to union a hardcoded list into the check.
  const envRowsQuery = useEnvironments(projectId || null);

  const existingSlugs = useMemo<string[]>(() => {
    return (envRowsQuery.data ?? []).map((e) => e.slug);
  }, [envRowsQuery.data]);

  const projects = projectsQuery.data ?? [];

  const reset = () => {
    setProjectId("");
    setSlug("");
    setLabel("");
    setColor("#0ea5e9");
    setErrors({});
    setSubmitting(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (next) return;
    if (submitting) return;
    reset();
    onClose();
  };

  const validate = (): boolean => {
    const next: typeof errors = {};

    if (!projectId) {
      next.projectId = t(
        "addEnvironment.projectRequired",
        "Please select a project",
      );
    }

    if (!label.trim()) {
      next.label = t("addEnvironment.labelRequired", "Label is required");
    }

    // Canonical slugs stay reserved EXCEPT when the slug names the chosen
    // kind — creating a dev-kind env with slug "dev" is the whole point.
    const slugError = validateEnvSlug(slug, existingSlugs, kind);
    if (slugError) {
      // Surface reserved-slug error with the cleaner key reserved message
      // so the runtime can show a localised message instead of the raw
      // helper return string.
      const trimmed = slug.trim().toLowerCase();
      if (
        !slug.trim() &&
        slugError !== "Slug is required" &&
        slugError !== "Use lowercase letters, digits, and dashes (max 32 chars)"
      ) {
        next.slug = t(
          "addEnvironment.nameRequired",
          "Slug is required",
        );
      } else if (
        (CANONICAL_ENV_SLUGS as readonly string[]).includes(trimmed)
      ) {
        next.slug = t("addEnvironment.nameReserved", "{slug} is reserved. Choose a different slug.", {
          slug: trimmed,
        });
      } else {
        next.slug = slugError;
      }
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    try {
      const env = {
        slug: slug.trim().toLowerCase(),
        label: label.trim(),
        color,
      };
      await addEnv.mutateAsync({
        projectId,
        slug: env.slug,
        label: env.label,
        color: env.color,
        kind,
      });
      const projectName =
        projects.find((p) => p.id === projectId)?.name ?? projectId;
      toast.success(
        t(
          "addEnvironment.created",
          'Environment "{label}" added to {project}.',
          { label: env.label, project: projectName },
        ),
      );
      reset();
      onClose();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t("addEnvironment.error", "Could not add environment.");
      toast.error(message);
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>
            {t("addEnvironment.title", "Add Environment")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "addEnvironment.description",
              "Add a new environment to a project. Custom environments only appear on the project you select.",
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form
            id="add-environment-form"
            onSubmit={handleSubmit}
            className="space-y-5"
            noValidate
          >
            <div className="space-y-2">
              <Label htmlFor="add-env-project">
                {t("addEnvironment.projectLabel", "Project")}
              </Label>
              <select
                id="add-env-project"
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  if (errors.projectId) {
                    setErrors((prev) => {
                      const { projectId: _drop, ...rest } = prev;
                      return rest;
                    });
                  }
                }}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-invalid={Boolean(errors.projectId) || undefined}
                aria-describedby={
                  errors.projectId ? "add-env-project-error" : undefined
                }
              >
                <option value="">
                  {t(
                    "addEnvironment.projectPlaceholder",
                    "Select a project",
                  )}
                </option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {errors.projectId && (
                <p
                  id="add-env-project-error"
                  className="text-xs text-red-600"
                >
                  {errors.projectId}
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Input
                  label={t("addEnvironment.nameLabel", "Env slug")}
                  required
                  placeholder={t(
                    "addEnvironment.namePlaceholder",
                    "e.g. qa",
                  )}
                  hint={t(
                    "addEnvironment.nameHelp",
                    "Lowercase letters, digits, and dashes. Used in the URL.",
                  )}
                  value={slug}
                  onChange={(e) => {
                    setSlug(e.target.value);
                    // Canonical slug → pre-fill the display label with the
                    // kind's FULL form ("Development", …). Fills an empty
                    // label or a previous auto-fill (any canonical label),
                    // never a hand-typed one. PROJECT_ENV_META is read
                    // here — event time — not at module eval (TDZ note on
                    // the import above).
                    const nextSlug = e.target.value.trim().toLowerCase();
                    if (
                      (CANONICAL_ENV_SLUGS as readonly string[]).includes(
                        nextSlug,
                      )
                    ) {
                      const fullLabel =
                        PROJECT_ENV_META[nextSlug as CanonicalEnvSlug]?.label;
                      const canonicalLabels = Object.values(
                        PROJECT_ENV_META,
                      ).map((m) => m.label);
                      if (
                        fullLabel &&
                        (!label.trim() ||
                          canonicalLabels.includes(label.trim()))
                      ) {
                        setLabel(fullLabel);
                      }
                    }
                    if (errors.slug) {
                      setErrors((prev) => {
                        const { slug: _drop, ...rest } = prev;
                        return rest;
                      });
                    }
                  }}
                  error={errors.slug ?? undefined}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={32}
                />
                {projectId && slug.trim() && !errors.slug && (
                  <p className="text-xs text-muted-foreground">
                    Path: <code>/projects/{projectId}/{slug.trim().toLowerCase()}</code>
                  </p>
                )}
                {/* Kind now rides on the slug (no picker) — surface what the
                    slug implies, most importantly that "dev" unlocks feature
                    authoring. Hidden for custom slugs: nothing to announce. */}
                {slug.trim() && kind !== "custom" && (
                  <p className="text-xs text-muted-foreground">
                    {kind === "dev"
                      ? t(
                          "addEnvironment.kindDevHelp",
                          "Feature authoring happens on dev envs.",
                        )
                      : t(
                          "addEnvironment.kindCanonicalHelp",
                          "Reserved slug — badge follows it.",
                        )}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Input
                  label={t("addEnvironment.labelLabel", "Display label")}
                  required
                  placeholder={t(
                    "addEnvironment.labelPlaceholder",
                    "e.g. Quality Assurance",
                  )}
                  value={label}
                  onChange={(e) => {
                    setLabel(e.target.value);
                    if (errors.label) {
                      setErrors((prev) => {
                        const { label: _drop, ...rest } = prev;
                        return rest;
                      });
                    }
                  }}
                  error={errors.label ?? undefined}
                  maxLength={100}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t("addEnvironment.colorLabel", "Color")}</Label>
              <ColorPicker value={color} onChange={setColor} />
              <div className="flex items-center gap-2 pt-1">
                <span
                  aria-hidden="true"
                  className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
                  style={envChipStyle(color)}
                >
                  {label.trim() || slug.trim().toLowerCase() || "env"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {color}
                </span>
              </div>
            </div>
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
            form="add-environment-form"
            loading={submitting}
          >
            {submitting
              ? t("addEnvironment.creating", "Adding…")
              : t("addEnvironment.cta", "Add Environment")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
