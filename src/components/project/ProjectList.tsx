import { ProjectCard } from "./ProjectCard";
import { useDataStore } from "@/store/dataStore";

// Local shape — the canonical schema lives in
// src/types/Shemastructure/Project.ts and is intentionally not imported.
interface Project {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface ProjectListProps {
  projects: Project[];
}

export function ProjectList({ projects }: ProjectListProps) {
  const getProjectFeatures = useDataStore((s) => s.getProjectFeatures);
  const getProjectFlows = useDataStore((s) => s.getProjectFlows);

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => {
        const featureCount = getProjectFeatures(project.id).length;
        const flowCount = getProjectFlows(project.id).length;
        return (
          <ProjectCard
            key={project.id}
            project={project}
            featureCount={featureCount}
            flowCount={flowCount}
          />
        );
      })}
    </div>
  );
}