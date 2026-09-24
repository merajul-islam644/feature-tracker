import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Bug,
  FolderKanban,
  GitBranch,
  FlaskConical,
  ListChecks,
  Megaphone,
  Users,
  ArrowRight,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EnvChip } from "@/components/ui/env-chip";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Separator } from "@/components/ui/separator";
import { AnnouncementsDialog } from "@/components/layout/AnnouncementsDialog";
import { TestConfirmationDialog } from "@/components/dashboard/TestConfirmationDialog";
import {
  useProjects,
  useRecentFeatures,
  useWorkspaceTotals,
  useAnnouncementsAutoOpen,
} from "@/lib/blocks/hooks";
import { useAllJoinedUsers } from "@/lib/blocks/users";
import { useLocale, useT } from "@/lib/blocks/i18n";
import { cn } from "@/lib/utils";

/*
 * Dashboard — see DESIGN-APP-v1.md §6.2.
 *
 * Layout (single column):
 *   1. Hero row: greeting + date on the left, Megaphone icon in the
 *      top-right corner that opens the announcements broadcast modal
 *      (same `AnnouncementsDialog` mounted from the topbar speaker
 *      trigger — same shared React Query, single source of truth).
 *   2. Metrics row: 4 StatCards (Projects, Features, Flows, Members)
 *   3. Recent projects (grid) + Recent features (compact list, equal width)
 *
 * The dashboard stays a calm read-only summary; the icon trigger is
 * the dedicated surface for broadcast content.
 *
 * The Verification activity card was removed — it was a placeholder
 * showing "No verification runs yet" + an Idle chip + a duplicate
 * "Open Issue Tracker" link. The Issues page is the canonical place
 * to start and monitor verification runs; the sidebar already
 * exposes it directly.
 */

export function DashboardPage() {
  const { currentUser } = useAuth();
  const projectsQuery = useProjects();
  const totalsQuery = useWorkspaceTotals();
  const recentFeaturesQuery = useRecentFeatures(5);
  const t = useT();
  const { formatRelativeTime } = useLocale();

  // Auto-open the announcements modal on a new broadcast. Lives here
  // (and not in the Topbar, which used to own it) because the
  // pill button on this page is now the canonical entry point for
  // the broadcast channel. Sharing the hook keeps the "fresh arrival
  // pops the dialog" behaviour intact without forcing the user to
  // hunt for the trigger somewhere else on the dashboard.
  const [announcementsOpen, setAnnouncementsOpen] =
    useAnnouncementsAutoOpen();

  const projects = projectsQuery.data ?? [];
  const members = useAllJoinedUsers().data ?? [];

  const recentProjects = useMemo(
    () =>
      [...projects]
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )
        .slice(0, 6),
    [projects]
  );

  const recentFeatures = recentFeaturesQuery.data ?? [];

  // `useRecentFeatures` filters by `scope.projectIds` but doesn't join the
  // project record, so each item only carries `feature.projectId`. The
  // workspace projects are already loaded for the metrics + recent-projects
  // card, so we just project them into a lookup table — no extra round-trip.
  const projectNameById = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name] as const)),
    [projects],
  );

  // All four metrics are sourced from real hooks — never show zeros when
  // a query is still loading. The previous version mapped the spec's
  // placeholder names onto the wrong fields (openIssues / verified /
  // pending / members aren't on `useWorkspaceTotals`), which made every
  // card render 0 once the spec's names didn't match the store.
  const featuresCount = totalsQuery.data?.features ?? 0;
  const flowsCount = totalsQuery.data?.flows ?? 0;

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="space-y-8">
      {/* Hero row — greeting + date on the left, larger "Announcements"
          pill button pinned to the top-right corner. Sized to match the
          hero headline visually so the icon+label reads as a deliberate
          affordance rather than a utility chip. Opens the same
          `AnnouncementsDialog` mounted from the topbar speaker trigger
          — React Query keeps the dataset in lockstep across both
          entry points. */}
      <section aria-labelledby="dashboard-hero-heading">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {today}
            </p>
            <h1
              id="dashboard-hero-heading"
              className="text-3xl font-semibold tracking-tight text-foreground"
            >
              {currentUser
                ? t("dashboard.welcome", "Welcome back, {name}.", {
                    name: currentUser.name,
                  })
                : t("dashboard.welcomeFallback", "Welcome back.")}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Test button — opens the permission-card confirmation
                modal. Sized to match the Announcements pill (same
                `h-11`, same border treatment) so the two read as a
                paired row of utility affordances. The icon (`FlaskConical`)
                echoes the test/QA semantic of the trigger. */}
            <TestConfirmationDialog>
              <button
                type="button"
                aria-label={t("dashboard.testButton", "Test")}
                title={t("dashboard.testButton", "Test")}
                className={cn(
                  // Amber treatment mirrors the deployment-notice
                  // modal the button opens — the pill visually
                  // previews the card it will reveal. Solid per-mode
                  // backgrounds (instead of low-opacity washes) keep
                  // the affordance legible in both themes, and the
                  // saturated amber border gives the button a
                  // deliberate edge against the neighbouring
                  // Announcements pill (which keeps the primary
                  // tint).
                  "inline-flex h-11 items-center gap-2 rounded-md border px-4 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2",
                  "border-amber-500/40 bg-amber-500/10 text-amber-900 hover:bg-amber-500/15 focus-visible:ring-amber-500/60",
                  "dark:border-amber-500/50 dark:bg-amber-500/15 dark:text-amber-100 dark:hover:bg-amber-500/25 dark:focus-visible:ring-amber-500/70",
                )}
              >
                <FlaskConical
                  className="h-5 w-5 text-amber-700 dark:text-amber-400"
                  aria-hidden="true"
                />
                <span>{t("dashboard.testButton", "Test")}</span>
              </button>
            </TestConfirmationDialog>

            <AnnouncementsDialog
              open={announcementsOpen}
              onOpenChange={setAnnouncementsOpen}
            >
              <button
                type="button"
                aria-label={t(
                  "announcements.openModal",
                  "Open announcements",
                )}
                title={t("announcements.openModal", "Open announcements")}
                className="inline-flex h-11 shrink-0 items-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Megaphone
                  className="h-5 w-5 text-primary -rotate-30 -scale-x-100"
                  aria-hidden="true"
                />
                <span>{t("announcements.title", "Announcements")}</span>
              </button>
            </AnnouncementsDialog>
          </div>
        </div>
      </section>

      {/* Metrics row — 4 StatCards sourced from real hooks. */}
      <section
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        aria-label={t("dashboard.statsLabel", "Workspace statistics")}
      >
        <StatCard
          label={t("dashboard.projects", "Projects")}
          metric={projects.length}
          icon={FolderKanban}
          tone="default"
          supporting={t("dashboard.projectsHint", "Across all environments")}
          loading={projectsQuery.isLoading}
        />
        <StatCard
          label={t("dashboard.features", "Features")}
          metric={featuresCount}
          icon={ListChecks}
          tone="success"
          supporting={t("dashboard.featuresHint", "Tracked capabilities")}
          loading={totalsQuery.isLoading}
        />
        <StatCard
          label={t("dashboard.flows", "Flows")}
          metric={flowsCount}
          icon={GitBranch}
          tone="warning"
          supporting={t("dashboard.flowsHint", "Verified user journeys")}
          loading={totalsQuery.isLoading}
        />
        <StatCard
          label={t("dashboard.members", "Members")}
          metric={members.length}
          icon={Users}
          tone="info"
          supporting={t("dashboard.membersHint", "Workspace roster")}
          loading={members.length === 0}
        />
      </section>

      {/* Recent projects + Recent features — equal-width two-column grid.
          Was lg:grid-cols-3 with projects on col-span-2, which left
          flows on a 1/3-width column and truncated every flow name to
          "Project ..." (the screenshot from the dashboard confirmed
          it). Equal columns give both cards enough room to show their
          items cleanly. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="recent-projects-heading">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle
                id="recent-projects-heading"
                className="flex items-center gap-2 text-base font-semibold"
              >
                <FolderKanban className="h-4 w-4 text-primary" aria-hidden="true" />
                {t("dashboard.recentProjects", "Recent Projects")}
              </CardTitle>
              <Button asChild variant="link" size="sm" className="h-auto px-0">
                <Link to="/projects" className="inline-flex items-center gap-1">
                  {t("dashboard.viewAll", "View all")}
                  <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </Link>
              </Button>
            </CardHeader>
            <Separator />
            <CardContent className="p-0">
              {projectsQuery.isLoading ? (
                <div className="space-y-2 p-5">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full rounded-lg" />
                  ))}
                </div>
              ) : recentProjects.length === 0 ? (
                <EmptyState
                  title={t("dashboard.noProjects", "No projects yet")}
                  description={t(
                    "dashboard.noProjectsDesc",
                    "Projects keep features, flows, environments, and verification evidence together.",
                  )}
                  action={
                    <Button asChild>
                      <Link to="/projects">
                        {t("dashboard.createProject", "Create project")}
                      </Link>
                    </Button>
                  }
                  icon={<FolderKanban className="h-6 w-6" aria-hidden="true" />}
                  className="m-5 min-h-[200px]"
                />
              ) : (
                <ul className="divide-y divide-border">
                  {recentProjects.map((project) => (
                    <li key={project.id}>
                      <Link
                        to={`/projects/${project.id}`}
                        className={cn(
                          "flex items-center justify-between gap-3 px-5 py-3",
                          "transition-colors hover:bg-accent focus:outline-none focus-visible:bg-accent"
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary-muted text-primary"
                            aria-hidden="true"
                          >
                            <FolderKanban className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">
                              {project.name}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {project.description ??
                                t(
                                  "dashboard.projectNoDescription",
                                  "No description",
                                )}
                            </p>
                          </div>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatRelativeTime(project.updatedAt)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>

        <section aria-labelledby="recent-features-heading">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle
                id="recent-features-heading"
                className="flex items-center gap-2 text-base font-semibold"
              >
                <ListChecks className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                {t("dashboard.recentFeatures", "Recent Features")}
              </CardTitle>
            </CardHeader>
            <Separator />
            <CardContent className="p-0">
              {recentFeaturesQuery.isLoading ? (
                <div className="space-y-2 p-5">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full rounded-lg" />
                  ))}
                </div>
              ) : recentFeatures.length === 0 ? (
                <EmptyState
                  title={t("dashboard.noFeatures", "No features yet")}
                  description={t(
                    "dashboard.noFeaturesDesc",
                    "Add the capabilities your team is building across projects.",
                  )}
                  icon={<ListChecks className="h-6 w-6" aria-hidden="true" />}
                  iconClassName="bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300"
                  className="m-5 min-h-[200px]"
                />
              ) : (
                <ul className="divide-y divide-border">
                  {recentFeatures.map((feature) => {
                    // Same envSlug-to-EnvironmentKey mapping as the
                    // flow row used — canonical slugs render their
                    // canonical label (DEV/STG/...); custom envs
                    // render the slug verbatim.
                    const slug = feature.envSlug;
                    const canonicalEnv: "dev" | "stg" | "prod" | "uat" | "custom" =
                      slug === "dev" ||
                      slug === "stg" ||
                      slug === "prod" ||
                      slug === "uat"
                        ? slug
                        : "custom";
                    return (
                      <li
                        key={feature.id}
                        className="flex items-center gap-3 px-5 py-3"
                      >
                        <div
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300"
                          aria-hidden="true"
                        >
                          <ListChecks className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p
                            className="truncate text-sm font-medium text-foreground"
                            title={feature.name}
                          >
                            {feature.name}
                          </p>
                          <p
                            className="truncate text-xs text-muted-foreground"
                            title={
                              projectNameById.get(feature.projectId) ?? ""
                            }
                          >
                            {projectNameById.get(feature.projectId) ?? ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <EnvChip
                            env={canonicalEnv}
                            label={canonicalEnv === "custom" ? slug : undefined}
                          />
                          <span className="text-xs text-muted-foreground">
                            {formatRelativeTime(feature.createdAt)}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      </div>

      {/* Hidden Bug icon reference keeps the import in case future metric
          chips want to render it. */}
      <span className="hidden">
        <Bug />
      </span>
    </div>
  );
}
