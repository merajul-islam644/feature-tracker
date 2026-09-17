import { useState } from "react";
import { Layers, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectList } from "@/components/project/ProjectList";
import { ProjectEmptyState } from "@/components/project/ProjectEmptyState";
import { CreateProjectModal } from "@/components/project/CreateProjectModal";
import { AddEnvironmentModal } from "@/components/project/AddEnvironmentModal";
import { useProjects } from "@/lib/blocks/hooks";
import { useT } from "@/lib/blocks/i18n";

export function ProjectsPage() {
  const { data: projects, isLoading } = useProjects();
  const t = useT();
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
            <Button
              variant="outline"
              onClick={() => setAddEnvOpen(true)}
              leftIcon={<Layers className="h-4 w-4" />}
            >
              {t("addEnvironment.cta", "Add Environment")}
            </Button>
            <Button
              onClick={() => setCreateOpen(true)}
              leftIcon={<Plus className="h-4 w-4" />}
            >
              {t("projects.createCta", "Create Project")}
            </Button>
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