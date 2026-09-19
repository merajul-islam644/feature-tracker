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
  // Testers can't author projects — drop the CTA rather than render a
  // button they can't act on. The matching `useCreateProject` hook
  // throws the same error if it's reached through any other path.
  const isTester = useIsRole("tester");
  return (
    <EmptyState
      icon={<FolderKanban className="h-6 w-6" aria-hidden="true" />}
      title={t("projectEmptyState.title", "No projects yet")}
      description={
        isTester
          ? t(
              "projectEmptyState.bodyTester",
              "There are no projects in your workspace. Ask a manager to create one.",
            )
          : t(
              "projectEmptyState.body",
              "Create your first project to start tracking features and flows.",
            )
      }
      action={
        isTester ? undefined : (
          <Button onClick={onCreate} leftIcon={<span>+</span>}>
            {t("projectEmptyState.cta", "Create Project")}
          </Button>
        )
      }
    />
  );
}