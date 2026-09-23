/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",

        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },

        /* Semantic tokens — see DESIGN-APP-v1.md §2.2 */
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
        },
        error: {
          DEFAULT: "hsl(var(--error))",
          foreground: "hsl(var(--error-foreground))",
        },
        ai: {
          DEFAULT: "hsl(var(--ai))",
          foreground: "hsl(var(--ai-foreground))",
        },
        environment: {
          DEFAULT: "hsl(var(--environment))",
          foreground: "hsl(var(--environment-foreground))",
        },

        highlight: {
          DEFAULT: "hsl(var(--highlight))",
          foreground: "hsl(var(--highlight-foreground))",
        },

        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },

        /* Color ramps used directly throughout the app. */
        indigo: {
          50: "#EEF2FF",
          100: "#E0E7FF",
          200: "#C7D2FE",
          300: "#A5B4FC",
          400: "#818CF8",
          500: "#6366F1",
          600: "#4F46E5",
          700: "#4338CA",
          800: "#3730A3",
          900: "#312E81",
        },
        violet: {
          400: "#A78BFA",
          500: "#8B5CF6",
          600: "#7C3AED",
          700: "#6D28D9",
        },
        cyan: {
          50: "#ECFEFF",
          100: "#CFFAFE",
          200: "#A5F3FC",
          300: "#67E8F9",
          400: "#22D3EE",
          500: "#06B6D4",
          600: "#0891B2",
          700: "#0E7490",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xl: "calc(var(--radius) + 4px)",
        "2xl": "calc(var(--radius) + 8px)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
      boxShadow: {
        soft: "0 1px 2px 0 rgb(15 23 42 / 0.04)",
        card: "0 2px 8px -2px rgb(15 23 42 / 0.08)",
        "card-hover": "0 8px 24px -8px rgb(15 23 42 / 0.16)",
        elevated: "0 12px 32px -12px rgb(15 23 42 / 0.22)",
        dialog: "0 24px 64px -16px rgb(15 23 42 / 0.32)",
        ai: "0 12px 40px -12px rgb(99 102 241 / 0.28)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "sidebar-open": {
          from: { "--sidebar-width": "0px" },
          to: { "--sidebar-width": "var(--sidebar-width-value)" },
        },
        "sidebar-close": {
          from: { "--sidebar-width": "var(--sidebar-width-value)" },
          to: { "--sidebar-width": "0px" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "fade-out": {
          from: { opacity: "1" },
          to: { opacity: "0" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-down": {
          from: { opacity: "0", transform: "translateY(-8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.98)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "chat-in": {
          from: { opacity: "0", transform: "translateY(12px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        // Top-sheet variant for the announcements modal — slides the
        // panel from off-screen above the viewport down to its pinned
        // top position, then back off-screen on close. Pairs with a
        // positioning override (top-0 translate-y-0) on the modal
        // container so the slide reads as a full-height drawer, not
        // a centered card moving.
        "dialog-from-top": {
          from: { opacity: "0", transform: "translateY(-100%)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "dialog-to-top": {
          from: { opacity: "1", transform: "translateY(0)" },
          to: { opacity: "0", transform: "translateY(-100%)" },
        },
        "progress-pulse": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.65" },
        },
        "rotate-stroke": {
          from: { strokeDashoffset: "0" },
          to: { strokeDashoffset: "-6" },
        },
        // Pulsing neon halo for the AI Assistant launcher — see §6.7 +
        // §9.1. The keyframe breathes between a tight indigo core and
        // a wider violet bloom, plus a fading ring that radiates
        // outward (the "AI is alive" tell). The constant drop shadow
        // stays put so the launcher remains anchored on the page.
        // Slow cycle (8s) and very low opacities / tight spreads so
        // the halo reads as ambient rather than aggressive — about
        // 1/5 of the original keyframe intensity.
        "ai-glow": {
          "0%, 100%": {
            boxShadow:
              "0 0 0 0 rgba(99,102,241,0.09), 0 0 6px 0 rgba(139,92,246,0.06), 0 12px 40px -8px rgba(99,102,241,0.45)",
          },
          "50%": {
            boxShadow:
              "0 0 0 4px rgba(99,102,241,0), 0 0 12px 2px rgba(139,92,246,0.10), 0 12px 40px -8px rgba(99,102,241,0.45)",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "sidebar-open": "sidebar-open 0.2s ease-out",
        "sidebar-close": "sidebar-close 0.2s ease-out",
        "fade-in": "fade-in 180ms ease-out",
        "fade-out": "fade-out 140ms ease-in",
        "slide-up": "slide-up 200ms ease-out",
        "slide-down": "slide-down 200ms ease-out",
        "scale-in": "scale-in 180ms ease-out",
        "chat-in": "chat-in 220ms cubic-bezier(0.16, 1, 0.3, 1)",
        "dialog-from-top": "dialog-from-top 280ms cubic-bezier(0.16, 1, 0.3, 1)",
        "dialog-to-top": "dialog-to-top 220ms cubic-bezier(0.4, 0, 1, 1)",
        "progress-pulse": "progress-pulse 1.8s ease-in-out infinite",
        "rotate-stroke": "rotate-stroke 1.2s linear infinite",
        // 8s — ambient breathing. One beat every 8 seconds; slow
        // enough to feel like the launcher is gently alive rather
        // than pulsing for attention.
        "ai-glow": "ai-glow 8s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
