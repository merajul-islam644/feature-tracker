import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { useThemeStore, applyTheme } from "./store/themeStore";
import "./index.css";

// Apply the persisted theme before React mounts so we don't flash light-then-dark.
applyTheme(useThemeStore.getState().mode);

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);