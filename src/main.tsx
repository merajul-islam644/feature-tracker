import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { useThemeStore, applyTheme, applyAccentColor } from "./store/themeStore";
import { AuthProvider } from "@/components/blocks/AuthProvider";
import { LocalizationProvider } from "@/lib/blocks/i18n";
import { queryClient } from "@/lib/queryClient";
import "./index.css";

// Apply the persisted theme + accent color BEFORE React mounts so we
// don't flash the default tokens and then switch. `onRehydrateStorage`
// also fires this for `accentColor`, but `useThemeStore.getState()` is
// already populated by the time we reach this line in the boot path,
// and we need both effects to run before the first paint regardless.
applyTheme(useThemeStore.getState().mode);
applyAccentColor(useThemeStore.getState().accentColor);

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <LocalizationProvider>
          <App />
        </LocalizationProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
