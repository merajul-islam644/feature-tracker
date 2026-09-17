import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Plus, GitBranch, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/error-state";
import { FeatureList } from "@/components/feature/FeatureList";
import { FeatureEmptyState } from "@/components/feature/FeatureEmptyState";
import { AddFeatureModal } from "@/components/feature/AddFeatureModal";
import { AddFlowModal } from "@/components/flow/AddFlowModal";
import { RenameEnvModal } from "@/components/project/RenameEnvModal";
import {
  useProject,
  useProjectFeatures,
  useProjectFlows,
} from "@/lib/blocks/hooks";
import { useT } from "@/lib/blocks/i18n";
import {
  CANONICAL_ENV_SLUGS,
  type CanonicalEnvSlug,
} from "@/lib/validation";
import { envChipStyle } from "@/components/ui/color-picker";
import type { Project, ProjectCustomEnv } from "@/lib/blocks/data";

// Canonical env slugs that are always available on every project. Order
// matches the dev→uat pipeline order; the page uses this for the chip and
// the card uses it to seed the chip list before custom envs are appended.
export const PROJECT_ENVS: readonly CanonicalEnvSlug[] = CANONICAL_ENV_SLUGS;

// Re-export so call sites that need to narrow `string` → `CanonicalEnvSlug`
// (e.g. the Environment chip's canonical-env colour lookup) don't have to
// import the validation module directly.
export type { CanonicalEnvSlug };

// One row of metadata per canonical env. Custom envs derive their chip
// color from a user-supplied hex via `envChipStyle` and don't appear in
// this table.
export interface CanonicalEnvMeta {
  label: string;
  shortLabel: string;
  i18nKey: string;
  className: string;
}

export const PROJECT_ENV_META: Record<CanonicalEnvSlug, CanonicalEnvMeta> = {
  dev: {
    label: "Development",
    shortLabel: "Dev",
    i18nKey: "projectEnv.envDev",
    className: "border-transparent bg-muted text-muted-foreground",
  },
  stg: {
    label: "Staging",
    shortLabel: "Stg",
    i18nKey: "projectEnv.envStg",
    className: "border-transparent bg-amber-500/10 text-amber-700",
  },
  prod: {
    label: "Production",
    shortLabel: "Prod",
    i18nKey: "projectEnv.envProd",
    className: "border-transparent bg-emerald-500/10 text-emerald-700",
  },
  uat: {
    label: "User Acceptance Testing",
    shortLabel: "Uat",
    i18nKey: "projectEnv.envUat",
    className: "border-transparent bg-violet-500/10 text-violet-700",
  },
};

// Resolved metadata for *any* env — used by both the page header and the
// card chip so the visual treatment of canonical vs. custom envs is in
// one place. Custom envs lose the i18n key (label is stored verbatim) and
// render via inline style instead of a Tailwind class.
export interface ResolvedEnvMeta {
  slug: string;
  label: string;
  shortLabel: string;
  className?: string;
  customStyle?: React.CSSProperties;
  isCustom: boolean;
  // True when the canonical-env label is sourced from
  // `project.envLabelOverrides` rather than the i18n default. Callers
  // that pipe the label through the i18n translator should render the
  // `label` verbatim instead, otherwise the override would be hidden
  // behind a translation that always wins. Custom envs are always
  // verbatim (the user provided the label directly), so this is set on
  // the page for canonical-with-override only.
  hasOverride?: boolean;
}

// Look up metadata for a single env slug. `project` is required for
// custom-env resolution; pass `undefined` to fall back to a plain
// "slug-as-label" rendering for an unknown slug.
//
// Canonical env labels consult `project.envLabelOverrides` first so the
// user can rename a built-in env (e.g. dev → "Local Dev") for a single
// project without touching the global i18n label.
export function resolveEnvMeta(
  slug: string | undefined,
  project: Project | null | undefined,
): ResolvedEnvMeta | null {
  if (!slug) return null;
  const canonical = (PROJECT_ENVS as readonly string[]).includes(slug);
  if (canonical) {
    const meta = PROJECT_ENV_META[slug as CanonicalEnvSlug];
    const override = project?.envLabelOverrides?.[slug];
    // Per-project override wins over the i18n default. Empty string
    // would mean "explicitly cleared" — fall back to the i18n label
    // so the user can never blank out the header. Capture the trimmed
    // value in its own variable so the ternary below resolves to a
    // narrow `string` (the raw `override` is `string | undefined`).
    const trimmedOverride = override && override.trim() ? override : "";
    const hasOverride = trimmedOverride.length > 0;
    return {
      slug,
      label: hasOverride ? trimmedOverride : meta.label,
      shortLabel: meta.shortLabel,
      className: meta.className,
      isCustom: false,
      hasOverride,
    };
  }
  const custom = project?.customEnvs?.find(
    (e: ProjectCustomEnv) => e.slug === slug,
  );
  if (custom) {
    const label = custom.label || slug;
    return {
      slug,
      label,
      shortLabel: label,
      customStyle: envChipStyle(custom.color || "#0ea5e9"),
      isCustom: true,
    };
  }
  // Unknown slug — render a neutral badge so a deep-link to a deleted
  // env doesn't blank out the page header.
  return {
    slug,
    label: slug,
    shortLabel: slug,
    className: "border-transparent bg-muted text-muted-foreground",
    isCustom: false,
  };
}

// Resolve a display label for an env slug WITHOUT requiring project
// context. Used by the AddFeature/AddFlow modals, which only know
// `envSlug` (they don't take a `project` prop). Canonical envs map to
// the same labels used by the page header; custom envs and unknown
// slugs fall back to the slug itself — close enough for the modal's
// read-only "Environment: <label>" row. The page header is the source
// of truth for custom env rendering.
export function envLabelFromSlug(slug: string | undefined): string {
  if (!slug) return "";
  if ((PROJECT_ENVS as readonly string[]).includes(slug)) {
    return PROJECT_ENV_META[slug as CanonicalEnvSlug].label;
  }
  return slug;
}

interface ProjectDetailPageProps {
  // Optional env slug passed as a prop. Routes `/projects/:projectId` and
  // `/projects/:projectId/:envSlug` both mount this component — the env,
  // when present, is read from props (not from `useParams`) so the prop
  // shape stays stable across both routes.
  envSlug?: string;
}

export function ProjectDetailPage({ envSlug: envSlugProp }: ProjectDetailPageProps = {}) {
  const params = useParams<{ projectId: string; envSlug?: string }>();
  const projectId = params.projectId;
  // Prefer the prop (set by the legacy routing path) over the URL param.
  // Reading from the URL keeps the catch-all `/projects/:projectId/:envSlug`
  // working without a wrapper page.
  const envSlug = envSlugProp ?? params.envSlug;

  const projectQuery = useProject(projectId);
  // Pass the env from the URL to scope the feature read. On the env-less
  // page (no envSlug), the hook returns every feature for the project,
  // including legacy records without an envSlug — see hooks.ts.
  const featuresQuery = useProjectFeatures(projectId, envSlug);
  const flowsQuery = useProjectFlows(projectId);
  const t = useT();
  const navigate = useNavigate();

  const [addFeatureOpen, setAddFeatureOpen] = useState(false);
  const [addFlowOpen, setAddFlowOpen] = useState(false);
  const [renameEnvOpen, setRenameEnvOpen] = useState(false);
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

  const envMeta = resolveEnvMeta(envSlug, project);

  return (
    <div className="space-y-6" key={retryKey}>
      <div>
        <Link
          to="/projects"
          className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          {t("projectDetail.backToProjects", "Projects")}
        </Link>
      </div>

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-foreground">
            {project.name}
          </h1>
          {envMeta && (
            <>
              <Badge
                className={envMeta.className}
                style={envMeta.customStyle}
                aria-label={
                  envMeta.isCustom || envMeta.hasOverride
                    ? envMeta.label
                    : t(
                        PROJECT_ENV_META[envMeta.slug as CanonicalEnvSlug]
                          .i18nKey,
                        envMeta.label,
                      )
                }
              >
                {/* Custom-env labels are user input — render verbatim.
                    Canonical-env labels render the i18n translation
                    UNLESS the user has set a per-project override, in
                    which case the override wins (it's user-provided
                    text, not a translation key). Without the
                    `hasOverride` branch the override would be hidden
                    behind the i18n lookup — `t()` returns the localised
                    label whenever the key resolves, ignoring the
                    fallback. */}
                {envMeta.isCustom || envMeta.hasOverride
                  ? envMeta.label
                  : t(
                      PROJECT_ENV_META[envMeta.slug as CanonicalEnvSlug]
                        .i18nKey,
                      envMeta.label,
                    )}
              </Badge>
              {/* Pencil trigger for the inline env rename modal. Same
                  visual treatment as the kebab trigger on ProjectCard,
                  scaled down (`h-7 w-7`) to fit alongside the header
                  chip without crowding it. Disabled when no env is
                  mounted (the env-less /projects/:id landing) — there
                  is nothing meaningful to rename in that case. */}
              <button
                type="button"
                onClick={() => setRenameEnvOpen(true)}
                aria-label={t("env.renameTitle", "Rename Environment")}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Add Feature / Add Flow only appear on the dev environment.
              Other envs (uat, prod, custom) are read-only views of
              what was authored in dev. The undefined envSlug case is
              the legacy /projects/:id landing — treat as dev. */}
          {(envSlug === undefined || envSlug === "dev") && (
            <>
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
            </>
          )}
        </div>
      </header>

      {features.length === 0 ? (
        envSlug === undefined || envSlug === "dev" ? (
          <FeatureEmptyState onAdd={() => setAddFeatureOpen(true)} />
        ) : (
          // Non-dev envs show a read-only empty state when no features
          // exist there yet — features are authored under dev first,
          // so other envs being empty isn't an actionable situation.
          <FeatureEmptyState />
        )
      ) : (
        <FeatureList
          features={features}
          readOnly={!(envSlug === undefined || envSlug === "dev")}
          envSlug={envSlug}
        />
      )}

      <AddFeatureModal
        open={addFeatureOpen}
        onClose={() => setAddFeatureOpen(false)}
        projectId={project.id}
        envSlug={envSlug}
      />

      <AddFlowModal
        open={addFlowOpen}
        onClose={() => setAddFlowOpen(false)}
        projectId={project.id}
        envSlug={envSlug}
      />

      {envMeta && (
        <RenameEnvModal
          open={renameEnvOpen}
          onClose={() => setRenameEnvOpen(false)}
          project={project}
          envSlug={envMeta.slug}
          isCustom={envMeta.isCustom}
          currentLabel={envMeta.label}
          onRenamed={(result) => {
            // When the slug changed, the URL the user is currently on
            // (e.g. /projects/:id/<oldSlug>) no longer resolves to a
            // valid env — the page header would render the
            // "unknown slug" fallback and the feature list would be
            // empty. Redirect to the new slug so the rename lands in
            // place. Skipped when only the label changed; in that case
            // the envMeta refresh from the query invalidation already
            // updates the visible label.
            if (
              result.oldSlug &&
              result.oldSlug !== result.newSlug
            ) {
              navigate(`/projects/${project.id}/${result.newSlug}`);
            }
          }}
        />
      )}
    </div>
  );
}