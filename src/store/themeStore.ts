import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type ThemeMode = "light" | "dark" | "system";

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      mode: "system",
      setMode: (mode) => set({ mode }),
    }),
    {
      name: "ft-theme",
      storage: createJSONStorage(() => localStorage),
    }
  )
);

/**
 * Resolve the effective theme from the user's mode and the system preference.
 * Returns true if dark mode should be active.
 */
export function resolveDark(mode: ThemeMode): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Apply the theme to the document by toggling the .dark class on <html>.
 * Call this on app boot and whenever the mode or system preference changes.
 */
export function applyTheme(mode: ThemeMode): boolean {
  const dark = resolveDark(mode);
  document.documentElement.classList.toggle("dark", dark);
  return dark;
}
