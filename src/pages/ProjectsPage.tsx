import { useMemo, useState } from "react";
import { FolderKanban, Layers, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectList } from "@/components/project/ProjectList";
import { ProjectListRows } from "@/components/project/ProjectListRows";
import { ProjectEmptyState } from "@/components/project/ProjectEmptyState";
import { ViewToggle } from "@/components/project/ViewToggle";
import { CreateProjectModal } from "@/components/project/CreateProjectModal";
import { AddEnvironmentModal } from "@/components/project/AddEnvironmentModal";
import { useProjects, useProjectsDevCounts } from "@/lib/blocks/hooks";
import { useIsRole } from "@/hooks/useAuth";
import { useT } from "@/lib/blocks/i18n";
import { useProjectsViewStore } from "@/store/projectsViewStore";

export function ProjectsPage() {
  const { data: projects, isLoading: projectsLoading } = useProjects();
  // Single round trip per workspace for all the feature/flow counts
  // both surfaces need — see `useProjectsDevCounts` in `hooks.ts`.
  // `counts` is `Map<projectId, {features, flows}>`; passing the empty
  // Map during initial load keeps both surfaces from crashing on the
  // very first render.
  const { data: counts } = useProjectsDevCounts();
  const viewMode = useProjectsViewStore((s) => s.mode);
  const t = useT();
  // Testers can browse existing environments but cannot add new ones. The
  // hook itself enforces this — see `useAddProjectEnv` in `hooks.ts` —
  // but hiding the CTA keeps the page honest about what a tester can do.
  const isTester = useIsRole("tester");
  const [createOpen, setCreateOpen] = useState(false);
  const [addEnvOpen, setAddEnvOpen] = useState(false);
  // Filter is session-local — no persistence. The user typed query is
  // intentionally not in localStorage: a stale filter from a previous
  // session would silently hide everything and confuse the next user
  // who opens the page.
  const [filter, setFilter] = useState("");
  const allProjects = projects ?? [];
  // Case-insensitive substring match on project name. Trimming handles
  // trailing spaces that users sometimes paste. Using `useMemo` so the
  // filter pass doesn't re-run on every unrelated re-render (toggle
  // hover, etc.); the dependency list intentionally only covers
  // `allProjects` and `filter`.
  const list = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return allProjects;
    return allProjects.filter((p) => p.name.toLowerCase().includes(q));
  }, [allProjects, filter]);
  // Counts depend on `useAliveScope` (the shared hook), which starts
  // fetching on mount. Until it resolves, fall back to an empty map
  // so `counts.get(id)?.features ?? 0` reads as 0 in both surfaces.
  const countsMap = counts ?? new Map<string, { features: number; flows: number }>();
  // Loading is "true" while either the project list or the counts are
  // still in flight. Card/row surfaces both depend on counts, so the
  // skeleton must wait until both are ready.
  const isLoading = projectsLoading || counts === undefined;

  return (
    <div className="space-y-6">
      {/* Header — title block on the left, actions cluster on the
          right. The actions cluster is a single row: filter input
          leftmost, then ViewToggle (a "global" control that affects
          the whole list), then Add Environment, then Create Project.
          Tester hider applies to the buttons only — the toggle and
          the filter are visible to everyone (both only touch
          localStorage / component state, no network or mutation). */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-muted text-primary"
            >
              <FolderKanban className="h-4 w-4" />
            </span>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {t("projects.title", "Projects")}
            </h1>
            {allProjects.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {/* Show matched/total when filtering so users can see
                    "how many of mine are filtered out" without counting
                    mentally. Falls back to total when no filter is set. */}
                {filter.trim() ? `${list.length} / ${allProjects.length}` : allProjects.length}
              </span>
            )}
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t(
              "projects.subtitle",
              "Manage your projects, features, and flows.",
            )}
          </p>
        </div>
        {allProjects.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Filter input — case-insensitive substring match on
                project name. Width is bounded so it doesn't squeeze
                the action buttons on narrower viewports; on mobile it
                sits on its own row thanks to the parent's flex-wrap. */}
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                type="search"
                role="searchbox"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t("projects.filter.placeholder", "Filter projects")}
                aria-label={t("projects.filter.placeholder", "Filter projects")}
                className="h-9 w-44 rounded-md border border-input bg-background pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 sm:w-56"
              />
            </div>
            <ViewToggle />
            {!isTester && (
              <>
                <Button
                  variant="outline"
                  onClick={() => setAddEnvOpen(true)}
                >
                  <Layers className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {t("addEnvironment.cta", "Add Environment")}
                </Button>
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {t("projects.createCta", "Create Project")}
                </Button>
              </>
            )}
          </div>
        )}
      </header>

      {isLoading ? (
        viewMode === "list" ? (
          // Row-shaped skeletons for list mode — match the 56px row
          // height so the swap-in doesn't reflow on load. Eleven
          // rows fills the viewport on a typical laptop without
          // inviting a layout shift if the real list is shorter.
          <div className="space-y-2" aria-hidden="true">
            {Array.from({ length: 11 }).map((_, i) => (
              <div
                key={i}
                className="h-14 w-full rounded-md border border-border bg-muted/40"
              />
            ))}
          </div>
        ) : (
          // 3-column card grid skeleton (default). Nine cards fills
          // three rows of the 1/2/3-column responsive grid (1 col on
          // mobile, 2 on sm, 3 on lg) without an awkward last-row
          // gap during load.
          <div
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            aria-hidden="true"
          >
            {Array.from({ length: 9 }).map((_, i) => (
              <div
                key={i}
                className="h-32 animate-pulse rounded-xl border border-border bg-muted/40"
              />
            ))}
          </div>
        )
      ) : allProjects.length === 0 ? (
        <ProjectEmptyState onCreate={() => setCreateOpen(true)} />
      ) : list.length === 0 ? (
        // Filter cleared the visible list — show a small inline hint
        // rather than the workspace-wide empty state (which would
        // mislead users into thinking there are no projects).
        <div className="rounded-xl border border-dashed border-border bg-card/40 px-4 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            {t(
              "projects.filter.noMatches",
              "No projects match \"{query}\".",
              { query: filter.trim() },
            )}
          </p>
          <button
            type="button"
            onClick={() => setFilter("")}
            className="mt-2 text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          >
            {t("projects.filter.clear", "Clear filter")}
          </button>
        </div>
      ) : viewMode === "list" ? (
        <ProjectListRows projects={list} counts={countsMap} />
      ) : (
        <ProjectList projects={list} counts={countsMap} />
      )}

      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
      <AddEnvironmentModal
        open={addEnvOpen}
        onClose={() => setAddEnvOpen(false)}
      />
    </div>
  );
}
