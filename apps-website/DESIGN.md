# Feature Tracker — Marketing Website Design System

## 1. Brand & Tone

### Brand

**Product name:** Feature Tracker

**Tagline:**
**Track every feature. Follow every flow. Ship with confidence.**

**Positioning:**
Feature Tracker is a workspace for engineering teams to keep features, flows, environments, issues, announcements, and team communication in one place.

### Brand voice

Feature Tracker should feel **clear, practical, confident, and engineering-focused**. The marketing site should communicate that the product reduces operational noise without making exaggerated claims or using generic "AI startup" language. Use short sentences, concrete product language, and outcome-focused copy. The visual personality should be modern and slightly playful, but still trustworthy enough for an internal engineering tool. Avoid excessive gradients, giant decorative illustrations, buzzwords, fake statistics, stock photography, and overly animated sections.

### Core message

> **From feature planning to production status, Feature Tracker gives engineering teams one clear place to see what is happening, where it is happening, and what needs attention.**

### Supporting message

Track features and flows across **development, staging, and production** while keeping issues, announcements, and team conversations connected to the same workspace.

---

# 2. Color Palette

The marketing site should use a blue/indigo primary color that matches the existing application.

## 2.1 Primary

| Token       | Hex       | Usage                   |
| ----------- | --------- | ----------------------- |
| Primary 50  | `#EEF2FF` | Very light backgrounds  |
| Primary 100 | `#E0E7FF` | Soft badges/backgrounds |
| Primary 200 | `#C7D2FE` | Borders                 |
| Primary 300 | `#A5B4FC` | Decorative elements     |
| Primary 400 | `#818CF8` | Dark-mode accents       |
| Primary 500 | `#6366F1` | Main brand color        |
| Primary 600 | `#4F46E5` | Buttons/hover           |
| Primary 700 | `#4338CA` | Strong text/accent      |
| Primary 800 | `#3730A3` | Dark emphasis           |
| Primary 900 | `#312E81` | Deep backgrounds        |

**Default primary:** `#6366F1`

Use `primary-600` for button hover states rather than changing to an unrelated color.

---

## 2.2 Secondary

Use a cool slate-blue secondary palette.

| Token         | Hex       |
| ------------- | --------- |
| Secondary 50  | `#F8FAFC` |
| Secondary 100 | `#F1F5F9` |
| Secondary 200 | `#E2E8F0` |
| Secondary 300 | `#CBD5E1` |
| Secondary 400 | `#94A3B8` |
| Secondary 500 | `#64748B` |
| Secondary 600 | `#475569` |
| Secondary 700 | `#334155` |
| Secondary 800 | `#1E293B` |
| Secondary 900 | `#0F172A` |

---

## 2.3 Accent

Use cyan sparingly for environment workflow visualization.

**Accent:** `#06B6D4`

Supporting values:

* Accent 50: `#ECFEFF`
* Accent 100: `#CFFAFE`
* Accent 200: `#A5F3FC`
* Accent 500: `#06B6D4`
* Accent 600: `#0891B2`
* Accent 700: `#0E7490`

Do not use the accent as a second primary CTA color.

---

## 2.4 Neutrals

| Token          | Light UI  | Dark UI   |
| -------------- | --------- | --------- |
| Background     | `#FFFFFF` | `#09090B` |
| Surface        | `#FFFFFF` | `#18181B` |
| Surface muted  | `#F8FAFC` | `#27272A` |
| Border         | `#E2E8F0` | `#3F3F46` |
| Text primary   | `#0F172A` | `#F8FAFC` |
| Text secondary | `#475569` | `#CBD5E1` |
| Text muted     | `#64748B` | `#A1A1AA` |

Marketing pages should remain predominantly white/light. Dark mode is optional for the marketing site, but all components should be written so dark mode can be added without restructuring.

---

## 2.5 Semantic Colors

### Success

* Light: `#16A34A`
* Background: `#F0FDF4`
* Border: `#BBF7D0`
* Dark: `#4ADE80`

### Warning

* Light: `#D97706`
* Background: `#FFFBEB`
* Border: `#FDE68A`
* Dark: `#FBBF24`

### Error

* Light: `#DC2626`
* Background: `#FEF2F2`
* Border: `#FECACA`
* Dark: `#F87171`

### Info

* Light: `#2563EB`
* Background: `#EFF6FF`
* Border: `#BFDBFE`
* Dark: `#60A5FA`

---

# 3. Typography

## 3.1 Font

Use **Inter** for the entire marketing site.

Install/import:

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
```

Fallback:

```css
font-family: 'Inter', ui-sans-serif, system-ui, sans-serif;
```

Use `font-feature-settings: "cv11";` where supported for a cleaner interface appearance.

---

## 3.2 Type Scale

| Element    | Size | Weight | Line Height | Tailwind                                |
| ---------- | ---: | -----: | ----------: | --------------------------------------- |
| H1 desktop | 64px |    800 |        1.05 | `text-6xl font-extrabold leading-tight` |
| H1 tablet  | 52px |    800 |        1.05 | `text-5xl`                              |
| H1 mobile  | 40px |    800 |         1.1 | `text-4xl`                              |
| H2         | 40px |    700 |        1.15 | `text-4xl font-bold`                    |
| H3         | 30px |    700 |         1.2 | `text-3xl font-bold`                    |
| H4         | 24px |    700 |        1.25 | `text-2xl font-bold`                    |
| H5         | 20px |    600 |         1.3 | `text-xl font-semibold`                 |
| H6         | 18px |    600 |         1.4 | `text-lg font-semibold`                 |
| Body large | 20px |    400 |         1.7 | `text-xl leading-8`                     |
| Body       | 16px |    400 |         1.6 | `text-base leading-7`                   |
| Body small | 14px |    400 |         1.5 | `text-sm leading-6`                     |
| Caption    | 12px |    500 |         1.4 | `text-xs font-medium`                   |

### Marketing heading rule

Keep headings short.

Prefer:

> **See every feature across every environment.**

Instead of:

> **A comprehensive solution for managing all of your feature-related workflows across multiple deployment environments.**

---

# 4. Spacing & Radius

## 4.1 Base unit

Use **4px** as the base spacing unit.

| Name | Value | Tailwind |
| ---- | ----: | -------- |
| 1    |   4px | `p-1`    |
| 2    |   8px | `p-2`    |
| 3    |  12px | `p-3`    |
| 4    |  16px | `p-4`    |
| 5    |  20px | `p-5`    |
| 6    |  24px | `p-6`    |
| 8    |  32px | `p-8`    |
| 10   |  40px | `p-10`   |
| 12   |  48px | `p-12`   |
| 16   |  64px | `p-16`   |
| 20   |  80px | `p-20`   |
| 24   |  96px | `p-24`   |

### Section spacing

Desktop:

```text
96px – 128px vertical
```

Typical Tailwind:

```text
py-24 lg:py-28
```

Mobile:

```text
64px – 80px
```

Typical:

```text
py-16
```

---

## 4.2 Border Radius

| Purpose     | Radius | Tailwind       |
| ----------- | -----: | -------------- |
| Small       |    6px | `rounded-md`   |
| Default     |    8px | `rounded-lg`   |
| Medium      |   12px | `rounded-xl`   |
| Large       |   16px | `rounded-2xl`  |
| Extra large |   24px | `rounded-3xl`  |
| Pill        | 9999px | `rounded-full` |

Use:

* `rounded-lg` for normal cards
* `rounded-xl` for larger panels
* `rounded-2xl` for hero visuals and major feature cards
* `rounded-full` for badges, environment chips, and buttons where appropriate

---

# 5. Layout Grid

## 5.1 Container

Primary page container:

```text
max-width: 1200px
```

Tailwind:

```html
mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8
```

For very wide visual sections:

```text
max-width: 1280px
```

Use:

```html
mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8
```

---

## 5.2 Breakpoints

Use Tailwind's default breakpoints:

| Breakpoint |  Width |
| ---------- | -----: |
| sm         |  640px |
| md         |  768px |
| lg         | 1024px |
| xl         | 1280px |
| 2xl        | 1536px |

Design mobile-first.

---

## 5.3 Typical Page Structure

```text
<body>
  <Navbar />

  <main>
    <Hero />
    <FeaturesOverview />
    <HowItWorks />
    <ProductVisual />
    <FinalCTA />
  </main>

  <Footer />
</body>
```

Do not create unnecessary pages or routing for the initial marketing site.

The initial site should work as a polished single-page marketing experience.

---

# 6. Page-by-Page Design

# 6.1 Navbar

## Layout sketch

```text
┌──────────────────────────────────────────────────────────────┐
│  ◈ Feature Tracker       Features  How it works      Sign In │
│                                                    Get Started│
└──────────────────────────────────────────────────────────────┘
```

Desktop:

```html
<header class="border-b border-slate-200 bg-white/95 backdrop-blur">
```

Navigation content:

* Logo
* Product name
* Features
* How it works
* Product visual / optional link
* Sign in
* Get started CTA

### Behavior

Desktop:

* horizontal navigation
* CTA visible

Mobile:

```text
Logo                                  Menu
```

Open a mobile navigation drawer/dropdown.

### Navbar height

```text
72px
```

Use:

```html
h-18
```

If `h-18` is not available, use:

```html
h-[72px]
```

The navbar should be **fixed to the viewport top**:

```html
fixed left-0 right-0 top-0 z-50
```

Add enough top padding to the page content:

```html
pt-[72px]
```

Do not use `sticky`.

---

# 6.2 Hero

## Goal

Immediately explain what Feature Tracker does.

## Layout

Desktop:

```text
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│          Track every feature.                               │
│          Follow every flow.                                 │
│          Ship with confidence.                              │
│                                                             │
│          Manage features, flows, environments, issues,      │
│          announcements, and team communication in one       │
│          engineering workspace.                             │
│                                                             │
│          [ Get Started ]   [ Explore Features ]             │
│                                                             │
│                    ↓                                        │
│            Product preview / dashboard                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Hero background

Use a subtle primary glow, not a large gradient.

Example:

```html
<section class="relative overflow-hidden bg-white">
```

Decorative elements:

```html
absolute
rounded-full
bg-indigo-100/50
blur-3xl
```

Keep decoration behind content and very subtle.

### Eyebrow

```text
ENGINEERING WORKSPACE
```

Style:

```html
inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-indigo-700
```

### H1

```text
Track every feature.
Follow every flow.
Ship with confidence.
```

Maximum width:

```html
max-w-4xl
```

Center aligned.

### Supporting text

```text
Keep features, flows, environments, issues, announcements, and team conversations connected in one workspace built for engineering teams.
```

Maximum:

```html
max-w-2xl
```

### CTA

Primary:

```text
Get Started
```

Secondary:

```text
Explore Features
```

### Hero spacing

```html
px-4 pb-20 pt-20 sm:pt-24 lg:pb-28 lg:pt-28
```

---

# 6.3 Features Overview

## Section heading

Eyebrow:

```text
EVERYTHING IN ONE WORKSPACE
```

Heading:

```text
Keep engineering work connected.
```

Description:

```text
From the first feature update to production status, keep the context your team needs close to the work.
```

## Grid

Desktop:

```text
3 columns
```

Tablet:

```text
2 columns
```

Mobile:

```text
1 column
```

Tailwind:

```html
grid gap-6 md:grid-cols-2 lg:grid-cols-3
```

---

## Feature cards

### Card 1 — Feature Tracking

Icon:

`Layers3`

Title:

```text
Track features
```

Description:

```text
Create and manage features with clear status across development, staging, and production.
```

---

### Card 2 — Flow Tracking

Icon:

`GitBranch`

Title:

```text
Follow critical flows
```

Description:

```text
Keep important product and engineering flows visible from development through production.
```

---

### Card 3 — Environment Visibility

Icon:

`Workflow`

Title:

```text
See every environment
```

Description:

```text
Understand where a feature stands without jumping between separate tools or spreadsheets.
```

---

### Card 4 — Issue Tracker

Icon:

`KanbanSquare`

Title:

```text
Move issues forward
```

Description:

```text
Organize issues on a focused Kanban board and keep evidence close to the work.
```

---

### Card 5 — Team Chat

Icon:

`MessageCircle`

Title:

```text
Talk where work happens
```

Description:

```text
Message workspace members directly and share images without leaving the workspace.
```

---

### Card 6 — Announcements

Icon:

`Megaphone`

Title:

```text
Keep everyone informed
```

Description:

```text
Share important workspace updates and keep announcements visible to the team.
```

---

## Feature card design

```html
rounded-2xl
border
border-slate-200
bg-white
p-6
shadow-sm
transition
duration-200
hover:-translate-y-1
hover:shadow-md
```

Icon container:

```html
flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600
```

Do not make cards excessively animated.

---

# 6.4 How It Works

## Section heading

Eyebrow:

```text
HOW IT WORKS
```

Heading:

```text
From idea to production, keep the path visible.
```

Description:

```text
Feature Tracker gives your team a simple workflow for keeping feature progress and engineering context connected.
```

## Three-step flow

```text
01                         02                         03

PLAN                       TRACK                      SHIP

Create features            Follow progress            See production
and flows                  across environments        status clearly
```

---

## Step 1

Icon:

`Plus`

Title:

```text
Create the work
```

Description:

```text
Add projects, features, and flows to give your team a shared view of what is being built.
```

---

## Step 2

Icon:

`GitCompare`

Title:

```text
Track the journey
```

Description:

```text
Follow each feature through development, staging, and production while keeping issues and updates connected.
```

---

## Step 3

Icon:

`Rocket`

Title:

```text
Ship with context
```

Description:

```text
See what is ready, what needs attention, and what your team has communicated along the way.
```

### Visual connection

Desktop:

```text
[01] ───────── [02] ───────── [03]
```

Use a subtle dotted or solid border line.

Do not make the line the main visual element.

Mobile:

```text
[01]
 │
[02]
 │
[03]
```

---

# 6.5 Screenshot / Product Visual Section

This is the main visual proof section.

## Heading

```text
A clear view of what your team is shipping.
```

Supporting text:

```text
Feature Tracker brings projects, feature status, flows, issues, and team updates into one focused workspace.
```

## Visual

Use an actual screenshot of the Feature Tracker dashboard when available.

Do not create fake UI that looks like a screenshot if a real screenshot is available.

### Screenshot frame

```html
overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl
```

Add:

```html
ring-1 ring-slate-900/5
```

### Browser frame

Create a lightweight browser-style frame:

```text
┌─────────────────────────────────────────────────────────┐
│ ● ● ●        feature-tracker                            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│                    Dashboard screenshot                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

Top bar:

```html
flex h-10 items-center border-b border-slate-200 bg-slate-50 px-4
```

Do not make browser chrome overly realistic.

---

# 6.6 Final CTA

## Purpose

Give visitors one obvious next action.

## Layout

```text
┌──────────────────────────────────────────────────────────┐
│                                                          │
│       Give your engineering team one clear view.        │
│                                                          │
│       Track features, follow flows, and keep             │
│       everyone aligned from dev to production.           │
│                                                          │
│                 [ Get Started ]                          │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

## Styling

Use primary background:

```html
rounded-3xl bg-indigo-600 px-6 py-16 text-white
```

Add a subtle decorative background:

```html
bg-indigo-500/20
```

Do not use a large multi-color gradient.

### CTA heading

```text
Give your engineering team one clear view.
```

### CTA description

```text
Bring features, flows, environments, issues, and team communication together.
```

### CTA button

White:

```html
bg-white text-indigo-700
```

Hover:

```html
hover:bg-indigo-50
```

---

# 6.7 Footer

## Layout

```text
┌───────────────────────────────────────────────────────────┐
│                                                           │
│  ◈ Feature Tracker                                       │
│  Track every feature. Follow every flow.                 │
│                                                           │
│  Product              Resources            Company        │
│  Features             Documentation        About          │
│  How it works         Support              Contact        │
│                                                           │
│───────────────────────────────────────────────────────────│
│  © 2026 Feature Tracker                 Privacy · Terms  │
└───────────────────────────────────────────────────────────┘
```

Keep the footer simple.

Do not add fake social media accounts.

### Footer background

```html
bg-slate-950 text-slate-300
```

### Footer heading

```html
text-white
```

### Footer links

```html
text-sm text-slate-400 transition hover:text-white
```

---

# 7. Component Inventory

The marketing site should be componentized but should not become over-engineered.

Recommended structure:

```text
src/
├── components/
│   ├── layout/
│   │   ├── Navbar.jsx
│   │   └── Footer.jsx
│   │
│   ├── marketing/
│   │   ├── Hero.jsx
│   │   ├── FeatureCard.jsx
│   │   ├── FeaturesSection.jsx
│   │   ├── StepCard.jsx
│   │   ├── HowItWorks.jsx
│   │   ├── ProductVisual.jsx
│   │   ├── CTASection.jsx
│   │   └── SectionHeading.jsx
│   │
│   └── ui/
│       ├── Button.jsx
│       └── Badge.jsx
│
├── pages/
│   └── Home.jsx
│
├── assets/
│   └── feature-tracker-dashboard.png
│
├── App.jsx
├── main.jsx
└── index.css
```

Do not create components for one-off text fragments.

---

## 7.1 Navbar

```jsx
<Navbar
  links={[
    { label: "Features", href: "#features" },
    { label: "How it works", href: "#how-it-works" },
  ]}
  primaryAction={{
    label: "Get Started",
    href: "#get-started",
  }}
/>
```

Props:

```ts
type NavLink = {
  label: string;
  href: string;
};

type NavbarProps = {
  links: NavLink[];
  primaryAction: {
    label: string;
    href: string;
  };
};
```

---

## 7.2 Button

```jsx
<Button variant="primary" size="lg">
  Get Started
</Button>
```

Props:

```ts
type ButtonProps = {
  variant?: "primary" | "secondary" | "outline" | "ghost";
  size?: "sm" | "md" | "lg";
  href?: string;
  children: React.ReactNode;
};
```

---

## 7.3 Badge

```jsx
<Badge>Engineering Workspace</Badge>
```

Props:

```ts
type BadgeProps = {
  children: React.ReactNode;
  variant?: "primary" | "neutral" | "success";
};
```

---

## 7.4 SectionHeading

```jsx
<SectionHeading
  eyebrow="EVERYTHING IN ONE WORKSPACE"
  title="Keep engineering work connected."
  description="From the first feature update to production status, keep the context your team needs close to the work."
/>
```

Props:

```ts
type SectionHeadingProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "left" | "center";
};
```

---

## 7.5 FeatureCard

```jsx
<FeatureCard
  icon={Layers3}
  title="Track features"
  description="Create and manage features with clear status across development, staging, and production."
/>
```

Props:

```ts
type FeatureCardProps = {
  icon: LucideIcon;
  title: string;
  description: string;
};
```

---

## 7.6 StepCard

```jsx
<StepCard
  number="01"
  icon={Plus}
  title="Create the work"
  description="Add projects, features, and flows to give your team a shared view."
/>
```

Props:

```ts
type StepCardProps = {
  number: string;
  icon: LucideIcon;
  title: string;
  description: string;
};
```

---

## 7.7 CTAButton

Use only if the normal Button component cannot cover the required behavior.

```jsx
<CTAButton href="#get-started">
  Get Started
</CTAButton>
```

Props:

```ts
type CTAButtonProps = {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "light";
};
```

---

## 7.8 ProductVisual

```jsx
<ProductVisual
  image="/assets/feature-tracker-dashboard.png"
  alt="Feature Tracker dashboard showing projects and feature status"
/>
```

Props:

```ts
type ProductVisualProps = {
  image: string;
  alt: string;
};
```

---

## 7.9 Footer

```jsx
<Footer
  productLinks={[]}
  resourceLinks={[]}
  companyLinks={[]}
/>
```

Props:

```ts
type FooterLink = {
  label: string;
  href: string;
};

type FooterProps = {
  productLinks: FooterLink[];
  resourceLinks: FooterLink[];
  companyLinks: FooterLink[];
};
```

---

# 8. Tailwind Configuration

The marketing site uses Tailwind CSS 3.

Use the following inside `tailwind.config.js`.

```js
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
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
          DEFAULT: "#6366F1",
        },

        secondary: {
          50: "#F8FAFC",
          100: "#F1F5F9",
          200: "#E2E8F0",
          300: "#CBD5E1",
          400: "#94A3B8",
          500: "#64748B",
          600: "#475569",
          700: "#334155",
          800: "#1E293B",
          900: "#0F172A",
          DEFAULT: "#64748B",
        },

        accent: {
          50: "#ECFEFF",
          100: "#CFFAFE",
          200: "#A5F3FC",
          500: "#06B6D4",
          600: "#0891B2",
          700: "#0E7490",
          DEFAULT: "#06B6D4",
        },

        success: {
          50: "#F0FDF4",
          100: "#DCFCE7",
          500: "#22C55E",
          600: "#16A34A",
          700: "#15803D",
          DEFAULT: "#16A34A",
        },

        warning: {
          50: "#FFFBEB",
          100: "#FEF3C7",
          500: "#F59E0B",
          600: "#D97706",
          700: "#B45309",
          DEFAULT: "#D97706",
        },

        error: {
          50: "#FEF2F2",
          100: "#FEE2E2",
          500: "#EF4444",
          600: "#DC2626",
          700: "#B91C1C",
          DEFAULT: "#DC2626",
        },

        info: {
          50: "#EFF6FF",
          100: "#DBEAFE",
          500: "#3B82F6",
          600: "#2563EB",
          700: "#1D4ED8",
          DEFAULT: "#2563EB",
        },
      },

      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
      },

      maxWidth: {
        "8xl": "90rem",
      },

      spacing: {
        18: "4.5rem",
      },

      borderRadius: {
        "4xl": "2rem",
      },

      boxShadow: {
        soft: "0 4px 24px rgba(15, 23, 42, 0.06)",
        card: "0 8px 30px rgba(15, 23, 42, 0.08)",
        product: "0 24px 70px rgba(15, 23, 42, 0.14)",
      },

      backgroundImage: {
        "hero-grid":
          "linear-gradient(to right, rgba(99, 102, 241, 0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(99, 102, 241, 0.06) 1px, transparent 1px)",
      },

      transitionTimingFunction: {
        "smooth": "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [],
};
```

---

# 9. Global CSS

`src/index.css` should establish the basic design foundation.

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html {
    scroll-behavior: smooth;
  }

  body {
    @apply bg-white text-slate-900 antialiased;
    font-family: "Inter", ui-sans-serif, system-ui, sans-serif;
  }

  ::selection {
    @apply bg-indigo-100 text-indigo-900;
  }

  :focus-visible {
    @apply outline-none ring-2 ring-indigo-500 ring-offset-2;
  }
}

@layer components {
  .container-marketing {
    @apply mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8;
  }

  .section-padding {
    @apply py-16 sm:py-20 lg:py-24;
  }
}
```

---

# 10. Accessibility Checklist

Accessibility is part of the design system, not a final cleanup step.

## 10.1 Color contrast

Target WCAG 2.1 AA.

Normal text:

```text
minimum contrast: 4.5:1
```

Large text:

```text
minimum contrast: 3:1
```

UI components and graphical objects:

```text
minimum contrast: 3:1
```

Do not use:

```text
text-slate-400
```

for important body text on white backgrounds.

Prefer:

```text
text-slate-600
```

or darker.

---

## 10.2 Keyboard navigation

Every interactive element must be keyboard accessible.

Required:

* visible `:focus-visible`
* logical tab order
* buttons must be actual `<button>`
* links must be actual `<a>`
* mobile navigation must support Escape
* no keyboard traps

Focus style:

```html
focus-visible:outline-none
focus-visible:ring-2
focus-visible:ring-indigo-500
focus-visible:ring-offset-2
```

---

## 10.3 Images

Every meaningful image requires useful alt text.

Good:

```html
alt="Feature Tracker dashboard showing project and feature status"
```

Decorative images:

```html
alt=""
```

Do not use alt text such as:

```text
image
screenshot
dashboard image
```

---

## 10.4 Semantic HTML

Use:

```html
<header>
<nav>
<main>
<section>
<article>
<footer>
```

Do not build the entire page using `<div>` elements.

Each major section should have an accessible heading.

---

## 10.5 Buttons and links

Use links for navigation:

```html
<a href="#features">
```

Use buttons for actions:

```html
<button type="button">
```

Do not create clickable `<div>` elements.

---

## 10.6 Motion

Animations should be subtle.

Default:

```text
150ms – 250ms
```

Use:

```html
transition-all duration-200
```

or:

```html
transition duration-200
```

Respect reduced-motion preferences.

Add:

```css
@media (prefers-reduced-motion: reduce) {
  html {
    scroll-behavior: auto;
  }

  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Avoid:

* parallax
* continuous floating animations
* large spinning decorations
* auto-playing videos
* excessive scroll animations

---

# 11. Interaction Guidelines

## Buttons

Primary button:

```html
inline-flex
items-center
justify-center
rounded-lg
bg-indigo-600
px-5
py-3
text-sm
font-semibold
text-white
transition
duration-200
hover:bg-indigo-700
active:bg-indigo-800
disabled:pointer-events-none
disabled:opacity-50
```

Secondary button:

```html
inline-flex
items-center
justify-center
rounded-lg
border
border-slate-300
bg-white
px-5
py-3
text-sm
font-semibold
text-slate-700
transition
duration-200
hover:bg-slate-50
```

---

## Cards

Default:

```html
rounded-2xl border border-slate-200 bg-white p-6 shadow-sm
```

Hover:

```html
transition duration-200 hover:-translate-y-1 hover:shadow-md
```

Do not apply hover movement to every element on the page.

---

# 12. Recommended Icons

Use `lucide-react`.

Recommended icons:

| Concept       | Icon            |
| ------------- | --------------- |
| Features      | `Layers3`       |
| Flows         | `GitBranch`     |
| Environment   | `Workflow`      |
| Projects      | `FolderKanban`  |
| Issues        | `KanbanSquare`  |
| Chat          | `MessageCircle` |
| Announcements | `Megaphone`     |
| Team          | `Users`         |
| Development   | `Code2`         |
| Staging       | `GitCompare`    |
| Production    | `Rocket`        |
| Create        | `Plus`          |
| Check         | `Check`         |
| Arrow         | `ArrowRight`    |
| External link | `ExternalLink`  |
| Menu          | `Menu`          |
| Close         | `X`             |

Icon size:

```text
20px
```

Large feature icon:

```text
24px
```

Hero decorative icon:

```text
32px
```

Never use emojis as UI icons.

---

# 13. Responsive Behavior

## Mobile — < 640px

* one-column layout
* centered hero
* navbar becomes menu
* buttons can become full-width
* feature cards stack
* screenshot extends to container edges where appropriate
* reduce heading sizes
* section padding `py-16`

## Tablet — 640–1023px

* two-column feature grid
* hero remains centered
* maintain generous whitespace
* navigation may remain compact

## Desktop — 1024px+

* three-column feature grid
* full navigation
* larger hero typography
* wider product screenshot
* three-step horizontal flow

---

# 14. Content Rules

## Do

Use:

```text
Track features across environments.
```

```text
Keep issues and evidence together.
```

```text
Talk to your team without leaving the workspace.
```

```text
See what is happening from development to production.
```

## Don't

Avoid:

```text
The ultimate revolutionary platform for modern engineering teams.
```

Avoid:

```text
10x your engineering productivity with AI-powered innovation.
```

Avoid fake claims such as:

```text
Trusted by 10,000+ engineering teams.
```

unless the number is real and approved.

---

# 15. Implementation Order

Follow this exact order.

## Step 1 — Create the Vite React project

If the marketing site does not already exist:

```bash
npm create vite@latest feature-tracker-marketing -- --template react
cd feature-tracker-marketing
npm install
```

---

## Step 2 — Install required packages

```bash
npm install lucide-react
```

Install Tailwind CSS 3:

```bash
npm install -D tailwindcss@3 postcss autoprefixer
```

Initialize:

```bash
npx tailwindcss init -p
```

---

## Step 3 — Configure Tailwind

Update:

```text
tailwind.config.js
```

with the `theme.extend` configuration in this document.

Ensure the `content` paths include:

```js
"./index.html",
"./src/**/*.{js,ts,jsx,tsx}",
```

---

## Step 4 — Create the folder structure

Create:

```text
src/
├── components/
│   ├── layout/
│   │   ├── Navbar.jsx
│   │   └── Footer.jsx
│   │
│   ├── marketing/
│   │   ├── Hero.jsx
│   │   ├── FeatureCard.jsx
│   │   ├── FeaturesSection.jsx
│   │   ├── StepCard.jsx
│   │   ├── HowItWorks.jsx
│   │   ├── ProductVisual.jsx
│   │   ├── CTASection.jsx
│   │   └── SectionHeading.jsx
│   │
│   └── ui/
│       ├── Button.jsx
│       └── Badge.jsx
│
├── pages/
│   └── Home.jsx
│
├── assets/
│
├── App.jsx
├── main.jsx
└── index.css
```

---

## Step 5 — Build global styles

Implement:

```text
src/index.css
```

first.

Add:

* Tailwind directives
* Inter font
* base colors
* body typography
* focus states
* selection styling
* reduced-motion rules
* reusable container classes

---

## Step 6 — Build primitive components

Create:

```text
Button.jsx
Badge.jsx
SectionHeading.jsx
```

Do this before building the larger sections.

---

## Step 7 — Build the Navbar

Create:

```text
components/layout/Navbar.jsx
```

Requirements:

* fixed at viewport top
* `z-50`
* 72px height
* desktop navigation
* mobile menu
* accessible buttons
* visible keyboard focus
* `pt-[72px]` on main content

---

## Step 8 — Build Hero

Create:

```text
components/marketing/Hero.jsx
```

Implement:

* eyebrow
* H1
* supporting copy
* two CTAs
* subtle background decoration
* responsive typography

Do not add complex animation.

---

## Step 9 — Build FeatureCard

Create:

```text
components/marketing/FeatureCard.jsx
```

Then create:

```text
components/marketing/FeaturesSection.jsx
```

Use a data array instead of duplicating markup:

```js
const features = [
  {
    icon: Layers3,
    title: "Track features",
    description: "...",
  },
  // ...
];
```

---

## Step 10 — Build How It Works

Create:

```text
StepCard.jsx
HowItWorks.jsx
```

Use exactly three steps.

---

## Step 11 — Add the product screenshot

Add the real screenshot to:

```text
src/assets/feature-tracker-dashboard.png
```

Then implement:

```text
ProductVisual.jsx
```

Use:

```html
rounded-2xl
border
shadow-product
```

Do not distort the screenshot.

---

## Step 12 — Build the final CTA

Create:

```text
CTASection.jsx
```

Use the primary indigo background and a single strong CTA.

---

## Step 13 — Build Footer

Create:

```text
components/layout/Footer.jsx
```

Keep it simple and responsive.

---

## Step 14 — Assemble Home

Create:

```text
pages/Home.jsx
```

Structure:

```jsx
<>
  <Navbar />

  <main className="pt-[72px]">
    <Hero />
    <FeaturesSection />
    <HowItWorks />
    <ProductVisual />
    <CTASection />
  </main>

  <Footer />
</>
```

---

## Step 15 — Configure App

`App.jsx` should render the home page.

For the initial marketing site, avoid introducing routing unless multiple marketing pages are actually required.

---

## Step 16 — Set development port

Update `vite.config.js`:

```js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
  },
});
```

---

## Step 17 — Run the site

```bash
npm run dev
```

Expected URL:

```text
http://localhost:5180
```

---

## Step 18 — Responsive verification

Test at minimum:

```text
375px
640px
768px
1024px
1280px
1536px
```

Check:

* navbar
* hero wrapping
* CTA buttons
* feature grid
* product screenshot
* footer
* horizontal overflow
* mobile menu

There must be no unintended horizontal scrollbar.

---

## Step 19 — Accessibility verification

Verify:

* keyboard-only navigation
* visible focus
* heading hierarchy
* image alt text
* button/link semantics
* color contrast
* mobile navigation keyboard behavior
* reduced-motion behavior

---

## Step 20 — Final visual polish

Before considering the site finished, check:

### Spacing

No cramped sections.

### Typography

No oversized paragraphs.

### Cards

No excessive shadows.

### Colors

Primary blue should remain the visual anchor.

### Icons

Consistent Lucide icon style.

### Animation

Subtle and purposeful.

### Content

No fake metrics or unsupported claims.

### Responsiveness

No broken layout between breakpoints.

---

# 16. Final Visual Direction

The finished marketing site should communicate this hierarchy:

```text
                    FEATURE TRACKER

              Track every feature.
              Follow every flow.
              Ship with confidence.

        Features → Environments → Issues → Team

                     ↓

             Product screenshot

                     ↓

          Simple 3-step workflow

                     ↓

              Strong final CTA
```

The overall visual language should be:

```text
Clean
Modern
Engineering-focused
Trustworthy
Slightly playful
Whitespace-heavy
Blue/indigo-led
Softly rounded
Subtle shadows
Minimal animation
```

Avoid:

```text
Generic SaaS gradients
Huge glowing blobs
Stock photos
Fake customer logos
Fake statistics
Excessive animations
Dense text
Overly rounded everything
Heavy glassmorphism
AI-generated-looking illustrations
```

The website should feel like the **marketing layer of the existing Feature Tracker product**, not like a completely unrelated SaaS template.

**Primary design principle:**

> Make the product understandable within 10 seconds, visually prove what it looks like, and give the visitor one clear next action.
