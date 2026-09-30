// "← Projects" back link used at the top of every page mounted under
// `/projects/:projectId/...`. Renders as the very first row of the
// page content, above the page header, so the user has a single
// canonical "back to projects" affordance across every sub-surface —
// the env landing, info page, features page, and every Issue Tracker
// sub-route. The user explicitly asked (2026-09-29) for this link
// to live on every menu page under `/projects/:projectId/...`.
//
// The link routes to `/projects` (the project list), NOT the env
// landing — the env landing isn't a stable parent because envs vary
// by project (some projects only have dev, others have
// dev/stg/prod/uat + custom envs). `/projects` is the only URL that's
// always reachable and means the same thing across every project.
//
// Same hover/focus styling as the inline link that lived in
// ProjectDetailPage / FeaturesPage; same i18n key
// (`projectDetail.backToProjects`, fallback "Projects") so the user
// sees one consistent label regardless of which surface they came
// from. The `<div>` wrapper preserves the same vertical spacing as
// the original copy — pages that consumed the inline link all used
// `<div className="space-y-6">` with this row as the first child, so
// keeping the wrapper means no consumer has to re-tune their gap.

import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { useT } from "@/lib/blocks/i18n";

export function BackToProjectsLink() {
  const t = useT();
  return (
    <div>
      <Link
        to="/projects"
        className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        {t("projectDetail.backToProjects", "Projects")}
      </Link>
    </div>
  );
}