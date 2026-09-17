// Inline rename dialog — single Input field, validates with projectNameSchema,
// persists via useUpdateProject. Mirrors the visual structure of
// CreateProjectModal but with a much smaller surface (no features list).

import { useEffect, useState } from "react";
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
import { projectNameSchema } from "@/lib/validation";
import { useToast } from "@/hooks/useToast";
import { useUpdateProject } from "@/lib/blocks/hooks";
import { useT } from "@/lib/blocks/i18n";

interface RenameProjectModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  currentName: string;
  // Echoed into the update payload because the cloud Project schema marks
  // `status` as `requiredOn: 3` (required on every update). The rename
  // mutation must resend the current value or the cloud rejects the
  // partial PATCH as "missing required field". The UI Project type
  // declares `status` as optional, so callers without it fall back to
  // "active" (which `useCreateProject` also defaults to — see
  // hooks.ts:678).
  currentStatus?: import("@/lib/blocks/data").Project["status"];
}

export function RenameProjectModal({
  open,
  onClose,
  projectId,
  currentName,
  currentStatus,
}: RenameProjectModalProps) {
  const updateProject = useUpdateProject();
  const toast = useToast();
  const t = useT();

  const [name, setName] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset the input every time the dialog re-opens so the user always sees
  // the latest server name, never a stale edit from a previous session.
  useEffect(() => {
    if (open) {
      setName(currentName);
      setError(null);
      setSubmitting(false);
    }
  }, [open, currentName]);

  const handleOpenChange = (next: boolean) => {
    if (next) return;
    if (submitting) return;
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = projectNameSchema.safeParse(name);
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "Invalid name");
      return;
    }
    const trimmed = name.trim();
    if (trimmed === currentName) {
      // No-op rename — just close.
      onClose();
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const updated = await updateProject.mutateAsync({
        id: projectId,
        // Echo `status` because the cloud Project schema marks it as
        // required on every update. Without this the rename fails with
        // "Field 'status' is required". `useCreateProject` defaults
        // status to "active" — same fallback here.
        patch: { name: trimmed, status: currentStatus ?? "active" },
      });
      toast.success(
        t("toast.projectRenamed", 'Project renamed to "{name}".', {
          name: updated.name,
        }),
      );
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("projectCard.renameError", "Could not rename project."),
      );
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="md">
        <DialogCloseButton />
        <DialogHeader>
          <DialogTitle>
            {t("projectCard.renameTitle", "Rename Project")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "projectCard.renameDescription",
              "Update the project name.",
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form
            id="rename-project-form"
            onSubmit={handleSubmit}
            noValidate
            className="space-y-2"
          >
            <Input
              label={t("createProject.nameLabel", "Project Name")}
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              error={error ?? undefined}
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
            form="rename-project-form"
            loading={submitting}
          >
            {t("save", "Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
