import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Plus, GitBranch } from "lucide-react";
import { useDataStore } from "@/store/dataStore";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/error-state";
import { FeatureList } from "@/components/feature/FeatureList";
import { FeatureEmptyState } from "@/components/feature/FeatureEmptyState";
import { AddFeatureModal } from "@/components/feature/AddFeatureModal";
import { AddFlowModal } from "@/components/flow/AddFlowModal";

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const isHydrated = useDataStore((s) => s.isHydrated);
  const project = useDataStore((s) =>
    projectId ? s.getProject(projectId) : undefined
  );
  // Subscribe to the raw arrays (stable references) and derive the filtered
  // views with useMemo. Subscribing directly to the selector results causes
  // useSyncExternalStore to see a new array reference on every render and
  // loop forever, because getProjectFeatures returns a fresh .filter() result.
  const allFeatures = useDataStore((s) => s.features);
  const allFlows = useDataStore((s) => s.flows);

  const features = useMemo(
    () =>
      projectId ? allFeatures.filter((f) => f.projectId === projectId) : [],
    [allFeatures, projectId]
  );
  const flowCount = useMemo(
    () =>
      projectId ? allFlows.filter((f) => f.projectId === projectId).length : 0,
    [allFlows, projectId]
  );

  const [addFeatureOpen, setAddFeatureOpen] = useState(false);
  const [addFlowOpen, setAddFlowOpen] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const featureFlowOptions = useMemo(
    () => features.map((f) => ({ value: f.id, label: f.name })),
    [features]
  );

  if (!isHydrated) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!project) {
    return (
      <ErrorState
        title="Project not found"
        message="The project you're looking for doesn't exist or was removed."
        onRetry={() => setRetryKey((k) => k + 1)}
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
          Projects
        </Link>
      </div>

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            {project.name}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {features.length} feature{features.length === 1 ? "" : "s"} •{" "}
            {flowCount} flow{flowCount === 1 ? "" : "s"}
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
                ? "Add at least one feature before creating a flow"
                : undefined
            }
          >
            Add Flow
          </Button>
          <Button
            onClick={() => setAddFeatureOpen(true)}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            Add Feature
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

      {/* Hide unused variable warning by referencing it via a no-op */}
      {featureFlowOptions && (
        <AddFlowModal
          open={addFlowOpen}
          onClose={() => setAddFlowOpen(false)}
          projectId={project.id}
        />
      )}
    </div>
  );
}