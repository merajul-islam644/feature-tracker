import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Plus, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/error-state";
import { FeatureList } from "@/components/feature/FeatureList";
import { FeatureEmptyState } from "@/components/feature/FeatureEmptyState";
import { AddFeatureModal } from "@/components/feature/AddFeatureModal";
import { EnvHeaderChip } from "@/components/project/EnvHeaderChip";
import { BootstrapDialog } from "@/components/project/BootstrapDialog";
import { BackToProjectsLink } from "@/components/layout/BackToProjectsLink";
import { useEnvironments, useProject, useProjectFeatures } from "@/lib/blocks/hooks";
import { useIsRole } from "@/hooks/useAuth";
import { useActiveEnvContext } from "@/contexts/ActiveEnvContext";
import { useT } from "@/lib/blocks/i18n";

// Dedicated features view — `/projects/:projectId/:envSlug/features`.
// Renders every feature authored under the active env on a single
// page (no nested routing, no hash anchors). The env-scoped read goes
// through the same `useProjectFeatures` hook used by
// `ProjectDetailPage`, so the cache is shared between the two pages
// for the same env (no double fetch on switch).
export function FeaturesPage() {
  const { projectId, envSlug } = useParams<{
    projectId: string;
    envSlug: string;
  }>();
  const { setEnv } = useActiveEnvContext();
  // Mirror `ProjectDetailPage`:200-219 — push the (projectId,
  // envSlug) pair into the env context so Issue Tracker sub-routes
  // (which sit outside this tree) keep their reads and mutations
  // scoped to the same env. No cleanup on unmount: leaving
  // ProjectDetailPage unmounts first, but Issue Tracker sub-routes
  // still need the env to stay mounted; the next entry into any
  // project env simply re-stamps whatever's there.
  useEffect(() => {
    if (projectId && envSlug) {
      setEnv({ projectId, envSlug });
    }
  }, [projectId, envSlug, setEnv]);

  const projectQuery = useProject(projectId);
  const featuresQuery = useProjectFeatures(projectId, envSlug);
  // The env list — row identity drives the dev gate and the header label
  // (slugs are renameable display caches under v2.1).
  const environmentsQuery = useEnvironments(projectId ?? null);
  const isManager = useIsRole("manager");
  const t = useT();
  const [addFeatureOpen, setAddFeatureOpen] = useState(false);
  const [bootstrapOpen, setBootstrapOpen] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  if (projectQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-1/2" />
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
          setRetryKey((k) => k + 1);
          projectQuery.refetch();
        }}
      />
    );
  }

  const features = featuresQuery.data ?? [];
  const envRows = environmentsQuery.data ?? [];
  // Add button + write access only on the env whose row kind is "dev".
  // Other envs (uat, prod, custom) are read-only views of what was
  // authored under dev. Mirrors `ProjectDetailPage`'s `isDevEnv`. While
  // the env rows are still loading (or in the deployment gap) the
  // canonical slug check stands in.
  const isDevEnv = envRows.length
    ? envRows.find((e) => e.slug === envSlug)?.kind === "dev"
    : envSlug === "dev";
  // Header badge label + rename/delete triggers live inside EnvHeaderChip;
  // this page only keeps isDevEnv for the authoring gates below.

  return (
    <div className="space-y-6" key={retryKey}>
      <BackToProjectsLink />

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-foreground">
            {t("features.title", "Features")}
          </h1>
          {/* `actions` — the pencil/trash pair renders here ONLY (user
              asked, 2026-10-01); every other env page shows the badge. */}
          {envSlug && <EnvHeaderChip actions />}
        </div>
        {/* Bootstrap renders on EVERY env page, for every role — the
            project card's env chips land here, so this is the page the
            "Bootstrap with an AI agent" handoff lives on. Read-only
            prompt generator: no mutation, no role gate, unlike the
            Add Feature CTA next to it. */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setBootstrapOpen(true)}
            leftIcon={<Rocket className="h-4 w-4" />}
          >
            {t("projectDetail.bootstrap", "Bootstrap")}
          </Button>
          {/* Manager + dev only — mirrors `ProjectDetailPage`:395. The
              Add Feature CTA is intentionally absent on non-dev envs
              and for non-managers; the empty state's `onAdd` follows
              the same rule. `useCreateFeature` throws the same error
              if reached through any other path. */}
          {isDevEnv && isManager && (
            <Button
              onClick={() => setAddFeatureOpen(true)}
              leftIcon={<Plus className="h-4 w-4" />}
            >
              {t("projectDetail.addFeature", "Add Feature")}
            </Button>
          )}
        </div>
      </header>

      {features.length === 0 ? (
        <FeatureEmptyState
          {...(isManager && isDevEnv
            ? { onAdd: () => setAddFeatureOpen(true) }
            : {})}
        />
      ) : (
        <FeatureList
          features={features}
          readOnly={!isDevEnv}
          envSlug={envSlug}
        />
      )}

      <AddFeatureModal
        open={addFeatureOpen}
        onClose={() => setAddFeatureOpen(false)}
        projectId={project.id}
        envSlug={envSlug}
      />

      {/* projectId + envSlug pin the walk scope into the copied prompt. */}
      <BootstrapDialog
        open={bootstrapOpen}
        onClose={() => setBootstrapOpen(false)}
        projectId={projectId}
        envSlug={envSlug}
      />
    </div>
  );
}
