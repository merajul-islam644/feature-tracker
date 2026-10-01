# apps-website

Public-facing website for the **Feature Tracker** app (sibling to the main
React app at the repo root).

## Status

**Scaffold only.** No design direction, no real content, no page structure
yet — all of that lands once the design call is made.

## Stack

- React 18 + JavaScript (no TypeScript)
- Vite 5 (dev server on **port 5180**, deliberately offset from the main
  app's 5173 so both can run side-by-side during local development)
- Tailwind CSS 3 (wired through PostCSS; design tokens land in
  `tailwind.config.js` once the visual direction is set)

## Scripts

```bash
npm install     # one-time, after the scaffold lands
npm run dev     # local dev server on http://localhost:5180
npm run build   # production build → dist/
npm run preview # serve the production build locally
```

## Layout

```
apps-website/
├── index.html
├── package.json
├── postcss.config.js
├── tailwind.config.js
├── vite.config.js
└── src/
    ├── App.jsx        # placeholder landing surface
    ├── main.jsx       # entry — mounts <App />
    └── index.css      # Tailwind layers + future global styles
```

## Pending decisions (waiting on the user)

- **Purpose / page structure** — marketing landing, docs site, both, or
  something else
- **Visual direction** — colors, typography, layout, references
- **Content** — copy, screenshots, CTAs

The current `App.jsx` is intentionally a single placeholder screen so the
scaffold boots without committing to any of the above.
