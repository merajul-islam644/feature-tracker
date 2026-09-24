# Design System Rewrite — Structured Engineering Workspace

Mode-agnostic design system: light and dark treated as two equal surface palettes,
not one being a transformed version of the other. Information hierarchy comes from
type scale → spacing → borders → surface tone → accent color, in that order.
Special technical areas (code, logs, Playwright evidence, terminal, AI reasoning)
use a darker technical surface in **both** modes — a consistent "instrument panel"
language independent of the application palette.

---

## 1. Visual direction

- Neutral zinc/stone surfaces, crisp 1px boundaries.
- Generous but disciplined spacing.
- Strong typography, compact controls, restrained radius.
- One signature indigo accent — used only for interaction / focus / primary actions.
- Light mode: warm-neutral paper-like surfaces, charcoal text, subtle borders.
- Dark mode: deep neutral surfaces, soft-white text, equally visible borders.
- **Avoid**: gradients, excessive shadows, glassmorphism, colored cards, oversized
  rounded containers, color-dependent hierarchy.

---

## 2. Complete CSS variable system

Use semantic variables everywhere — no hardcoded `bg-white`, `text-gray-*`, etc.

### `src/index.css`

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    /* ========== CORE SURFACES ========== */

    --background: 40 20% 97%;
    --foreground: 240 10% 12%;

    --surface: 0 0% 100%;
    --surface-muted: 40 14% 94%;
    --surface-subtle: 40 12% 91%;
    --surface-raised: 0 0% 100%;

    /* ========== CARD / PANEL ========== */

    --card: 0 0% 100%;
    --card-foreground: 240 10% 12%;

    --panel: 40 16% 95%;
    --panel-foreground: 240 10% 14%;

    /* ========== BORDERS ========== */

    --border: 40 9% 84%;
    --border-strong: 40 7% 74%;
    --border-subtle: 40 10% 89%;

    /* ========== TEXT HIERARCHY ========== */

    --muted: 40 12% 94%;
    --muted-foreground: 240 5% 42%;

    --subtle-foreground: 240 5% 53%;

    /* ========== PRIMARY / SIGNATURE ACCENT ========== */

    --primary: 243 75% 59%;
    --primary-foreground: 0 0% 100%;

    --primary-muted: 243 80% 96%;
    --primary-border: 243 70% 82%;

    /* ========== SECONDARY ========== */

    --secondary: 40 10% 92%;
    --secondary-foreground: 240 8% 22%;

    /* ========== INTERACTIVE STATES ========== */

    --accent: 40 10% 93%;
    --accent-foreground: 240 8% 16%;

    --ring: 243 75% 59%;

    /* ========== STATUS ========== */

    --success: 152 55% 36%;
    --success-muted: 152 45% 94%;
    --success-border: 152 40% 80%;

    --warning: 35 85% 42%;
    --warning-muted: 35 80% 94%;
    --warning-border: 35 65% 78%;

    --destructive: 0 68% 48%;
    --destructive-foreground: 0 0% 100%;
    --destructive-muted: 0 70% 95%;
    --destructive-border: 0 55% 82%;

    --info: 199 75% 42%;
    --info-muted: 199 70% 94%;
    --info-border: 199 55% 80%;

    /* ========== INPUTS ========== */

    --input: 40 8% 79%;
    --input-background: 0 0% 100%;
    --input-placeholder: 240 5% 55%;

    /* ========== TECHNICAL SURFACES (code/logs/AI/evidence) ========== */

    --technical: 240 10% 10%;
    --technical-foreground: 240 8% 92%;
    --technical-muted: 240 5% 64%;
    --technical-border: 240 5% 24%;

    /* ========== OVERLAY ========== */

    --overlay: 240 10% 8%;

    /* ========== RADIUS ========== */

    --radius: 0.75rem;
  }

  .dark {
    /* ========== CORE SURFACES ========== */

    --background: 240 7% 9%;
    --foreground: 240 8% 94%;

    --surface: 240 7% 12%;
    --surface-muted: 240 6% 15%;
    --surface-subtle: 240 5% 18%;
    --surface-raised: 240 7% 14%;

    /* ========== CARD / PANEL ========== */

    --card: 240 7% 12%;
    --card-foreground: 240 8% 94%;

    --panel: 240 6% 14%;
    --panel-foreground: 240 8% 92%;

    /* ========== BORDERS ========== */

    --border: 240 5% 25%;
    --border-strong: 240 5% 34%;
    --border-subtle: 240 5% 20%;

    /* ========== TEXT HIERARCHY ========== */

    --muted: 240 6% 16%;
    --muted-foreground: 240 5% 68%;

    --subtle-foreground: 240 5% 57%;

    /* ========== PRIMARY / SIGNATURE ACCENT ========== */

    --primary: 243 80% 68%;
    --primary-foreground: 240 10% 10%;

    --primary-muted: 243 35% 20%;
    --primary-border: 243 45% 36%;

    /* ========== SECONDARY ========== */

    --secondary: 240 5% 19%;
    --secondary-foreground: 240 8% 90%;

    /* ========== INTERACTIVE STATES ========== */

    --accent: 240 5% 19%;
    --accent-foreground: 240 8% 94%;

    --ring: 243 80% 68%;

    /* ========== STATUS ========== */

    --success: 152 55% 52%;
    --success-muted: 152 30% 17%;
    --success-border: 152 35% 30%;

    --warning: 38 88% 60%;
    --warning-muted: 35 30% 18%;
    --warning-border: 35 40% 32%;

    --destructive: 0 70% 62%;
    --destructive-foreground: 0 0% 100%;
    --destructive-muted: 0 30% 18%;
    --destructive-border: 0 38% 32%;

    --info: 199 75% 58%;
    --info-muted: 199 30% 17%;
    --info-border: 199 38% 30%;

    /* ========== INPUTS ========== */

    --input: 240 5% 32%;
    --input-background: 240 7% 10%;
    --input-placeholder: 240 5% 52%;

    /* ========== TECHNICAL SURFACE — SAME IN BOTH MODES ========== */

    --technical: 240 10% 8%;
    --technical-foreground: 240 8% 92%;
    --technical-muted: 240 5% 62%;
    --technical-border: 240 5% 22%;

    --overlay: 240 10% 4%;
  }
}
```

### `tailwind.config.js`

```js
export default {
  darkMode: ["class"],

  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",

        surface: {
          DEFAULT: "hsl(var(--surface))",
          muted: "hsl(var(--surface-muted))",
          subtle: "hsl(var(--surface-subtle))",
          raised: "hsl(var(--surface-raised))",
        },

        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },

        panel: {
          DEFAULT: "hsl(var(--panel))",
          foreground: "hsl(var(--panel-foreground))",
        },

        border: {
          DEFAULT: "hsl(var(--border))",
          strong: "hsl(var(--border-strong))",
          subtle: "hsl(var(--border-subtle))",
        },

        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },

        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          muted: "hsl(var(--primary-muted))",
          border: "hsl(var(--primary-border))",
        },

        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },

        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
          muted: "hsl(var(--destructive-muted))",
          border: "hsl(var(--destructive-border))",
        },

        success: {
          DEFAULT: "hsl(var(--success))",
          muted: "hsl(var(--success-muted))",
          border: "hsl(var(--success-border))",
        },

        warning: {
          DEFAULT: "hsl(var(--warning))",
          muted: "hsl(var(--warning-muted))",
          border: "hsl(var(--warning-border))",
        },

        info: {
          DEFAULT: "hsl(var(--info))",
          muted: "hsl(var(--info-muted))",
          border: "hsl(var(--info-border))",
        },

        input: "hsl(var(--input))",
        "input-background": "hsl(var(--input-background))",

        technical: {
          DEFAULT: "hsl(var(--technical))",
          foreground: "hsl(var(--technical-foreground))",
          muted: "hsl(var(--technical-muted))",
          border: "hsl(var(--technical-border))",
        },
      },

      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
};
```

---

## 3. Per-component design guidance

### Sidebar — information rail, not a giant colored panel

- Width: 240–256px
- `bg-surface`, `border-r border-border`
- Logo area separated by a border
- Nav items: `h-9`, compact
- Icons: `size-4`, labels `text-sm`
- Active: subtle indigo-tinted surface — NOT a huge indigo rectangle
- No gradients, no floating glass
- Section labels: uppercase / letter-spaced / muted

```tsx
<nav className="flex h-9 items-center gap-2 rounded-md px-3
  text-sm text-muted-foreground
  hover:bg-accent hover:text-foreground
  data-[active=true]:bg-primary-muted
  data-[active=true]:text-primary">
```

### Topbar — keep it quiet

```tsx
<header className="
  h-16 shrink-0
  border-b border-border
  bg-surface
  px-6
  flex items-center justify-between
">
```

- Breadcrumb / page title left
- Search / action area in middle
- Notifications, theme, avatar right
- No excessive shadows, no giant page title, no gradient background

### Cards — structured documents, not floating blobs

**Preferred:**

```tsx
<Card className="rounded-lg border border-border bg-card text-card-foreground" />
```

**Avoid:** `rounded-2xl shadow-xl` as the default.

Shadows only when an element physically floats above another surface.

Card hierarchy:

```
Card
 ├── Header
 │    ├── eyebrow
 │    ├── title
 │    └── description
 ├── Content
 └── Footer
```

Prefer borders and spacing over shadows.

### Dialogs — focused workspaces

```tsx
<DialogContent className="rounded-xl border border-border bg-surface p-0 shadow-2xl" />
```

- Header padding `p-6`
- Content `px-6 py-5`
- Footer `border-t border-border px-6 py-4`
- Clear title hierarchy, destructive action visually separated
- Do NOT make dialogs heavily translucent

### Dropdowns

```tsx
<DropdownMenuContent className="
  min-w-[180px]
  rounded-md
  border border-border
  bg-surface
  p-1
  shadow-lg
" />
```

Items:

```tsx
className="flex h-9 items-center gap-2 rounded-sm px-2 text-sm text-foreground hover:bg-accent"
```

Destructive: `text-destructive hover:bg-destructive-muted`

### Tabs — structural, not pill-heavy

Active tab:

```tsx
className="relative h-10 border-b-2 border-primary px-1 text-sm font-medium text-foreground"
```

Inactive: `text-muted-foreground hover:text-foreground`

Avoid making every tab a rounded pill.

### Forms — prioritize readability

```tsx
<div className="space-y-2">
  <Label className="text-sm font-medium">Project name</Label>

  <Input className="
    h-10
    border-input
    bg-input-background
    focus-visible:ring-2
    focus-visible:ring-ring/20
  " />

  <p className="text-xs text-muted-foreground">
    The name visible to your team.
  </p>
</div>
```

Use `space-y-2`, not excessive vertical spacing.

### Inputs — visually neutral

```tsx
className="
  h-10 rounded-md
  border border-input
  bg-input-background
  text-sm text-foreground
  placeholder:text-muted-foreground
  focus-visible:border-primary
  focus-visible:ring-2
  focus-visible:ring-primary/20
"
```

Do NOT add colored backgrounds to normal inputs, use giant rounded pills, or
use shadows as focus indicators.

### Buttons — communicate hierarchy

**Primary:**

```tsx
className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
```

**Secondary:**

```tsx
className="h-9 rounded-md border border-border bg-surface px-4 text-sm font-medium text-foreground hover:bg-accent"
```

**Ghost:**

```tsx
className="h-9 rounded-md px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
```

**Destructive:** use red only when the action is actually destructive.
`bg-destructive text-destructive-foreground hover:bg-destructive/90`

### AI Assistant — technical operator console

Use the technical tokens.

```tsx
<div className="overflow-hidden rounded-xl border border-technical-border bg-technical text-technical-foreground">
```

**Header:** `AI VERIFICATION · ● Ready` — small status indicator, NOT a huge AI icon.

**Messages:**
- User: `bg-technical-border/40`
- Assistant: `bg-transparent`
- Tool calls: `border border-technical-border bg-technical font-mono`

**Verification progress** — vertical execution timeline:

```
✓ Open application
✓ Authenticate
✓ Inspect navigation
✓ Test forms
● Verify issue tracker
○ Evidence capture
```

Much more useful than colorful progress cards.

### Issue Tracker — QA control center

**Run / Verify panel** — bordered control panel:

```tsx
<section className="rounded-lg border border-border bg-card">
```

Header: `Verify Application` + `Run verification against the selected URL.`
Primary action: `▶ Run verification`

During execution:

```
Verification running

✓ Page loaded
✓ Navigation inspected
✓ Forms inspected
● Checking interactions
○ Evidence capture
```

Avoid turning every check into a colorful card.

**Issue list** — dense list/table hybrid:

```
┌────┬──────────────────────────────┬──────────┬──────────┐
│ ID │ Issue                        │ Severity │ Status   │
├────┼──────────────────────────────┼──────────┼──────────┤
│ #41│ Submit button does nothing   │ High     │ Open     │
│ #40│ Missing empty state          │ Medium   │ Review   │
└────┴──────────────────────────────┴──────────┴──────────┘
```

Rows:

```tsx
className="border-b border-border px-4 py-3 hover:bg-accent/50"
```

### Evidence viewer — dark technical surface in BOTH themes

```tsx
<div className="overflow-hidden rounded-lg border border-technical-border bg-technical">
```

Top bar: `Screenshot | Console | Network | Accessibility`
Image viewport: `bg-technical`
Metadata: `URL | Timestamp | Viewport | Load time | Console errors`

Use monospace for technical data:

```tsx
className="font-mono text-xs"
```

Creates a consistent engineering-tool feeling regardless of application theme.

### Environment chips — restrained cyan

Cyan is reserved for environment semantics (DEV / STAGING / PROD).

```tsx
className="
  inline-flex h-6 items-center
  rounded-md
  border border-cyan-500/30
  bg-cyan-500/10
  px-2 text-xs font-medium
  text-cyan-700 dark:text-cyan-300
"
```

Do NOT make them giant saturated pills.

### Status chips — state, not decoration

| Status      | Classes                                                              |
| ----------- | -------------------------------------------------------------------- |
| Success     | `border border-success-border bg-success-muted text-success`         |
| Warning     | `border border-warning-border bg-warning-muted text-warning`         |
| Error       | `border border-destructive-border bg-destructive-muted text-destructive` |
| Neutral     | `border border-border bg-muted text-muted-foreground`                |

### Settings — document / editor layout

```
Settings

General | Appearance | Notifications | Members | Integrations | Verification

Main content:

Section title
Description
────────────────────────
Setting   Description         Control
```

Use horizontal separators rather than cards everywhere.

```tsx
className="border-b border-border py-5"
```

### Members — structured table, not card grid

```
Avatar   Name              Role       Status       Actions
──────────────────────────────────────────────────────────
        John Smith         Manager    Active       ...
        Sarah Ahmed        Tester     Active       ...
```

Denser and more appropriate for a workspace application.

### Profile

```
Profile

[Avatar]  MD Merajul Islam
          Software Developer

────────────────────────

Personal information

Name
Email
...
```

Large avatar is acceptable here because identity is the focus.

### Notifications — compact notification center

Unread: `bg-primary-muted` — keep the actual notification text neutral.

```
● New verification completed
  Project Alpha · 2 minutes ago
```

Do NOT make each notification a colored card.

### Chat — same language as AI assistant

- Human messages: `bg-primary-muted text-foreground`
- System / AI: `bg-surface-muted border border-border`
- Attachments: `border border-border rounded-md`
- Images: restrained `rounded-md`, NOT huge rounded corners

### Empty states — quiet

```
[small icon]

No features yet

Create your first feature to begin tracking
development flows.

[ Create feature ]
```

Use `text-muted-foreground` for explanation. Do NOT use huge illustrations unless
genuinely useful.

### Loading states — layout-following skeletons

```tsx
<div className="h-4 w-40 animate-pulse rounded-sm bg-muted" />
```

Avoid animated gradient skeletons.

For operational verification, use explicit progress instead:

```
✓ Completed
● Running
○ Pending
```

### Error states — clear and actionable

```tsx
<div className="rounded-lg border border-destructive-border bg-destructive-muted p-4">
  Unable to load project

  The server returned an unexpected response.

  [ Try again ]
</div>
```

Do NOT use giant red sections.

### Toasts — compact system messages

```tsx
className="rounded-lg border border-border bg-surface text-foreground shadow-lg"
```

Success / error use a small semantic icon + text, not an entirely colored toast.

### Tooltips — small, dense, technical

```tsx
className="rounded-md border border-border bg-technical px-2.5 py-1.5 text-xs text-technical-foreground shadow-lg"
```

Using the technical surface gives tooltips consistent contrast in both themes.

---

## 4. Exact Tailwind utility patterns

Do NOT freestyle component styling.

### Global background

**Always:** `bg-background text-foreground`
**Never:** `bg-white dark:bg-zinc-950`

### Main surfaces

Use `bg-surface`, `bg-card`, or `bg-surface-muted` based on semantic purpose.

### Hairline dividers

**Always:** `border border-border` or `border-b border-border`
**Never:** `border-gray-200 dark:border-gray-800` when a semantic token exists

Strong: `border-border-strong`
Subtle: `border-border-subtle`

### Primary accent — use indigo only for

- primary actions
- active navigation
- active tabs
- focus
- selected states
- important links

Subtle primary surface: `bg-primary-muted border-primary-border`

### Neutral interactive surface

`hover:bg-accent` — do not create custom hover colors per component.

### Muted text

- `text-muted-foreground`
- secondary muted: `text-subtle-foreground`

### Inputs

`border border-input bg-input-background`
Focus: `focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20`

### Cards

Default: `rounded-lg border border-border bg-card`
**Not:** `rounded-2xl shadow-xl`

### Small controls

`h-8 rounded-md` — tiny controls
`h-9 rounded-md` — normal controls
`h-10 rounded-md` — inputs

### Page spacing

- Desktop page: `px-6 py-6`
- Large page: `px-8 py-8`
- Main content: `mx-auto w-full max-w-7xl`

### Section spacing

- Sections: `space-y-6`
- Major sections: `space-y-8`
- Form fields: `space-y-2`

### Typography

| Use             | Class                              |
| --------------- | ---------------------------------- |
| Page title      | `text-2xl font-semibold tracking-tight` |
| Section title   | `text-lg font-semibold`            |
| Card title      | `text-sm font-semibold`            |
| Body            | `text-sm text-foreground`          |
| Description     | `text-sm text-muted-foreground`    |
| Metadata        | `text-xs text-muted-foreground`    |
| Technical data  | `font-mono text-xs`                |

### Icons

- Default: `size-4`
- Small: `size-3.5`
- Large: `size-5`

Never use giant icons to fill empty space unless the empty state specifically requires it.

### Focus — one consistent language

```tsx
focus-visible:outline-none
focus-visible:ring-2
focus-visible:ring-primary/20
focus-visible:ring-offset-2
focus-visible:ring-offset-background
```

### Technical surfaces

- `bg-technical`
- `text-technical-foreground`
- `border-technical-border`
- Muted technical content: `text-technical-muted`

### Shadows — only for elevation

- `shadow-sm` — occasional subtle elevation
- `shadow-lg` — dropdowns / dialogs / tooltips
- `shadow-2xl` — large modal overlays only

Do NOT use shadows to separate ordinary cards from the page.

### Radius system

| Class       | Use                                        |
| ----------- | ------------------------------------------ |
| `rounded-sm`| tiny controls                              |
| `rounded-md`| buttons, inputs, menus                     |
| `rounded-lg`| cards, panels                              |
| `rounded-xl`| dialogs / major containers                 |

Avoid `rounded-full` except: avatars, circular icon buttons, genuinely pill-like
status indicators.

### Example complete page

```tsx
<div className="min-h-screen bg-background text-foreground">
  <header className="h-16 border-b border-border bg-surface">
    ...
  </header>

  <div className="flex">
    <aside className="w-60 border-r border-border bg-surface">
      ...
    </aside>

    <main className="flex-1 px-6 py-6">
      <div className="mx-auto max-w-7xl space-y-6">

        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Features
          </h1>

          <p className="mt-1 text-sm text-muted-foreground">
            Track features and their verification flows.
          </p>
        </div>

        <section className="rounded-lg border border-border bg-card">
          ...
        </section>

      </div>
    </main>
  </div>
</div>
```

The component structure remains the same between modes — only the semantic token
values change.

---

## 5. Final look-and-feel checklist

The finished Feature Tracker should feel like a serious modern engineering
workspace, not a marketing dashboard: **neutral, precise, calm, dense enough for
professional QA work**, and visually organized primarily through typography,
spacing, borders, and surface tone.

- **Light mode**: refined warm-neutral workspace with crisp charcoal text and
  understated boundaries.
- **Dark mode**: equally intentional deep-neutral workspace with soft-white text
  and equally strong structural boundaries.
- **Indigo**: single signature application accent, used sparingly.
- **Cyan**: reserved for environments.
- **Semantic colors**: only on actual statuses.
- **Cards**: bordered rather than heavily shadowed.
- **Tabs**: structural rather than pill-shaped.
- **Forms**: compact and readable.
- **Tables / lists**: replace unnecessary card grids.
- **AI / verification / evidence areas**: use a consistent technical-console
  surface in both modes.

The two themes should look like **two native expressions of the same design
system** — not "light mode plus dark mode overrides".

**The final test**: switch between Light and Dark on every major screen —
Dashboard, Projects, Features, Flows, Issue Tracker, AI Assistant, Settings,
Members, Profile, Notifications, and Chat — and the information hierarchy,
spacing, component proportions, interaction states, and visual quality should
remain equally convincing in both modes.
