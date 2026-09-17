// Inline rename dialog for a feature row — single Input, validates with
// featureNameSchema, persists via useUpdateFeature. Mirrors the visual
// structure of RenameProjectModal but is scoped to one feature row.

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
import { featureNameSchema } from "@/lib/validation";
import { useToast } from "@/hooks/useToast";
import { useUpdateFeature } from "@/lib/blocks/hooks";
import { useT } from "@/lib/blocks/i18n";

interface RenameFeatureModalProps {
  open: boolean;
  onClose: () => void;
  featureId: string;
  projectId: string;
  currentName: string;
}

export function RenameFeatureModal({
  open,
  onClose,
  featureId,
  projectId,
  currentName,
}: RenameFeatureModalProps) {
  const updateFeature = useUpdateFeature();
  const toast = useToast();
  const t = useT();

  const [name, setName] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset the input every time the dialog re-opens so the user always
  // sees the latest server name, never a stale edit from a previous
  // session.
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
    const result = featureNameSchema.safeParse(name);
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
      const updated = await updateFeature.mutateAsync({
        id: featureId,
        projectId,
        patch: { name: trimmed },
      });
      toast.success(
        t("toast.featureRenamed", 'Feature renamed to "{name}".', {
          name: updated.name,
        }),
      );
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("featureItem.renameError", "Could not rename feature."),
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
            {t("featureItem.renameTitle", "Rename Feature")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "featureItem.renameDescription",
              "Update the feature name.",
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form
            id="rename-feature-form"
            onSubmit={handleSubmit}
            noValidate
            className="space-y-2"
          >
            <Input
              label={t("addFeature.nameLabel", "Feature Name")}
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
            form="rename-feature-form"
            loading={submitting}
          >
            {t("save", "Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
