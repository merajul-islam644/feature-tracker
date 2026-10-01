import * as React from "react";
import { cn } from "@/lib/utils";

/*
 * EnvChip — see DESIGN-APP-v1.md §7.26.
 *
 * Reserved for environment-specific visual language. Always cyan tones.
 * Pass `env` to get the canonical label (DEV/STG/PROD/UAT/CUSTOM); pass
 * `label` for custom environments.
 */

export type EnvironmentKey = "dev" | "stg" | "prod" | "uat" | "custom";

const envLabels: Record<EnvironmentKey, string> = {
  dev: "DEV",
  stg: "STG",
  prod: "PROD",
  uat: "UAT",
  custom: "CUSTOM",
};

export interface EnvChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  env?: EnvironmentKey;
  label?: string;
  /** Optional status dot inside the chip. */
  status?: "success" | "warning" | "error" | "info" | "neutral";
}

const statusColors: Record<NonNullable<EnvChipProps["status"]>, string> = {
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-red-500",
  info: "bg-sky-500",
  neutral: "bg-slate-400",
};

export const EnvChip = React.forwardRef<HTMLSpanElement, EnvChipProps>(
  ({ className, env, label, status, ...props }, ref) => {
    const text = label ?? (env ? envLabels[env] : "");
    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
          "border-cyan-200 bg-cyan-50 text-cyan-700",
          "dark:border-cyan-500/30 dark:bg-cyan-500/15 dark:text-cyan-300",
          className
        )}
        {...props}
      >
        {status ? (
          <span
            className={cn("status-dot", statusColors[status])}
            aria-hidden="true"
          />
        ) : null}
        <span>{text}</span>
      </span>
    );
  }
);
EnvChip.displayName = "EnvChip";
