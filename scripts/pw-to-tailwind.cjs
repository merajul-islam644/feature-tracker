// One-shot migration: replace every `pw-*` className in PlaywrightPage.tsx
// with Tailwind utility classes matching the design tokens used elsewhere
// in the app.
//
// Run with: node scripts\pw-to-tailwind.cjs
//
// Boundaries are word-bounded so `pw-editor` does not match inside
// `pw-editor-card` or `data-pw-action`, and the literal selector strings
// in the SCRIPT_LIBRARY (".pw-card-header", ".pw-editor-card", etc.) are
// not touched because they're preceded by a `.`.

const fs = require("node:fs");
const path = require("node:path");

const FILE = path.resolve(__dirname, "..", "src", "playwright", "PlaywrightPage.tsx");
const src = fs.readFileSync(FILE, "utf8");

const MAP = {
  // ---- summary tally row ----
  "pw-summary":
    "flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs",
  "pw-summary-stats": "flex flex-wrap items-center gap-2",
  "pw-summary-pill":
    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium",
  "pw-summary-pill-pass":
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  "pw-summary-pill-fail":
    "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  "pw-summary-pill-total": "border-border bg-background text-muted-foreground",
  "pw-summary-verdict":
    "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-xs font-semibold uppercase tracking-wider",
  "pw-summary-verdict-pass":
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  "pw-summary-verdict-fail":
    "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  "pw-summary-verdict-running":
    "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  "pw-summary-verdict-empty": "border-border bg-muted text-muted-foreground",

  // ---- toolbar / select ----
  "pw-toolbar": "flex flex-wrap items-end gap-3",
  "pw-select": "flex flex-col gap-1 text-xs font-medium text-muted-foreground",

  // ---- grid + cards ----
  "pw-grid": "grid gap-4 lg:grid-cols-2",
  "pw-editor-card":
    "flex min-h-[400px] flex-col rounded-lg border border-border bg-card overflow-hidden",
  "pw-output-card":
    "flex max-h-[60vh] flex-col rounded-lg border border-border bg-card overflow-hidden",
  "pw-card-header":
    "flex items-center justify-between gap-2 border-b border-border px-4 py-2 text-sm font-medium text-foreground",
  "pw-editor": "flex-1 overflow-auto",
  "pw-editor-disabled": "pointer-events-none opacity-60",
  "pw-empty": "px-4 py-6 text-center text-xs text-muted-foreground",

  // ---- log list ----
  "pw-log-list": "flex-1 overflow-y-auto p-2 space-y-1 text-xs",
  "pw-log":
    "flex flex-col gap-1 rounded-md border border-border bg-background px-3 py-2",
  "pw-log-log": "",
  "pw-log-error": "border-red-500/30 bg-red-500/5",
  "pw-log-expect": "border-blue-500/30 bg-blue-500/5",
  "pw-log-kind":
    "inline-flex w-fit items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground",
  "pw-log-text": "flex flex-col gap-1",
  "pw-log-detail":
    "whitespace-pre-wrap rounded bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground",

  // ---- highlight overlay ----
  "pw-highlight":
    "pointer-events-none fixed z-50 rounded-md border-2 border-blue-500 bg-blue-500/10 transition-all duration-150",
  "pw-highlight-label":
    "absolute -top-6 left-0 inline-flex items-center gap-1 rounded bg-blue-500 px-2 py-0.5 text-[10px] font-medium text-white shadow",
};

// Longest-first so `pw-summary-pill-pass` is replaced before
// `pw-summary-pill`, and `pw-editor-card` before `pw-editor`.
const keys = Object.keys(MAP).sort((a, b) => b.length - a.length);

let out = src;
const counts = {};
let total = 0;

for (const key of keys) {
  const re = new RegExp(
    `(^|[\\s"\\'])` + key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&") + `(?=[\\s"\\']|$)`,
    "g",
  );
  const matched = (out.match(re) || []).length;
  if (matched > 0) {
    out = out.replace(re, (_, prefix) => prefix + MAP[key]);
    counts[key] = matched;
    total += matched;
  }
}

fs.writeFileSync(FILE, out, "utf8");

console.log(`Replaced ${total} occurrences across ${Object.keys(counts).length} classes.`);
for (const key of keys) {
  if (counts[key]) console.log(`  ${key.padEnd(30)} -> ${counts[key]}`);
}