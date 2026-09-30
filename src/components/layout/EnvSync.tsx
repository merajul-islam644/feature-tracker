// URL → ActiveEnv sync. Mounts once at AppLayout root so the active
// project env is stamped from the URL on EVERY navigation, including
// the 4-segment Issue Tracker sub-routes (`/projects/:id/:envSlug/<key>`)
// where the ProjectDetailPage tree doesn't sit.
//
// Why this exists: the 4-segment sub-routes (`targets`, `secrets`,
// `scope`, `panel`, `history`, `issues`) live in their own page
// components — none of them mount ProjectDetailPage, and the legacy
// per-page `setEnv` calls only fire on the 3-segment catch-all and
// the dedicated `/features` route. A user landing directly on
// `/projects/<id>/dev/targets` after the mirror last held `stg` would
// otherwise see the wrong-env target list and silently edit the
// wrong row. ProjectDetailPage's own effect still runs for the
// 3-segment landing — this component is idempotent with it (same
// setter, same payload), so keeping the page-level effect around is
// harmless.
//
// Outside a project env URL the component clears the context, so
// leaving `/projects/<id>/<env>` (e.g. to `/dashboard`) drops the
// env. Hooks that depend on it already treat `null` as "no data"
// (empty list, no mutations allowed) — see `ActiveEnvContext` for
// the policy.

import { useEffect } from "react";
import { matchPath, useLocation } from "react-router-dom";
import { useActiveEnvContext } from "@/contexts/ActiveEnvContext";

// Match every project env route, including the dedicated features page
// and the Issue Tracker sub-routes. The trailing `/*` swallows any
// 4th segment (and the rare 5th, if one ever ships). `info` and other
// env-less project pages do NOT match — they keep the env untouched
// (ProjectDetailPage itself decides what to push for its own URL).
const PROJECT_ENV_PATTERN = "/projects/:projectId/:envSlug/*";

function readEnvFromPath(pathname: string): {
  projectId: string;
  envSlug: string;
} | null {
  const match = matchPath(
    { path: PROJECT_ENV_PATTERN, caseSensitive: false, end: false },
    pathname,
  );
  if (!match || !match.params) return null;
  const { projectId, envSlug } = match.params as {
    projectId?: string;
    envSlug?: string;
  };
  if (!projectId || !envSlug) return null;
  return { projectId, envSlug };
}

export function EnvSync() {
  const { setEnv } = useActiveEnvContext();
  const { pathname } = useLocation();

  // Only the env pair matters for the dependency diff — re-running the
  // effect on every pathname change would still work, but would also
  // re-fire when the user navigates between sibling sub-routes on the
  // same env (no-op write, plus a `useActiveEnvSelection` mutation
  // round-trip). The pair is the actual change unit.
  const next = readEnvFromPath(pathname);
  const nextKey = next ? `${next.projectId}/${next.envSlug}` : "";

  useEffect(() => {
    setEnv(next);
    // `next` is derived from `pathname` and the route table — listing
    // only the key keeps the effect's dependency narrow while still
    // catching every URL change that touches the (projectId, envSlug)
    // pair.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextKey, setEnv]);

  return null;
}