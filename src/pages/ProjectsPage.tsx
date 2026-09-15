import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectList } from "@/components/project/ProjectList";
import { ProjectEmptyState } from "@/components/project/ProjectEmptyState";
import { CreateProjectModal } from "@/components/project/CreateProjectModal";
import { useProjects } from "@/lib/blocks/hooks";
import { useT } from "@/lib/blocks/i18n";

export function ProjectsPage() {
  const { data: projects, isLoading } = useProjects();
  const t = useT();
  const [createOpen, setCreateOpen] = useState(false);
  const list = projects ?? [];

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            {t("projects.title", "Projects")}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {t(
              "projects.subtitle",
              "Manage your projects, features, and flows.",
            )}
          </p>
        </div>
        {list.length > 0 && (
          <Button
            onClick={() => setCreateOpen(true)}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            {t("projects.createCta", "Create Project")}
          </Button>
        )}
      </header>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-lg border border-slate-200 bg-slate-100/60"
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
    </div>
  );
}