// Confirm-then-delete dialog for an environment. Mirrors
// DeleteProjectDialog (built straight from the Dialog primitives — there's
// no shared confirm-dialog component in this repo), but names the blast
// radius: the env's features, flows, targets, secrets, bindings, issues,
// and verification checks all die with the row (see
// `useDeleteEnvironment`'s child-first cascade).
//
// The caller handles post-delete navigation — the dialog neither knows nor
// owns the router.

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
import { useDeleteEnvironment } from "@/lib/blocks/hooks";
import { useT } from "@/lib/blocks/i18n";

interface DeleteEnvDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** The Environment row's ItemId — the delete target. */
  environmentId: string;
  /** Display label, verbatim from the row — shown in the copy + toast. */
  label: string;
  /** Fires after a successful delete, before the dialog closes — the
   *  env page that hosted the deleted env navigates away here. */
  onDeleted?: () => void;
}

export function DeleteEnvDialog({
  open,
  onClose,
  projectId,
  environmentId,
  label,
  onDeleted,
}: DeleteEnvDialogProps) {
  const deleteEnv = useDeleteEnvironment();
  const toast = useToast();
  const t = useT();
  const [submitting, setSubmitting] = useState(false);

  // Reset the spinner state when re-opened, so a stale "deleting" never
  // blocks a fresh attempt after a previous failure (same discipline as
  // DeleteProjectDialog).
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
      await deleteEnv.mutateAsync({ projectId, id: environmentId });
      toast.success(
        t("toast.envDeleted", 'Environment "{label}" deleted.', { label }),
      );
      onDeleted?.();
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("env.deleteError", "Could not delete environment."),
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
            {t("env.deleteTitle", "Delete environment?")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "env.deleteDescription",
              'This permanently removes "{label}" and everything scoped to it — features, flows, targets, secrets, issues, and its verification checks. This action cannot be undone.',
              { label },
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm font-medium text-foreground">
            {label}
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
            {t("env.deleteConfirm", "Delete environment")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
