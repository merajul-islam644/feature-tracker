import { FolderKanban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useT } from "@/lib/blocks/i18n";

interface ProjectEmptyStateProps {
  onCreate: () => void;
}

export function ProjectEmptyState({ onCreate }: ProjectEmptyStateProps) {
  const t = useT();
  return (
    <EmptyState
      icon={<FolderKanban className="h-6 w-6" aria-hidden="true" />}
      title={t("projectEmptyState.title", "No projects yet")}
      description={t(
        "projectEmptyState.body",
        "Create your first project to start tracking features and flows.",
      )}
      action={
        <Button onClick={onCreate} leftIcon={<span>+</span>}>
          {t("projectEmptyState.cta", "Create Project")}
        </Button>
      }
    />
  );
}