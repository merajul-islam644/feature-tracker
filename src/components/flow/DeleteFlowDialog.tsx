// Confirm-then-delete dialog for a flow row. Built directly from the
// Dialog primitives to match DeleteProjectDialog.

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
import { useDeleteFlow } from "@/lib/blocks/hooks";
import { useT } from "@/lib/blocks/i18n";

interface DeleteFlowDialogProps {
  open: boolean;
  onClose: () => void;
  flowId: string;
  projectId: string;
  featureId: string;
  flowName: string;
}

export function DeleteFlowDialog({
  open,
  onClose,
  flowId,
  projectId,
  featureId,
  flowName,
}: DeleteFlowDialogProps) {
  const deleteFlow = useDeleteFlow();
  const toast = useToast();
  const t = useT();
  const [submitting, setSubmitting] = useState(false);

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
      await deleteFlow.mutateAsync({ id: flowId, projectId, featureId });
      toast.success(
        t("toast.flowDeleted", 'Flow "{name}" deleted.', {
          name: flowName,
        }),
      );
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("flowItem.deleteError", "Could not delete flow."),
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
            {t("flowItem.deleteTitle", "Delete flow?")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "flowItem.deleteDescription",
              "This will permanently remove the flow. This action cannot be undone.",
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm font-medium text-foreground">
            {flowName}
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
            {t("flowItem.deleteConfirm", "Delete flow")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
