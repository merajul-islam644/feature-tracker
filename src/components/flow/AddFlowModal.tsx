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
import { useToast } from "@/hooks/useToast";
import { useCreateFlow, useProjectFeatures } from "@/lib/blocks/hooks";
import { useT } from "@/lib/blocks/i18n";

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
  const createFlow = useCreateFlow();
  const featuresQuery = useProjectFeatures(projectId);
  const toast = useToast();
  const t = useT();

  const features = featuresQuery.data ?? [];

  const [name, setName] = useState("");
  const [featureId, setFeatureId] = useState(defaultFeatureId ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const [featureError, setFeatureError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setFeatureId(defaultFeatureId ?? (features[0]?.id ?? ""));
      setNameError(null);
      setFeatureError(null);
    }
  }, [open, defaultFeatureId, features]);

  const featureOptions = useMemo(
    () => features.map((f) => ({ value: f.id, label: f.name })),
    [features],
  );

  const handleOpenChange = (next: boolean) => {
    if (next) return;
    if (createFlow.isPending) return;
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
      setFeatureError(t("addFlow.featureRequired", "Please select a feature"));
      valid = false;
    } else {
      setFeatureError(null);
    }

    if (!valid) return;

    try {
      const flow = await createFlow.mutateAsync({
        projectId,
        featureId,
        name: name.trim(),
      });
      toast.success(
        t("toast.flowCreated", 'Flow "{name}" created successfully.', {
          name: flow.name,
        }),
      );
      onClose();
    } catch (err) {
      setFeatureError(
        err instanceof Error
          ? err.message
          : t("addFlow.error", "Could not create flow."),
      );
    }
  };

  const pending = createFlow.isPending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t("addFlow.title", "Add Flow")}</DialogTitle>
          <DialogDescription>
            {t(
              "addFlow.description",
              "Map a user journey to one of this project's features.",
            )}
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
              label={t("addFlow.nameLabel", "Flow Name")}
              required
              placeholder={t("addFlow.namePlaceholder", "e.g. User Login Flow")}
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
              label={t("addFlow.featureLabel", "Feature")}
              required
              options={featureOptions}
              placeholder={
                features.length === 0
                  ? t(
                      "addFlow.featurePlaceholderEmpty",
                      "No features available — add one first",
                    )
                  : t("addFlow.featurePlaceholder", "Select a feature")
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
                {t(
                  "addFlow.noFeaturesHint",
                  "Create at least one feature in this project before adding flows.",
                )}
              </p>
            )}
          </form>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={pending}
          >
            {t("cancel", "Cancel")}
          </Button>
          <Button
            type="submit"
            form="add-flow-form"
            loading={pending}
            disabled={features.length === 0}
          >
            {pending ? t("addFlow.creating", "Creating…") : t("create", "Create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}