/**
 * Cross-page handoff for "Run this Playwright block" requests.
 *
 * The repo browser has no way to render the runner inline — it lives on
 * `/playwright` behind a separate route. To launch a block from the
 * editor, the browser writes the snippet here, navigates to `/playwright`,
 * and that page consumes the snippet on mount, auto-runs it, then clears
 * the slot so a manual reload of `/playwright` later doesn't re-run the
 * last block.
 *
 * Module state (vs. sessionStorage / URL params):
 *   - The snippet is only valid for the in-app navigation we trigger
 *     ourselves, never across reloads. A module variable enforces that
 *     naturally — reload the browser and it's gone.
 *   - URL params would force us to base64-encode multi-KB source strings.
 *   - sessionStorage would survive unrelated visits and could surprise
 *     the user if a stale snippet leaked into a later session.
 */
export type PendingPlaywrightSource = {
  /** The exact source the user wants executed (already trimmed). */
  source: string;
  /** Display label, used in the runner header so the user can tell
   *  what got launched ("tests/login.spec.ts · test('login works')"). */
  label: string;
  /** Auto-trigger `run()` as soon as the runner is mounted. */
  autoRun: boolean;
};

let pending: PendingPlaywrightSource | null = null;

export function setPendingPlaywrightSource(next: PendingPlaywrightSource): void {
  pending = next;
}

export function consumePendingPlaywrightSource(): PendingPlaywrightSource | null {
  const current = pending;
  pending = null;
  return current;
}