import { useState } from "react";
import { ChevronDown, ChevronRight, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { FlowItem } from "@/components/flow/FlowItem";
import { FlowEmptyState } from "./FlowEmptyState";
import { AddFlowModal } from "@/components/flow/AddFlowModal";
import { useFeatureFlows } from "@/lib/blocks/hooks";
import { useT } from "@/lib/blocks/i18n";
import { cn } from "@/lib/utils";
import type { Feature } from "@/lib/blocks/data";

interface FeatureItemProps {
  feature: Feature;
}

export function FeatureItem({ feature }: FeatureItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [addFlowOpen, setAddFlowOpen] = useState(false);
  const { data: flows } = useFeatureFlows(expanded ? feature.id : undefined);
  const t = useT();
  const flowList = flows ?? [];

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setExpanded((v) => !v);
    }
  };

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={handleKey}
        aria-expanded={expanded}
        aria-controls={`feature-content-${feature.id}`}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {expanded ? (
          <ChevronDown
            className="h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        ) : (
          <ChevronRight
            className="h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        )}
        <span className="flex-1 text-sm font-semibold text-foreground">
          {feature.name}
        </span>
        <Badge variant={flowList.length > 0 ? "default" : "muted"}>
          <GitBranch className="h-3 w-3" aria-hidden="true" />
          {flowList.length}
        </Badge>
      </div>

      {expanded && (
        <div
          id={`feature-content-${feature.id}`}
          className="bg-muted/30 px-4 py-3"
        >
          <Separator className="mb-3" />
          {flowList.length === 0 ? (
            <FlowEmptyState onAdd={() => setAddFlowOpen(true)} />
          ) : (
            <ul className="space-y-1.5">
              {flowList.map((flow) => (
                <li key={flow.id}>
                  <FlowItem flow={flow} />
                </li>
              ))}
              <li className="pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAddFlowOpen(true)}
                  className={cn("text-primary")}
                >
                  {t("featureItem.addAnotherFlow", "+ Add another flow")}
                </Button>
              </li>
            </ul>
          )}
        </div>
      )}

      <AddFlowModal
        open={addFlowOpen}
        onClose={() => setAddFlowOpen(false)}
        projectId={feature.projectId}
        defaultFeatureId={feature.id}
      />
    </div>
  );
}