import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite config for the public-facing Feature Tracker website.
// Kept intentionally minimal — Tailwind is wired through PostCSS
// (`postcss.config.js` + `tailwind.config.js`) so future design tokens
// can land in one place.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    // Different port from the main app (5173) so both can run side-by-side
    // during local development without a collision.
    strictPort: false,
  },
});
