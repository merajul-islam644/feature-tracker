import { GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";

interface FlowEmptyStateProps {
  onAdd: () => void;
}

export function FlowEmptyState({ onAdd }: FlowEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-slate-200 bg-white px-4 py-6 text-center">
      <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <GitBranch className="h-4 w-4" aria-hidden="true" />
      </div>
      <p className="text-sm font-medium text-slate-700">Please create a flow</p>
      <p className="mt-0.5 text-xs text-slate-500">
        Map out the user journey for this feature.
      </p>
      <div className="mt-3">
        <Button size="sm" onClick={onAdd}>
          Add Flow
        </Button>
      </div>
    </div>
  );
}