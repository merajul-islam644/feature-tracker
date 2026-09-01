import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectList } from "@/components/project/ProjectList";
import { ProjectEmptyState } from "@/components/project/ProjectEmptyState";
import { CreateProjectModal } from "@/components/project/CreateProjectModal";
import { useDataStore } from "@/store/dataStore";

export function ProjectsPage() {
  const projects = useDataStore((s) => s.projects);
  const isHydrated = useDataStore((s) => s.isHydrated);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Projects</h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage your projects, features, and flows.
          </p>
        </div>
        {projects.length > 0 && (
          <Button onClick={() => setCreateOpen(true)} leftIcon={<Plus className="h-4 w-4" />}>
            Create Project
          </Button>
        )}
      </header>

      {!isHydrated ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-lg border border-slate-200 bg-slate-100/60"
              aria-hidden="true"
            />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <ProjectEmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <ProjectList projects={projects} />
      )}

      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  );
}