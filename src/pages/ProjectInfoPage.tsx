// Read-only metadata view of a project. Lives at /projects/:projectId/info.
//
// Surfaces everything the working page (ProjectDetailPage) doesn't:
// description, status, color, created/updated timestamps, the full env
// list (canonical + custom), and per-environment feature/flow counts
// followed by a project-wide total. Counts come from `useProjectFeatures`
// and `useProjectFlows` (env-less) and are grouped client-side, so this
// page does one feature list query + one flow aggregate query regardless
// of how many environments the project has.

import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/error-state";
import {
  useProject,
  useProjectFeatures,
  useProjectFlows,
} from "@/lib/blocks/hooks";
import { useLocale, useT } from "@/lib/blocks/i18n";
import { cn } from "@/lib/utils";
import { envChipStyle } from "@/components/ui/color-picker";
import {
  PROJECT_ENVS,
  PROJECT_ENV_META,
} from "./ProjectDetailPage";
import type { CanonicalEnvSlug } from "@/lib/validation";
import type { ProjectCustomEnv } from "@/lib/blocks/data";

interface EnvCount {
  slug: string;
  label: string;
  features: number;
  flows: number;
  isCustom: boolean;
  /** Inline color tint for custom env chips. */
  customColor?: string;
  /** Tailwind class for canonical env chips. */
  className?: string;
}

export function ProjectInfoPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const projectQuery = useProject(projectId);
  const { t, formatRelativeTime } = useLocale();

  // Env-less reads so we can group client-side across every env. The
  // hook queries are gated on `projectId`, so they don't fire until the
  // project resolves. Legacy records (no envSlug) are still in scope.
  const featuresQuery = useProjectFeatures(projectId);
  const flowsQuery = useProjectFlows(projectId);

  if (projectQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const project = projectQuery.data;

  if (!project) {
    return (
      <ErrorState
        title={t("projects.notFound", "Project not found")}
        message={t(
          "projects.notFoundMessage",
          "The project you're looking for doesn't exist or was removed.",
        )}
        onRetry={() => {
          projectQuery.refetch();
        }}
      />
    );
  }

  const customEnvs: ProjectCustomEnv[] = project.customEnvs ?? [];
  const features = featuresQuery.data ?? [];
  const flows = flowsQuery.data ?? [];

  // Build the per-env count table: canonical first (dev→uat) so the
  // order matches the chip list on the card, then user-defined envs in
  // the order they were added. A trailing "Unassigned" row catches
  // legacy records with no envSlug — they exist today and would
  // otherwise disappear from the page.
  const counts: EnvCount[] = [
    ...PROJECT_ENVS.map((slug) => {
      const meta = PROJECT_ENV_META[slug as CanonicalEnvSlug];
      return {
        slug,
        label: t(
          `projectCard.env${slug.charAt(0).toUpperCase() + slug.slice(1)}`,
          meta.shortLabel,
        ),
        features: 0,
        flows: 0,
        isCustom: false,
        className: meta.className,
      };
    }),
    ...customEnvs.map((env) => ({
      slug: env.slug,
      label: env.label || env.slug,
      features: 0,
      flows: 0,
      isCustom: true,
      customColor: env.color || "#0ea5e9",
    })),
  ];
  let unassignedFeatures = 0;
  let unassignedFlows = 0;

  for (const f of features) {
    const idx = f.envSlug
      ? counts.findIndex((c) => c.slug === f.envSlug)
      : -1;
    if (idx === -1) unassignedFeatures += 1;
    else counts[idx].features += 1;
  }
  for (const fl of flows) {
    const idx = fl.envSlug
      ? counts.findIndex((c) => c.slug === fl.envSlug)
      : -1;
    if (idx === -1) unassignedFlows += 1;
    else counts[idx].flows += 1;
  }
  if (unassignedFeatures > 0 || unassignedFlows > 0) {
    counts.push({
      slug: "",
      label: t("projectInfo.unassignedEnv", "Unassigned"),
      features: unassignedFeatures,
      flows: unassignedFlows,
      isCustom: false,
      className: "border-border bg-muted text-muted-foreground",
    });
  }

  const totalFeatures = counts.reduce((sum, c) => sum + c.features, 0);
  const totalFlows = counts.reduce((sum, c) => sum + c.flows, 0);
  const countsReady = !featuresQuery.isLoading && !flowsQuery.isLoading;

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/projects"
          className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          {t("projectInfo.backToProject", "Back to project")}
        </Link>
      </div>

      <header>
        <h1 className="text-2xl font-semibold text-foreground">
          {t("projectInfo.title", "Project Details")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{project.name}</p>
      </header>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-2.5 text-center">
                  {t("projectInfo.field.name", "Name")}
                </th>
                <th className="px-5 py-2.5 text-center">
                  {t("projectInfo.field.status", "Status")}
                </th>
                <th className="px-5 py-2.5 text-center">
                  {t("projectInfo.field.color", "Color")}
                </th>
                <th className="px-5 py-2.5 text-center">
                  {t("projectInfo.field.description", "Description")}
                </th>
                <th className="px-5 py-2.5 text-center">
                  {t("projectInfo.field.createdAt", "Created")}
                </th>
                <th className="px-5 py-2.5 text-center">
                  {t("projectInfo.field.updatedAt", "Updated")}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="px-5 py-3 text-center font-medium text-foreground">
                  {project.name}
                </td>
                <td className="px-5 py-3 text-center text-foreground">
                  {project.status ? capitalize(project.status) : "—"}
                </td>
                <td className="px-5 py-3 text-center text-foreground">
                  {project.color ? (
                    <span className="inline-flex items-center justify-center gap-2">
                      <span
                        className="inline-block h-4 w-4 rounded border border-border"
                        style={{ backgroundColor: project.color }}
                        aria-label={project.color}
                      />
                      <span className="font-mono text-xs text-muted-foreground">
                        {project.color}
                      </span>
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-5 py-3 text-center text-foreground">
                  {project.description?.trim() ? (
                    <span className="whitespace-pre-wrap">
                      {project.description}
                    </span>
                  ) : (
                    <span className="text-muted-foreground italic">
                      {t("projectInfo.emptyDescription", "No description")}
                    </span>
                  )}
                </td>
                <td className="px-5 py-3 text-center text-foreground">
                  {formatRelativeTime(project.createdAt)}
                </td>
                <td className="px-5 py-3 text-center text-foreground">
                  {formatRelativeTime(project.updatedAt)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {t("projectInfo.countsHeading", "Counts by environment")}
        </h2>
        <Card className="mt-3 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="px-5 py-2.5">
                    {t("projectInfo.colEnv", "Environment")}
                  </th>
                  <th className="px-5 py-2.5 text-center">
                    {t("projectInfo.colFeatures", "Features")}
                  </th>
                  <th className="px-5 py-2.5 text-center">
                    {t("projectInfo.colFlows", "Flows")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {counts.map((c) => (
                  <EnvCountRow
                    key={c.slug || "__unassigned__"}
                    row={c}
                    ready={countsReady}
                  />
                ))}
                <tr className="bg-muted/30">
                  <td className="px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-foreground">
                    {t("projectInfo.totalLabel", "Total")}
                  </td>
                  <td className="px-5 py-2.5 text-center font-semibold text-foreground">
                    {countsReady ? totalFeatures : "…"}
                  </td>
                  <td className="px-5 py-2.5 text-center font-semibold text-foreground">
                    {countsReady ? totalFlows : "…"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      </section>
    </div>
  );
}

// One env row in the counts table. Renders the env as a chip in the
// first cell so canonical and custom envs are visually identical to the
// chip list above; the next two cells hold the feature and flow counts.
function EnvCountRow({ row, ready }: { row: EnvCount; ready: boolean }) {
  return (
    <tr>
      <td className="px-5 py-2.5">
        {row.isCustom ? (
          <span
            className="inline-flex items-center rounded-full border border-transparent px-2 py-0.5 text-xs font-medium"
            style={envChipStyle(row.customColor || "#0ea5e9")}
          >
            {row.label}
          </span>
        ) : (
          <span
            className={cn(
              "inline-flex items-center rounded-full border border-transparent px-2 py-0.5 text-xs font-medium",
              row.className,
            )}
          >
            {row.label}
          </span>
        )}
      </td>
      <td className="px-5 py-2.5 text-center font-medium text-foreground tabular-nums">
        {ready ? row.features : "…"}
      </td>
      <td className="px-5 py-2.5 text-center font-medium text-foreground tabular-nums">
        {ready ? row.flows : "…"}
      </td>
    </tr>
  );
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
