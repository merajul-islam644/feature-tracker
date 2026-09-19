// Project tile in the /projects grid.
//
// The card body is NOT a `<Link>` anymore — chips are the primary navigation
// entry, each one routing to a dedicated /projects/:id/:env page. A kebab
// trigger sits absolutely in the top-right corner and opens a Radix dropdown
// with four actions: Open, Project Details, Rename, Delete.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FolderKanban,
  GitBranch,
  Info,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Settings,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useLocale, useT } from "@/lib/blocks/i18n";
import type { Project } from "@/lib/blocks/data";
import { useIsRole } from "@/hooks/useAuth";
import { RenameProjectModal } from "./RenameProjectModal";
import { DeleteProjectDialog } from "./DeleteProjectDialog";
import { EnvironmentChips } from "./EnvironmentChips";
import { RotatingDottedBorder } from "./RotatingDottedBorder";

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
  const { formatRelativeTime } = useLocale();
  const t = useT();
  const navigate = useNavigate();
  // Testers are read-only on the workspace — they can browse projects and
  // follow Project Details, but Rename / Delete are hidden. The matching
  // hooks (`useUpdateProject`, `useDeleteProject`) also throw the same
  // error if reached programmatically.
  const isTester = useIsRole("tester");
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Stop the Radix dropdown trigger from re-firing the synthetic click
  // after the dropdown opens. No wrapping <Link> to navigate now — the
  // trigger just needs to prevent Radix's click-then-menu-open side effects
  // from bubbling up.
  const swallowTriggerClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  // Custom envs are user-defined per-project. Canonical envs are always
  // shown first (dev→uat) so the chip layout is identical across the
  // workspace; user-added envs follow in the order they were added.
  const customEnvs = project.customEnvs ?? [];

  return (
    <div className="group relative">
      <Card className="h-full">
        <div className="flex items-start gap-3 p-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <FolderKanban className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-semibold text-foreground">
              {project.name}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("projects.updated", "Updated {relative}", {
                relative: formatRelativeTime(project.updatedAt),
              })}
            </p>
            {/* Environment chips — each one is a real button that routes
                to `/projects/:id/<slug>`. The card body itself is not
                clickable; chips are the entry point. Canonical envs use
                Tailwind classes from PROJECT_ENV_META; user-added envs
                apply a hex-tinted style via envChipStyle. When the
                project has more than 4 envs the extras collapse behind
                a `+N` overflow button (shared with the info page). */}
            <div className="mt-2">
              <EnvironmentChips
                customEnvs={customEnvs}
                mode="link"
                projectId={project.id}
              />
            </div>
          </div>
        </div>
        <Separator />
        <div className="flex flex-nowrap items-center gap-3 px-5 py-3 text-xs text-muted-foreground">
          {/* Counts cluster — flex-1 with min-w-0 so it claims the
              remaining space and shrinks/ellipsizes before colliding
              with the pill on the right. */}
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <span className="flex items-center gap-1.5 truncate">
              <ListChecks className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">
                <span className="font-semibold text-foreground">
                  {featureCount}
                </span>{" "}
                {t("dashboard.features", "Features")}
              </span>
            </span>
            <span className="flex items-center gap-1.5 truncate">
              <GitBranch className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">
                <span className="font-semibold text-foreground">
                  {flowCount}
                </span>{" "}
                {t("dashboard.flows", "Flows")}
              </span>
            </span>
          </div>
          {/* Pill — shrink-0 so it always wins for width and never
              gives up space to the counts. Dotted outline is an SVG
              pill whose stroke is dashed and animated via
              stroke-dashoffset so the dots slide around the edge
              continuously. Compactly sized so it fits on the same
              row as the counts without crowding them. */}
          <div className="relative inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-sm pl-2 pr-1 py-1 text-[8px] leading-none">
            <RotatingDottedBorder
              className="absolute inset-0 h-full w-full text-muted-foreground/70"
              aria-hidden="true"
            />
            <span className="relative inline-block animate-blink">
              {t("projectCard.updatedWith", "Updating with DEV")}
            </span>
            <Settings
              className="relative h-3 w-3 animate-spin text-muted-foreground/70"
              aria-hidden="true"
            />
          </div>
        </div>
      </Card>

      {/* Kebab trigger. Always visible so the menu is discoverable without
          hover. Positioned over the top-right of the card. */}
      <div className="absolute right-2 top-2 z-10">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={swallowTriggerClick}
              aria-label={t("projectCard.menu", "Project actions")}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/60 bg-background/80 text-muted-foreground backdrop-blur-sm transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              onSelect={() => navigate(`/projects/${project.id}/info`)}
            >
              <Info className="h-4 w-4" aria-hidden="true" />
              <span>{t("projectCard.details", "Project Details")}</span>
            </DropdownMenuItem>
            {!isTester && (
              <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
                <span>{t("projectCard.rename", "Rename")}</span>
              </DropdownMenuItem>
            )}
            {!isTester && <DropdownMenuSeparator />}
            {!isTester && (
              <DropdownMenuItem
                onSelect={() => setDeleteOpen(true)}
                className="text-red-600 focus:bg-red-50 focus:text-red-700"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                <span>{t("projectCard.delete", "Delete")}</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <RenameProjectModal
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        projectId={project.id}
        currentName={project.name}
        currentStatus={project.status}
      />
      <DeleteProjectDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        project={project}
      />
    </div>
  );
}
