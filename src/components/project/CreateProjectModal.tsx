import { useState } from "react";
import { Plus, X } from "lucide-react";
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
import { projectNameSchema, validateFeatureName } from "@/lib/validation";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/useToast";
import { useCreateFeature, useCreateProject } from "@/lib/blocks/hooks";
import { useT } from "@/lib/blocks/i18n";
import { PROJECT_ENVS } from "@/pages/ProjectDetailPage";

interface CreateProjectModalProps {
  open: boolean;
  onClose: () => void;
}

interface FeatureInputRow {
  id: number;
  value: string;
  error: string | null;
}

export function CreateProjectModal({ open, onClose }: CreateProjectModalProps) {
  const createProject = useCreateProject();
  const createFeature = useCreateFeature();
  const { currentUser } = useAuth();
  const toast = useToast();
  const t = useT();

  const [projectName, setProjectName] = useState("");
  const [projectError, setProjectError] = useState<string | null>(null);
  const [features, setFeatures] = useState<FeatureInputRow[]>([
    { id: 1, value: "", error: null },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [nextId, setNextId] = useState(2);

  const reset = () => {
    setProjectName("");
    setProjectError(null);
    setFeatures([{ id: 1, value: "", error: null }]);
    setNextId(2);
    setSubmitting(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (next) return;
    if (submitting) return;
    reset();
    onClose();
  };

  const handleAddFeature = () => {
    setFeatures((rows) => [...rows, { id: nextId, value: "", error: null }]);
    setNextId((n) => n + 1);
  };

  const handleRemoveFeature = (id: number) => {
    setFeatures((rows) =>
      rows.length > 1 ? rows.filter((r) => r.id !== id) : rows
    );
  };

  const handleFeatureChange = (id: number, value: string) => {
    setFeatures((rows) =>
      rows.map((r) => (r.id === id ? { ...r, value, error: null } : r))
    );
  };

  const validateAll = (): boolean => {
    const result = projectNameSchema.safeParse(projectName);
    if (!result.success) {
      setProjectError(result.error.issues[0]?.message ?? "Invalid name");
      return false;
    }
    setProjectError(null);

    let valid = true;
    // Build the "other rows" list once, keyed by row id, so each row is
    // checked against every OTHER row's value (not against itself). The
    // earlier version passed the full trimmedValues array straight to
    // `validateFeatureName`, which meant every non-empty row matched its
    // own value and spuriously reported "Duplicate feature name" — and
    // because the row's error was set at the same moment, the user saw
    // the error AND the submission was blocked. Now each row sees only
    // the values from the other rows, so a single non-empty row stays
    // valid and only true cross-row duplicates fail validation.
    const otherValuesByRow = new Map<number, string[]>();
    features.forEach((r) => {
      otherValuesByRow.set(
        r.id,
        features
          .filter((other) => other.id !== r.id)
          .map((other) => other.value.trim()),
      );
    });

    setFeatures((rows) =>
      rows.map((row) => {
        const error = validateFeatureName(
          row.value,
          otherValuesByRow.get(row.id) ?? [],
        );
        if (error) valid = false;
        return { ...row, error };
      })
    );

    return valid;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateAll() || !currentUser) return;

    setSubmitting(true);

    try {
      const project = await createProject.mutateAsync({
        name: projectName.trim(),
        status: "active",
      });

      const featureNames = features
        .map((r) => r.value.trim())
        .filter((n) => n.length > 0);
      const seen = new Set<string>();
      const uniqueNames = featureNames.filter((n) => {
        const key = n.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      for (const name of uniqueNames) {
        await createFeature.mutateAsync({
          projectId: project.id,
          name,
          // Stamp initial features with the project's default env
          // (canonical "dev"). `EnvironmentChips` routes to
          // `/projects/:id/<slug>` and dev is the first chip, so this is
          // the env users land on after creating a project — features
          // authored without an envSlug would be filtered out by
          // `useProjectFeatures(projectId, "dev")` and silently vanish
          // from that view. Features added later via the dev page keep
          // using the same path (the page passes envSlug through), so
          // the initial set and the follow-up set end up on the same
          // env and behave identically on env-scoped reads.
          envSlug: PROJECT_ENVS[0],
        });
      }

      toast.success(
        t("toast.projectCreated", 'Project "{name}" created successfully.', {
          name: project.name,
        }),
      );
      reset();
      onClose();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t("createProject.createError", "Could not create project.");
      toast.error(message);
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>
            {t("createProject.title", "Create Project")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "createProject.description",
              "Add a project name and optional initial features.",
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form
            id="create-project-form"
            onSubmit={handleSubmit}
            className="space-y-5"
            noValidate
          >
            <Input
              label={t("createProject.nameLabel", "Project Name")}
              required
              placeholder={t(
                "createProject.namePlaceholder",
                "e.g. Marketing Website",
              )}
              value={projectName}
              onChange={(e) => {
                setProjectName(e.target.value);
                if (projectError) setProjectError(null);
              }}
              error={projectError ?? undefined}
              autoFocus
              maxLength={100}
            />

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>
                  {t("createProject.featuresLabel", "Features")}
                </Label>
                <span className="text-xs text-muted-foreground">
                  {t("createProject.featuresOptional", "Optional")}
                </span>
              </div>
              <div className="space-y-2">
                {features.map((row) => (
                  <div key={row.id} className="flex items-start gap-2">
                    <div className="flex-1">
                      <Input
                        placeholder={t(
                          "createProject.featureNamePlaceholder",
                          "Feature name",
                        )}
                        value={row.value}
                        onChange={(e) =>
                          handleFeatureChange(row.id, e.target.value)
                        }
                        error={row.error ?? undefined}
                        maxLength={100}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveFeature(row.id)}
                      disabled={features.length === 1}
                      aria-label={t(
                        "createProject.removeFeature",
                        "Remove feature input",
                      )}
                      className="mt-1.5 rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={handleAddFeature}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                {t("createProject.addFeature", "Add Feature")}
              </button>
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
            form="create-project-form"
            loading={submitting}
          >
            {submitting
              ? t("createProject.creating", "Creating…")
              : t("create", "Create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}