import { ProjectCard } from "./ProjectCard";
import { useProjectFeatures, useProjectFlows } from "@/lib/blocks/hooks";
import type { Project } from "@/lib/blocks/data";

interface ProjectListProps {
  projects: Project[];
}

export function ProjectList({ projects }: ProjectListProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => (
        <ProjectCardWithCounts key={project.id} project={project} />
      ))}
    </div>
  );
}

function ProjectCardWithCounts({ project }: { project: Project }) {
  // Card counts are scoped to the dev env — counting across every env
  // would inflate the totals because cloning to stg/uat/prod produces
  // duplicates of the same dev feature/flow (each clone keeps the dev
  // source's identity via `clonedFromXxxId`). Showing the dev-only count
  // matches what the user sees on /projects/:id (the default page), so
  // the card and the entry page agree.
  const { data: features } = useProjectFeatures(project.id, "dev");
  const { data: flows } = useProjectFlows(project.id, "dev");
  const featureCount = features?.length ?? 0;
  const flowCount = flows?.length ?? 0;
  return (
    <ProjectCard
      project={project}
      featureCount={featureCount}
      flowCount={flowCount}
    />
  );
}