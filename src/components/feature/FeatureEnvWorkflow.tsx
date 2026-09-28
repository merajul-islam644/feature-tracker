// Read-only environment workflow diagram for the feature row.
//
// Mirrors the visual the user sees on the flow row (Dev → Stg →
// Prod → UAT), but without click affordances. Two variants exist:
// the manager-interactive `ManagerFeatureEnvWorkflow` (rendered by
// `FeatureItem.tsx` for dev-source features with `isManager` and no
// `clonedFromFeatureId` — i.e. only features the manager can still
// promote) and this read-only mirror — used for everyone else
// (testers, developers, and managers on already-cloned sibling
// rows whose `clonedFromFeatureId` is set). Per the user's request:
// every feature row shows the chain so the user sees where this
// feature has been promoted; cloning only happens via the manager-
// interactive chain on dev-source features, and the rest of the
// time this read-only mirror takes over to visualize the current
// cross-env state.
//
// Visual state per sibling pill:
//   * `useClonedFeatureEnvs` returns an env in its set  → "cloned"
//     visual (Check + animated arrow) persistently — the user's
//     "show the animation + tick always after clicking"
//     requirement. Means the source row has a sibling record in
//     that env (created by a previous `useCloneFeature` call).
//   * set is empty for that env                     → "available"
//     visual (outlined, no tick, no animation) —
//     clickable only in the interactive variant.
//
// The dev-source pill stays filled (golden bg, dark text) on every
// row regardless of role / clone state — it's the row's own env.
//
// Visuals (Node / Arrow / palette) come from
// `EnvWorkflowPrimitives.tsx` so this row and the manager-
// interactive variant read as one chain at a glance. Only the
// interactive affordances differ — `interactive={false}` on every
// `EnvNode` strips the click handler. See
// `ManagerFeatureEnvWorkflow.tsx` for the interactive counterpart.

import { Fragment } from "react";
import { useT } from "@/lib/blocks/i18n";
import { useClonedFeatureEnvs } from "@/lib/blocks/hooks";
import type { Feature } from "@/lib/blocks/data";
import {
  SIBLING_ENVS,
  EnvNode,
  EnvArrow,
  EnvWorkflowStyles,
} from "@/components/flow/EnvWorkflowPrimitives";

interface FeatureEnvWorkflowProps {
  feature: Feature;
}

export function FeatureEnvWorkflow({ feature }: FeatureEnvWorkflowProps) {
  const t = useT();

  // Sibling-clone lookup. The hook queries
  // `featuresCollection.list({ filter: { clonedFromFeatureId: feature.id } })`
  // and returns the set of envSlug values where this source feature
  // already has a sibling record. Empty set on a never-promoted
  // source; populated as the manager clicks each sibling pill via
  // the interactive `ManagerFeatureEnvWorkflow`. We do NOT gate on
  // `feature.clonedFromFeatureId` here — the read-only mirror is
  // mounted on both source and sibling rows, and on a sibling row
  // the lookup naturally returns the set of envs the source has
  // been cloned TO (i.e. this row's siblings in OTHER envs),
  // keeping the persistent-tick visual consistent across the chain.
  const clonedEnvsQuery = useClonedFeatureEnvs(
    feature.id,
    feature.projectId,
  );
  const clonedEnvs = clonedEnvsQuery.data ?? new Set<string>();

  return (
    <>
      {/* Same keyframe injection as the flow-row interactive
          workflow — see EnvWorkflowPrimitives for why this is
          duplicated rather than declared once globally. */}
      <EnvWorkflowStyles />
      <span
        role="group"
        aria-label={t("envWorkflow.label", "Environment workflow")}
        className="inline-flex h-5 shrink-0 items-center gap-0.5 self-center overflow-visible text-yellow-400"
      >
        <EnvNode
          label="Dev"
          state="source"
          title={t("envWorkflow.source", "Source environment")}
          interactive={false}
        />
        {SIBLING_ENVS.map((env) => {
          // The pill whose slug appears in the clonedEnvs set paints
          // the "cloned" visual (Check + animated arrow)
          // continuously — the persistent marker for "this feature
          // has a sibling record in {env}". All other sibling pills
          // stay in the plain "available" state. While the lookup is
          // still in flight we fall back to the empty set so the
          // initial render doesn't flash a misleading tick on every
          // pill (and the read-only mirror stays calm until the
          // query resolves).
          const isPromoted = clonedEnvs.has(env.slug);
          // The arrow leading INTO this env animates when EITHER:
          //   (a) there is a sibling record in this env (the existing
          //       "I promoted there" marker), OR
          //   (b) this env IS the current feature's env (the
          //       "this is where I live" marker — shows the upstream
          //       connection from dev / stg / prod on every env page
          //       even when the user hasn't promoted further yet).
          // Without (b), the chain on stg / prod / uat pages renders
          // completely static unless the feature has siblings in
          // higher envs — the user reported that as a bug because
          // they wanted the marching-dash effect visible regardless
          // of which env page they're on.
          const isCurrentEnv = env.slug === feature.envSlug;
          const animateArrow = isPromoted || isCurrentEnv;
          return (
            <Fragment key={env.slug}>
              <EnvArrow animate={animateArrow} />
              <EnvNode
                label={env.label}
                state={isPromoted ? "cloned" : "available"}
                title={
                  isPromoted
                    ? t(
                        "envWorkflow.promotedTo",
                        "Promoted to {env}",
                        { env: env.label },
                      )
                    : undefined
                }
                interactive={false}
              />
            </Fragment>
          );
        })}
      </span>
    </>
  );
}
