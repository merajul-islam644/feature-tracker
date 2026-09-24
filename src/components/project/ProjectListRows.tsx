// One-row-per-project layout for the /projects page. Each row matches
// the loading skeleton's shape exactly — `rounded-md border border-border`
// at `min-h-[3.5rem]` (= 56px, the skeleton height) — so the swap-in
// from skeleton to row doesn't reflow and the visual rhythm stays
// consistent. The skeleton's `bg-muted/40` becomes `bg-card` once the
// row has content (a muted background on populated rows would be
// visually noisy at 20+ projects); hover re-introduces an accent tint
// to signal the row is interactive.
//
// Row geometry (single 56px+ line):
//   [folder icon] [name + relative time]   [env chips]   [features] [flows] [kebab]
//
// `min-h-[3.5rem]` lets a row grow when env chips wrap to a second
// line — projects with many custom envs would otherwise truncate the
// chip strip. Rows with ≤4 envs sit at exactly 56px, matching the
// skeleton.
//
// Tester role gating: kebab uses `RowKebabMenu`'s `readOnly` mode so
// testers see only "Project Details"; rename/delete hooks are still
// reachable via the mutation hooks' own role check (defense in depth).

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FolderKanban,
  GitBranch,
  Info,
  ListChecks,
} from "lucide-react";
import {
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { RowKebabMenu } from "@/components/ui/row-kebab";
import { EnvironmentChips } from "./EnvironmentChips";
import { RenameProjectModal } from "./RenameProjectModal";
import { DeleteProjectDialog } from "./DeleteProjectDialog";
import { useLocale, useT } from "@/lib/blocks/i18n";
import { useIsRole } from "@/hooks/useAuth";
import type { Project } from "@/lib/blocks/data";
import type { ProjectsCounts } from "./ProjectList";

interface ProjectListRowsProps {
  projects: Project[];
  counts: ProjectsCounts;
}

export function ProjectListRows({ projects, counts }: ProjectListRowsProps) {
  // `space-y-2` matches the skeleton wrapper exactly — same vertical
  // rhythm between rows whether we're loading or loaded.
  return (
    <div className="space-y-2">
      {projects.map((project) => (
        <ProjectListRow
          key={project.id}
          project={project}
          featureCount={counts.get(project.id)?.features ?? 0}
          flowCount={counts.get(project.id)?.flows ?? 0}
        />
      ))}
    </div>
  );
}

function ProjectListRow({
  project,
  featureCount,
  flowCount,
}: {
  project: Project;
  featureCount: number;
  flowCount: number;
}) {
  const navigate = useNavigate();
  const { formatRelativeTime } = useLocale();
  const t = useT();
  const isTester = useIsRole("tester");
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const customEnvs = project.customEnvs ?? [];

  return (
    // Container matches `ProjectsPage.tsx`'s loading skeleton:
    //   rounded-md border border-border, min-h-[3.5rem] (= 56px)
    // The bg swap (muted→card) is intentional: a muted bg on every
    // populated row would look washed-out at 20+ rows.
    <div className="flex min-h-[3.5rem] w-full items-center gap-3 rounded-md border border-border bg-card px-3 py-2 transition-colors hover:bg-accent/40">
      {/* Left cluster: folder icon + name + relative time */}
      <div className="flex min-w-0 items-center gap-2 sm:basis-1/4 sm:shrink-0">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <FolderKanban className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-foreground">
            {project.name}
          </h3>
          <p className="truncate text-xs text-muted-foreground">
            {t("projects.updated", "Updated {relative}", {
              relative: formatRelativeTime(project.updatedAt),
            })}
          </p>
        </div>
      </div>

      {/* Middle cluster: env chips. `flex-1` claims the remaining
          horizontal space so the chips sit centered between the name
          and the counts. Chips wrap to a 2nd line if there are >4
          envs. */}
      <div className="flex min-w-0 flex-1 items-center justify-center">
        <EnvironmentChips
          customEnvs={customEnvs}
          mode="link"
          projectId={project.id}
        />
      </div>

      {/* Right cluster: feature/flow counts + kebab. Counts collapse
          to icon-only on narrow widths so the kebab stays reachable. */}
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ListChecks className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">
          <span className="font-semibold text-foreground">{featureCount}</span>{" "}
          {t("dashboard.features", "Features")}
        </span>
      </span>
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <GitBranch className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">
          <span className="font-semibold text-foreground">{flowCount}</span>{" "}
          {t("dashboard.flows", "Flows")}
        </span>
      </span>
      <RowKebabMenu
        ariaLabel={t("projectCard.menu", "Project actions")}
        readOnly={isTester}
        viewDetailsLabel={t("projectCard.details", "Project Details")}
        onViewDetails={() => navigate(`/projects/${project.id}/info`)}
        renameLabel={t("projectCard.rename", "Rename")}
        deleteLabel={t("projectCard.delete", "Delete")}
        onRename={() => setRenameOpen(true)}
        onDelete={() => setDeleteOpen(true)}
        // `extraItems` slot is only used in the editable (non-tester)
        // branch. The Details item sits above Rename so the visual
        // order matches ProjectCard: Details → Rename → Delete.
        extraItems={
          <DropdownMenuItem
            onSelect={() => navigate(`/projects/${project.id}/info`)}
          >
            <Info className="h-4 w-4" aria-hidden="true" />
            <span>{t("projectCard.details", "Project Details")}</span>
          </DropdownMenuItem>
        }
      />

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
