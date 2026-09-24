// Card grid for the /projects page. Counts come from a prop (lifted
// from `ProjectsPage` via `useProjectsDevCounts`) so both the grid and
// the row-based list view share a single round trip per workspace
// instead of one round trip per project.

import { ProjectCard } from "./ProjectCard";
import type { Project } from "@/lib/blocks/data";

export type ProjectsCounts = Map<
  string,
  { features: number; flows: number }
>;

interface ProjectListProps {
  projects: Project[];
  counts: ProjectsCounts;
}

export function ProjectList({ projects, counts }: ProjectListProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => (
        <ProjectCard
          key={project.id}
          project={project}
          featureCount={counts.get(project.id)?.features ?? 0}
          flowCount={counts.get(project.id)?.flows ?? 0}
        />
      ))}
    </div>
  );
}