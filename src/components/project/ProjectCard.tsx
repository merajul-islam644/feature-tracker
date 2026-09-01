import { Link } from "react-router-dom";
import { FolderKanban, ListChecks, GitBranch } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatRelativeDate } from "@/lib/utils";

// Local shape — the canonical schema lives in
// src/types/Shemastructure/Project.ts and is intentionally not imported.
interface Project {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface ProjectCardProps {
  project: Project;
  featureCount: number;
  flowCount: number;
}

export function ProjectCard({
  project,
  featureCount,
  flowCount,
}: ProjectCardProps) {
  return (
    <Link
      to={`/projects/${project.id}`}
      className="group block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <Card className="h-full transition-all group-hover:shadow-md">
        <div className="flex items-start gap-3 p-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <FolderKanban className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-semibold text-foreground group-hover:text-primary">
              {project.name}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Updated {formatRelativeDate(project.updatedAt)}
            </p>
          </div>
        </div>
        <Separator />
        <div className="flex items-center gap-4 px-5 py-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />
            <span>
              <span className="font-semibold text-foreground">
                {featureCount}
              </span>{" "}
              Features
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
            <span>
              <span className="font-semibold text-foreground">{flowCount}</span>{" "}
              Flows
            </span>
          </span>
        </div>
      </Card>
    </Link>
  );
}
