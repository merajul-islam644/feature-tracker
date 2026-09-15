import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Plus, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/error-state";
import { FeatureList } from "@/components/feature/FeatureList";
import { FeatureEmptyState } from "@/components/feature/FeatureEmptyState";
import { AddFeatureModal } from "@/components/feature/AddFeatureModal";
import { AddFlowModal } from "@/components/flow/AddFlowModal";
import {
  useProject,
  useProjectFeatures,
  useProjectFlows,
} from "@/lib/blocks/hooks";
import { useT } from "@/lib/blocks/i18n";

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const projectQuery = useProject(projectId);
  const featuresQuery = useProjectFeatures(projectId);
  const flowsQuery = useProjectFlows(projectId);
  const t = useT();

  const [addFeatureOpen, setAddFeatureOpen] = useState(false);
  const [addFlowOpen, setAddFlowOpen] = useState(false);
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
  const features = featuresQuery.data ?? [];
  const flowCount = flowsQuery.data?.length ?? 0;

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

  return (
    <div className="space-y-6" key={retryKey}>
      <div>
        <Link
          to="/projects"
          className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          {t("projectDetail.backToProjects", "Projects")}
        </Link>
      </div>

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            {project.name}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {t("projects.featureCount", "{count} features", {
              count: features.length,
            })}{" "}
            •{" "}
            {t("projects.flowCount", "{count} flows", { count: flowCount })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => setAddFlowOpen(true)}
            leftIcon={<GitBranch className="h-4 w-4" />}
            disabled={features.length === 0}
            title={
              features.length === 0
                ? t(
                    "projectDetail.addFeatureFirstTooltip",
                    "Add at least one feature before creating a flow",
                  )
                : undefined
            }
          >
            {t("projectDetail.addFlow", "Add Flow")}
          </Button>
          <Button
            onClick={() => setAddFeatureOpen(true)}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            {t("projectDetail.addFeature", "Add Feature")}
          </Button>
        </div>
      </header>

      {features.length === 0 ? (
        <FeatureEmptyState onAdd={() => setAddFeatureOpen(true)} />
      ) : (
        <FeatureList features={features} />
      )}

      <AddFeatureModal
        open={addFeatureOpen}
        onClose={() => setAddFeatureOpen(false)}
        projectId={project.id}
      />

      <AddFlowModal
        open={addFlowOpen}
        onClose={() => setAddFlowOpen(false)}
        projectId={project.id}
      />
    </div>
  );
}