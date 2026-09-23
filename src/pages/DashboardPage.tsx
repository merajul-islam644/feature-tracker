import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  FolderKanban,
  ListChecks,
  GitBranch,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  useProjects,
  useRecentFlows,
  useWorkspaceTotals,
} from "@/lib/blocks/hooks";
import { useLocale, useT } from "@/lib/blocks/i18n";
import { AnnouncementsSection } from "@/components/dashboard/AnnouncementsSection";

export function DashboardPage() {
  const { currentUser } = useAuth();
  const projectsQuery = useProjects();
  const totalsQuery = useWorkspaceTotals();
  const recentFlowsQuery = useRecentFlows(5);
  const t = useT();
  const { formatRelativeTime } = useLocale();

  const projects = projectsQuery.data ?? [];

  const recentProjects = useMemo(
    () =>
      [...projects]
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )
        .slice(0, 5),
    [projects],
  );

  const recentFlows = recentFlowsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">
          {t("dashboard.title", "Dashboard")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {currentUser
            ? t("dashboard.welcome", "Welcome back, {name}.", {
                name: currentUser.name,
              })
            : t("dashboard.welcomeFallback", "Welcome back.")}
        </p>
      </header>

      {/* Manager broadcast — pinned above everything else so a
          "going to prod" style announcement is the first thing every
          member reads after signing in. */}
      <AnnouncementsSection />

      <section
        className="grid gap-4 sm:grid-cols-3"
        aria-label={t("dashboard.statsLabel", "Workspace statistics")}
      >
        <StatCard
          label={t("dashboard.projects", "Projects")}
          value={projects.length}
          icon={<FolderKanban className="h-5 w-5" aria-hidden="true" />}
          loading={projectsQuery.isLoading}
        />
        <StatCard
          label={t("dashboard.features", "Features")}
          value={totalsQuery.data?.features ?? 0}
          icon={<ListChecks className="h-5 w-5" aria-hidden="true" />}
          loading={totalsQuery.isLoading}
        />
        <StatCard
          label={t("dashboard.flows", "Flows")}
          value={totalsQuery.data?.flows ?? 0}
          icon={<GitBranch className="h-5 w-5" aria-hidden="true" />}
          loading={totalsQuery.isLoading}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="recent-projects-heading">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle
                id="recent-projects-heading"
                className="text-base font-semibold"
              >
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
                    <Skeleton key={i} className="h-5 w-full" />
                  ))}
                </div>
              ) : recentProjects.length === 0 ? (
                <p className="px-5 py-6 text-center text-sm text-muted-foreground">
                  {t("dashboard.noProjects", "No projects yet.")}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {recentProjects.map((project) => (
                    <li key={project.id}>
                      <Link
                        to={`/projects/${project.id}`}
                        className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-accent focus:outline-none focus-visible:bg-accent"
                      >
                        <span className="truncate text-sm font-medium text-foreground">
                          {project.name}
                        </span>
                        <span className="text-xs text-muted-foreground">
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

        <section aria-labelledby="recent-flows-heading">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle
                id="recent-flows-heading"
                className="text-base font-semibold"
              >
                {t("dashboard.recentFlows", "Recent Flows")}
              </CardTitle>
              <Badge variant="muted">{recentFlows.length}</Badge>
            </CardHeader>
            <Separator />
            <CardContent className="p-0">
              {recentFlowsQuery.isLoading ? (
                <div className="space-y-2 p-5">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-5 w-full" />
                  ))}
                </div>
              ) : recentFlows.length === 0 ? (
                <p className="px-5 py-6 text-center text-sm text-muted-foreground">
                  {t("dashboard.noFlows", "No flows yet.")}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {recentFlows.map((flow) => (
                    <li
                      key={flow.id}
                      className="flex items-center justify-between gap-3 px-5 py-3"
                    >
                      <span className="truncate text-sm font-medium text-foreground">
                        {flow.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatRelativeTime(flow.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  loading: boolean;
}

function StatCard({ label, value, icon, loading }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3 space-y-0 pb-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
          {icon}
        </div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-9 w-16" />
        ) : (
          <p className="text-3xl font-semibold text-foreground">{value}</p>
        )}
      </CardContent>
    </Card>
  );
}