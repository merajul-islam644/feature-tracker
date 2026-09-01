import { FolderKanban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

interface ProjectEmptyStateProps {
  onCreate: () => void;
}

export function ProjectEmptyState({ onCreate }: ProjectEmptyStateProps) {
  return (
    <EmptyState
      icon={<FolderKanban className="h-6 w-6" aria-hidden="true" />}
      title="No Projects Yet"
      description="Create your first project to get started."
      action={
        <Button onClick={onCreate} leftIcon={<span>+</span>}>
          Create Project
        </Button>
      }
    />
  );
}
