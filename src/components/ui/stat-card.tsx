import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

/*
 * StatCard — see DESIGN-APP-v1.md §7.24.
 *
 * Anatomy: label · icon · metric · supporting context · trend/status.
 * Used on the dashboard hero metrics row.
 */

type Tone = "default" | "success" | "warning" | "error" | "info";

const toneStyles: Record<Tone, string> = {
  default: "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300",
  success: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300",
  warning: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300",
  error: "bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300",
  info: "bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300",
};

export interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  metric: React.ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  supporting?: React.ReactNode;
  trend?: React.ReactNode;
  /** When provided, the whole card becomes clickable. */
  href?: string;
  /** Use rounded-2xl hero variant (larger padding). */
  hero?: boolean;
  /** While the underlying data is still loading, render the metric slot as
   *  a pulsing skeleton instead of the value. The label + icon stay so the
   *  layout doesn't shift when the value arrives. */
  loading?: boolean;
}

export const StatCard = React.forwardRef<HTMLDivElement, StatCardProps>(
  (
    {
      className,
      label,
      metric,
      icon: Icon,
      tone = "default",
      supporting,
      trend,
      href,
      hero = false,
      loading = false,
      ...props
    },
    ref
  ) => {
    const cardClasses = cn(
      "group rounded-xl border bg-card p-5 shadow-card",
      "transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover",
      hero && "rounded-2xl p-6",
      href && "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    );

    const inner = (
      <>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {label}
            </div>
            <div className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
              {loading ? (
                <Skeleton className="mt-1 h-7 w-20" />
              ) : (
                metric
              )}
            </div>
          </div>
          {Icon ? (
            <div
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                toneStyles[tone]
              )}
              aria-hidden="true"
            >
              <Icon className="h-4 w-4" />
            </div>
          ) : null}
        </div>
        {(supporting || trend) && (
          <div className="mt-3 flex items-center justify-between gap-2 text-xs">
            {supporting ? (
              <span className="text-muted-foreground">{supporting}</span>
            ) : (
              <span />
            )}
            {trend ? (
              <span className="font-medium text-foreground">{trend}</span>
            ) : null}
          </div>
        )}
      </>
    );

    if (href) {
      return (
        <a ref={ref as React.Ref<HTMLAnchorElement>} href={href} className={cardClasses} {...(props as any)}>
          {inner}
        </a>
      );
    }

    return (
      <div ref={ref} className={cardClasses} {...props}>
        {inner}
      </div>
    );
  }
);
StatCard.displayName = "StatCard";

/*
 * Convenience selectors for the four canonical hero metrics used on
 * the dashboard (open issues / verified flows / pending verifications /
 * active members).
 */
export const statIcons = {
  openIssues: AlertTriangle,
  verified: CheckCircle2,
  pending: Info,
  members: Info,
};
