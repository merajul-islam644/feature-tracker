import { useState } from "react";
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
import { projectNameSchema } from "@/lib/validation";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/useToast";
import { useCreateProject } from "@/lib/blocks/hooks";
import { useT } from "@/lib/blocks/i18n";

interface CreateProjectModalProps {
  open: boolean;
  onClose: () => void;
}

// Project creation is project-row-only (user directive 2026-10-01): no
// default environments are seeded and no initial features are offered —
// features are env-scoped rows (schema v2.1) and there is no env to
// stamp them onto at create time. The manager adds environments via the
// Add Environment modal, then authors features inside an env page. The
// old initial-features loop (sequential `useCreateFeature` calls) and
// the awaited env/check seed inside `useCreateProject` were what kept
// this modal open for many seconds after the project itself had landed.

export function CreateProjectModal({ open, onClose }: CreateProjectModalProps) {
  const createProject = useCreateProject();
  const { currentUser } = useAuth();
  const toast = useToast();
  const t = useT();

  const [projectName, setProjectName] = useState("");
  const [projectError, setProjectError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setProjectName("");
    setProjectError(null);
    setSubmitting(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (next) return;
    if (submitting) return;
    reset();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    const result = projectNameSchema.safeParse(projectName);
    if (!result.success) {
      setProjectError(result.error.issues[0]?.message ?? "Invalid name");
      return;
    }
    setProjectError(null);
    setSubmitting(true);

    try {
      const project = await createProject.mutateAsync({
        name: projectName.trim(),
        status: "active",
      });

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
            {t("createProject.description", "Add a project name.")}
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
