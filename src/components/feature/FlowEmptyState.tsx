import { GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/blocks/i18n";

interface FlowEmptyStateProps {
  /** When provided, renders an Add Flow CTA. Omit for read-only
   *  empty states (e.g. non-dev envs where flows are authored under
   *  dev and other envs may legitimately be empty). */
  onAdd?: () => void;
}

export function FlowEmptyState({ onAdd }: FlowEmptyStateProps) {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-border bg-card px-4 py-6 text-center">
      <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <GitBranch className="h-4 w-4" aria-hidden="true" />
      </div>
      <p className="text-sm font-medium text-foreground">
        {t("flowEmptyState.title", "No flows yet")}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {t(
          "flowEmptyState.body",
          "Add a flow to map out the steps in this feature.",
        )}
      </p>
      {onAdd && (
        <div className="mt-3">
          <Button size="sm" onClick={onAdd}>
            {t("flowEmptyState.cta", "Add Flow")}
          </Button>
        </div>
      )}
    </div>
  );
}