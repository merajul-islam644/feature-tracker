// RunProgressRing — see DESIGN-APP-v1.md §7.28 + §8.2.
//
// Circular progress ring used by the Issue Tracker "Run Control" section.
// Stroke width 6, base 96 / large 128. Track muted, progress primary.
// State overlays: success → emerald, warning → amber, error → red,
// active → indigo. Center: percentage. Below: small caption.
//
// When `runActive` is true, the progress arc pulses subtly via
// `animate-progress-pulse`.

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface RunProgressRingProps {
  /** 0–100 percentage. */
  pct: number;
  /** Overall run state — drives stroke color. */
  state?: "idle" | "running" | "success" | "warning" | "error";
  /** Small label under the percentage (e.g. "VERIFYING"). */
  caption?: string;
  /** Optional second line (e.g. "Inspecting checkout flow"). */
  subCaption?: string;
  /** Render at the larger 128px size. */
  large?: boolean;
  /** Disable pulse animation (for static success states). */
  noPulse?: boolean;
}

const stateStroke: Record<NonNullable<RunProgressRingProps["state"]>, string> = {
  idle: "text-muted-foreground/40",
  running: "text-indigo-500",
  success: "text-emerald-500",
  warning: "text-amber-500",
  error: "text-red-500",
};

export function RunProgressRing({
  pct,
  state = "idle",
  caption,
  subCaption,
  large = false,
  noPulse = false,
}: RunProgressRingProps) {
  const size = large ? 128 : 96;
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, pct));
  const dashOffset = circumference * (1 - clamped / 100);

  const isActive = state === "running" && !noPulse;

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="relative"
        style={{ width: size, height: size }}
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Verification progress"
      >
        <svg width={size} height={size} className="-rotate-90">
          {/* Track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            className="text-muted"
            stroke="currentColor"
          />
          {/* Progress arc */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            stroke="currentColor"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            className={cn(
              "transition-all duration-500 ease-out",
              stateStroke[state],
              isActive && "animate-progress-pulse",
            )}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={cn(
              "font-semibold tracking-tight text-foreground",
              large ? "text-2xl" : "text-lg",
            )}
          >
            {Math.round(clamped)}%
          </span>
          {caption && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {caption}
            </span>
          )}
          {isActive && (
            <Loader2
              className="absolute right-2 top-2 h-3.5 w-3.5 animate-spin text-indigo-500"
              aria-hidden="true"
            />
          )}
        </div>
      </div>
      {subCaption && (
        <p className="max-w-[180px] text-center text-xs text-muted-foreground">
          {subCaption}
        </p>
      )}
    </div>
  );
}
