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
import { MultiSelect } from "@/components/ui/multi-select";
import { featureNameSchema } from "@/lib/validation";
import { useToast } from "@/hooks/useToast";
import { useCreateFeature } from "@/lib/blocks/hooks";
import { useT } from "@/lib/blocks/i18n";
import { useUsersByRole } from "@/lib/blocks/users";
import { envLabelFromSlug } from "@/pages/ProjectDetailPage";

interface AddFeatureModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  // Env the new feature belongs to. When set (env-scoped page), a
  // read-only "Environment: <label>" row is shown above the name input.
  // When unset (env-less page), the feature is created without envSlug
  // — legacy-compatible.
  envSlug?: string;
}

// Both assignment pickers are multi-select. A feature can be created
// with zero assignees and added to later from the (future) edit modal,
// or co-developed / co-tested by any number of users. The arrays stay
// empty until the picker has been used — they're forwarded verbatim to
// the mutation on submit so an un-picked state preserves "no one
// assigned".
export function AddFeatureModal({
  open,
  onClose,
  projectId,
  envSlug,
}: AddFeatureModalProps) {
  const createFeature = useCreateFeature();
  const toast = useToast();
  const t = useT();
  // Two parallel queries for the multi-select option lists. The hook
  // is defensive — it returns `[]` on 403 so the modal still renders.
  // Cache key includes the role so toggling between dev/qa mounts
  // doesn't refetch the same list.
  const developersQuery = useUsersByRole("developer");
  const qasQuery = useUsersByRole("tester");
  const developers = developersQuery.data ?? [];
  const qas = qasQuery.data ?? [];
  // Module-level empty fallback so the options arrays have a stable
  // identity across renders — prevents the MultiSelect from re-
  // rendering its child option list on every keystroke.
  const EMPTY: { value: string; label: string }[] = [];
  const developerOptions = useMemo(
    () =>
      developers.length > 0
        ? developers.map((u) => ({ value: u.id, label: u.displayName }))
        : EMPTY,
    [developers, EMPTY],
  );
  const qaOptions = useMemo(
    () =>
      qas.length > 0
        ? qas.map((u) => ({ value: u.id, label: u.displayName }))
        : EMPTY,
    [qas, EMPTY],
  );

  const [name, setName] = useState("");
  // Multi-select picks live as parallel arrays of selected option
  // values. Empty array is the "no one assigned" state — when the
  // user hasn't opened the picker yet, there's nothing to clear, and
  // when they have and deselected everything, this is also empty (no
  // sentinel needed like the previous single-value `UNASSIGNED`).
  const [developerIds, setDeveloperIds] = useState<string[]>([]);
  const [qaIds, setQaIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setName("");
      setDeveloperIds([]);
      setQaIds([]);
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
        // envSlug is forwarded verbatim — the mutation skips the field
        // entirely when undefined (see useCreateFeature).
        envSlug,
        // Forward the picked arrays verbatim. Empty arrays (or omitted)
        // mean unassigned — see useCreateFeature for the wire-shape
        // rationale.
        developerIds,
        qaIds,
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

  const envLabel = envLabelFromSlug(envSlug);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t("addFeature.title", "Add Feature")}</DialogTitle>
          <DialogDescription>
            {t(
              "addFeature.description",
              "Create a feature inside this project. Assign a developer and a QA to track ownership.",
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form
            id="add-feature-form"
            onSubmit={handleSubmit}
            noValidate
            className="space-y-4"
          >
            {envLabel && (
              <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-sm">
                <span className="text-muted-foreground">
                  {t("addFeature.envLabel", "Environment")}
                  {": "}
                </span>
                <span className="font-medium text-foreground">{envLabel}</span>
              </div>
            )}
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
            {/* "Assign Developers" multi-select. Populated from
                IAM users with role `developer`. Empty list = the
                403 fallback path; the picker still renders (with
                the placeholder text acting as the explanation) so
                the modal stays usable. Selected developers appear
                as removable chips; the popover's checkbox list lets
                the user add more. */}
            <MultiSelect
              label={t("addFeature.developerLabel", "Assign Developers")}
              options={developerOptions}
              placeholder={
                developers.length === 0
                  ? t(
                      "addFeature.developerUnavailable",
                      "No developers available — leave unassigned",
                    )
                  : t(
                      "addFeature.developerPlaceholder",
                      "Pick developers (any number)",
                    )
              }
              value={developerIds}
              onChange={setDeveloperIds}
            />
            {/* Same shape for QA. The QA role doubles as the
                `tester` IAM role in this tenant, so the picker is
                populated from `useUsersByRole("tester")`. The label
                stays "Assign QAs" so the user sees the semantic
                intent; the underlying role lookup is internal. */}
            <MultiSelect
              label={t("addFeature.qaLabel", "Assign QAs")}
              options={qaOptions}
              placeholder={
                qas.length === 0
                  ? t(
                      "addFeature.qaUnavailable",
                      "No QAs available — leave unassigned",
                    )
                  : t(
                      "addFeature.qaPlaceholder",
                      "Pick QAs (any number)",
                    )
              }
              value={qaIds}
              onChange={setQaIds}
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