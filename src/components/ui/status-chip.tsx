import * as React from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * StatusChip — see DESIGN-APP-v1.md §7.25.
 *
 * Always pairs color with icon + text. States: success · warning · error ·
 * info · neutral. Used for verification status, run status, feature status.
 */

type Status = "success" | "warning" | "error" | "info" | "neutral";

const statusStyles: Record<
  Status,
  { icon: React.ElementType; classes: string; label: string }
> = {
  success: {
    icon: CheckCircle2,
    classes:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30",
    label: "Verified",
  },
  warning: {
    icon: AlertTriangle,
    classes:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30",
    label: "Warning",
  },
  error: {
    icon: AlertCircle,
    classes:
      "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30",
    label: "Error",
  },
  info: {
    icon: Info,
    classes:
      "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30",
    label: "Info",
  },
  neutral: {
    icon: Minus,
    classes:
      "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
    label: "Neutral",
  },
};

export interface StatusChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: Status;
  /** Override default label (e.g. "Verifying", "Passed", "18 targets checked"). */
  label?: React.ReactNode;
  /** Hide the dot/icon. */
  hideIcon?: boolean;
  /** Pulse the icon (e.g. while a run is active). */
  pulse?: boolean;
}

export const StatusChip = React.forwardRef<HTMLSpanElement, StatusChipProps>(
  ({ className, status, label, hideIcon = false, pulse = false, ...props }, ref) => {
    const config = statusStyles[status];
    const Icon = config.icon;
    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
          config.classes,
          className
        )}
        {...props}
      >
        {hideIcon ? (
          <span
            className="status-dot"
            style={{ backgroundColor: "currentColor" }}
            aria-hidden="true"
          />
        ) : (
          <Icon
            className={cn("h-3.5 w-3.5", pulse && "animate-progress-pulse")}
            aria-hidden="true"
          />
        )}
        <span>{label ?? config.label}</span>
      </span>
    );
  }
);
StatusChip.displayName = "StatusChip";
