import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronRight, GitBranch, Info } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { RowKebabMenu } from "@/components/ui/row-kebab";
import { FlowItem } from "@/components/flow/FlowItem";
import { FlowEmptyState } from "./FlowEmptyState";
import { AddFlowModal } from "@/components/flow/AddFlowModal";
import { RenameFeatureModal } from "./RenameFeatureModal";
import { DeleteFeatureDialog } from "./DeleteFeatureDialog";
import { FeatureDetailsDrawer } from "./FeatureDetailsDrawer";
import { FeatureEnvWorkflow } from "./FeatureEnvWorkflow";
import { RenameFlowModal } from "@/components/flow/RenameFlowModal";
import { DeleteFlowDialog } from "@/components/flow/DeleteFlowDialog";
import { FlowDetailsDrawer } from "@/components/flow/FlowDetailsDrawer";
import { useFeatureFlows } from "@/lib/blocks/hooks";
import { useIsRole } from "@/hooks/useAuth";
import { useLocale, useT } from "@/lib/blocks/i18n";
import { cn } from "@/lib/utils";
import type { Feature, Flow } from "@/lib/blocks/data";

interface FeatureItemProps {
  feature: Feature;
  /** When true, hides rename/delete kebabs and the inline "Add
   *  another flow" button — the row is read-only. */
  readOnly?: boolean;
  /** Active environment slug. When set, the per-row status counts
   *  filter flows to this env; when undefined, they aggregate across
   *  every env (the legacy env-less `/projects/:id` page). */
  envSlug?: string;
}

// Three small "Passed N / Failed N / Pending N" pills that sit next
// to the feature's flow-count badge. Each pill uses the same semantic
// colors as StatusChip so the row reads consistently. We compute
// counts by filtering flows by envSlug when present, otherwise
// counting every flow for the feature.
interface StatusCount {
  key: "passed" | "failed" | "pending";
  i18nKey: string;
  className: string;
}

// All three "passed / failed / pending" pills share the same muted
// chip styling as the unset Stack chip on the flow row
// (`border-border bg-muted text-muted-foreground`). This keeps the
// feature row visually uniform — the user reads the row as
// "feature name + count chips" rather than a colored dashboard —
// and the GitBranch badge with the flow count stays as the only
// accent on the row.
const MUTED_CHIP =
  "border-border bg-muted text-muted-foreground";

const STATUS_COUNTS: StatusCount[] = [
  {
    key: "passed",
    i18nKey: "passed",
    className: MUTED_CHIP,
  },
  {
    key: "failed",
    i18nKey: "failed",
    className: MUTED_CHIP,
  },
  {
    key: "pending",
    i18nKey: "pending",
    className: MUTED_CHIP,
  },
];

// The "+5" overflow chip on the left opens a dropdown listing the
// "other" chip options not shown inline — the two remaining test
// statuses (Investigating, Pause), plus the three stack slices
// (Frontend, Backend, Investigating). "Investigating" intentionally
// appears TWICE — once for status, once for stack — because they
// count different things even though both chips share the same
// violet (see StackChip comment). Each row labels itself
// "Investigating(Status)" / "Investigating(Stack)" so the user can
// read either chip and see the matching count beside it.
interface OtherCount {
  key: "investigatingStatus" | "pauseStatus" | "frontend" | "backend" | "investigatingStack";
  /** i18n key prefix: "flowStatus" or "flowStack". */
  i18n: "flowStatus" | "flowStack";
  /** i18n key suffix for the label. */
  i18nKey: string;
  /** Optional suffix appended to the label in parentheses, e.g.
   *  "(Status)" — disambiguates rows whose labels would otherwise
   *  collide (the two Investigating rows). */
  suffix?: string;
  className: string;
}

const OTHER_COUNTS: OtherCount[] = [
  {
    key: "investigatingStatus",
    i18n: "flowStatus",
    i18nKey: "investigating",
    suffix: "Status",
    className: "border-violet-300 bg-violet-50 text-violet-700",
  },
  {
    key: "frontend",
    i18n: "flowStack",
    i18nKey: "frontend",
    className: "border-primary-border bg-primary-muted text-primary",
  },
  {
    key: "backend",
    i18n: "flowStack",
    i18nKey: "backend",
    className: "border-border bg-muted text-muted-foreground",
  },
  {
    key: "pauseStatus",
    i18n: "flowStatus",
    i18nKey: "pause",
    className: "border-sky-300 bg-sky-50 text-sky-700",
  },
  {
    key: "investigatingStack",
    i18n: "flowStack",
    i18nKey: "investigating",
    suffix: "Stack",
    className: "border-violet-300 bg-violet-50 text-violet-700",
  },
];

function tallyByStatus(flows: Flow[]) {
  const counts = { passed: 0, failed: 0, pending: 0 };
  for (const f of flows) {
    if (f.status === "passed") counts.passed++;
    else if (f.status === "failed") counts.failed++;
    else if (f.status === "pending") counts.pending++;
  }
  return counts;
}

// Counts for the "other" options shown in the +5 dropdown. The two
// "investigating" keys are kept separate on purpose: a flow can have
// status="investigating" without stack="investigating" (and vice
// versa), so each row reports its own count. The remaining three
// keys are straightforward: status="pause", stack="frontend",
// stack="backend". Caller pre-filters by envSlug when the page is
// env-scoped — these helpers just tally what's in the list.
function tallyOthers(flows: Flow[]) {
  const counts = {
    investigatingStatus: 0,
    pauseStatus: 0,
    frontend: 0,
    backend: 0,
    investigatingStack: 0,
  };
  for (const f of flows) {
    if (f.status === "investigating") counts.investigatingStatus++;
    if (f.status === "pause") counts.pauseStatus++;
    if (f.stack === "frontend") counts.frontend++;
    if (f.stack === "backend") counts.backend++;
    if (f.stack === "investigating") counts.investigatingStack++;
  }
  return counts;
}

export function FeatureItem({
  feature,
  readOnly = false,
  envSlug,
}: FeatureItemProps) {
  // Testers are read-only across the workspace, even on the dev source
  // env. We OR with `readOnly` here rather than relying on the page
  // thread `readOnly` all the way down — the kebab gate lives next to
  // the rename/delete state so it can't be accidentally bypassed by a
  // page that forgets the OR. The hooks (`useUpdateFeature` /
  // `useDeleteFeature` / `useUpdateFlow` / `useDeleteFlow`) also throw
  // for testers as defense-in-depth.
  const isTester = useIsRole("tester");
  const effectiveReadOnly = readOnly || isTester;

  const [expanded, setExpanded] = useState(false);
  const [addFlowOpen, setAddFlowOpen] = useState(false);

  // Feature-level rename/delete/details. The kebab lives at the end
  // of the header row; opening any of the three closes nothing else,
  // they're independent modals sharing one trigger via RowKebabMenu's
  // `extraItems` slot for the read-only details entry.
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Drawer open state lives in URL search params (`?feature=<id>`)
  // instead of local state so a page refresh, a browser back/forward,
  // or sharing the URL with a colleague all keep the drawer open on
  // the same feature. Each FeatureItem watches the param: when it
  // matches this row's id, this row's drawer is the open one.
  const [searchParams, setSearchParams] = useSearchParams();
  const openFeatureId = searchParams.get("feature");
  const detailsOpen = openFeatureId === feature.id;
  const openDetails = () => {
    const next = new URLSearchParams(searchParams);
    next.set("feature", feature.id);
    setSearchParams(next, { replace: false });
  };
  const closeDetails = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("feature");
    setSearchParams(next, { replace: false });
  };

  // Flow-level rename/delete/details. The row kebab is rendered next
  // to each flow inside the expanded list; one pair of modals serves
  // whichever flow was last clicked (id + name stored in state). The
  // details drawer likewise caches the *whole* flow so the drawer can
  // show every field without re-querying.
  const [renameFlow, setRenameFlow] = useState<
    { id: string; name: string; status: import("@/lib/blocks/data").FlowStatus } | null
  >(null);
  const [deleteFlow, setDeleteFlow] = useState<{ id: string; name: string } | null>(null);

  // Always fetch flows for this feature so the count badge survives
  // collapse. The list itself is still gated on `expanded` below, so the
  // payload only renders when the row is open — but the badge needs the
  // count to persist across expand/collapse (otherwise it briefly reads 0
  // every time the row is minimized).
  //
  // `feature.projectId` is forwarded so the returned `Flow` records
  // carry the right projectId — required by `useCloneFlow`'s env chip
  // to filter and create the destination feature.
  const { data: flows } = useFeatureFlows(feature.id, feature.projectId);
  const t = useT();
  const { formatRelativeTime } = useLocale();
  const flowList: Flow[] = flows ?? [];

  // Flow Details drawer open state mirrors the Feature Details pattern:
  // lives in URL search params (`?flow=<id>`) instead of local state
  // so a page refresh, browser back/forward, or a shared URL all keep
  // the drawer open on the same flow. Each FeatureItem watches the
  // param — when it matches one of this row's flows, that flow's
  // drawer is the open one. `?? null` covers "URL set but flow is no
  // longer in the cached list" (e.g. flow was deleted) — treat as
  // closed so the drawer auto-dismisses instead of pointing at a
  // missing record.
  const openFlowId = searchParams.get("flow");
  const detailsFlow =
    openFlowId !== null
      ? flowList.find((f) => f.id === openFlowId) ?? null
      : null;
  const openFlowDetails = (flow: Flow) => {
    const next = new URLSearchParams(searchParams);
    next.set("flow", flow.id);
    // Clear `tab` and `expanded` so the drawer always opens on the
    // Details tab — otherwise a stale `?tab=tests` from a previous
    // session / refresh would carry over (URLSearchParams.clone()
    // preserves every other key, including tab state) and the user
    // would land on Test Cases instead of Details when they explicitly
    // chose "Flow Details" from the kebab. The tab pill on the
    // drawer's own header lets them switch forward to Tests when they
    // want it.
    next.delete("tab");
    next.delete("expanded");
    setSearchParams(next, { replace: false });
  };
  const closeFlowDetails = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("flow");
    setSearchParams(next, { replace: false });
  };
  // When the page is env-scoped, every visible count on this row
  // (badge, status pills, +5 dropdown, expanded list) needs to be
  // filtered to that env — otherwise the badge could say 6 while the
  // status pills sum to 2, which is the exact mismatch the user
  // flagged. On the env-less page (envSlug undefined), aggregate
  // across every env.
  const visibleFlowList: Flow[] =
    envSlug !== undefined
      ? flowList.filter((f) => f.envSlug === envSlug)
      : flowList;
  const statusCounts = tallyByStatus(visibleFlowList);
  const otherCounts = tallyOthers(visibleFlowList);

  // Measure the inner content's height after every render that could
  // change it (rows added/removed, modal opens, error-state swap) and
  // expose it as a CSS variable on the wrapper. The expand/collapse
  // keyframes in index.css read this variable so the animation
  // always lands on the real content height — no height cap, no
  // guess. Refs stay stable across renders so the ResizeObserver
  // and effect deps don't churn. We re-measure on every render of
  // the children (visibleFlowList length, rename/delete state) by
  // depending on `expanded` plus the visibleFlowList reference; the
  // observer also catches intrinsic-size changes (flow names wrapping,
  // status pill wrap, etc.) we wouldn't otherwise catch.
  const contentRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = contentRef.current;
    if (!node) return;
    const measure = () => {
      // Use the natural content height, not bounding rect — when the
      // wrapper is collapsed, the inner `overflow-hidden` clips the
      // child to 0 but the child's scrollHeight still reports the
      // real content height. Setting the wrapper to that height (in
      // CSS pixels) is what the expand keyframe ends on.
      const h = node.scrollHeight;
      node.parentElement?.style.setProperty(
        "--feature-content-height",
        `${h}px`,
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [expanded, visibleFlowList]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setExpanded((v) => !v);
    }
  };

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={handleKey}
        aria-expanded={expanded}
        aria-controls={`feature-content-${feature.id}`}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {/* Single icon that rotates 90° on expand — `ChevronRight`
            pointing right + `rotate-90` lands pointing down, matching
            the previous collapsed/expanded glyphs without a hard cut
            between two different elements. `transition-transform`
            pairs with the panel's `transition-[grid-template-rows]`
            so the icon sweep and the height open/close share the
            same 200ms ease-out. */}
        <ChevronRight
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out",
            expanded && "rotate-90",
          )}
          aria-hidden="true"
        />
        <span className="flex-1 text-sm font-semibold text-foreground">
          {feature.name}
        </span>
        {/* Read-only environment workflow diagram — sits between the
            feature name and the status pills so it mirrors the
            flow-row's position. Renders for every env (dev / uat /
            stg / prod / custom) so the user sees where this feature
            has been promoted regardless of which env they're viewing.
            No click handler — the read-only mirror is intentional;
            cloning happens on the dev-source flow row's interactive
            EnvWorkflow, not on the feature row. The env-less page
            (feature.envSlug undefined) has no row-level env anchor,
            so we skip the diagram there. */}
        {feature.envSlug !== undefined && <FeatureEnvWorkflow feature={feature} />}
        {/* Per-env Passed / Failed / Pending counts as three small
            pills. Always rendered (including 0) so the row's
            horizontal layout doesn't shift with the data. Filtered
            to envSlug when the page is env-scoped; aggregated on the
            env-less page. Heights match the adjacent flow-count
            Badge via text-xs + py-0.5 + border. */}
        <div className="flex items-center gap-1.5" aria-label={t("featureItem.statusCounts.label", "Flow statuses")}>
          {/* +5 is the trigger chip that opens a dropdown listing the
              other per-status count chips with their real values.
              Sized to match the inline pills (text-xs + py-0.5 +
              border) so the row stays vertically aligned. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[state=open]:bg-accent"
              >
                +5
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {OTHER_COUNTS.map((s) => (
                <DropdownMenuItem
                  key={s.key}
                  className="flex items-center gap-2"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "inline-block h-2 w-2 shrink-0 rounded-full border",
                      s.className.split(" ").find((c) => c.startsWith("border-")),
                      s.className
                        .split(" ")
                        .find((c) => c.startsWith("bg-") && !c.includes("hover")),
                    )}
                  />
                  <span>
                    {t(`${s.i18n}.${s.i18nKey}`, s.i18nKey)}
                    {s.suffix && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({s.suffix})
                      </span>
                    )}
                  </span>
                  <span className="ml-auto font-semibold text-foreground">
                    {otherCounts[s.key]}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {STATUS_COUNTS.map((s) => (
            <span
              key={s.key}
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
                s.className,
              )}
            >
              <span>{t(`flowStatus.${s.i18nKey}`, s.key)}</span>
              <span className="font-semibold">{statusCounts[s.key]}</span>
            </span>
          ))}
        </div>
        {/* Total flow-count chip — sits to the left of the updated
            time. Uses the env-filtered list so it agrees with the
            status pills + expanded list on env-scoped pages. */}
        <Badge variant={visibleFlowList.length > 0 ? "default" : "muted"}>
          <GitBranch className="h-3 w-3" aria-hidden="true" />
          {visibleFlowList.length}
        </Badge>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {formatRelativeTime(feature.updatedAt)}
        </span>
        {/* Row kebab — sits at the end of the header row. The RowKebabMenu
            wrapper swallows pointer/keyboard events so opening the menu
            doesn't toggle the row's expand/collapse. Two modes:
              * readOnly  → kebab with ONLY a "Feature Details" entry
                            that opens the details drawer. No Rename /
                            Delete — non-dev envs are read-only views
                            of what was authored in dev.
              * editable  → kebab with Rename + Delete + Feature Details.
                            Destructive Delete stays anchored at the
                            bottom. */}
        {effectiveReadOnly ? (
          <RowKebabMenu
            ariaLabel={t("featureItem.menu", "Feature actions")}
            readOnly
            viewDetailsLabel={t("featureItem.details", "Feature Details")}
            onViewDetails={openDetails}
          />
        ) : (
          <RowKebabMenu
            ariaLabel={t("featureItem.menu", "Feature actions")}
            renameLabel={t("featureItem.rename", "Rename")}
            deleteLabel={t("featureItem.delete", "Delete")}
            onRename={() => setRenameOpen(true)}
            onDelete={() => setDeleteOpen(true)}
            // Read-only "Feature Details" lives above Rename/Delete so the
            // destructive Delete stays anchored at the bottom. Available
            // on every row (not gated on `readOnly`) because inspection
            // is useful regardless of who's looking at the page.
            extraItems={
              <DropdownMenuItem onSelect={openDetails}>
                <Info className="h-4 w-4" aria-hidden="true" />
                <span>{t("featureItem.details", "Feature Details")}</span>
              </DropdownMenuItem>
            }
          />
        )}
      </div>

      {/* Always-mounted wrapper so the height can animate between 0
          and the measured content height instead of mount/unmount on
          toggle. The keyframes in index.css (`feature-expand` /
          `feature-collapse`) read `--feature-content-height`, which
          the effect above writes from the inner scrollHeight on
          every content change. Two animation classes are toggled by
          `data-state` — open plays the expand keyframe (0 → height),
          closed plays the collapse keyframe (height → 0). The inner
          `overflow-hidden` keeps any content past the wrapper's
          current height clipped during the transition.
          `role="region"` + `aria-hidden={!expanded}` keeps the AT
          contract honest when collapsed: the panel is removed from
          the accessibility tree and the keyboard tab order, even
          though it stays in the DOM for the animation. The 200ms
          timing matches the existing `accordion-down` /
          `sidebar-open` keyframes in tailwind.config.js so the
          row's motion language stays consistent with the rest of
          the app. */}
      <div
        id={`feature-content-${feature.id}`}
        role="region"
        aria-hidden={!expanded}
        data-state={expanded ? "open" : "closed"}
        className="feature-collapse-wrapper overflow-hidden"
      >
        <div
          ref={contentRef}
          className="bg-muted/30 px-4 py-3"
        >
          <Separator className="mb-3" />
          {visibleFlowList.length === 0 ? (
            !effectiveReadOnly ? (
              <FlowEmptyState onAdd={() => setAddFlowOpen(true)} />
            ) : (
              <FlowEmptyState />
            )
          ) : (
            <ul className="space-y-1.5">
              {visibleFlowList.map((flow) => (
                <li
                  key={flow.id}
                  className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm transition-colors hover:border-primary/40 hover:bg-accent"
                >
                  <FlowItem
                    flow={flow}
                    readOnly={readOnly}
                    trailing={
                      readOnly ? (
                        // Read-only flows (non-dev envs): kebab with
                        // ONLY a "Flow Details" entry that opens the
                        // details drawer. No Rename/Delete — non-dev
                        // envs are read-only views.
                        <RowKebabMenu
                          ariaLabel={t("flowItem.menu", "Flow actions")}
                          readOnly
                          viewDetailsLabel={t(
                            "flowItem.details",
                            "Flow Details",
                          )}
                          // Open state is URL-backed (`?flow=<id>`)
                          // so a refresh / shared link / back-forward
                          // all re-open the drawer on the same flow.
                          onViewDetails={() => openFlowDetails(flow)}
                        />
                      ) : (
                        <RowKebabMenu
                          ariaLabel={t("flowItem.menu", "Flow actions")}
                          renameLabel={t("flowItem.rename", "Rename")}
                          deleteLabel={t("flowItem.delete", "Delete")}
                          onRename={() =>
                            setRenameFlow({
                              id: flow.id,
                              name: flow.name,
                              // `flow.status` is optional; `toFlow` falls back
                              // to "active" for legacy records, so we mirror
                              // that here when sending the rename mutation.
                              status: flow.status ?? "active",
                            })
                          }
                          onDelete={() => setDeleteFlow({ id: flow.id, name: flow.name })}
                          // Read-only "Flow Details" parallels the row's
                          // parent feature row. Open state is URL-backed
                          // (`?flow=<id>`) so a refresh / shared link /
                          // back-forward all re-open the drawer on the
                          // same flow.
                          extraItems={
                            <DropdownMenuItem
                              onSelect={() => openFlowDetails(flow)}
                            >
                              <Info className="h-4 w-4" aria-hidden="true" />
                              <span>
                                {t("flowItem.details", "Flow Details")}
                              </span>
                            </DropdownMenuItem>
                          }
                        />
                      )
                    }
                  />
                </li>
              ))}
              {!effectiveReadOnly && (
                <li className="pt-2">
                  {/* "+ Add another flow" button — gated on effectiveReadOnly
                      so testers can't add flows either, matching the rest of
                      the read-only posture. Stays visible when the row is
                      editable. */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setAddFlowOpen(true)}
                    className={cn("text-primary")}
                  >
                    {t("featureItem.addAnotherFlow", "+ Add another flow")}
                  </Button>
                </li>
              )}
            </ul>
          )}
        </div>
      </div>

      <AddFlowModal
        open={addFlowOpen}
        onClose={() => setAddFlowOpen(false)}
        projectId={feature.projectId}
        defaultFeatureId={feature.id}
        // Lock the modal to the feature's own env — the modal filters its
        // dropdown to env-matching features and stamps the flow's envSlug
        // from this. Because the FeatureItem's "+ Add another flow" is
        // always triggered from within the feature's own env-scoped
        // context, passing feature.envSlug aligns the modal with the
        // route.
        envSlug={feature.envSlug}
      />

      <RenameFeatureModal
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        featureId={feature.id}
        projectId={feature.projectId}
        currentName={feature.name}
      />
      <DeleteFeatureDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        featureId={feature.id}
        projectId={feature.projectId}
        featureName={feature.name}
      />

      {/* Read-only details drawer opened from the kebab's "Feature
          Details" entry. Right-side Sheet (via the app's <SheetContent
          side="right"> primitive) so the row stays in view behind it.
          Owns its own open state; receives the env-scoped counts so
          it agrees with the row's pills and expanded list. */}
      <FeatureDetailsDrawer
        open={detailsOpen}
        onClose={closeDetails}
        feature={feature}
        visibleFlowCount={visibleFlowList.length}
        statusCounts={statusCounts}
      />

      <RenameFlowModal
        open={renameFlow !== null}
        onClose={() => setRenameFlow(null)}
        flowId={renameFlow?.id ?? ""}
        projectId={feature.projectId}
        featureId={feature.id}
        currentName={renameFlow?.name ?? ""}
        currentStatus={renameFlow?.status ?? "active"}
      />
      <DeleteFlowDialog
        open={deleteFlow !== null}
        onClose={() => setDeleteFlow(null)}
        flowId={deleteFlow?.id ?? ""}
        projectId={feature.projectId}
        featureId={feature.id}
        flowName={deleteFlow?.name ?? ""}
      />

      {/* Read-only "Flow Details" drawer opened from any per-flow
          kebab inside the expanded list. Open state is URL-backed
          (`?flow=<id>`); `detailsFlow` is derived from the cached
          flow list so the drawer has every field without a
          re-query. Closing drops the `?flow=<id>` param only — any
          concurrent `?feature=<id>` is preserved so a still-open
          Feature Details drawer stays open. */}
      <FlowDetailsDrawer
        open={detailsFlow !== null}
        onClose={closeFlowDetails}
        flow={detailsFlow}
      />
    </div>
  );
}