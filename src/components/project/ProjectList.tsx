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
  const { data: features } = useProjectFeatures(project.id);
  const { data: flows } = useProjectFlows(project.id);
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