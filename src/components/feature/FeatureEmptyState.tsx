import { ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

interface FeatureEmptyStateProps {
  onAdd: () => void;
}

export function FeatureEmptyState({ onAdd }: FeatureEmptyStateProps) {
  return (
    <EmptyState
      icon={<ListChecks className="h-6 w-6" aria-hidden="true" />}
      title="No Features Yet"
      description="Please create a feature to continue."
      action={<Button onClick={onAdd}>Add Feature</Button>}
    />
  );
}
