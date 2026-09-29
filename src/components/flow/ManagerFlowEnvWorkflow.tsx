// Interactive horizontal environment workflow for the flow row.
//
// Renders for managers on a dev-source flow row (gate at
// `FlowItem.tsx`). Mirrors the structure of the feature-row
// `ManagerFeatureEnvWorkflow` but for the flow entity: Dev (filled)
// → 3 sibling pills. Managers click a sibling pill to promote this
// flow into that env; the mutation is a sibling-record create via
// `useCloneFlow` — the source row's `envSlug` stays as "dev", a new
// sibling record appears in the destination env, and the source
// row's `FlowEnvWorkflow` mirror picks up the persistent
// "promoted to {env}" tick once the clone lands.
//
// Per-flow independence — each flow's env workflow operates on the
// flow alone, without coupling to the parent feature's env chain.
// The mutation does NOT cascade (no feature auto-create, no other-
// flow auto-clone); only the one flow is duplicated. The manager
// can promote any flow regardless of where the feature sits. See
// `useCloneFlow` for the full rationale.
//
// Visual states per sibling pill:
//
//   * Source (Dev)        — golden filled, dark text. Source of
//                           truth. Always the dev pill.
//
//   * Already cloned      — outlined + light golden bg + check
//                           icon + animated arrow. A sibling
//                           record already exists in this env
//                           (created by a previous `useCloneFlow`
//                           click). Persistent marker; not
//                           clickable (clicking would create a
//                           duplicate clone — the sibling pill is
//                           disabled to prevent this).
//
//   * Ready (in-flight)   — same "cloned" visual but with the
//                           pending pulse overlay. Shown on the
//                           pill that is the in-flight target of
//                           an active click — gives the manager
//                           instant feedback ("you clicked Stg,
//                           the pill flipped to ready") before
//                           the sibling record lands and
//                           `useClonedFlowEnvs` reports the new
//                           env as cloned.
//
//   * Blocked (status !== "passed")
//                         — same outlined "available" look so the
//                           pill stays clickable. Click surfaces
//                           an error toast (the mutation throws
//                           when the precondition fails). The
//                           flow row's precondition is single-
//                           dimensional — just the flow's own
//                           status — so we skip the feature row's
//                           multi-flow BlockPromoteModal and rely
//                           on the toast for the explanation.
//
//   * Available           — outlined, yellow text, no tick, no
//                           animation, clickable. Default sibling
//                           state — no clone yet exists in this
//                           env AND the flow is in passed status.
//
// Visuals (Node / Arrow / STATE_CLASSES / keyframes) live in
// `EnvWorkflowPrimitives.tsx` so the flow-row interactive chain
// (`ManagerFlowEnvWorkflow`) and the flow-row read-only mirror
// (`FlowEnvWorkflow`) share the exact same look. Only the click
// handler + the pending-spinner logic stay here.

import { Fragment } from "react";
import { useCloneFlow, useClonedFlowEnvs } from "@/lib/blocks/hooks";
import { useToast } from "@/hooks/useToast";
import { useT } from "@/lib/blocks/i18n";
import type { Flow } from "@/lib/blocks/data";
import {
  SIBLING_ENVS,
  EnvNode,
  EnvArrow,
  EnvWorkflowStyles,
} from "@/components/flow/EnvWorkflowPrimitives";

interface ManagerFlowEnvWorkflowProps {
  flow: Flow;
}

export function ManagerFlowEnvWorkflow({
  flow,
}: ManagerFlowEnvWorkflowProps) {
  const t = useT();
  const toast = useToast();
  const cloneFlow = useCloneFlow();

  // Sibling-clone lookup — same hook the read-only
  // `FlowEnvWorkflow` uses. Tells us which sibling envs already
  // have a clone so we can render the persistent "already
  // cloned" visual and disable the click. Empty set on a never-
  // promoted source; populated as the manager clicks each sibling
  // pill.
  const clonedEnvsQuery = useClonedFlowEnvs(flow.id);
  const clonedEnvs = clonedEnvsQuery.data ?? new Set<string>();

  // Precondition gate — the flow itself must be in "passed"
  // status. The team's promotion contract is explicit: a flow is
  // promotion-ready only when QA has signed off on it (status
  // === "passed"). Any non-passed status (`failed`, `pending`,
  // `draft`, `investigating`, `pause`) is a block — either because
  // the work is unfinished or because it has hit a regression.
  //
  // This is intentionally simpler than the feature row's gate
  // (which checks "every source-env flow is passed") because the
  // flow row's precondition is single-dimensional. The feature-
  // level chip already enforces the all-flows-must-pass rule at
  // the feature row; the flow row's own chip is the per-flow
  // enforcement. We don't double-count or re-check the sibling
  // flows here.
  //
  // Unlike `ManagerFeatureEnvWorkflow`, the blocked pill stays
  // clickable so the click surfaces the mutation's error toast —
  // which gives the manager the actionable message ("Mark the
  // flow as Passed before promoting"). The feature row uses a
  // modal because the block reason can be multi-flow; the flow
  // row's reason is one boolean, so a toast is enough.
  const isBlocked = flow.status !== "passed";

  const handleClone = (slug: string) => {
    if (cloneFlow.isPending) return; // ignore double-clicks while a promote is in flight
    // Defensive duplicate-clone guard — the `disabled` prop on the
    // pill already prevents clicks on already-cloned envs, but a
    // stale modal / programmatic caller could still reach here.
    // Return silently rather than fire a doomed mutation.
    if (clonedEnvs.has(slug)) return;
    cloneFlow.mutate(
      { flow, targetEnvSlug: slug },
      {
        onSuccess: () => {
          toast.success(
            t(
              "toast.flowPromoted",
              'Flow "{name}" promoted to {env}.',
              { name: flow.name, env: slug.toUpperCase() },
            ),
          );
        },
        onError: (err) => {
          // Blocked-by-precondition errors surface here as a clear
          // toast — the mutation's thrown message is already
          // user-facing ("Cannot promote flow ... — it is not in
          // 'Passed' status..."), so we pass it through verbatim.
          // Other errors (network, server) fall through to the
          // generic fallback.
          toast.error(
            err instanceof Error
              ? err.message
              : t(
                  "toast.flowPromoteError",
                  "Could not promote flow.",
                ),
          );
        },
      },
    );
  };

  return (
    <>
      {/* Inline keyframes for the marching-dash arrow — see
          EnvWorkflowPrimitives for why this is local rather than
          a global stylesheet rule. */}
      <EnvWorkflowStyles />
      <span
        role="group"
        aria-label={t("envWorkflow.label", "Environment workflow")}
        className="inline-flex h-5 shrink-0 items-center gap-0.5 self-center overflow-visible text-yellow-400"
      >
        {/* Source: Dev. Always filled, not interactive. */}
        <EnvNode
          label="Dev"
          state="source"
          title={t("envWorkflow.source", "Source environment")}
        />

        {SIBLING_ENVS.map((env) => {
          const isAlreadyCloned = clonedEnvs.has(env.slug);
          const isThisPending =
            cloneFlow.isPending &&
            cloneFlow.variables?.flow.id === flow.id &&
            cloneFlow.variables?.targetEnvSlug === env.slug;
          // `showReady` flips this pill to the "cloned" visual
          // (Check + animated arrow) when this env already has a
          // sibling (persistent marker) OR this pill is the
          // in-flight target of an active click. Order of the OR
          // matters for the `isThisPending` branch: the in-flight
          // visual takes precedence over the "already cloned"
          // visual on the same pill because pending is a transient
          // state that resolves into "already cloned" once the
          // mutation lands and `useClonedFlowEnvs` reports the new
          // sibling.
          //
          // NOTE: a *blocked* pill stays in the regular
          // "available" visual — we don't repaint it red. The
          // block reason surfaces in the tooltip + the error toast
          // on click, not in the pill chrome. Keeping the same
          // yellow outline makes the chain look uniform and avoids
          // introducing a new visual state for the primitive
          // (which would cascade through `FlowEnvWorkflow`'s
          // read-only mirror too).
          const showReady = isAlreadyCloned || isThisPending;
          // Tooltip precedence (most actionable first):
          //   1. precondition fails (status !== passed)
          //      → "Can't promote — flow not Passed"
          //   2. already cloned
          //      → "Already promoted to {env}"
          //   3. default
          //      → "Promote to {env}"
          const pillTitle = isBlocked
            ? t(
                "envWorkflow.flowNotPassedBlocked",
                'Cannot promote "{flow}" — not in Passed status (click for details)',
                { flow: flow.name },
              )
            : isAlreadyCloned
              ? t(
                  "envWorkflow.alreadyPromoted",
                  "Already promoted to {env}",
                  { env: env.label },
                )
              : t(
                  "envWorkflow.cloneTo",
                  "Promote to {env}",
                  { env: env.label },
                );
          return (
            <Fragment key={env.slug}>
              <EnvArrow animate={showReady} />
              <EnvNode
                label={env.label}
                state={showReady ? "cloned" : "available"}
                title={pillTitle}
                // Disabled when:
                //   * already cloned (would create a duplicate
                //     sibling record)
                //   * pending (this pill is the in-flight target
                //     of an active click)
                //
                // Blocked pills are NOT disabled — clicking them
                // surfaces the mutation's error toast (the
                // mutation throws when status !== passed). The
                // feature row uses a BlockPromoteModal for the
                // multi-flow case; the flow row's single-dimension
                // precondition gets the lighter toast UX.
                disabled={isAlreadyCloned || isThisPending}
                pending={isThisPending}
                onClick={(event) => {
                  // Buttons inside a workflow don't bubble so the
                  // parent row click handler doesn't fire.
                  event.stopPropagation();
                  handleClone(env.slug);
                }}
              />
            </Fragment>
          );
        })}
      </span>
    </>
  );
}
