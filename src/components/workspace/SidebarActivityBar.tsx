// VS Code-style sidebar activity bar — a narrow vertical icon strip
// along the left edge of the workspace. Each icon is a Radix Tooltip
// wrapper around a Lucide icon. Active item gets `bg-muted`, inactive
// items fade on hover.
//
// Item sources are merged by the parent (built-ins first, then per
// enabled extension, then the Extensions manager). The activity bar
// itself only knows about `id`, `icon`, `label`, and `onSelect`.

import {
  Box,
  FlaskConical,
  FolderTree,
  GitBranch,
  ListFilter,
  ListTree,
  Package,
  Puzzle,
  Search,
  type LucideIcon,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface ActivityBarItem {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Optional count bubble (VS Code's Source Control badge) — shown
   *  bottom-right of the icon when > 0. */
  badge?: number;
}

/** Built-in items we always show. Order = top-to-bottom in the rail
 *  (mirrors VS Code: Explorer, Search, Source Control, then our own
 *  Problems + Extensions).
 *  Extensions contribute additional items between `extensions` and the
 *  end, but the activity bar is agnostic to that — see
 *  `useActivityBarItems` in WorkspacePage for the merge. */
export const BUILTIN_ITEMS: ActivityBarItem[] = [
  { id: "explorer", label: "Explorer", icon: FolderTree },
  { id: "search", label: "Search", icon: Search },
  { id: "git", label: "Source Control", icon: GitBranch },
  // Phase 1 LSP: diagnostics list. Lives in the sidebar (not the
  // bottom dock like VS Code) because the dock is terminal space —
  // see ProblemsPanel.tsx.
  { id: "problems", label: "Problems", icon: ListFilter },
  // Phase 2 LSP: document symbols for the active file (OutlinePanel).
  { id: "outline", label: "Outline", icon: ListTree },
  // Item 8: root package.json scripts, one click runs in the terminal
  // (NpmScriptsPanel).
  { id: "scripts", label: "npm Scripts", icon: Package },
  // Testing view (VS Code's flask): *.test.*/*.spec.* discovery +
  // one-click run in the terminal (TestingPanel).
  { id: "tests", label: "Testing", icon: FlaskConical },
  { id: "extensions", label: "Extensions", icon: Puzzle },
];

interface SidebarActivityBarProps {
  items: ActivityBarItem[];
  activeId: string;
  onSelect: (id: string) => void;
}

/** Default icon used when an extension's manifest references an
 *  unknown lucide icon name. Kept as a tiny lookup so the activity bar
 *  can render without crashing. */
export function resolveLucideIcon(name: string | undefined): LucideIcon {
  if (!name) return Box;
  // Lazy lookup — only a handful of icons are referenced by extensions
  // in the v1 spec. Add more entries as extensions ship.
  switch (name) {
    case "Box":
      return Box;
    case "FolderTree":
      return FolderTree;
    case "Puzzle":
      return Puzzle;
    case "Search":
      return Search;
    default:
      return Box;
  }
}

export function SidebarActivityBar({
  items,
  activeId,
  onSelect,
}: SidebarActivityBarProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <div
        className={cn(
          "flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-muted/30 py-2",
        )}
        role="tablist"
        aria-label="Sidebar activity bar"
      >
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === activeId;
          return (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-label={item.label}
                  data-testid={`activity-bar-${item.id}`}
                  onClick={() => onSelect(item.id)}
                  className={cn(
                    "relative flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors",
                    "hover:bg-muted hover:text-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive &&
                      "border-l-2 border-primary bg-muted text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {typeof item.badge === "number" && item.badge > 0 && (
                    <span
                      className="absolute -bottom-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold leading-none text-primary-foreground"
                      data-testid={`activity-bar-badge-${item.id}`}
                    >
                      {item.badge > 99 ? "99+" : item.badge}
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={6}>
                {item.label}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}