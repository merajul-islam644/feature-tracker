// i18n shim for the ported TestPilot workbench.
//
// TestPilot's workbench calls its own `useT()` (returns `{ t }`) and a
// standalone `translate(key)` from `lib/i18n/LocalizationProvider`.
// Lattice's i18n exposes `useT()` returning the t function directly with
// (key, fallback) resolution. This shim adapts the shapes: the workbench
// renders its English fallbacks through Lattice's dictionary lookup, and
// the few bare `translate("key")` toast strings in the ported store get
// small English fallbacks instead of leaking raw keys into the UI.

export type TranslationKey = string;

// English fallbacks for every key the ported workbench calls WITHOUT an
// explicit fallback argument. Values mirror TestPilot's own dictionary so
// the ported chrome reads exactly like production TestPilot; Lattice's
// Blocks dictionary never needs to carry them.
const FALLBACKS: Record<string, string> = {
  "status.failed": "Failed",
  "status.passed": "Passed",
  "status.skipped": "Skipped",
  "common.failed": "failed",
  "common.cancel": "Cancel",
  "common.delete": "Delete",
  "common.duration": "Duration",
  "common.loading": "Loading",
  "run.cancel": "Cancel run",
  "run.cases": "Test cases",
  "run.cases.collapseAll": "Collapse all",
  "run.cases.expandAll": "Expand all",
  "run.noCases": "No case results recorded for this run.",
  "run.notRun": "Not run",
  "run.openIssue": "Open issue",
  "run.openRun": "Open run",
  "run.runningNow": "Running…",
  "tests.baseURL": "Base URL",
  "tests.baseURLPlaceholder": "https://app-under-test.example.com",
  "tests.noSpecs": "No *.spec.* or *.test.* files in this workspace to run.",
  "tests.results": "Results",
  "tests.run": "Run Tests",
  "tests.runnerOff": "Local runner: off",
  "tests.runnerOnline": "Runner online",
  "tests.running": "Running…",
  "tests.save": "Save file",
  "tests.tooManySpecs": "More than {max} spec files — running the first {max} (runner limit).",
  "toast.runCancelled": "Run cancelled",
  "toast.specSaved": "Spec saved",
  "toast.syncFailed": "Blocks sync failed — it will retry on the next load.",
};

export function translate(
  key: TranslationKey,
  vars?: Record<string, unknown>,
): string {
  const base = FALLBACKS[key] ?? key;
  if (!vars) return base;
  return base.replace(/\{(\w+)\}/g, (_, k: string) =>
    vars[k] !== undefined ? String(vars[k]) : `{${k}}`,
  );
}

import { useT as useLatticeT } from "@/lib/blocks/i18n";

export function useT(): {
  t: (key: TranslationKey, fallback?: string) => string;
} {
  const latticeT = useLatticeT();
  return {
    // Route through `translate` so keys without an explicit fallback
    // resolve from FALLBACKS (English) instead of leaking the raw key
    // when Lattice's dictionary doesn't carry it. An explicit fallback
    // still wins.
    t: (key: TranslationKey, fallback?: string) =>
      latticeT(fallback ?? translate(key)),
  };
}
