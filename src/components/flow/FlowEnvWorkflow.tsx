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
// Reads the cloned env set from `useClonedEnvs(flow.id)`. The hook
// queries the Flow collection for records with `clonedFromFlowId ===
// flow.id`, returning the set of env slugs where a sibling exists.
// For a uat/stg/prod/custom flow this will usually be empty (most
// non-dev flows are leaves in the promote chain), so all three
// sibling nodes render as outlined "available" pills — that's the
// intended visual.
//
// Arrow animation rule for non-dev rows differs from the dev row:
// on a dev row, the arrow into an env animates only if that env has
// already been cloned (i.e. the chain "reached" it). On a non-dev
// row the row's own env IS the current step in the chain, so the
// arrows leading UP TO it animate regardless of `useClonedEnvs`.
// Concretely: if `flow.envSlug` is "uat", animate the Dev→Stg and
// Stg→Prod arrows (chain reached prod) but not the Prod→UAT arrow
// (the row itself is uat — the destination pill, not a step still
// to be taken). For "prod" animate Dev→Stg and Stg→Prod. For "stg"
// no sibling arrows animate (only the source Dev→Stg, which is the
// source position itself). Custom envs aren't in the
// dev→stg→prod→uat chain so no sibling arrows animate for them.
// Visuals (Node / Arrow / palette) come from
// EnvWorkflowPrimitives.tsx so this row and the dev interactive
// `EnvWorkflow` row read as one chain at a glance. Only the
// interactive affordances differ — `interactive={false}` on every
// `EnvNode` strips the hover-fill + pointer cursor. See
// EnvWorkflow.tsx for the interactive counterpart.

import { Fragment } from "react";
import { useClonedEnvs } from "@/lib/blocks/hooks";
import { useT } from "@/lib/blocks/i18n";
import { CANONICAL_ENV_SLUGS } from "@/lib/validation";
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

// Index of a slug in the canonical promote order, or `-1` for slugs
// not in the canonical chain (e.g. custom envs). Used by the
// animation rule below to decide whether an arrow into a sibling
// env is "up to" the row's own env.
function canonicalIndex(slug: string | undefined): number {
  if (!slug) return -1;
  return (CANONICAL_ENV_SLUGS as readonly string[]).indexOf(slug);
}

export function FlowEnvWorkflow({ flow }: FlowEnvWorkflowProps) {
  const t = useT();
  // Sibling lookup keyed per source flow. `enabled` stays false until
  // both userId and flowId resolve, so there's no startup flash of an
  // empty chain — same contract as the feature-row read-only mirror.
  const { data: clonedEnvs } = useClonedEnvs(flow.id);
  const cloned = clonedEnvs ?? new Set<string>();
  const rowIndex = canonicalIndex(flow.envSlug);

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
          // The arrow leading INTO this sibling env animates when
          // the chain has reached this env from the row's
          // perspective. Two cases:
          //   * Row is in a canonical env (stg/prod/uat) and this
          //     sibling env is at or before the row's env in the
          //     canonical promote order — the chain got here, so
          //     animate the arrow as a finished path of motion.
          //   * Row has downstream clones — sibling env has a
          //     sibling clone of this flow, animate (matches the
          //     dev-row behavior; preserves the "this env has a
          //     clone" affordance even if the row is non-dev).
          // Custom-env rows aren't in the canonical chain so the
          // first branch never fires; the second branch covers any
          // downstream clones the row may have.
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
