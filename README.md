# Feature Tracker

A SaaS-style workspace for tracking **Projects → Features → Flows** with a clean, modern UI.

## Stack

- Vite + React 18 + TypeScript
- React Router v6
- Tailwind CSS
- Zustand (state + localStorage persistence)
- React Hook Form + Zod (validation)
- lucide-react (icons)

## Getting Started

```bash
npm install
npm run dev
```

Then open the URL Vite prints (default: http://localhost:5173).

## Demo Login

Any non-empty email + password signs you in as the seeded demo user.

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — type-check and build for production
- `npm run preview` — preview the production build
- `npm run typecheck` — type-check only

## Project Structure

```
src/
├── components/
│   ├── layout/     # Topbar, Sidebar, AppLayout
│   ├── ui/         # Button, Input, Modal, Toast, etc.
│   ├── project/    # ProjectCard, CreateProjectModal, ...
│   ├── feature/    # FeatureList, FeatureItem, ...
│   └── flow/       # FlowItem, AddFlowModal
├── pages/          # Login, Dashboard, Projects, ProjectDetail, Profile
├── store/          # auth, data, ui (zustand)
├── lib/            # validation, seed, utils
├── hooks/          # useAuth, useToast
└── types/          # shared TypeScript types
```