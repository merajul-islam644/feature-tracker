import { useState } from "react";
import { FolderKanban, Layers, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectList } from "@/components/project/ProjectList";
import { ProjectEmptyState } from "@/components/project/ProjectEmptyState";
import { CreateProjectModal } from "@/components/project/CreateProjectModal";
import { AddEnvironmentModal } from "@/components/project/AddEnvironmentModal";
import { useProjects } from "@/lib/blocks/hooks";
import { useIsRole } from "@/hooks/useAuth";
import { useT } from "@/lib/blocks/i18n";

export function ProjectsPage() {
  const { data: projects, isLoading } = useProjects();
  const t = useT();
  // Testers can browse existing environments but cannot add new ones. The
  // hook itself enforces this — see `useAddProjectEnv` in `hooks.ts` —
  // but hiding the CTA keeps the page honest about what a tester can do.
  const isTester = useIsRole("tester");
  const [createOpen, setCreateOpen] = useState(false);
  const [addEnvOpen, setAddEnvOpen] = useState(false);
  const list = projects ?? [];

  return (
    <div className="space-y-6">
      {/* Header — icon badge + title + subtitle, matching the issue
          tracker / dashboard treatment. The icon badge is the small
          indigo-tinted square that the design system uses to anchor a
          page title; without it the heading floats untethered. */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300"
            >
              <FolderKanban className="h-4 w-4" />
            </span>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {t("projects.title", "Projects")}
            </h1>
            {list.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {list.length}
              </span>
            )}
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t(
              "projects.subtitle",
              "Manage your projects, features, and flows.",
            )}
          </p>
        </div>
        {list.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Hidden for testers — the underlying mutation throws the
                same error if it's reached another way (URL, programmatic
                call, etc.). */}
            {!isTester && (
              <Button
                variant="outline"
                onClick={() => setAddEnvOpen(true)}
              >
                <Layers className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {t("addEnvironment.cta", "Add Environment")}
              </Button>
            )}
            {/* Create Project — also hidden for testers (read-only on
                the workspace surface). The header is the easy case; the
                harder one is `ProjectEmptyState` below, which surfaces
                its own "Create Project" CTA when the project list is
                empty. We gate that component the same way so testers
                can't author a project through the empty state either. */}
            {!isTester && (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {t("projects.createCta", "Create Project")}
              </Button>
            )}
          </div>
        )}
      </header>

      {isLoading ? (
        <div
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          aria-hidden="true"
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-xl border border-border bg-muted/40"
            />
          ))}
        </div>
      ) : list.length === 0 ? (
        <ProjectEmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <ProjectList projects={list} />
      )}

      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
      <AddEnvironmentModal
        open={addEnvOpen}
        onClose={() => setAddEnvOpen(false)}
      />
    </div>
  );
}