import * as React from "react";
import { cn } from "@/lib/utils";

/*
 * EmptyState — see DESIGN-APP-v1.md §7.22 + §6.14.
 *
 * Anatomy: illustration · headline · description · action.
 * Container: min-h-[280px] flex-col items-center justify-center rounded-2xl
 * border-dashed bg-muted/20 p-8 text-center.
 *
 * Never ship "No data." — explain what is missing, why it matters, and
 * what the user can do.
 */

export interface EmptyStateProps {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  /** Additional secondary action slot (rarely needed). */
  secondaryAction?: React.ReactNode;
  /** Override classes on the icon container — used when a section wants its
   *  empty state icon to match the section's accent (e.g. the Recent
   *  Features list uses emerald while the default is indigo). */
  iconClassName?: string;
  className?: string;
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  secondaryAction,
  iconClassName,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed bg-muted/20 p-8 text-center",
        className
      )}
      role="status"
    >
      {icon && (
        <div
          className={cn(
            "mb-5 flex h-14 w-14 items-center justify-center rounded-xl bg-primary-muted text-primary",
            iconClassName,
          )}
        >
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
      {secondaryAction && (
        <div className="mt-2 text-xs text-muted-foreground">
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
