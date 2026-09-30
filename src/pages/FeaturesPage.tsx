import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/error-state";
import { FeatureList } from "@/components/feature/FeatureList";
import { FeatureEmptyState } from "@/components/feature/FeatureEmptyState";
import { AddFeatureModal } from "@/components/feature/AddFeatureModal";
import { BackToProjectsLink } from "@/components/layout/BackToProjectsLink";
import { useProject, useProjectFeatures } from "@/lib/blocks/hooks";
import { useIsRole } from "@/hooks/useAuth";
import { useActiveEnvContext } from "@/contexts/ActiveEnvContext";
import { useT } from "@/lib/blocks/i18n";
import { envLabelFromSlug } from "@/pages/ProjectDetailPage";

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
  const isManager = useIsRole("manager");
  const t = useT();
  const [addFeatureOpen, setAddFeatureOpen] = useState(false);
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
  // Add button + write access only on dev. Other envs (uat, prod,
  // custom) are read-only views of what was authored under dev.
  // Mirrors `ProjectDetailPage`:351-355 and `:425`.
  const isDevEnv = envSlug === "dev";

  return (
    <div className="space-y-6" key={retryKey}>
      <BackToProjectsLink />

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-foreground">
            {t("features.title", "Features")}
          </h1>
          {envSlug && (
            <Badge
              className="border-transparent bg-muted text-muted-foreground"
              aria-label={envLabelFromSlug(envSlug)}
            >
              {envLabelFromSlug(envSlug)}
            </Badge>
          )}
        </div>
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
    </div>
  );
}
