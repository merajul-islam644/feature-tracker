// Modal for adding a per-project custom environment. Opened from the
// `Add Environment` button on `/projects`. The modal collects a target
// project, an env slug (URL path segment), a display label, and a color,
// then dispatches `useAddProjectEnv`. The env appears as a new chip on
// only that project's card — not on any other project — per the
// per-project opt-in design.
//
// Validation runs locally (slug format + reserved + duplicate within the
// target project's current env list); on server success the project query
// cache is invalidated by `useUpdateProject` inside the mutation, so the
// card refreshes without an explicit refetch.

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
import { useAddProjectEnv, useProjects, useProject } from "@/lib/blocks/hooks";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/useToast";
import { useT } from "@/lib/blocks/i18n";
import { CANONICAL_ENV_SLUGS, validateEnvSlug } from "@/lib/validation";
import { envChipStyle } from "@/components/ui/color-picker";

interface AddEnvironmentModalProps {
  open: boolean;
  onClose: () => void;
}

export function AddEnvironmentModal({
  open,
  onClose,
}: AddEnvironmentModalProps) {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  const projectsQuery = useProjects();
  const addEnv = useAddProjectEnv();
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

  // The target project is needed both to populate the existing-env list
  // (for duplicate validation) and to show in the success toast. We look
  // it up by id; since the user picked it from the dropdown, it will
  // always resolve to a Project.
  const targetProjectId = projectId;
  const targetProjectQuery = useProject(targetProjectId || undefined);
  const targetProject = targetProjectQuery.data;

  const existingSlugs = useMemo<string[]>(() => {
    const fromCustom = targetProject?.customEnvs?.map((e) => e.slug) ?? [];
    return [...CANONICAL_ENV_SLUGS, ...fromCustom];
  }, [targetProject]);

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

    const slugError = validateEnvSlug(slug, existingSlugs);
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
      await addEnv.mutateAsync({ projectId, env });
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
                {targetProject && slug.trim() && !errors.slug && (
                  <p className="text-xs text-muted-foreground">
                    Path: <code>/projects/{targetProject.id}/{slug.trim().toLowerCase()}</code>
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
