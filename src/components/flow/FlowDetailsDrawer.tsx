// Read-only "Flow Details" drawer opened from a flow row's 3-dot kebab
// menu. Surfaces what a single line of the row can't: opaque IDs, the
// flow's status / stack / env taxonomy, the long-form description,
// step count, clone origin, and timestamps. Comments aren't enumerated
// here — the comments chip + CommentsModal already own that surface,
// we only surface the count so the user can spot "this flow has 12
// comments" at a glance without expanding.
//
// Right-side Sheet rather than a Dialog so the feature row + its flow
// list stay in view while the drawer is open. The kebab remains
// reachable after closing without re-finding the row.

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuth } from "@/hooks/useAuth";
import { useT } from "@/lib/blocks/i18n";
import { useClonedEnvs } from "@/lib/blocks/hooks";
import { cn } from "@/lib/utils";
import type { Flow } from "@/lib/blocks/data";

interface FlowDetailsDrawerProps {
  open: boolean;
  onClose: () => void;
  flow: Flow | null;
}

// Render a labeled field the way ProfilePage / FeatureDetailsDrawer do
// — small uppercase caption with the value below. Keeps the drawer
// visually consistent with the app's other read-only surfaces.
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm text-foreground">{children}</dd>
    </div>
  );
}

// Show "—" rather than blank when a field is unset, and render any
// string fallback the table cell couldn't show inline. We don't try to
// pretty-print enum values here — the kebab's row already shows the
// canonical chip; we only restate the label so the drawer is readable
// without the row visible.
function Value({ children }: { children: React.ReactNode }) {
  if (children === null || children === undefined || children === "") {
    return <span className="text-muted-foreground">—</span>;
  }
  return <>{children}</>;
}

// Same shape as FeatureDetailsDrawer's UserChip — render a user
// reference (createdBy / updatedBy) with a friendly "You" when the id
// matches the signed-in user, otherwise the raw IAM subject in mono.
// Lives here too (rather than sharing a util module) because both
// drawers stay small enough that a single shared component would
// create more wiring than it saves.
function UserChip({
  userId,
  youLabel,
  currentUserId,
  currentUserName,
}: {
  userId?: string;
  youLabel: string;
  currentUserId?: string;
  currentUserName?: string;
}) {
  if (!userId) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (currentUserId && userId === currentUserId) {
    return (
      <span
        title={currentUserName}
        className="inline-flex items-center rounded-full border border-border bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground"
      >
        {youLabel}
      </span>
    );
  }
  return (
    <span className="break-all font-mono text-xs" title={userId}>
      {userId}
    </span>
  );
}

// Sibling envs in canonical promote order (stg → prod → uat). Mirrors
// `SIBLING_ENVS` in EnvWorkflow.tsx — duplicated here rather than
// exported because the workflow file owns it as a private constant
// and exposing it just for the drawer's read-only mirror isn't
// worth a module-level export change.
const DIAGRAM_SIBLING_ENVS = [
  { slug: "stg", label: "Stg" },
  { slug: "prod", label: "Prod" },
  { slug: "uat", label: "UAT" },
] as const;

// Read-only mirror of the row's interactive EnvWorkflow. Reuses the
// same node + arrow visuals (golden source, outline-with-check for
// cloned, outline for available) but without any click handlers —
// matches the drawer's "read-only summary" promise and avoids
// duplicating a click-to-clone mutation that's already one click
// away on the row. The drawer also skips the marching-dash
// animation defined inside EnvWorkflow's <style> tag — its keyframes
// are component-local; re-injecting them in every drawer mount would
// pile up identical <style> nodes. A static dashed line is still
// visually distinct as "no clone path yet".
function EnvWorkflowDiagram({
  clonedEnvs,
}: {
  clonedEnvs: Set<string>;
}) {
  return (
    <div className="mt-3 inline-flex h-6 items-center gap-1 overflow-visible text-yellow-400">
      <DiagramNode
        label="Dev"
        // The drawer shows the workflow only for dev-source flows
        // (caller-side gate) so the source box is always Dev.
        state="source"
      />
      {DIAGRAM_SIBLING_ENVS.map((env) => {
        const alreadyCloned = clonedEnvs.has(env.slug);
        return (
          <div key={env.slug} className="flex items-center gap-1">
            <DiagramArrow animated={alreadyCloned} />
            <DiagramNode
              label={env.label}
              state={alreadyCloned ? "cloned" : "available"}
            />
          </div>
        );
      })}
    </div>
  );
}

// Reused shape + class set from EnvWorkflow's Node, minus the click
// affordances. State maps stay identical so the read-only mirror
// stays visually indistinguishable from the row's interactive
// version at a glance.
function DiagramNode({
  label,
  state,
}: {
  label: string;
  state: "source" | "cloned" | "available";
}) {
  const STATE_CLASSES: Record<typeof state, string> = {
    source:
      "border-yellow-400 bg-yellow-400 text-yellow-950",
    cloned:
      "border-yellow-400/60 bg-yellow-400/15 text-yellow-200",
    available:
      "border-yellow-400/40 bg-transparent text-yellow-300",
  };
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-0.5 rounded-full border px-1.5 text-[9px] font-bold uppercase tracking-tight",
        STATE_CLASSES[state],
      )}
      aria-label={label}
    >
      {state === "cloned" && (
        <span aria-hidden="true" className="inline-flex">
          {/* Checkmark — same lucide-react glyph used in the row's
              Node, minus the icon component import for this read-
              only context. */}
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
      )}
      <span>{label}</span>
    </span>
  );
}

function DiagramArrow({ animated }: { animated: boolean }) {
  return (
    <svg
      width="14"
      height="10"
      viewBox="0 0 14 10"
      aria-hidden="true"
      className={cn("shrink-0 text-yellow-400")}
    >
      <line
        x1="0"
        y1="5"
        x2="10"
        y2="5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeDasharray="3 2"
        // When the destination env has been cloned, animate the dash
        // so the user can read which segments are "live". The
        // keyframe (defined inline-scoped elsewhere) is intentionally
        // omitted here to keep the drawer stateless — a static dashed
        // line still reads as a directional chain.
        className={animated ? "env-wf-arrow-line" : undefined}
      />
      <polygon points="10,3 13,5 10,7" fill="currentColor" />
    </svg>
  );
}

export function FlowDetailsDrawer({
  open,
  onClose,
  flow,
}: FlowDetailsDrawerProps) {
  const t = useT();
  // Same "you or raw id" rendering as FeatureDetailsDrawer — see that
  // component for the rationale (no user directory, so non-self ids
  // render as the IAM subject).
  const { currentUser } = useAuth();
  // Read cloned-env set so the read-only workflow diagram can show
  // which sibling envs the source flow has been promoted to. Hook is
  // unconditional (rules of hooks) — `enabled: false` when flowId is
  // missing keeps it idle for null-flow renders.
  const { data: clonedEnvs } = useClonedEnvs(flow?.id);

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>
            {t("flowItem.detailsTitle", "Flow Details")}
          </SheetTitle>
          <SheetDescription>
            {t(
              "flowItem.detailsDescription",
              "Read-only summary of this flow.",
            )}
          </SheetDescription>
        </SheetHeader>

        {/* SheetContent renders `p-6` already; the body scrolls if the
            flow has a long clone id or many steps. Pull the sections
            off the bottom so the footer stays anchored. Falls back to
            a placeholder when no flow has been selected yet (drawer
            opened then parent cleared the state). */}
        <div className="flex-1 overflow-y-auto py-2">
          {!flow ? (
            <p className="text-sm text-muted-foreground">
              {t("flowItem.details.empty", "No flow selected.")}
            </p>
          ) : (
            <>
              <dl className="grid gap-4 sm:grid-cols-2">
                <Field label={t("flowItem.details.name", "Name")}>
                  <span className="font-semibold">{flow.name}</span>
                </Field>
                <Field label={t("flowItem.details.env", "Environment")}>
                  {flow.envSlug ? (
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {flow.envSlug}
                    </code>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </Field>
                <Field label={t("flowItem.details.status", "Status")}>
                  <Value>{flow.status ?? t("flowItem.details.unset", "unset")}</Value>
                </Field>
                <Field label={t("flowItem.details.stack", "Stack")}>
                  <Value>{flow.stack ?? t("flowItem.details.unset", "unset")}</Value>
                </Field>
                <Field label={t("flowItem.details.id", "Flow ID")}>
                  <span className="break-all font-mono text-xs">{flow.id}</span>
                </Field>
                <Field label={t("flowItem.details.featureId", "Feature ID")}>
                  <span className="break-all font-mono text-xs">
                    {flow.featureId}
                  </span>
                </Field>
                <Field label={t("flowItem.details.projectId", "Project ID")}>
                  <span className="break-all font-mono text-xs">
                    {flow.projectId}
                  </span>
                </Field>
                {/* Clone origin only when present — most flows are
                    source rows with nothing to point at. */}
                {flow.clonedFromFlowId && (
                  <Field
                    label={t(
                      "flowItem.details.clonedFrom",
                      "Cloned from flow",
                    )}
                  >
                    <span className="break-all font-mono text-xs">
                      {flow.clonedFromFlowId}
                    </span>
                  </Field>
                )}
                <Field label={t("flowItem.details.created", "Created")}>
                  {new Date(flow.createdAt).toLocaleString()}
                </Field>
                <Field label={t("flowItem.details.updated", "Last updated")}>
                  {new Date(flow.updatedAt).toLocaleString()}
                </Field>
                <Field label={t("flowItem.details.createdBy", "Created by")}>
                  <UserChip
                    userId={flow.createdBy}
                    youLabel={t("flowItem.details.you", "You")}
                    currentUserId={currentUser?.id}
                    currentUserName={currentUser?.name}
                  />
                </Field>
                <Field label={t("flowItem.details.updatedBy", "Updated by")}>
                  <UserChip
                    userId={flow.updatedBy}
                    youLabel={t("flowItem.details.you", "You")}
                    currentUserId={currentUser?.id}
                    currentUserName={currentUser?.name}
                  />
                </Field>
              </dl>

              {/* Read-only workflow diagram — mirrors the row's
                  interactive EnvWorkflow but without click-to-clone
                  affordances. Same canonical Dev → Stg → Prod → UAT
                  chain; cloned sibling envs render with the same
                  check-filled outline as the row. Gated on dev env
                  to match EnvWorkflow's "source-only" behavior on the
                  row — promotion logic is dev-centric, so showing the
                  diagram for a stg/prod/uat flow wouldn't carry the
                  same meaning. */}
              {flow.envSlug === "dev" && (
                <>
                  <Separator className="my-5" />
                  <div>
                    <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {t(
                        "flowItem.details.workflowHeading",
                        "Environment workflow",
                      )}
                    </h4>
                    <EnvWorkflowDiagram clonedEnvs={clonedEnvs ?? new Set()} />
                  </div>
                </>
              )}

              {/* Long-form description + step count get their own block
                  below the id grid — they can be long and would feel
                  cramped in a 2-column cell. */}
              {flow.description && (
                <>
                  <Separator className="my-5" />
                  <div>
                    <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {t("flowItem.details.description", "Description")}
                    </h4>
                    <p className="mt-2 whitespace-pre-line text-sm text-foreground">
                      {flow.description}
                    </p>
                  </div>
                </>
              )}

              {flow.steps && flow.steps.length > 0 && (
                <>
                  <Separator className="my-5" />
                  <div>
                    <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {t("flowItem.details.stepsHeading", "Steps")}
                    </h4>
                    <p className="mt-2 text-sm text-foreground">
                      <span className="font-semibold">
                        {flow.steps.length}
                      </span>{" "}
                      {t("flowItem.details.stepsTotal", "step(s) recorded")}
                    </p>
                    <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-foreground">
                      {flow.steps.map((step, idx) => (
                        <li key={idx} className="break-words">
                          {step}
                        </li>
                      ))}
                    </ol>
                  </div>
                </>
              )}

              <Separator className="my-5" />
              <div>
                <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t("flowItem.details.commentsHeading", "Comments")}
                </h4>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t(
                    "flowItem.details.commentsHint",
                    "Open from the row's Comments chip — comments live there, not here.",
                  )}
                </p>
              </div>
            </>
          )}
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={onClose}>
            {t("close", "Close")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
