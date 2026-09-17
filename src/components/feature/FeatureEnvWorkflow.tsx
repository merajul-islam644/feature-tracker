// Read-only environment workflow diagram for the feature row.
//
// Mirrors the visual the user already sees on a flow row (Dev → Stg →
// Prod → UAT), but without the click-to-clone affordance. Per the
// user's request: the diagram tells the user "this feature has been
// promoted to these envs" without offering a mutation path inline —
// the feature-row interaction model is rename/delete/details, not
// clone-the-feature.
//
// Reads the cloned env set from `useClonedFeatureEnvs` keyed on the
// SOURCE feature id (the original dev feature). Every row in the same
// promote chain (the original dev feature + every sibling clone) sees
// the SAME chain visualization, so the animation is consistent across
// every row even on non-dev envs. Without the source-id lookup, a
// non-dev row would only see ITS OWN downstream clones and miss the
// arrows leading up to its env.
//
// Arrow animation rule: the arrow into a sibling env animates iff that
// env has a sibling clone (i.e. the chain has reached it). This is the
// SAME rule for every row regardless of which env it lives in — the
// user's "same animate as dev env for others env" requirement.
// Position-based logic (animating arrows leading INTO the row's own
// env) is gone — what matters is the chain state, not the row's
// perspective.

import { Fragment } from "react";
import { useClonedFeatureEnvs } from "@/lib/blocks/hooks";
import { useT } from "@/lib/blocks/i18n";
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
  // Source id: every clone's view of the chain starts from the
  // original dev feature. Without this, a non-dev row would only see
  // ITS OWN downstream clones and miss the chain leading up to it.
  const sourceId = feature.clonedFromFeatureId ?? feature.id;
  // `enabled` stays false until both userId and featureId resolve, so
  // there's no startup flash of an empty chain — same contract as the
  // flow-row read-only mirror.
  const { data: clonedEnvs } = useClonedFeatureEnvs(sourceId, feature.projectId);
  const cloned = clonedEnvs ?? new Set<string>();

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
          // Single rule, same on dev and non-dev rows: animate the
          // arrow into this sibling env iff the chain has reached it.
          const animateArrow = alreadyCloned;
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
