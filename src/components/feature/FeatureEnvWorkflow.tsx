// Read-only environment workflow diagram for the feature row.
//
// Mirrors the visual the user already sees on a flow row (Dev → Stg →
// Prod → UAT), but without the click-to-clone affordance. Per the
// user's request: the diagram tells the user "this feature has been
// promoted to these envs" without offering a mutation path inline —
// the feature-row interaction model is rename/delete/details, not
// clone-the-feature.
//
// Reads the cloned env set from `useClonedFeatureEnvs(feature.id,
// feature.projectId)`. The hook queries the Feature collection for
// records with `clonedFromFeatureId === feature.id`, returning the
// set of env slugs where a sibling exists. No clicks, no pending
// state, no toast — see EnvWorkflow.tsx (the flow-row version) for
// the interactive counterpart. Visuals (Node / Arrow / palette) come
// from EnvWorkflowPrimitives.tsx so the two workflows read as one
// chain at a glance.
//
// Arrow animation rule: on a dev row, an arrow into a sibling env
// animates iff that env has a sibling clone. On a non-dev row the
// row's own env IS the current step in the chain, so arrows leading
// UP TO it animate regardless of `useClonedFeatureEnvs`. For a "uat"
// feature, animate Dev→Stg and Stg→Prod arrows (chain reached prod)
// but not the Prod→UAT arrow (the row itself is uat). For "prod",
// animate Dev→Stg and Stg→Prod. For "stg" no sibling arrows animate.
// Custom-env rows aren't in the canonical chain so the
// position-based branch never fires; the clone-based branch covers
// any downstream clones.

import { Fragment } from "react";
import { useClonedFeatureEnvs } from "@/lib/blocks/hooks";
import { useT } from "@/lib/blocks/i18n";
import { CANONICAL_ENV_SLUGS } from "@/lib/validation";
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

// Index of a slug in the canonical promote order, or `-1` for slugs
// not in the canonical chain (e.g. custom envs). Used by the
// animation rule below to decide whether an arrow into a sibling
// env is "up to" the row's own env.
function canonicalIndex(slug: string | undefined): number {
  if (!slug) return -1;
  return (CANONICAL_ENV_SLUGS as readonly string[]).indexOf(slug);
}

export function FeatureEnvWorkflow({ feature }: FeatureEnvWorkflowProps) {
  const t = useT();
  // Read-only sibling lookup — see useClonedFeatureEnvs for why we
  // intentionally don't apply createdByFilter here. The hook is
  // `enabled: false` until both userId and featureId resolve, so
  // there's no startup flash of an empty chain.
  const { data: clonedEnvs } = useClonedFeatureEnvs(feature.id, feature.projectId);
  const cloned = clonedEnvs ?? new Set<string>();
  const rowIndex = canonicalIndex(feature.envSlug);

  return (
    <>
      {/* Same keyframe injection as the flow-row workflow — see
          EnvWorkflowPrimitives for why this is duplicated rather than
          declared once globally. */}
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
          const alreadyCloned = cloned.has(env.slug);
          // Same rule as the flow-row read-only mirror — animate the
          // arrow leading INTO this sibling env when the chain has
          // reached this env from the row's perspective. Two cases:
          //   * Row is in a canonical env and this sibling env is
          //     at or before the row's env in the canonical promote
          //     order — the chain got here, so animate.
          //   * Row has downstream clones — animate (preserves the
          //     "this env has a clone" affordance even on non-dev
          //     rows that have downstream activity).
          const siblingIndex = canonicalIndex(env.slug);
          const animateArrow =
            (rowIndex >= 0 &&
              siblingIndex >= 0 &&
              siblingIndex <= rowIndex) ||
            alreadyCloned;
          return (
            <Fragment key={env.slug}>
              <EnvArrow animate={animateArrow} />
              <EnvNode
                label={env.label}
                state={alreadyCloned ? "cloned" : "available"}
                title={
                  alreadyCloned
                    ? t(
                        "envWorkflow.alreadyCloned",
                        "Already cloned to {env}",
                        { env: env.label },
                      )
                    : undefined
                }
                // Read-only mirror — no click handler AND no pointer
                // cursor so the env pills don't suggest they're
                // actionable. Cloning happens at the flow level via
                // each FlowItem's interactive EnvWorkflow.
                interactive={false}
              />
            </Fragment>
          );
        })}
      </span>
    </>
  );
}
