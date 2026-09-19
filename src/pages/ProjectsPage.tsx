import { useState } from "react";
import { Layers, Plus } from "lucide-react";
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
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            {t("projects.title", "Projects")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
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
                leftIcon={<Layers className="h-4 w-4" />}
              >
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
              <Button
                onClick={() => setCreateOpen(true)}
                leftIcon={<Plus className="h-4 w-4" />}
              >
                {t("projects.createCta", "Create Project")}
              </Button>
            )}
          </div>
        )}
      </header>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-lg border border-border bg-muted"
              aria-hidden="true"
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