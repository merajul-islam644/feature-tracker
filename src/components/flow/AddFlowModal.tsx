import { useEffect, useMemo, useState } from "react";
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
import { Select } from "@/components/ui/select";
import { flowNameSchema } from "@/lib/validation";
import { useDataStore } from "@/store/dataStore";
import { useToast } from "@/hooks/useToast";
import { delay } from "@/lib/utils";

interface AddFlowModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  defaultFeatureId?: string;
}

export function AddFlowModal({
  open,
  onClose,
  projectId,
  defaultFeatureId,
}: AddFlowModalProps) {
  // Subscribe to the raw features array (stable reference) and derive the
  // project-scoped list with useMemo. The previous selector returned a fresh
  // .filter() array on every call, which useSyncExternalStore saw as a new
  // snapshot and re-rendered forever.
  const allFeatures = useDataStore((s) => s.features);
  const addFlow = useDataStore((s) => s.addFlow);
  const toast = useToast();

  const features = useMemo(
    () => allFeatures.filter((f) => f.projectId === projectId),
    [allFeatures, projectId]
  );

  const [name, setName] = useState("");
  const [featureId, setFeatureId] = useState(defaultFeatureId ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const [featureError, setFeatureError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setFeatureId(defaultFeatureId ?? (features[0]?.id ?? ""));
      setNameError(null);
      setFeatureError(null);
      setSubmitting(false);
    }
  }, [open, defaultFeatureId, features]);

  const featureOptions = useMemo(
    () => features.map((f) => ({ value: f.id, label: f.name })),
    [features]
  );

  const handleOpenChange = (next: boolean) => {
    if (next) return;
    if (submitting) return;
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let valid = true;

    const result = flowNameSchema.safeParse(name);
    if (!result.success) {
      setNameError(result.error.issues[0]?.message ?? "Invalid name");
      valid = false;
    } else {
      setNameError(null);
    }

    if (!featureId) {
      setFeatureError("Please select a feature");
      valid = false;
    } else {
      setFeatureError(null);
    }

    if (!valid) return;

    setSubmitting(true);
    await delay(400);

    const flow = addFlow(projectId, featureId, name);
    if (!flow) {
      setFeatureError("Selected feature is no longer available.");
      setSubmitting(false);
      return;
    }

    toast.success(`Flow "${flow.name}" created successfully.`);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Add Flow</DialogTitle>
          <DialogDescription>
            Map a user journey to one of this project's features.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form
            id="add-flow-form"
            onSubmit={handleSubmit}
            className="space-y-4"
            noValidate
          >
            <Input
              label="Flow Name"
              required
              placeholder="e.g. User Login Flow"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) setNameError(null);
              }}
              error={nameError ?? undefined}
              autoFocus
              maxLength={100}
            />
            <Select
              label="Feature"
              required
              options={featureOptions}
              placeholder={
                features.length === 0
                  ? "No features available — add one first"
                  : "Select a feature"
              }
              value={featureId}
              onChange={(e) => {
                setFeatureId(e.target.value);
                if (featureError) setFeatureError(null);
              }}
              error={featureError ?? undefined}
              disabled={features.length === 0}
            />
            {features.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Create at least one feature in this project before adding flows.
              </p>
            )}
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
            form="add-flow-form"
            loading={submitting}
            disabled={features.length === 0}
          >
            {submitting ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
