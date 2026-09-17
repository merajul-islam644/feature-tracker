// Visual primitives shared by the flow row's interactive EnvWorkflow
// and the feature row's read-only mirror. Lives here (next to
// EnvWorkflow.tsx) rather than in src/components/ui/ because the
// yellow theme + state classes are workflow-specific and aren't
// reused anywhere else in the app.
//
// Each module that renders a chain — EnvWorkflow for flows,
// FeatureEnvWorkflow for features — owns the spacing wrapper, the
// source-node positioning, and the per-env iteration. The Node +
// Arrow here are stateless presentation.

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

// One of three states — maps to STATE_CLASSES below and to the
// optional check-mark + interactive affordances on Node.
export type EnvNodeState = "source" | "cloned" | "available";

// Three sibling envs in canonical promote order (stg → prod → uat).
// Dev is the source and is rendered separately by the caller so the
// source box doesn't appear on a row whose flow/feature lives in
// stg/prod/uat.
export const SIBLING_ENVS = [
  { slug: "stg", label: "Stg" },
  { slug: "prod", label: "Prod" },
  { slug: "uat", label: "UAT" },
] as const;

// Palette + base cursor per state. Every state carries `cursor-default`
// in the base set because the underlying <button> element has a
// browser-default `cursor: pointer` that would otherwise leak through
// the interactive variant's `cursor-pointer` override. The interactive
// flow-row variant appends `ENV_NODE_INTERACTIVE_CLASSES` on top — only
// the "available" state actually gets the pointer cursor there.
export const ENV_NODE_STATE_CLASSES: Record<EnvNodeState, string> = {
  source:
    "cursor-default border-yellow-400 bg-yellow-400 text-yellow-950 shadow-[0_0_6px_rgba(250,204,21,0.45)]",
  cloned:
    "cursor-default border-yellow-400/60 bg-yellow-400/15 text-yellow-200",
  available:
    "cursor-default border-yellow-400/40 bg-transparent text-yellow-300",
};

// Interactive-only affordances — hover fill + pointer cursor on the
// "available" nodes. Only appended when the caller marks the chain
// as interactive (flow row). Source / cloned stay cursor-default
// either way, matching their non-interactive role.
export const ENV_NODE_INTERACTIVE_CLASSES: Record<EnvNodeState, string> = {
  source: "",
  cloned: "",
  available:
    "hover:border-yellow-400 hover:bg-yellow-400/10 cursor-pointer",
};

// Inline keyframes for the marching-dash arrow. Each module that
// mounts a chain injects its own `<style>` — the keyframe is local
// rather than a global stylesheet rule so a page without a workflow
// doesn't ship unused CSS. Both EnvWorkflow and FeatureEnvWorkflow
// mount together in the same DOM at the same time, so the keyframe
// declaration is duplicated intentionally; browsers deduplicate the
// parsed rule by name.
export const ENV_WORKFLOW_KEYFRAMES = `
@keyframes env-wf-arrow-flow {
  0% { stroke-dashoffset: 0; }
  100% { stroke-dashoffset: -5; }
}
.env-wf-arrow-line {
  animation: env-wf-arrow-flow 0.9s linear infinite;
}
`;

interface NodeProps {
  label: string;
  state: EnvNodeState;
  title?: string;
  // When provided, the node renders as a clickable <button>. Omit
  // for the read-only feature-row variant — Node still renders as a
  // <button> (for focus / keyboard parity) but with no onClick the
  // node is inert.
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  pending?: boolean;
  // When true (default), append the hover + cursor-pointer
  // affordances for the "available" state. The feature-row variant
  // passes `false` so its read-only chain doesn't suggest the envs
  // are clickable when they aren't.
  interactive?: boolean;
}

// One environment pill. State determines the look; onClick / pending
// only matter for the interactive flow-row variant — the feature-row
// variant passes neither so the node is a non-interactive label.
export function EnvNode({
  label,
  state,
  title,
  onClick,
  disabled,
  pending,
  interactive = true,
}: NodeProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={cn(
        "relative inline-flex h-5 items-center gap-0.5 rounded-full border px-1.5 text-[9px] font-bold uppercase tracking-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 focus-visible:ring-offset-1",
        ENV_NODE_STATE_CLASSES[state],
        interactive && ENV_NODE_INTERACTIVE_CLASSES[state],
        // Pending spinner always wins over the interactive cursor so
        // the user sees "in flight" rather than a clickable pill.
        disabled && "cursor-progress opacity-70",
      )}
    >
      {state === "cloned" && (
        <Check className="h-2.5 w-2.5" aria-hidden="true" />
      )}
      <span>{label}</span>
      {pending && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-yellow-400/40"
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-yellow-100" />
        </span>
      )}
    </button>
  );
}

// Short arrow between nodes. Dashed stroke matches the row's yellow
// theme; arrowhead is a small filled triangle pointing right.
// `aria-hidden` because the parent <span role="group"> carries the
// semantic label.
//
// `animate`: when true, dashes march left-to-right via the
// `env-wf-arrow-line` keyframe; when false, the line stays as a flat
// dashed indicator. Both workflows pass `animate={alreadyCloned}`
// for the *destination* env, so the chain animates outward as more
// envs get cloned.
export function EnvArrow({ animate }: { animate: boolean }) {
  return (
    <svg
      width="14"
      height="10"
      viewBox="0 0 14 10"
      aria-hidden="true"
      className="shrink-0 text-yellow-400"
    >
      <line
        x1="0"
        y1="5"
        x2="10"
        y2="5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeDasharray="3 2"
        className={animate ? "env-wf-arrow-line" : undefined}
      />
      <polygon points="10,3 13,5 10,7" fill="currentColor" />
    </svg>
  );
}

// Convenience wrapper — renders the inline `<style>` tag the marching
// keyframe needs. Each workflow component calls this once at the
// top of its render so the keyframe is in the DOM for every node.
// Returns a fragment because the caller usually wants to render this
// alongside its content, not as a wrapper element.
export function EnvWorkflowStyles(): ReactNode {
  return <style>{ENV_WORKFLOW_KEYFRAMES}</style>;
}
