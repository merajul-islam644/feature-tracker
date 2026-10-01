// Confirm-then-delete dialog for projects. Built directly from the Dialog
// primitives — there's no shared confirm-dialog component in this repo.

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
import { useToast } from "@/hooks/useToast";
import { useDeleteProject } from "@/lib/blocks/hooks";
import { useT } from "@/lib/blocks/i18n";
import type { Project } from "@/lib/blocks/data";

interface DeleteProjectDialogProps {
  open: boolean;
  onClose: () => void;
  project: Project;
}

export function DeleteProjectDialog({
  open,
  onClose,
  project,
}: DeleteProjectDialogProps) {
  const deleteProject = useDeleteProject();
  const toast = useToast();
  const t = useT();
  const [submitting, setSubmitting] = useState(false);

  // Reset the spinner state when re-opened, so a stale "deleting" never
  // blocks a fresh attempt after a previous failure.
  useEffect(() => {
    if (open) setSubmitting(false);
  }, [open]);

  const handleOpenChange = (next: boolean) => {
    if (next) return;
    if (submitting) return;
    onClose();
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await deleteProject.mutateAsync(project.id);
      toast.success(
        t("toast.projectDeleted", 'Project "{name}" deleted.', {
          name: project.name,
        }),
      );
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("projectCard.deleteError", "Could not delete project."),
      );
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="sm">
        <DialogCloseButton />
        <DialogHeader>
          <DialogTitle>
            {t("projectCard.deleteTitle", "Delete project?")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "projectCard.deleteDescription",
              "This will permanently remove the project. This action cannot be undone.",
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm font-medium text-foreground">
            {project.name}
          </p>
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
            variant="destructive"
            onClick={handleConfirm}
            loading={submitting}
          >
            {t("projectCard.deleteConfirm", "Delete project")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
