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

import { useSearchParams } from "react-router-dom";
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
import { TestCaseSpreadsheet } from "@/components/test-cases/TestCaseSpreadsheet";

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
  // Drawer tab + spreadsheet-expanded state live in URL search params
  // (`?tab=tests&expanded=1`) instead of local state so a page refresh
  // keeps the user exactly where they were — e.g. mid-edit on the
  // Test Cases spreadsheet with the drawer expanded. The `flow` param
  // (which flow's drawer is open) is owned by FeatureItem; we only
  // manage `tab` + `expanded` here.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: "details" | "tests" =
    searchParams.get("tab") === "tests" ? "tests" : "details";
  const testsExpanded = searchParams.get("expanded") === "1";
  const expanded = tab === "tests" && testsExpanded;
  // Update helpers — preserve any other search params on the URL by
  // cloning the current `URLSearchParams` before mutating. Same
  // pattern as FeatureDetailsDrawer used pre-migration.
  const setTab = (next: "details" | "tests") => {
    const params = new URLSearchParams(searchParams);
    if (next === "details") {
      params.delete("tab");
      // Switching back to Details is an implicit "I'm done with the
      // wide view" — also clear the expanded flag so re-opening the
      // Test Cases tab later starts at the narrow default.
      params.delete("expanded");
    } else {
      params.set("tab", "tests");
    }
    setSearchParams(params, { replace: false });
  };
  // Accept either a direct boolean (for explicit `true`/`false` calls
  // like the Sheet close handler and the tab-switch reset) or an
  // updater function (for the spreadsheet's toggle button which does
  // `setTestsExpanded((v) => !v)`). The toggle case can't read the
  // current value from `testsExpanded` directly because that value
  // comes from `searchParams` and could be stale inside the closure
  // — the updater form captures the latest snapshot React provides.
  const setTestsExpanded = (next: boolean | ((prev: boolean) => boolean)) => {
    const resolved =
      typeof next === "function" ? next(testsExpanded) : next;
    const params = new URLSearchParams(searchParams);
    if (resolved) {
      params.set("expanded", "1");
    } else {
      params.delete("expanded");
    }
    setSearchParams(params, { replace: false });
  };
  // Read cloned-env set so the read-only workflow diagram can show
  // which sibling envs the source flow has been promoted to. Hook is
  // unconditional (rules of hooks) — `enabled: false` when flowId is
  // missing keeps it idle for null-flow renders.
  const { data: clonedEnvs } = useClonedEnvs(flow?.id);

  return (
    <Sheet open={open} onOpenChange={(next) => {
        if (!next) {
          // Reset before unmount — same rationale as the tab-switch
          // reset. The drawer will mount fresh the next time it opens.
          setTestsExpanded(false);
          onClose();
        }
      }}>
      {/* Right-side drawer. Wider than Sheet's stock `sm:max-w-sm` so
          the id-style mono fields and the two-column grid breathe.
          On the Test Cases tab we widen further so the spreadsheet
          has room for Status / Priority cells + multi-line Steps /
          Expected / Actual columns. When the user toggles the
          spreadsheet's expand icon, `w-full` + `sm:max-w-none` clear
          the `sm:max-w-md` cap on the Sheet variant so the drawer
          takes the full viewport horizontally. `flex flex-col` so the
          body flex-1 + footer anchor behave the way the spreadsheet
          expects when it owns the full vertical space. */}
      <SheetContent
        side="right"
        className={cn(
          "flex flex-col",
          tab === "tests"
            ? expanded
              ? "w-full sm:max-w-none"
              : "sm:max-w-3xl"
            : "sm:max-w-md",
        )}
      >
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

        {/* Segmented switcher — Details vs Test Cases. We use a plain
            inline-flex pair rather than the Radix Tabs primitive to
            avoid pulling in another component dep for a two-option
            toggle. The active button is filled; the other is a quiet
            outline so it's clear which panel is mounted below. */}
        <div
          role="tablist"
          aria-label={t("flowItem.drawer.tabsAria", "Flow panels")}
          className="mt-3 inline-flex shrink-0 self-start rounded-md border border-border bg-muted/40 p-0.5 text-sm"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "details"}
            onClick={() => setTab("details")}
            className={cn(
              "rounded-sm px-3 py-1 font-medium transition-colors",
              tab === "details"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t("flowItem.drawer.tabDetails", "Details")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "tests"}
            onClick={() => {
              // Both `tab=tests` and the `expanded` reset must land
              // in the SAME `setSearchParams` call. React Router's
              // `setSearchParams` is non-merging, so splitting the
              // updates across two calls would overwrite the first
              // with a `URLSearchParams` built from the *previous*
              // snapshot (before `tab=tests` had been applied) —
              // leaving the URL unchanged. Clone once, mutate both,
              // commit once.
              const params = new URLSearchParams(searchParams);
              params.set("tab", "tests");
              params.delete("expanded");
              setSearchParams(params, { replace: false });
            }}
            className={cn(
              "rounded-sm px-3 py-1 font-medium transition-colors",
              tab === "tests"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t("flowItem.drawer.tabTests", "Test Cases")}
          </button>
        </div>

        {/* Body — `flex-1 min-h-0` lets the inner scroll container
            shrink below its content size (the standard flex + scroll
            pattern). When `tests` is active we mount the spreadsheet
            as the only body child and give it a definite height so
            its sticky table header renders correctly. */}
        <div className="mt-3 flex-1 min-h-0 overflow-hidden">
          {tab === "details" ? (
            <div className="h-full overflow-y-auto py-2">
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
          ) : (
            /* The spreadsheet owns the full vertical space of the
               drawer body on this tab. It already renders a sticky
               toolbar + scrolling table inside, so we just hand it
               the flow id (and the parent feature id for schema
               validation) — no extra chrome needed here. */
            flow && (
              <TestCaseSpreadsheet
                flowId={flow.id}
                featureId={flow.featureId}
                expanded={expanded}
                onToggleExpanded={() => setTestsExpanded((v) => !v)}
              />
            )
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
