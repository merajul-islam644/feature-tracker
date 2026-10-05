// Tiny presentational badge — distinguishes Playwright-authored runs
// (`<ScriptBadge kind="playwright" />`) from AI verification runs
// (`<ScriptBadge kind="verification" />`) in the History list. One line
// of styling, no logic; lives in its own file so the import path in
// RunHistory reads naturally and a future colour/spelling change is one
// edit instead of a multi-file search.

import type { RunKind } from "@/types/issue-tracker";
import { cn } from "@/lib/utils";

const LABEL: Record<RunKind, string> = {
  playwright: "Playwright",
  verification: "AI",
};

const TONE_CLASS: Record<RunKind, string> = {
  // Both pills use the muted border + ink pattern so they read as the
  // same component family; the colour difference is just enough to
  // distinguish "human script" (sky/blue) from "AI walk" (amber/warm).
  // Plain Tailwind palette tokens — no theme overrides needed.
  playwright:
    "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
  verification:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
};

interface Props {
  kind: RunKind;
  className?: string;
}

export function ScriptBadge({ kind, className }: Props) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        TONE_CLASS[kind],
        className,
      )}
      aria-label={`Run kind: ${LABEL[kind]}`}
      title={`Run kind: ${LABEL[kind]}`}
    >
      {LABEL[kind]}
    </span>
  );
}