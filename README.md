# Lattice

A SELISE Blocks-based SaaS workspace covering the software delivery lifecycle
in one app: track **Projects → Environments → Features → Flows**, verify
deployed targets against checklists, manage the issues that fall out, and
write the fix — in a built-in VS Code-style workbench with an embedded AI
agent.

## What's inside

- **Dashboard** — workspace metrics, recent projects/features, announcements.
- **Projects** — each project carries environments (dev/stg/prod/uat + custom);
  every env-scoped surface hangs off `/projects/:id/:env/...`.
- **Features & Flows** — the spec hierarchy: what's being built and how it
  behaves, with per-environment workflow states (author → manager review).
- **Issue Tracker** (project + env scoped):
  - *Targets* — deployed URLs under verification
  - *Secrets* — per-target credentials
  - *Scopes* — verification checklists
  - *History* — past verification runs
  - *Issues* — GitHub-style drag-and-drop board with assignment-based
    visibility and date-only grouping
- **Workspace (Panel)** — a VS Code-style editor: file tree, tabs, Monaco /
  CodeMirror editing, integrated terminal (xterm + node-pty), git source
  control, command palette, problems view. The embedded AI agent proposes
  file edits as reviewable diffs (never writes disk directly), runs commands,
  and drives the browser through the local runner.
- **Team surfaces** — chat with calls, inbox mail (real inbound addresses via
  the bundled `mail-server`), notepad (text + spreadsheet pads),
  notifications.
- **IAM & platform** — hosted OIDC login (SELISE Blocks IAM), users,
  organizations, roles & permissions (manager / developer / tester — the
  sidebar adapts per role), members directory, localization (i18n with a
  language switcher).

## Stack

- Vite + React 18 + TypeScript
- React Router v6, TanStack Query
- Tailwind CSS + Radix UI primitives
- Zustand (state + localStorage persistence)
- React Hook Form + Zod
- Monaco Editor / CodeMirror 6, xterm.js
- `@seliseblocks/client` SDK — data gateway, IAM, notifier, mail, localization

## Local services

Two companion Node processes back the browser-side features:

| Service | Entry | Purpose |
| --- | --- | --- |
| Runner | `runner/server.mjs` | Express + Playwright + node-pty + LSP bridge: executes test suites headlessly, hosts workspace terminals, serves the AI tool loop's exec/browse transport |
| Mail bridge | `mail-server/server.mjs` | Gives every user a real routable email address (tempmail.lol bridge by default, Cloudflare Email Routing for production) and pulls inbound mail into `/mail` |

## Getting Started

```bash
npm install
cp .env.example .env   # fill in the VITE_BLOCKS_* values
npm run dev:all        # UI + runner together
```

Open the URL Vite prints. Plain HTTP/localhost cannot receive the hosted
login session cookie — see the local-HTTPS setup (`npm run cert`) if login
redirects back without signing in.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `VITE_BLOCKS_API_URL` | Blocks Data/IAM API base URL |
| `VITE_BLOCKS_KEY` | Project API key |
| `VITE_BLOCKS_OIDC_URL` | Hosted login (OIDC) base URL |
| `VITE_BLOCKS_OIDC_CLIENT_ID` | This app's OIDC client id |
| `VITE_BLOCKS_APP_DOMAIN` | App domain used for session/redirect handling |
| `VITE_BLOCKS_DEV_HOST` / `VITE_BLOCKS_DEV_PORT` | Dev-server host/port overrides |

## Login

Sign-in goes through the **SELISE Blocks hosted login** (IAM OIDC):
`redirectToProvider` → IAM → `/login/callback` → session. There is no local
demo account; users come from the connected Blocks project.

## Scripts

- `npm run dev` — start the dev server (UI only)
- `npm run dev:all` — dev server + runner together
- `npm run runner` — runner service only
- `npm run dev:server` — mail bridge only
- `npm run build` — type-check and build for production
- `npm run preview` — preview the production build
- `npm run typecheck` — type-check only

## Project Structure

```
src/
├── components/
│   ├── layout/      # AppLayout, AppSidebar, Topbar, OrgSwitcher, ...
│   ├── ui/          # Button, Input, Modal, Toast, table primitives, ...
│   ├── project/     # ProjectCard, CreateProjectModal, env chips, ...
│   ├── feature/     # FeatureList, details drawer, env workflows, ...
│   ├── flow/        # FlowItem, details drawer, comments, ...
│   ├── issue-tracker/ # IssueCard, VerificationPanel, EvidenceViewer, ...
│   ├── team-chat/   # ChatThread, CallDialog, EmojiPicker, ...
│   ├── notepad/     # pad create/delete modals
│   └── settings/    # AI avatar widgets
├── features/
│   └── workbench/   # the VS Code-style editor: activity bar, editor host,
│                    #   terminal, source control, problems, AI panel,
│                    #   command palette, runner/LSP clients
├── pages/           # Login, Dashboard, Projects, ProjectDetail, Features,
│                    #   Chat, Mail, Notepad*, Members/Users/Organizations/
│                    #   Roles, Settings, Profile + pages/issue-tracker/
├── lib/
│   ├── blocks/      # @seliseblocks/client wiring: config, hooks, i18n,
│   │                #   notifier, users, auth context
│   ├── runner/      # HTTP client for the runner service
│   └── workspace/   # local-folder (FSA) workspace handling
├── store/           # zustand stores
├── hooks/           # useAuth, useToast, ...
└── types/           # shared TypeScript types + Blocks schema types

runner/              # Playwright runner + terminal PTY + LSP bridge (Express)
server/              # mail bridge (Express)
```
