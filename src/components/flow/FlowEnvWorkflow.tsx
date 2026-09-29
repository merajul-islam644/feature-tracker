// Read-only environment workflow diagram for the flow row.
//
// Mirrors the visual the user sees on the feature row (Dev → Stg →
// Prod → UAT), but without click affordances. Two variants exist:
// the manager-interactive `ManagerFlowEnvWorkflow` (rendered by
// `FlowItem.tsx` for dev-source flows with `isManager` and no
// `clonedFromFlowId` — i.e. only flows the manager can still promote)
// and this read-only mirror — used for everyone else (testers,
// developers, and managers on already-cloned sibling rows whose
// `clonedFromFlowId` is set). Per the user's request: every flow row
// shows the chain so the user sees where this flow has been promoted;
// cloning only happens via the manager-interactive chain on dev-source
// flows, and the rest of the time this read-only mirror takes over to
// visualize the current cross-env state.
//
// Per-flow independence — each flow row's chain is independent of its
// parent feature's chain. The flow can be promoted to stg / prod /
// uat regardless of where the parent feature sits. The dev-source
// pill is the row's own env; the sibling pills reflect what
// `useClonedFlowEnvs` reports for this flow's `clonedFromFlowId`.
//
// Visual state per sibling pill:
//   * `useClonedFlowEnvs` returns an env in its set, OR the env is
//     in this row's lineage path (source env → current env,
//     inclusive) → "cloned" visual (Check + animated arrow)
//     persistently. Means either (a) the source has a sibling
//     record in this env OR (b) this row's lineage has travelled
//     through this env on the way to its current env (e.g. on a
//     row in Prod, both Stg and Prod paint "cloned" even though
//     the Prod-clone has no children — the row's lineage was in
//     Stg before being promoted to Prod).
//   * otherwise                                      → "available"
//     visual (outlined, no tick, no animation) — the env is
//     beyond where this row's lineage has reached (e.g. UAT on a
//     Prod-clone row).
//
// The dev-source pill stays filled (golden bg, dark text) on every
// row regardless of role / clone state — it's the row's own env.
//
// Visuals (Node / Arrow / palette) come from
// `EnvWorkflowPrimitives.tsx` so this row and the manager-
// interactive variant read as one chain at a glance. Only the
// interactive affordances differ — `interactive={false}` on every
// `EnvNode` strips the click handler. See
// `ManagerFlowEnvWorkflow.tsx` for the interactive counterpart.

import { Fragment } from "react";
import { useT } from "@/lib/blocks/i18n";
import { useClonedFlowEnvs } from "@/lib/blocks/hooks";
import type { Flow } from "@/lib/blocks/data";
import {
  SIBLING_ENVS,
  EnvNode,
  EnvArrow,
  EnvWorkflowStyles,
  passedEnvSet,
} from "@/components/flow/EnvWorkflowPrimitives";

interface FlowEnvWorkflowProps {
  flow: Flow;
}

export function FlowEnvWorkflow({ flow }: FlowEnvWorkflowProps) {
  const t = useT();

  // Sibling-clone lookup. The hook queries
  // `flowsCollection.list({ filter: { clonedFromFlowId: flow.id } })`
  // and returns the set of envSlug values where this source flow
  // already has a sibling record. Empty set on a never-promoted
  // source; populated as the manager clicks each sibling pill via
  // the interactive `ManagerFlowEnvWorkflow`. We do NOT gate on
  // `flow.clonedFromFlowId` here — the read-only mirror is mounted
  // on both source and sibling rows, and on a sibling row the
  // lookup naturally returns the set of envs the source has been
  // cloned TO (i.e. this row's siblings in OTHER envs), keeping the
  // persistent-tick visual consistent across the chain.
  const clonedEnvsQuery = useClonedFlowEnvs(flow.id);
  const clonedEnvs = clonedEnvsQuery.data ?? new Set<string>();
  // Lineage path — the set of envs this row has travelled through
  // from source up to and including its current env. Drives the
  // animation + "cloned" visual on envs where the row's lineage
  // has been, even when that env has no children of its own (the
  // common case on Prod-clone / Stg-clone / UAT-clone rows — those
  // rows have no `clonedFromFlowId` children, but their lineage
  // still passed through every earlier env).
  const pathEnvs = passedEnvSet(flow.envSlug);

  return (
    <>
      {/* Same keyframe injection as the feature-row workflow — see
          EnvWorkflowPrimitives for why this is duplicated rather
          than declared once globally. */}
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
          // continuously — the persistent marker for "this flow has
          // a sibling record in {env}". All other sibling pills stay
          // in the plain "available" state. While the lookup is
          // still in flight we fall back to the empty set so the
          // initial render doesn't flash a misleading tick on every
          // pill (and the read-only mirror stays calm until the
          // query resolves).
          const isPromoted = clonedEnvs.has(env.slug);
          // `isInPath` is true when this env sits on the row's
          // lineage path from source (Dev) up to its current env —
          // i.e. the row has "passed through" this env on its way
          // here. For a Prod-clone row this lights up both Stg and
          // Prod pills; for a Dev-source row it contributes nothing
          // extra (the source's path is just {dev}, which never
          // matches a sibling slug).
          const isInPath = pathEnvs.has(env.slug);
          // The arrow leading INTO this env animates when EITHER:
          //   (a) there is a sibling record in this env (the
          //       existing "I promoted there" marker), OR
          //   (b) this env IS on the row's lineage path (Dev → …
          //       → this row's current env, inclusive). (b)
          //       subsumes the older "current env" check because
          //       the current env is always in the path — it also
          //       lights up every earlier env on the same row.
          // The user wanted the marching-dash animation to reflect
          // "all the envs this flow has passed" — without (b), the
          // chain on a Prod-clone row only animated the Stg→Prod
          // arrow even though the row's lineage travelled through
          // Stg first.
          const animateArrow = isPromoted || isInPath;
          return (
            <Fragment key={env.slug}>
              <EnvArrow animate={animateArrow} />
              <EnvNode
                label={env.label}
                // Pill state mirrors the animation: "cloned" visual
                // (Check + filled outline) when this env is in the
                // row's lineage path OR already has a sibling.
                // On a Prod-clone row, this paints Stg with a tick
                // (matching the animated arrow) — without it the
                // arrow animates into a plain "available" pill,
                // which reads as inconsistent to the user.
                state={isInPath ? "cloned" : "available"}
                title={
                  // Title precedence: explicit "promoted to" wins
                  // over the generic "in path" copy so the source-
                  // row tooltips stay unchanged from before this
                  // change.
                  isPromoted
                    ? t(
                        "envWorkflow.promotedTo",
                        "Promoted to {env}",
                        { env: env.label },
                      )
                    : isInPath
                      ? t(
                          "envWorkflow.inEnv",
                          "In {env}",
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
