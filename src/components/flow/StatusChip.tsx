// Status chip + dropdown for a single flow row.
//
// Renders a small pill to the left of the flow's "updated" timestamp.
// Initial label is "Status" (a placeholder that signals the chip is
// interactive). Once a status has been set, the chip shows the actual
// label (e.g. "Passed") in its corresponding color. Clicking opens a
// Radix dropdown listing the four test statuses — picking one writes
// the new value through useUpdateFlowStatus.
//
// Read-only mode (non-dev envs): the chip is rendered but the trigger
// is disabled — non-dev envs are views of data authored under dev, so
// status changes happen there and just propagate here.

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useLocale, useT } from "@/lib/blocks/i18n";
import {
  FLOW_TEST_STATUSES,
  type Flow,
  type FlowTestStatus,
} from "@/lib/blocks/data";
import { useUpdateFlowStatus } from "@/lib/blocks/hooks";

interface StatusChipProps {
  flow: Flow;
  /** When true, the chip is rendered but disabled (read-only view). */
  readOnly?: boolean;
}

interface StatusVisual {
  /** Tailwind classes for the chip background, text, and border. */
  className: string;
  /** i18n key suffix for the dropdown item label. */
  i18nKey: string;
}

// Visual treatment per status. Test-result statuses get semantic colors
// (green/red/yellow/purple); the placeholder "Status" gets a neutral
// muted look so it reads as unset rather than as a real state.
const STATUS_VISUALS: Record<FlowTestStatus, StatusVisual> = {
  passed: {
    className:
      "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
    i18nKey: "passed",
  },
  failed: {
    className: "border-red-300 bg-red-50 text-red-700 hover:bg-red-100",
    i18nKey: "failed",
  },
  pending: {
    className:
      "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100",
    i18nKey: "pending",
  },
  investigating: {
    className:
      "border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100",
    i18nKey: "investigating",
  },
  pause: {
    className:
      "border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100",
    i18nKey: "pause",
  },
};

export function StatusChip({ flow, readOnly = false }: StatusChipProps) {
  const t = useT();
  const { formatRelativeTime: _ } = useLocale();
  const updateStatus = useUpdateFlowStatus();

  // The flow's `status` may be any FlowStatus (lifecycle + test). Only
  // test statuses render in their semantic color; lifecycle statuses
  // (draft/active/done) and missing status fall back to the neutral
  // "Status" placeholder.
  const current = flow.status;
  const visual: StatusVisual | null =
    current && current in STATUS_VISUALS
      ? STATUS_VISUALS[current as FlowTestStatus]
      : null;

  const handleSelect = (next: FlowTestStatus) => {
    if (readOnly) return;
    if (next === current) return;
    updateStatus.mutate({
      id: flow.id,
      projectId: flow.projectId,
      featureId: flow.featureId,
      // Forward the unchanged `title` so the cloud (which marks
      // `title` required on update) accepts the partial PATCH.
      name: flow.name,
      status: next,
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("flowStatus.chipLabel", "Flow status")}
          disabled={readOnly}
          className={cn(
            "inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[10px] font-medium transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            visual
              ? visual.className
              : "border-border bg-muted text-muted-foreground hover:bg-accent",
            readOnly && "cursor-default opacity-60",
          )}
        >
          {visual
            ? t(`flowStatus.${visual.i18nKey}`, capitalize(visual.i18nKey))
            : t("flowStatus.label", "Status")}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {FLOW_TEST_STATUSES.map((s) => {
          const v = STATUS_VISUALS[s];
          return (
            <DropdownMenuItem
              key={s}
              onSelect={() => handleSelect(s)}
              className="flex items-center gap-2"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "inline-block h-2 w-2 rounded-full border",
                  v.className.split(" ").find((c) => c.startsWith("border-")) ??
                    "border-border",
                  v.className
                    .split(" ")
                    .find((c) => c.startsWith("bg-") && !c.includes("hover"))
                )}
              />
              <span>{t(`flowStatus.${v.i18nKey}`, capitalize(v.i18nKey))}</span>
              {current === s && (
                <span className="ml-auto text-xs text-muted-foreground">
                  ✓
                </span>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
