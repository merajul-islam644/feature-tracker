// User preference for the Projects page layout: 3-column responsive card
// grid vs. one-row-per-project list. Persisted to localStorage so the
// choice survives reloads and cross-session reopens. No CSS side effects
// on rehydrate (unlike `themeStore`'s accent color), so no
// `onRehydrateStorage` callback is needed.
//
// Naming follows the `ft-*` prefix convention used elsewhere in the repo
// (`ft-theme`, `ft-locale`, `ft-issue-tracker-*`, ...). Defaults to
// `"grid"` for new users — the layout the page shipped with — so opening
// the page after a clear is identical to the pre-toggle behavior.

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type ProjectsViewMode = "grid" | "list";

interface ProjectsViewState {
  mode: ProjectsViewMode;
  setMode: (mode: ProjectsViewMode) => void;
}

export const useProjectsViewStore = create<ProjectsViewState>()(
  persist(
    (set) => ({
      mode: "grid",
      setMode: (mode) => set({ mode }),
    }),
    {
      name: "ft-projects-view",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);