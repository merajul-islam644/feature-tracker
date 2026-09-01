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
import { useDataStore } from "@/store/dataStore";
import { useToast } from "@/hooks/useToast";
import { delay } from "@/lib/utils";

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
  const addFeature = useDataStore((s) => s.addFeature);
  const toast = useToast();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

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

    setSubmitting(true);
    await delay(400);

    const feature = addFeature(projectId, name);
    if (!feature) {
      setError("A feature with this name already exists in this project.");
      setSubmitting(false);
      return;
    }

    toast.success(`Feature "${feature.name}" added successfully.`);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Add Feature</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form
            id="add-feature-form"
            onSubmit={handleSubmit}
            noValidate
            className="space-y-4"
          >
            <Input
              label="Feature Name"
              required
              placeholder="e.g. Authentication"
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
            Cancel
          </Button>
          <Button
            type="submit"
            form="add-feature-form"
            loading={submitting}
          >
            {submitting ? "Adding…" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
