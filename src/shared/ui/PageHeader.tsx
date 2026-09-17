import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Top-of-page header with a title, optional subtitle, and an actions slot.
 *
 * Stacks the actions row under the title on small screens and lays it out
 * to the right on `sm` and up. Mirrors the visual treatment used by
 * feature-specific headers (e.g. `IssueTrackerHeader`) so a page can drop
 * in this primitive when it doesn't need its own bespoke header.
 */
export interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}