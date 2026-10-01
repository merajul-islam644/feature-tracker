// Confirm-then-delete dialog for a feature row. Built directly from the
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
import { useDeleteFeature } from "@/lib/blocks/hooks";
import { useT } from "@/lib/blocks/i18n";

interface DeleteFeatureDialogProps {
  open: boolean;
  onClose: () => void;
  featureId: string;
  projectId: string;
  featureName: string;
}

export function DeleteFeatureDialog({
  open,
  onClose,
  featureId,
  projectId,
  featureName,
}: DeleteFeatureDialogProps) {
  const deleteFeature = useDeleteFeature();
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
      await deleteFeature.mutateAsync({ id: featureId, projectId });
      toast.success(
        t("toast.featureDeleted", 'Feature "{name}" deleted.', {
          name: featureName,
        }),
      );
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("featureItem.deleteError", "Could not delete feature."),
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
            {t("featureItem.deleteTitle", "Delete feature?")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "featureItem.deleteDescription",
              "This will permanently remove the feature and all of its flows. This action cannot be undone.",
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm font-medium text-foreground">
            {featureName}
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
            {t("featureItem.deleteConfirm", "Delete feature")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
