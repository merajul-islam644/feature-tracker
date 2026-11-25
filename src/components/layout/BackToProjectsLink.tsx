// Breadcrumb trail used at the top of every page mounted under
// `/projects/:projectId/...` — renders as the very first row of the
// page content, above the page header. Started life as the plain
// "← Projects" back link the user asked for (2026-09-29); refined on
// 2026-11-24 into the "Projects › Project Name" trail: the back arrow
// is gone and the project name is deliberately NOT clickable (user
// request) — only the "Projects" crumb navigates, to `/projects`.
//
//   Projects  ›  Acme Portal        ← identical on every consumer page
//
// `/projects` (the project list) is the only parent that's always
// reachable and means the same thing across every project — env
// landings vary by project, so they were never used as the parent.
//
// The project name resolves from the shared `useProjects` cache (60 s
// staleTime) — the same read every project-aware surface uses, so the
// breadcrumb costs no extra round-trip once anything else has fetched
// the list, and it fills in on its own if this page deep-loaded before
// the list arrived. While the name is unknown the component degrades
// to a lone "Projects" link.
//
// `useParams` supplies the (projectId) context on every consumer route
// — all nine pages sit under a path that carries `:projectId` — so no
// call site needs to pass anything.
//
// Same i18n key as before (`projectDetail.backToProjects`, fallback
// "Projects") so the first crumb keeps one consistent label. The
// `<div>` wrapper preserves the vertical spacing every consumer
// already tuned around this row.

import { Link, useParams } from "react-router-dom";
import { useProjects } from "@/lib/blocks/hooks";
import { useT } from "@/lib/blocks/i18n";

export function BackToProjectsLink() {
  const t = useT();
  const { projectId } = useParams<{ projectId: string }>();
  const projectsQuery = useProjects();
  const project = projectId
    ? projectsQuery.data?.find((p) => p.id === projectId)
    : undefined;

  return (
    <div>
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 items-center gap-1 text-sm font-medium text-muted-foreground"
      >
        <Link
          to="/projects"
          className="shrink-0 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
        >
          {t("projectDetail.backToProjects", "Projects")}
        </Link>
        {projectId && project && (
          <>
            <span className="shrink-0 opacity-70" aria-hidden="true">
              ›
            </span>
            <span
              className="truncate text-foreground first-letter:uppercase"
              title={project.name}
            >
              {project.name}
            </span>
          </>
        )}
      </nav>
    </div>
  );
}
