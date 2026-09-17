// Read-only environment workflow diagram for non-dev flow rows.
//
// Mirrors the visual the user already sees on a dev-source flow row
// (Dev → Stg → Prod → UAT), but without the click-to-clone
// affordance. Per the user's request: every flow row in every env
// shows the promote-chain diagram; cloning is only interactive on
// dev-source flows. On a non-dev flow row the diagram tells the user
// "this flow lives here" plus "has it been further cloned elsewhere"
// without offering a mutation path inline — non-dev envs are
// read-only views of what was authored in dev.
//
// Reads the cloned env set from `useClonedEnvs` keyed on the SOURCE
// flow id (the original dev flow). Every row in the same promote
// chain sees the same chain visualization, so the animation is
// consistent across every row even on non-dev envs. Without the
// source-id lookup, a non-dev row would only see ITS OWN downstream
// clones and miss the arrows leading up to its env.
//
// Arrow animation rule: the arrow into a sibling env animates iff
// that env has a sibling clone (i.e. the chain has reached it). This
// is the SAME rule for every row regardless of which env it lives in
// — the user's "same animate as dev env for others env" requirement.
// Position-based logic (animating arrows leading INTO the row's own
// env) is gone — what matters is the chain state, not the row's
// perspective. Visuals (Node / Arrow / palette) come from
// EnvWorkflowPrimitives.tsx so this row and the dev interactive
// `EnvWorkflow` row read as one chain at a glance. Only the
// interactive affordances differ — `interactive={false}` on every
// `EnvNode` strips the hover-fill + pointer cursor. See
// EnvWorkflow.tsx for the interactive counterpart.

import { Fragment } from "react";
import { useClonedEnvs } from "@/lib/blocks/hooks";
import { useT } from "@/lib/blocks/i18n";
import type { Flow } from "@/lib/blocks/data";
import {
  SIBLING_ENVS,
  EnvNode,
  EnvArrow,
  EnvWorkflowStyles,
} from "./EnvWorkflowPrimitives";

interface FlowEnvWorkflowProps {
  flow: Flow;
}

export function FlowEnvWorkflow({ flow }: FlowEnvWorkflowProps) {
  const t = useT();
  // Source id: every clone's view of the chain starts from the
  // original dev flow. Same rationale as FeatureEnvWorkflow — without
  // this, a non-dev row only sees its own downstream clones and misses
  // the chain leading up to it.
  const sourceId = flow.clonedFromFlowId ?? flow.id;
  // Sibling lookup keyed per source flow. `enabled` stays false until
  // both userId and flowId resolve, so there's no startup flash of an
  // empty chain — same contract as the feature-row read-only mirror.
  const { data: clonedEnvs } = useClonedEnvs(sourceId);
  const cloned = clonedEnvs ?? new Set<string>();

  return (
    <>
      {/* Same keyframe injection as the interactive flow-row workflow
          and the feature-row read-only mirror — see
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
          // Single rule, same on dev and non-dev rows: animate iff
          // the chain has reached this sibling env.
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
                // actionable on a non-dev row. Cloning happens only
                // on the dev-source flow row's interactive
                // EnvWorkflow.
                interactive={false}
              />
            </Fragment>
          );
        })}
      </span>
    </>
  );
}
