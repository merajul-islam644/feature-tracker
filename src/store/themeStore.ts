import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type ThemeMode = "light" | "dark" | "system";

interface ThemeState {
  mode: ThemeMode;
  // Hex string of the user's chosen accent color, or null to use the
  // CSS defaults baked into `index.css`. Persisted alongside `mode` so
  // the accent survives reloads.
  accentColor: string | null;
  setMode: (mode: ThemeMode) => void;
  setAccentColor: (color: string | null) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      mode: "system",
      accentColor: null,
      setMode: (mode) => set({ mode }),
      // Persist + apply in one step. Callers don't have to remember to
      // call `applyAccentColor` after updating the store — the setter
      // does the side effect for them. The boot path in `main.tsx`
      // handles the initial application via `onRehydrateStorage`.
      setAccentColor: (accentColor) => {
        set({ accentColor });
        applyAccentColor(accentColor);
      },
    }),
    {
      name: "ft-theme",
      storage: createJSONStorage(() => localStorage),
      // After rehydration, the in-memory state matches what was
      // persisted, but the CSS variables on <html> haven't been
      // touched yet. Apply them now so a reload paints with the right
      // theme on the very first frame.
      onRehydrateStorage: () => (state) => {
        if (state) applyAccentColor(state.accentColor);
      },
    }
  )
);

// CSS variables that get rewritten when the accent color changes. Kept
// in one place so a "reset" can restore all of them at once.
const ACCENT_VARS = [
  "--primary",
  "--ring",
  "--sidebar-primary",
  "--sidebar-ring",
  "--sidebar-accent",
  "--sidebar-accent-foreground",
] as const;

/**
 * Convert a `#rrggbb` hex string to the `H S% L%` HSL triplet format
 * the rest of the design tokens use (e.g. `"221.2 83.2% 53.3%"`).
 * Returns null for anything we can't parse so the caller can fall
 * back to the default token value.
 */
function hexToHsl(hex: string): string | null {
  const cleaned = hex.replace("#", "").trim();
  if (cleaned.length !== 6) return null;
  const r = parseInt(cleaned.slice(0, 2), 16) / 255;
  const g = parseInt(cleaned.slice(2, 4), 16) / 255;
  const b = parseInt(cleaned.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
  }
  return `${h.toFixed(1)} ${(s * 100).toFixed(1)}% ${(l * 100).toFixed(1)}%`;
}

/**
 * Pick a contrast-friendly foreground lightness for the sidebar accent
 * pill (which uses `--sidebar-accent` as background and
 * `--sidebar-accent-foreground` as text). Reads L from the input HSL
 * triplet — the LAST percentage match in the string is always the
 * lightness (the first one is the saturation).
 *
 * L >= 60 (light accent) → dark text (L=18) so the white-ish pill is
 * legible. L < 60 (dark accent) → near-white text (L=98).
 */
function sidebarForegroundLightness(accentHsl: string): number {
  const matches = [...accentHsl.matchAll(/(\d+(?:\.\d+)?)%/g)];
  const lightness =
    matches.length > 0
      ? parseFloat(matches[matches.length - 1][1])
      : 50;
  return lightness >= 60 ? 18 : 98;
}

/**
 * Apply or reset the accent color. Pass `null` to restore the CSS
 * defaults that ship in `index.css`. Mutates `document.documentElement`
 * directly — must run before React mounts on first paint, and is safe
 * to call repeatedly (the settings page calls it on every picker
 * change).
 */
export function applyAccentColor(color: string | null): void {
  const root = document.documentElement;
  if (!color) {
    ACCENT_VARS.forEach((v) => root.style.removeProperty(v));
    return;
  }
  const hsl = hexToHsl(color);
  if (!hsl) return;
  const fgL = sidebarForegroundLightness(hsl);
  const fgHsl = `0 0% ${fgL}%`;
  const set = (name: string, value: string) =>
    root.style.setProperty(name, value);
  set("--primary", hsl);
  set("--ring", hsl);
  set("--sidebar-primary", hsl);
  set("--sidebar-ring", hsl);
  set("--sidebar-accent", hsl);
  set("--sidebar-accent-foreground", fgHsl);
}

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
