import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  FolderKanban,
  ListChecks,
  GitBranch,
  ArrowRight,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useDataStore } from "@/store/dataStore";
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
import { formatRelativeDate } from "@/lib/utils";

export function DashboardPage() {
  const { currentUser } = useAuth();
  const projects = useDataStore((s) => s.projects);
  const features = useDataStore((s) => s.features);
  const flows = useDataStore((s) => s.flows);
  const isHydrated = useDataStore((s) => s.isHydrated);

  const stats = useMemo(
    () => ({
      projectCount: projects.length,
      featureCount: features.length,
      flowCount: flows.length,
    }),
    [projects, features, flows]
  );

  const recentProjects = useMemo(
    () =>
      [...projects]
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )
        .slice(0, 5),
    [projects]
  );

  const recentFlows = useMemo(
    () =>
      [...flows]
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
        .slice(0, 5),
    [flows]
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Welcome back, {currentUser?.name ?? "there"}. Here's a snapshot of
          your workspace.
        </p>
      </header>

      {/* Stat cards */}
      <section
        className="grid gap-4 sm:grid-cols-3"
        aria-label="Workspace statistics"
      >
        <StatCard
          label="Projects"
          value={stats.projectCount}
          icon={<FolderKanban className="h-5 w-5" aria-hidden="true" />}
          loading={!isHydrated}
        />
        <StatCard
          label="Features"
          value={stats.featureCount}
          icon={<ListChecks className="h-5 w-5" aria-hidden="true" />}
          loading={!isHydrated}
        />
        <StatCard
          label="Flows"
          value={stats.flowCount}
          icon={<GitBranch className="h-5 w-5" aria-hidden="true" />}
          loading={!isHydrated}
        />
      </section>

      {/* Recent projects & flows */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="recent-projects-heading">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle
                id="recent-projects-heading"
                className="text-base font-semibold"
              >
                Recent Projects
              </CardTitle>
              <Button asChild variant="link" size="sm" className="h-auto px-0">
                <Link to="/projects" className="inline-flex items-center gap-1">
                  View all
                  <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </Link>
              </Button>
            </CardHeader>
            <Separator />
            <CardContent className="p-0">
              {recentProjects.length === 0 ? (
                <p className="px-5 py-6 text-center text-sm text-muted-foreground">
                  No projects yet.
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
                          {formatRelativeDate(project.updatedAt)}
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
                Recent Flows
              </CardTitle>
              <Badge variant="muted">{recentFlows.length}</Badge>
            </CardHeader>
            <Separator />
            <CardContent className="p-0">
              {recentFlows.length === 0 ? (
                <p className="px-5 py-6 text-center text-sm text-muted-foreground">
                  No flows yet.
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
                        {formatRelativeDate(flow.createdAt)}
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
