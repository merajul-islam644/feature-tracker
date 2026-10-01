// Interactive horizontal environment workflow for the feature row.
//
// Renders for managers on a dev-source feature row (gate at
// `FeatureItem.tsx`). Mirrors the structure of the deleted flow-row
// `EnvWorkflow` but for the feature entity: Dev (filled) → 3 sibling
// pills. Managers click a sibling pill to promote this feature into
// that env; the mutation is a sibling-record create via
// `useCloneFeature` — the source row's `envSlug` stays as "dev", a
// new sibling record appears in the destination env (with all source-
// env flows cascaded under it), and the source row's
// `FeatureEnvWorkflow` mirror picks up the persistent
// "promoted to {env}" tick once the clone lands.
//
// Visual states per sibling pill:
//
//   * Source (Dev)        — golden filled, dark text. Source of
//                            truth. Always the dev pill.
//
//   * Already cloned      — outlined + light golden bg + check icon
//                            + animated arrow. A sibling record
//                            already exists in this env (created
//                            by a previous `useCloneFeature`
//                            click). Persistent marker; not
//                            clickable (clicking would create a
//                            duplicate clone — the sibling pill is
//                            disabled to prevent this).
//
//   * Ready (in-flight)   — same "cloned" visual but with the
//                            pending pulse overlay. Shown on the
//                            pill that is the in-flight target of
//                            an active click — gives the manager
//                            instant feedback ("you clicked Stg,
//                            the pill flipped to ready") before
//                            the sibling record lands and
//                            `useClonedFeatureEnvs` reports the
//                            new env as cloned.
//
//   * Blocked (precondition fails — 0 flows OR any failed)
//                          — same outlined "available" look so the
//                            pill stays clickable. Click opens
//                            `BlockPromoteModal` with an error
//                            explanation + a "Request" button that
//                            sends a notification to the
//                            feature's assigned QAs. The pill is
//                            NOT disabled — the previous "click is
//                            inert" behavior hid the block reason
//                            from the manager; the new flow makes
//                            the reason actionable.
//
//   * Available           — outlined, yellow text, no tick, no
//                            animation, clickable. Default sibling
//                            state — no clone yet exists in this
//                            env AND no precondition is failing.
//
// Visuals (Node / Arrow / STATE_CLASSES / keyframes) live in
// `EnvWorkflowPrimitives.tsx` so the feature-row interactive chain
// (`ManagerFeatureEnvWorkflow`) and the feature-row read-only mirror
// (`FeatureEnvWorkflow`) share the exact same look. Only the click
// handler + the pending-spinner logic + the block-reason modal stay
// here.

import { Fragment, useState } from "react";
import {
  useCloneFeature,
  useClonedFeatureEnvs,
  useFeatureFlows,
  useProject,
} from "@/lib/blocks/hooks";
import { useToast } from "@/hooks/useToast";
import { useT } from "@/lib/blocks/i18n";
import type { Feature } from "@/lib/blocks/data";
import {
  SIBLING_ENVS,
  EnvNode,
  EnvArrow,
  EnvWorkflowStyles,
  passedEnvSet,
} from "@/components/flow/EnvWorkflowPrimitives";
import { BlockPromoteModal, type BlockReason } from "./BlockPromoteModal";

interface ManagerFeatureEnvWorkflowProps {
  feature: Feature;
}

export function ManagerFeatureEnvWorkflow({
  feature,
}: ManagerFeatureEnvWorkflowProps) {
  const t = useT();
  const toast = useToast();
  const cloneFeature = useCloneFeature();

  // Sibling-clone lookup — same hook the read-only
  // `FeatureEnvWorkflow` uses. Tells us which sibling envs already
  // have a clone so we can render the persistent "already cloned"
  // visual and disable the click. Empty set on a never-promoted
  // source; populated as the manager clicks each sibling pill.
  const clonedEnvsQuery = useClonedFeatureEnvs(feature.id, feature.projectId);
  const clonedEnvs = clonedEnvsQuery.data ?? new Set<string>();
  // Lineage path — same helper, same rationale as
  // `FlowEnvWorkflow.tsx`. On this manager-interactive variant the
  // gate at `FeatureItem.tsx` mounts the component only on dev-
  // source features (no `clonedFromFeatureId`), so `pathEnvs` is
  // always `{dev}` and `isInPath` never matches a sibling slug.
  // Kept anyway so the visual rule is one shared rule across all
  // four components — the read-only mirrors (FeatureEnvWorkflow,
  // FlowEnvWorkflow) are where `isInPath` actually animates a pill.
  const pathEnvs = passedEnvSet(feature.envSlug);

  // Project lookup — the block-promote modal uses the project name
  // in the notification body so the QA recipient sees the full
  // "{actor} requested promotion for {feature} in {project} to {env}"
  // message. `useProject` reads from the same query cache
  // `ProjectDetailPage` populates, so this is a free cache hit when
  // the chain renders inside a project page; on a page that hasn't
  // loaded the project, `project` is `undefined` and the modal
  // falls back to an empty string in the body — acceptable, the QA
  // can still act on the featureName alone.
  const projectQuery = useProject(feature.projectId);
  const project = projectQuery.data;

  // Precondition gate — the feature must have AT LEAST ONE
  // source-env flow AND every source-env flow must be in "passed"
  // status. The team's promotion contract is explicit: a feature
  // is promotion-ready only when QA has signed off on every flow
  // under it (status === "passed"). Any non-passed status
  // (`failed`, `pending`, `draft`, `investigating`, `pause`) is a
  // block — either because the work is unfinished or because it
  // has hit a regression. Empty features are also blocked.
  //
  // We pull the feature's flows via `useFeatureFlows` (the same
  // hook the row already uses for its own flow list) and filter to
  // those whose `envSlug` matches the source feature's — mirrors
  // the cascade filter inside `useCloneFeature`'s mutationFn so
  // the UI gate and the mutation gate agree on the rule.
  //
  // Optimistic during the initial fetch: while the flows query is
  // still loading we treat the precondition as passed (empty
  // `sourceFlows` → `isBlocked === false`). The mutation's
  // server-side check throws if the precondition actually fails,
  // which surfaces as an error toast. Earlier iterations
  // conservatively disabled every pill with a "Loading flow
  // status…" tooltip until the query resolved, but that turned
  // every hover into a confusing "Loading…" message and made the
  // chain feel broken before the manager had interacted with
  // anything. Letting the manager click through and catching the
  // failure at the modal/mutation layer is much less noisy.
  const flowsQuery = useFeatureFlows(feature.id, feature.projectId);
  const sourceFlows = (flowsQuery.data ?? []).filter(
    (f) => f.envSlug === feature.envSlug,
  );
  // `nonPassedFlows` is every source-env flow whose status is
  // anything other than `"passed"`. Drives both the modal body
  // (which flows are blocking) and the tooltip count. Pre-sorted
  // by `name` so the modal body is stable across re-renders
  // (TanStack Query re-emits the array on every refetch and an
  // un-sorted `.slice` would otherwise feel like the list is
  // shuffling).
  const nonPassedFlows = sourceFlows
    .filter((f) => f.status !== "passed")
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  // Discriminated block reason — drives the modal copy. Two
  // branches: `"empty"` (no flows under the feature) and
  // `"notAllPassed"` (at least one flow is not in passed status).
  // `empty` takes precedence when both would apply (which only
  // happens if `sourceFlows` is empty — by definition then
  // `nonPassedFlows` is also empty — so the order is mostly
  // defensive).
  const blockReason: BlockReason | null =
    sourceFlows.length === 0
      ? "empty"
      : nonPassedFlows.length > 0
        ? "notAllPassed"
        : null;
  const isBlocked = blockReason !== null;
  // Top-3 blocking flow names for the modal body.
  const blockingFlowNames = nonPassedFlows
    .slice(0, 3)
    .map((f) => f.name ?? "(untitled)");

  // Block-promote modal state. Tracks which env pill was clicked
  // so the modal can render "Promote to Stg" in its title and
  // include the right envSlug in the notification body. `null`
  // when no modal is open.
  const [blockedEnvSlug, setBlockedEnvSlug] = useState<string | null>(null);
  const blockedEnvLabel =
    SIBLING_ENVS.find((e) => e.slug === blockedEnvSlug)?.label ?? "";

  const handleClone = (slug: string) => {
    if (cloneFeature.isPending) return; // ignore double-clicks while a promote is in flight
    // Defensive duplicate-clone guard — the `disabled` prop on the
    // pill already prevents clicks on already-cloned envs, but a
    // stale modal / programmatic caller could still reach here.
    // Return silently rather than fire a doomed mutation.
    if (clonedEnvs.has(slug)) return;
    // Blocked-by-precondition: open the request modal instead of
    // trying to promote. The mutation would throw anyway, but the
    // modal gives the manager an actionable next step (notify QA)
    // rather than a dead-end error toast.
    if (isBlocked && blockReason) {
      setBlockedEnvSlug(slug);
      return;
    }
    cloneFeature.mutate(
      { feature, targetEnvSlug: slug },
      {
        onSuccess: () => {
          toast.success(
            t(
              "toast.featurePromoted",
              'Feature "{name}" promoted to {env}.',
              { name: feature.name, env: slug.toUpperCase() },
            ),
          );
        },
        onError: (err) => {
          toast.error(
            err instanceof Error
              ? err.message
              : t(
                  "toast.featurePromoteError",
                  "Could not promote feature.",
                ),
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
          // See `ManagerFlowEnvWorkflow.tsx` — on this manager-
          // interactive variant the gate at `FeatureItem.tsx`
          // restricts the mount to dev-source features (no
          // `clonedFromFeatureId`), so `pathEnvs` is always `{dev}`
          // and `isInPath` never matches a sibling slug. Kept for
          // parity with the read-only `FeatureEnvWorkflow` so all
          // four components share one animation rule.
          const isInPath = pathEnvs.has(env.slug);
          const isThisPending =
            cloneFeature.isPending &&
            cloneFeature.variables?.feature.id === feature.id &&
            cloneFeature.variables?.targetEnvSlug === env.slug;
          // `showReady` flips this pill to the "cloned" visual
          // (Check + animated arrow) when this env already has a
          // sibling (persistent marker), this pill is the in-flight
          // target of an active click, OR the row's lineage has
          // passed through this env (the `isInPath` branch — no-op
          // here but kept for parity with `FeatureEnvWorkflow`).
          // Order of the OR matters for the `isThisPending`
          // branch: the in-flight visual takes precedence over the
          // "already cloned" visual on the same pill because
          // pending is a transient state that resolves into
          // "already cloned" once the mutation lands and
          // `useClonedFeatureEnvs` reports the new sibling.
          //
          // NOTE: a *blocked* pill stays in the regular "available"
          // visual — we don't repaint it red. The block reason
          // surfaces in the tooltip + the modal that opens on
          // click, not in the pill chrome. Keeping the same yellow
          // outline makes the chain look uniform and avoids
          // introducing a new visual state for the primitive
          // (which would cascade through `FeatureEnvWorkflow`'s
          // read-only mirror too).
          const showReady = isAlreadyCloned || isThisPending || isInPath;
          // Tooltip precedence (most actionable first):
          //   1. precondition fails (no flows OR any not passed)
          //      → "Can't promote — {reason}" so the manager
          //         knows to expect the modal on click
          //   2. already cloned
          //      → "Already promoted to {env}"
          //   3. default
          //      → "Promote to {env}"
          const pillTitle = isBlocked
            ? blockReason === "empty"
              ? t(
                  "envWorkflow.emptyBlocked",
                  'Cannot promote "{feature}" — no flows yet (click for options)',
                  { feature: feature.name },
                )
              : t(
                  "envWorkflow.notAllPassedBlocked",
                  'Cannot promote "{feature}" — {count} flow not Passed (click for options)',
                  {
                    feature: feature.name,
                    count: nonPassedFlows.length,
                  },
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
                //   * pending (this pill is the in-flight target of
                //     an active click)
                //
                // Blocked pills are NOT disabled — clicking them
                // opens the BlockPromoteModal with a "Request"
                // button. The previous behavior (disabled when
                // blocked) hid the block reason behind a tooltip;
                // the manager reported the error toast fired even
                // when nothing happened, and asked for an explicit
                // modal instead.
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

      {/* Block-promote modal — only mounted when a blocked pill was
          clicked. We unmount (rather than just hide) so the modal's
          internal `useEffect([open])` resets the spinner state on
          the next open. */}
      {blockedEnvSlug && blockReason && (
        <BlockPromoteModal
          open={true}
          onClose={() => setBlockedEnvSlug(null)}
          feature={feature}
          project={project}
          targetEnvSlug={blockedEnvSlug}
          targetEnvLabel={blockedEnvLabel}
          blockingFlowCount={nonPassedFlows.length}
          blockingFlowNames={blockingFlowNames}
          blockReason={blockReason}
        />
      )}
    </>
  );
}
