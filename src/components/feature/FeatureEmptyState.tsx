import { ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useT } from "@/lib/blocks/i18n";

interface FeatureEmptyStateProps {
  /** When provided, renders an Add Feature CTA. Omit for read-only
   *  empty states (e.g. non-dev envs where features are authored
   *  under dev and other envs may legitimately be empty). */
  onAdd?: () => void;
}

export function FeatureEmptyState({ onAdd }: FeatureEmptyStateProps) {
  const t = useT();
  return (
    <EmptyState
      icon={<ListChecks className="h-6 w-6" aria-hidden="true" />}
      title={t("featureEmptyState.title", "No features yet")}
      description={t(
        "featureEmptyState.body",
        "Start by adding a feature to this project.",
      )}
      action={
        onAdd ? (
          <Button onClick={onAdd}>
            {t("featureEmptyState.cta", "Add Feature")}
          </Button>
        ) : undefined
      }
    />
  );
}