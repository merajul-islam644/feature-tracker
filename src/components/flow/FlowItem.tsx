import { GitBranch } from "lucide-react";
import { formatRelativeDate } from "@/lib/utils";

// Local shape — the canonical schema lives in
// src/types/Shemastructure/Flow.ts and is intentionally not imported.
interface Flow {
  id: string;
  projectId: string;
  featureId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface FlowItemProps {
  flow: Flow;
}

export function FlowItem({ flow }: FlowItemProps) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm transition-colors hover:border-primary/40 hover:bg-accent">
      <GitBranch
        className="h-4 w-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="flex-1 truncate font-medium text-foreground">
        {flow.name}
      </span>
      <span className="hidden text-xs text-muted-foreground sm:inline">
        {formatRelativeDate(flow.createdAt)}
      </span>
    </div>
  );
}
