import { FolderKanban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useIsRole } from "@/hooks/useAuth";
import { useT } from "@/lib/blocks/i18n";

interface ProjectEmptyStateProps {
  onCreate: () => void;
}

export function ProjectEmptyState({ onCreate }: ProjectEmptyStateProps) {
  const t = useT();
  // Project creation is manager-only (developers and testers cannot
  // author projects). Drop the CTA rather than render a button they
  // can't act on, and swap to the "ask a manager" body copy so the
  // page is honest about what a non-manager can do. The matching
  // `useCreateProject` hook throws the same error if it's reached
  // through any other path.
  const isManager = useIsRole("manager");
  return (
    <EmptyState
      icon={<FolderKanban className="h-6 w-6" aria-hidden="true" />}
      title={t("projectEmptyState.title", "No projects yet")}
      description={
        isManager
          ? t(
              "projectEmptyState.body",
              "Create your first project to start tracking features and flows.",
            )
          : t(
              "projectEmptyState.bodyTester",
              "There are no projects in your workspace. Ask a manager to create one.",
            )
      }
      action={
        isManager ? (
          <Button onClick={onCreate} leftIcon={<span>+</span>}>
            {t("projectEmptyState.cta", "Create Project")}
          </Button>
        ) : undefined
      }
    />
  );
}