// One-shot migration: replace every `rb-*` className in RepoBrowserPage.tsx
// with Tailwind utility classes that match the design tokens used elsewhere
// in the app.
//
// Run with: node scripts\rb-to-tailwind.cjs
//
// This rewrites the file in place. Boundaries are word-bounded so
// `rb-entry` does not match inside `rb-entry-name`.

const fs = require("node:fs");
const path = require("node:path");

const FILE = path.resolve(__dirname, "..", "src", "repo-browser", "RepoBrowserPage.tsx");
const src = fs.readFileSync(FILE, "utf8");

// Map of rb-* class name -> Tailwind utility string.
// Order does not matter — each replacement is word-bounded.
const MAP = {
  // ---- page-level layout ----
  "rb-page": "space-y-6",
  "rb-clone-row": "flex flex-wrap items-end gap-3",
  "rb-toolbar": "flex flex-wrap items-end gap-3",
  "rb-grid": "grid gap-4 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)_minmax(0,260px)]",
  "rb-error":
    "rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive",

  // ---- form fields / clone row ----
  "rb-field": "flex flex-col gap-1 text-xs font-medium text-muted-foreground",
  "rb-field-grow": "flex-1 min-w-0",
  "rb-clone-field": "min-w-[260px]",
  "rb-clone-input-wrap": "relative flex items-center",
  "rb-clone-clear":
    "absolute right-2 inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted",
  "rb-clone-btn":
    "inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90",
  "rb-clone-error":
    "flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive",
  "rb-clone-dismiss":
    "ml-auto inline-flex h-5 w-5 items-center justify-center rounded text-destructive hover:bg-destructive/20",

  // ---- external link + pw badge ----
  "rb-external":
    "inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground",
  "rb-pw-badge":
    "inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary",

  // ---- breadcrumbs ----
  "rb-breadcrumbs":
    "flex flex-wrap items-center gap-1 text-xs text-muted-foreground",
  "rb-crumb-home":
    "inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground",
  "rb-crumb-row": "inline-flex items-center gap-1",
  "rb-crumb":
    "inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground",
  "rb-crumb-active": "bg-muted text-foreground",

  // ---- shared card chrome ----
  "rb-card-header":
    "flex items-center justify-between gap-2 border-b border-border px-4 py-2 text-sm font-medium text-foreground",
  "rb-card-meta": "text-xs font-normal text-muted-foreground",
  "rb-empty":
    "px-4 py-6 text-center text-xs text-muted-foreground",
  "rb-discard":
    "inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted",

  // ---- tree panel ----
  "rb-tree-card":
    "flex max-h-[calc(100vh-22rem)] flex-col rounded-lg border border-border bg-card overflow-hidden",
  "rb-tree": "flex-1 overflow-y-auto p-1 text-sm",
  "rb-entry":
    "flex w-full items-center gap-2 rounded px-2 py-1 text-foreground hover:bg-muted",
  "rb-entry-active": "bg-muted text-foreground",
  "rb-entry-name": "truncate",
  "rb-entry-meta": "ml-auto text-xs text-muted-foreground",

  // ---- viewer panel ----
  "rb-viewer-card":
    "flex min-h-[400px] flex-col rounded-lg border border-border bg-card overflow-hidden",
  "rb-viewer": "flex-1 overflow-auto",
  "rb-placeholder":
    "flex h-full items-center justify-center p-6 text-sm text-muted-foreground",
  "rb-pill":
    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
  "rb-pill-dirty":
    "bg-amber-500/10 text-amber-700 dark:text-amber-300",

  // ---- outline panel ----
  "rb-outline-card":
    "flex max-h-[calc(100vh-22rem)] flex-col rounded-lg border border-border bg-card overflow-hidden",
  "rb-outline": "flex-1 overflow-y-auto p-1 text-sm",
  "rb-outline-row": "flex items-center gap-2 px-2 py-1 hover:bg-muted",
  "rb-outline-line":
    "w-8 text-right text-xs tabular-nums text-muted-foreground",
  "rb-outline-kind":
    "inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground",
  "rb-outline-name": "flex-1 truncate",
  "rb-outline-play":
    "inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-primary/10 hover:text-primary",
  "rb-outline-run-all":
    "inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted",

  // ---- env drawer ----
  "rb-env-drawer": "fixed inset-0 flex pointer-events-none",
  "rb-env-drawer-open": "pointer-events-auto",
  "rb-env-backdrop": "fixed inset-0 bg-black/40",
  "rb-env-panel":
    "pointer-events-auto relative ml-auto flex h-full w-full max-w-md flex-col border-l border-border shadow-lg bg-card",
  "rb-env-header":
    "flex items-center justify-between gap-2 border-b border-border px-4 py-3",
  "rb-env-header-actions": "flex items-center gap-1",
  "rb-env-toggle":
    "inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted",
  "rb-env-close":
    "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground",
  "rb-env-body": "flex-1 overflow-y-auto p-4 space-y-4",
  "rb-token-section": "space-y-3",
  "rb-token-section-header":
    "flex items-center justify-between gap-2",
  "rb-token-row": "flex items-center gap-2",
  "rb-token-input":
    "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
  "rb-token-clear":
    "inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted",
  "rb-token-hint": "text-xs text-muted-foreground",
  "rb-env-divider": "border-border",
  "rb-env-hint": "text-xs text-muted-foreground",
  "rb-env-inputs": "space-y-2",
  "rb-env-input-row": "flex flex-wrap items-end gap-2",
  "rb-env-input":
    "flex flex-col gap-1 text-xs font-medium text-muted-foreground",
  "rb-env-input-grow": "flex-1 min-w-[160px]",
  "rb-env-actions": "flex justify-end",
  "rb-env-add":
    "inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90",
  "rb-env-list": "space-y-1.5",
  "rb-env-row":
    "flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2",
  "rb-env-row-key": "font-mono text-xs",
  "rb-env-row-value":
    "flex-1 truncate font-mono text-xs text-muted-foreground",
  "rb-env-eq": "text-xs text-muted-foreground",
  "rb-env-row-remove":
    "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive",

  // ---- run drawer ----
  "rb-run-drawer":
    "fixed bottom-0 left-0 right-0 z-40 flex justify-center px-4 pb-4 pointer-events-none",
  "rb-run-drawer-open": "pointer-events-auto",
  "rb-run-drawer-running": "",
  "rb-run-drawer-collapsed": "max-w-md",
  "rb-run-backdrop": "fixed inset-0 z-40 bg-black/40",
  "rb-run-panel":
    "pointer-events-auto relative z-50 flex w-full max-w-3xl flex-col rounded-lg border border-border bg-card shadow-lg overflow-hidden",
  "rb-run-header":
    "flex items-center justify-between gap-2 border-b border-border px-4 py-2",
  "rb-run-toggle":
    "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted",
  "rb-run-label":
    "text-xs font-medium text-muted-foreground truncate",
  "rb-run-header-actions": "flex items-center gap-1",
  "rb-inline-stop":
    "inline-flex items-center gap-1 rounded-md bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground hover:bg-destructive/90",
  "rb-inline-clear":
    "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted",
  "rb-run-close":
    "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted",
  "rb-run-body": "max-h-[40vh] overflow-y-auto",
};

// Sort keys longest-first so `rb-entry-active` is replaced before
// `rb-entry` (otherwise the partial match would corrupt the longer name).
const keys = Object.keys(MAP).sort((a, b) => b.length - a.length);

let out = src;
let totalReplacements = 0;
const counts = {};

for (const key of keys) {
  // Match the key as a whole word inside a className. Boundary characters
  // we treat as separators — covers both `className="rb-foo"` and
  // `className="rb-foo rb-bar"` and template literals like
  // `${isOpen ? " rb-foo" : ""}`.
  const re = new RegExp(
    `(^|[\\s"\\'])` + key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&") + `(?=[\\s"\\']|$)`,
    "g",
  );
  const before = out;
  out = out.replace(re, (_, prefix) => prefix + MAP[key]);
  const diff = (before.length - out.length) * -1; // not meaningful, count via match instead
  const matched = (before.match(re) || []).length;
  counts[key] = matched;
  totalReplacements += matched;
}

fs.writeFileSync(FILE, out, "utf8");

console.log(`Replaced ${totalReplacements} occurrences across ${Object.keys(counts).length} classes.`);
for (const key of keys) {
  if (counts[key]) console.log(`  ${key.padEnd(28)} -> ${counts[key]}`);
}