// Interactive horizontal environment workflow.
//
// Sits between the flow name and the stack chip on every dev-env flow
// row. Each canonical non-dev env (Stg / Prod / UAT) is rendered as a
// clickable pill that clones this flow into that env on click — same
// mutation as the EnvironmentChip dropdown, just one click deeper
// into the row. Visual states:
//
//   * Source (Dev)  — golden filled, dark text. Source of truth.
//
//   * Cloned        — outlined, lighter golden text + check mark. The
//                     user has previously cloned this flow into that
//                     env (look up via `useClonedEnvs`); cloning again
//                     would create a duplicate sibling, so the node is
//                     non-interactive. Hover shows a "(already cloned)"
//                     title for the curious.
//
//   * Available     — outlined, yellow text, hoverable. Clicking fires
//                     the same `useCloneFlow` mutation as the env chip
//                     dropdown. On success TanStack Query invalidates
//                     the cloned-envs key, the node immediately flips
//                     to "cloned" state, and the next node in the
//                     chain becomes available for another clone — so
//                     the user can progressively promote the flow
//                     left-to-right across envs without leaving the
//                     row or opening a dropdown.
//
// Per-env cloning progress reads from the same `useClonedEnvs` hook
// the EnvironmentChip uses, so both controls stay in sync.
//
// Visuals (Node / Arrow / STATE_CLASSES / keyframes) live in
// EnvWorkflowPrimitives.tsx so the feature row's read-only mirror
// shares the exact same look. Only the click handler + the
// pending-spinner logic stay here.

import { Fragment } from "react";
import { useCloneFlow, useClonedEnvs } from "@/lib/blocks/hooks";
import { useToast } from "@/hooks/useToast";
import { useT } from "@/lib/blocks/i18n";
import type { Flow } from "@/lib/blocks/data";
import {
  SIBLING_ENVS,
  EnvNode,
  EnvArrow,
  EnvWorkflowStyles,
} from "./EnvWorkflowPrimitives";

interface EnvWorkflowProps {
  flow: Flow;
}

export function EnvWorkflow({ flow }: EnvWorkflowProps) {
  const t = useT();
  const toast = useToast();
  const cloneFlow = useCloneFlow();
  // `useClonedEnvs(flow.id)` returns the Set of env slugs where this
  // flow already has a sibling clone. TanStack Query invalidates this
  // key on `useCloneFlow.onSuccess`, so the new env flips to the
  // "cloned" state without a manual refetch.
  const { data: clonedEnvs } = useClonedEnvs(flow.id);
  const cloned = clonedEnvs ?? new Set<string>();

  const handleClone = (slug: string) => {
    if (cloneFlow.isPending) return; // ignore double-clicks while a clone is in flight
    // Defensive: the UI disables cloned options, but stay safe against
    // keyboard activations or stale renders.
    if (cloned.has(slug)) {
      toast.error(
        t(
          "toast.flowAlreadyCloned",
          "Flow is already cloned to this environment.",
        ),
      );
      return;
    }
    cloneFlow.mutate(
      { flow, targetEnvSlug: slug },
      {
        onSuccess: () => {
          toast.success(
            t("toast.flowCloned", 'Flow "{name}" cloned to {env}.', {
              name: flow.name,
              env: slug.toUpperCase(),
            }),
          );
        },
        onError: (err) => {
          toast.error(
            err instanceof Error
              ? err.message
              : t("toast.flowCloneError", "Could not clone flow."),
          );
        },
      },
    );
  };

  return (
    <>
      {/* Inline keyframes for the marching-dash arrow — see
          EnvWorkflowPrimitives for why this is local rather than a
          global stylesheet rule. */}
      <EnvWorkflowStyles />
      <span
        role="group"
        aria-label={t("envWorkflow.label", "Environment workflow")}
        // Same dimensions as the prior circular ring wrapper so the row
        // height stays unchanged when the workflow is added or removed.
        // `gap-0.5` keeps the nodes close together so the workflow
        // reads as a tight chain rather than a row of standalone
        // buttons — important because the row already has multiple
        // chips competing for horizontal space.
        className="inline-flex h-5 shrink-0 items-center gap-0.5 self-center overflow-visible text-yellow-400"
      >
        {/* Source: Dev. Always filled, not interactive. */}
        <EnvNode
          label="Dev"
          state="source"
          title={t("envWorkflow.source", "Source environment")}
        />

        {SIBLING_ENVS.map((env) => {
          const alreadyCloned = cloned.has(env.slug);
          const isThisPending =
            cloneFlow.isPending &&
            cloneFlow.variables?.flow.id === flow.id &&
            cloneFlow.variables?.targetEnvSlug === env.slug;
          return (
            <Fragment key={env.slug}>
              {/* Animate the arrow leading INTO this env iff the env
                  has already been cloned. The progress model:
                    * No clones yet           → no animation (chain idle)
                    * Stg cloned              → animate DEV → STG
                    * Stg + Prod cloned       → also animate STG → PROD
                    * Stg + Prod + UAT cloned → also animate PROD → UAT
                  Animation grows *outward from Dev* as the flow
                  propagates further, so the user sees the journey
                  expand rather than a perpetual "still pending" loop.
                  The animated dash treats a completed step as a
                  finished path of motion, not as "data still in
                  transit". */}
              <EnvArrow animate={alreadyCloned} />
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
                    : t("envWorkflow.cloneTo", "Clone to {env}", {
                        env: env.label,
                      })
                }
                // Disable this node (and only this node) while its own
                // clone is in flight. Other nodes stay clickable so the
                // user can stage the next clone if they want.
                disabled={isThisPending}
                pending={isThisPending}
                onClick={
                  alreadyCloned
                    ? undefined
                    : (event) => {
                        // Buttons inside a workflow don't bubble so the
                        // parent row click handler doesn't fire.
                        event.stopPropagation();
                        handleClone(env.slug);
                      }
                }
              />
            </Fragment>
          );
        })}
      </span>
    </>
  );
}
