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
import type { Feature } from "@/lib/blocks/data";
import { useT } from "@/lib/blocks/i18n";
import { envLabelFromSlug } from "@/pages/ProjectDetailPage";

interface AddFlowModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  defaultFeatureId?: string;
  // Env the new flow belongs to. When set, the dropdown is restricted to
  // features whose env matches, the locked Environment row is rendered,
  // and the flow record is stamped with this envSlug (defense in depth —
  // we don't trust the picked feature's envSlug to match the page's).
  envSlug?: string;
}

export function AddFlowModal({
  open,
  onClose,
  projectId,
  defaultFeatureId,
  envSlug,
}: AddFlowModalProps) {
  const createFlow = useCreateFlow();
  // Fetch every feature for the project (env-less), then filter to envSlug
  // client-side. This keeps every AddFlowModal — page-level + one per
  // FeatureItem — on a single shared cache key, so we don't trigger a
  // separate network call per unique envSlug when the modal mounts across
  // many feature rows on /projects/:id. The page-level hook keeps its own
  // env-scoped fetch for the feature list display.
  const featuresQuery = useProjectFeatures(projectId);
  // Module-level empty fallback so the reference is stable across renders
  // — otherwise `data ?? []` would create a fresh array each render and
  // defeat the useMemo below, re-tripping the reset-name useEffect.
  const EMPTY_FEATURES: Feature[] = [];
  const featuresAll = featuresQuery.data ?? EMPTY_FEATURES;
  const toast = useToast();
  const t = useT();

  // useMemo so the filtered list keeps a stable identity when neither
  // input changed — otherwise the .filter() call would create a new array
  // every render and trip the reset-name useEffect on every keystroke,
  // making the input unwriteable.
  const features = useMemo(
    () =>
      envSlug
        ? featuresAll.filter((f) => f.envSlug === envSlug)
        : featuresAll,
    [featuresAll, envSlug],
  );

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

  const envLabel = envLabelFromSlug(envSlug);

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
        // Modal's env wins over the picked feature's — keeps the flow
        // tied to the page's env even if the dropdown somehow shows a
        // cross-env feature in a future regression.
        envSlug,
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
            {envLabel && (
              <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-sm">
                <span className="text-muted-foreground">
                  {t("addFlow.envLabel", "Environment")}
                  {": "}
                </span>
                <span className="font-medium text-foreground">{envLabel}</span>
              </div>
            )}
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
                  ? envLabel
                    ? t(
                        "addFlow.featurePlaceholderEmpty",
                        "No features in this environment — add one first",
                      )
                    : t(
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
                {envLabel
                  ? t(
                      "addFlow.noFeaturesHint",
                      "Create at least one feature in this environment before adding flows.",
                    )
                  : t(
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