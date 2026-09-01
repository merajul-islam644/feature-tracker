// Per-application group header (spec section 24).

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function IssueGroup({ title, count, defaultOpen = true, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 bg-muted/40 px-4 py-2 text-left text-sm font-semibold text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          )}
          {title}
        </span>
        <span
          className={cn(
            "rounded-full bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground",
          )}
        >
          {count}
        </span>
      </button>
      {open && <ul className="space-y-2 p-3">{children}</ul>}
    </div>
  );
}
