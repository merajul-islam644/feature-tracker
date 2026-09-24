// Stack chip + dropdown for a single flow row.
//
// Sits to the LEFT of the Status chip on each flow row. Lets the user
// tag which slice of the app the flow exercises (Frontend / Backend /
// Investigating). Mirrors StatusChip's UX but with a smaller color set
// chosen so the two chips don't read as the same kind of control:
//
//   frontend      → indigo (UI blue-violet)
//   backend       → slate (neutral dark)
//   investigating → violet (matches Status "investigating" intentionally
//                            so both chips agree when a flow is under
//                            investigation — semantic overlap is the point)
//
// Initial label is "Stack" (a placeholder); once set, the chip shows the
// actual label in its color. Read-only mode disables the trigger.
//
// `Status` and `Stack` are independent fields — both chips are always
// rendered, so the row has stable horizontal layout regardless of which
// values are set.

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/blocks/i18n";
import {
  FLOW_STACKS,
  type Flow,
  type FlowStack,
  type FlowStatus,
} from "@/lib/blocks/data";
import { useUpdateFlowStack } from "@/lib/blocks/hooks";

interface StackChipProps {
  flow: Flow;
  /** When true, the chip is rendered but disabled (read-only view). */
  readOnly?: boolean;
}

interface StackVisual {
  /** Tailwind classes for the chip background, text, and border. */
  className: string;
  /** i18n key suffix for the dropdown item label. */
  i18nKey: string;
}

// Visual treatment per stack slice. Picked to be distinguishable from
// the Status chip palette (green/red/amber/violet/sky) so the user can
// scan a row at a glance and tell which chip carries which meaning.
const STACK_VISUALS: Record<FlowStack, StackVisual> = {
  frontend: {
    className:
      "border-primary-border bg-primary-muted text-primary hover:bg-primary-muted/80",
    i18nKey: "frontend",
  },
  backend: {
    className:
      "border-border bg-muted text-muted-foreground hover:bg-accent",
    i18nKey: "backend",
  },
  investigating: {
    className:
      "border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100",
    i18nKey: "investigating",
  },
};

export function StackChip({ flow, readOnly = false }: StackChipProps) {
  const t = useT();
  const updateStack = useUpdateFlowStack();

  const current = flow.stack;
  const visual: StackVisual | null =
    current && current in STACK_VISUALS
      ? STACK_VISUALS[current as FlowStack]
      : null;

  const handleSelect = (next: FlowStack) => {
    if (readOnly) return;
    if (next === current) return;
    // Forward unchanged `title` and `status` so the cloud (which
    // marks both required on update) accepts the partial PATCH.
    updateStack.mutate({
      id: flow.id,
      projectId: flow.projectId,
      featureId: flow.featureId,
      name: flow.name,
      // The chip changes `stack`; `status` is echoed through unchanged
      // so the partial PATCH is well-formed. Default to "draft" only
      // if the flow has no status yet (legacy records).
      status: (flow.status as FlowStatus) ?? "draft",
      stack: next,
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("flowStack.chipLabel", "Flow stack")}
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
            ? t(`flowStack.${visual.i18nKey}`, capitalize(visual.i18nKey))
            : t("flowStack.label", "Stack")}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {FLOW_STACKS.map((s) => {
          const v = STACK_VISUALS[s];
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
              <span>{t(`flowStack.${v.i18nKey}`, capitalize(v.i18nKey))}</span>
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
