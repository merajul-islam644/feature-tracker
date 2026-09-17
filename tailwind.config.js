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
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
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
      },
      boxShadow: {
        soft: "0 1px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 0 rgb(0 0 0 / 0.06)",
        elevated:
          "0 4px 6px -1px rgb(0 0 0 / 0.06), 0 2px 4px -2px rgb(0 0 0 / 0.06)",
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
        "rotate-stroke": {
          // Animates a single full period of stroke-dashoffset so the
          // dashes appear to slide continuously around the SVG path.
          // Period is dash + gap = 2 + 4 = 6.
          from: { strokeDashoffset: "0" },
          to: { strokeDashoffset: "-6" },
        },
        spin: {
          from: { transform: "rotate(0deg)" },
          to: { transform: "rotate(360deg)" },
        },
        pulse: {
          // Scale up and down rhythmically, mirrored around 1 so the
          // text stays at its natural size at the start/end of each
          // cycle. Subtle 1.0 → 1.08 range to avoid distraction.
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.08)" },
        },
        wave: {
          // SkewX back and forth — text tilts left then right like
          // a flag catching the wind. Origin defaults to center, so
          // the tilt pivots around the middle of the word.
          "0%, 100%": { transform: "skewX(0deg)" },
          "25%": { transform: "skewX(-6deg)" },
          "75%": { transform: "skewX(6deg)" },
        },
        flip: {
          // 3D Y-axis rotation — text flips like a coin spinning.
          // perspective keeps the rotation readable instead of flat.
          "0%, 100%": { transform: "perspective(400px) rotateY(0deg)" },
          "50%": { transform: "perspective(400px) rotateY(180deg)" },
        },
        blink: {
          // Opacity pulses between full and 60% so the text throbs
          // without ever disappearing — the floor stays readable at
          // every moment so the layout doesn't visually shift.
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.6" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "rotate-stroke": "rotate-stroke 1.2s linear infinite",
        spin: "spin 3.6s linear infinite",
        pulse: "pulse 1s ease-in-out infinite",
        wave: "wave 0.8s ease-in-out infinite",
        flip: "flip 1.4s ease-in-out infinite",
        blink: "blink 3.6s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
