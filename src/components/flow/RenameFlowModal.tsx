// Inline rename dialog for a flow row — single Input, validates with
// flowNameSchema, persists via useUpdateFlow. Mirrors RenameFeatureModal.

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
import { flowNameSchema } from "@/lib/validation";
import { useToast } from "@/hooks/useToast";
import { useUpdateFlow } from "@/lib/blocks/hooks";
import { useT } from "@/lib/blocks/i18n";

interface RenameFlowModalProps {
  open: boolean;
  onClose: () => void;
  flowId: string;
  projectId: string;
  featureId: string;
  currentName: string;
  // Echoed back into the update payload because the cloud Flow schema
  // marks `status` as `requiredOn: 3` (required on every update). The
  // rename mutation must resend the current value or the cloud rejects
  // the partial PATCH as "missing required field".
  currentStatus: import("@/lib/blocks/data").FlowStatus;
}

export function RenameFlowModal({
  open,
  onClose,
  flowId,
  projectId,
  featureId,
  currentName,
  currentStatus,
}: RenameFlowModalProps) {
  const updateFlow = useUpdateFlow();
  const toast = useToast();
  const t = useT();

  const [name, setName] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
    const result = flowNameSchema.safeParse(name);
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "Invalid name");
      return;
    }
    const trimmed = name.trim();
    if (trimmed === currentName) {
      onClose();
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const updated = await updateFlow.mutateAsync({
        id: flowId,
        projectId,
        featureId,
        // Echoed because the cloud Flow schema marks `status` as required
        // on every update. Without this the rename fails with "Field
        // 'status' is required".
        status: currentStatus,
        patch: { name: trimmed },
      });
      toast.success(
        t("toast.flowRenamed", 'Flow renamed to "{name}".', {
          name: updated.name,
        }),
      );
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("flowItem.renameError", "Could not rename flow."),
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
            {t("flowItem.renameTitle", "Rename Flow")}
          </DialogTitle>
          <DialogDescription>
            {t("flowItem.renameDescription", "Update the flow name.")}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form
            id="rename-flow-form"
            onSubmit={handleSubmit}
            noValidate
            className="space-y-2"
          >
            <Input
              label={t("addFlow.nameLabel", "Flow Name")}
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
            form="rename-flow-form"
            loading={submitting}
          >
            {t("save", "Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
