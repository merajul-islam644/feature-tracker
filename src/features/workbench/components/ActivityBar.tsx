// VS Code activity bar: the narrow icon rail on the far left. Four
// views -- Explorer, Search, Source Control and Run -- in VS Code's
// own order. The Source Control icon carries the same changes badge
// VS Code shows: the dirty-file count, capped at "99+".

import { Bot, FlaskConical, FolderTree, GitBranch, Search, TriangleAlert, type LucideIcon } from "lucide-react";
import type { SidebarView } from "../state/workbenchStore";

const ITEMS: { id: SidebarView; label: string; icon: LucideIcon }[] = [
  { id: "explorer", label: "Explorer", icon: FolderTree },
  { id: "search", label: "Search", icon: Search },
  { id: "scm", label: "Source Control", icon: GitBranch },
  { id: "run", label: "Run", icon: FlaskConical },
  { id: "problems", label: "Problems", icon: TriangleAlert },
  // The embedded AI — pinned to the BOTTOM of the rail, VS Code's
  // Copilot placement (user request).
  { id: "ai", label: "AI", icon: Bot }
];

/** VS Code caps activity-bar badge text at "99+". */
function badgeText(count: number): string {
  return count > 99 ? "99+" : String(count);
}

export function ActivityBar({ active, changesCount, visible, onSelect, problemsCount }: {
  active: SidebarView;
  /** Dirty-file count shown on the Source Control icon, VS Code-style. */
  changesCount?: number;
  /** Error count shown on the Problems icon, same badge treatment. */
  problemsCount?: number;
  visible: boolean;
  onSelect: (view: SidebarView) => void;
}) {
  return (
    <nav aria-label="Activity bar" className="wb-activity">
      {ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = visible && item.id === active;
        const showBadge =
          (item.id === "scm" && changesCount !== undefined && changesCount > 0) ||
          (item.id === "problems" && problemsCount !== undefined && problemsCount > 0);
        const badgeValue = item.id === "scm" ? changesCount : problemsCount;
        return (
          <button
            aria-label={item.label}
            aria-pressed={isActive}
            className={`wb-activity-btn${isActive ? " active" : ""}`}
            key={item.id}
            onClick={() => onSelect(item.id)}
            title={item.label}
            type="button"
          >
            <Icon size={20} strokeWidth={1.7} />
            {showBadge ? <span className="wb-activity-badge">{badgeText(badgeValue ?? 0)}</span> : null}
          </button>
        );
      })}
    </nav>
  );
}
