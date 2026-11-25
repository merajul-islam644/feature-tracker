// Workspace surface — the body of the `/panel` route.
//
// What used to live here was a custom CodeMirror workspace backed by
// the local dev-server (see git history for `WorkspacePage.tsx`). The
// user retired that: this page now hosts the SAME workbench feature the
// `/tests` route hosts (`features/workbench` — one engine everywhere),
// while keeping the Workspace page's own design: the FolderTree icon
// badge + title + env chip + subtitle header, in the app's tokens. The
// folder pick, editing, terminal, git and runs all come from the
// workbench's runner/FSA transports — no local dev-server involved.

import { useActiveEnv } from "@/contexts/ActiveEnvContext";
import { useWorkbenchProject } from "@/shared/useWorkbenchProject";
import { BackToProjectsLink } from "@/components/layout/BackToProjectsLink";
import { EnvHeaderChip } from "@/components/project/EnvHeaderChip";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/lib/blocks/i18n";
import { Workbench } from "@/features/workbench/Workbench";

export function PanelPage() {
  const t = useT();
  const activeEnv = useActiveEnv();
  const resolution = useWorkbenchProject();

  if (!activeEnv || resolution.state === "no-env") {
    return (
      <div className="space-y-6">
        <BackToProjectsLink />
        <ErrorState
          title={t("issueTracker.workspace.title", "Workspace")}
          message="Open a project environment first — the workspace is scoped to the active project."
        />
      </div>
    );
  }

  if (resolution.state === "loading") {
    return (
      <div className="space-y-6">
        <BackToProjectsLink />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[560px] w-full" />
      </div>
    );
  }

  if (resolution.state === "error") {
    return (
      <div className="space-y-6">
        <BackToProjectsLink />
        <ErrorState
          title={t("issueTracker.workspace.title", "Workspace")}
          message="The active project could not be loaded."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <BackToProjectsLink />
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-foreground">
            {t("issueTracker.workspace.title", "Workspace")}
          </h1>
          <EnvHeaderChip />
        </div>
        <p className="text-sm text-muted-foreground">
          {t(
            "issueTracker.workspace.subtitle",
            "Open a folder and edit files like VS Code. Changes autosave to disk.",
          )}
        </p>
      </div>
      <Workbench project={resolution.project} variant="workspace" />
    </div>
  );
}
