// Segmented icon-only toggle for the Projects page layout. Mirrors
// the Theme picker pattern in `SettingsPage.tsx` (role="radiogroup" +
// inline-flex rounded-md border) so the two segmented controls agree
// visually. Arrow keys cycle between the options for keyboard nav;
// Space/Enter selects the focused option.
//
// Reads/writes `useProjectsViewStore`, which persists the choice to
// localStorage as `ft-projects-view`.
//
// Both icons come from `lucide-react` (already a dependency). This is
// the first use of either icon in this codebase.

import { LayoutGrid, List, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/blocks/i18n";
import {
  useProjectsViewStore,
  type ProjectsViewMode,
} from "@/store/projectsViewStore";

interface ViewOption {
  value: ProjectsViewMode;
  Icon: LucideIcon;
}

const OPTIONS: readonly ViewOption[] = [
  { value: "grid", Icon: LayoutGrid },
  { value: "list", Icon: List },
];

export function ViewToggle() {
  const mode = useProjectsViewStore((s) => s.mode);
  const setMode = useProjectsViewStore((s) => s.setMode);
  const t = useT();

  // Arrow-key cycling. The `keydown` handler lives on the radiogroup
  // wrapper rather than each button — that's the WAI-ARIA pattern for
  // radio groups. Horizontal arrows step left/right; Home/End jump to
  // the first/last option.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") {
      return;
    }
    e.preventDefault();
    const idx = OPTIONS.findIndex((o) => o.value === mode);
    if (idx === -1) return;
    let nextIdx = idx;
    if (e.key === "ArrowLeft") nextIdx = (idx - 1 + OPTIONS.length) % OPTIONS.length;
    if (e.key === "ArrowRight") nextIdx = (idx + 1) % OPTIONS.length;
    if (e.key === "Home") nextIdx = 0;
    if (e.key === "End") nextIdx = OPTIONS.length - 1;
    setMode(OPTIONS[nextIdx].value);
  };

  return (
    <div
      role="radiogroup"
      aria-label={t("projects.view.toggleAria", "View mode")}
      onKeyDown={onKeyDown}
      className="inline-flex rounded-md border border-input bg-background p-0.5"
    >
      {OPTIONS.map(({ value, Icon }) => {
        const active = mode === value;
        const label = t(
          value === "grid" ? "projects.view.grid" : "projects.view.list",
          value === "grid" ? "Grid" : "List",
        );
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            tabIndex={active ? 0 : -1}
            onClick={() => setMode(value)}
            className={cn(
              "inline-flex h-9 w-9 items-center justify-center rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}