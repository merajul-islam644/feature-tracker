import { useEffect, useState } from "react";
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
import { featureNameSchema } from "@/lib/validation";
import { useToast } from "@/hooks/useToast";
import { useCreateFeature } from "@/lib/blocks/hooks";
import { useT } from "@/lib/blocks/i18n";

interface AddFeatureModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
}

export function AddFeatureModal({
  open,
  onClose,
  projectId,
}: AddFeatureModalProps) {
  const createFeature = useCreateFeature();
  const toast = useToast();
  const t = useT();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setName("");
      setError(null);
    }
  }, [open]);

  const handleOpenChange = (next: boolean) => {
    if (next) return;
    if (createFeature.isPending) return;
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = featureNameSchema.safeParse(name);
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "Invalid name");
      return;
    }

    try {
      const feature = await createFeature.mutateAsync({
        projectId,
        name: name.trim(),
      });
      toast.success(
        t("toast.featureCreated", 'Feature "{name}" added successfully.', {
          name: feature.name,
        }),
      );
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("addFeature.error", "Could not add feature."),
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t("addFeature.title", "Add Feature")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form
            id="add-feature-form"
            onSubmit={handleSubmit}
            noValidate
            className="space-y-4"
          >
            <Input
              label={t("addFeature.nameLabel", "Feature Name")}
              required
              placeholder={t(
                "addFeature.namePlaceholder",
                "e.g. Authentication",
              )}
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
            disabled={createFeature.isPending}
          >
            {t("cancel", "Cancel")}
          </Button>
          <Button
            type="submit"
            form="add-feature-form"
            loading={createFeature.isPending}
          >
            {createFeature.isPending
              ? t("addFeature.adding", "Adding…")
              : t("add", "Add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}