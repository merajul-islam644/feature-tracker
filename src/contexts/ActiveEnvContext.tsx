// Active project environment — the (projectId, envSlug) pair that the
// Issue Tracker is currently scoped to. Set by EnvSync (and the
// ProjectDetailPage tree) when the URL resolves to
// `/projects/:projectId/:envSlug`, and read by the Issue Tracker data
// hooks to filter targets / secrets / issues to the right env.
//
// URL is the ONLY source of truth (page-scoped fetching policy, user
// directive 2026-10-01: a page should only issue the data calls its own
// content needs). EnvSync clears the context on every non-env route, so
// `env` is non-null exactly while a project-env route is mounted — the
// env-scoped tracker queries never fire on /projects, /dashboard, /chat,
// etc. There is deliberately NO localStorage-mirror hydration and NO
// cloud→local promote: both used to resurrect a stale pair on pages that
// had no env in their URL, which made the app-wide tracker reads fire
// against a project the current page never asked about. A hard refresh
// on a 4-segment tracker route doesn't need a mirror — the URL carries
// the pair and EnvSync re-applies it on mount.
//
// Persistence (v2.1): `UserPreference.activeEnvironmentId` — the env's
// row identity in `blx_Environments`, via `useActiveEnvironment` — is
// still WRITTEN here (local → cloud) so the user's last env follows them
// across devices and the walker can read it. The sync is one-directional
// by design: nothing on the read path promotes the stored id back into
// session state. The preference + env-row reads are gated on `env` being
// set, so pages without an env issue zero preference/env-table reads.
//
// Loop safety: `setEnv` only touches local state — the cloud write
// happens in a reconcile effect that fires only when the resolved row id
// actually differs from the persisted preference, and `setEnv` is
// referentially stable so downstream URL-sync effects fire once per
// navigation, not per render.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  useActiveEnvironment,
  useAllEnvironments,
} from "@/lib/blocks/hooks";

export interface ActiveEnv {
  projectId: string;
  envSlug: string;
}

interface ActiveEnvContextValue {
  env: ActiveEnv | null;
  setEnv: (env: ActiveEnv | null) => void;
}

const ActiveEnvContext = createContext<ActiveEnvContextValue | null>(null);

export function ActiveEnvProvider({ children }: { children: ReactNode }) {
  // No hydration from storage — the URL (via EnvSync) is the only writer.
  // First paint on any page starts with `null`; on env routes EnvSync's
  // effect applies the URL pair within the same commit cycle.
  const [env, setEnvState] = useState<ActiveEnv | null>(null);

  // Preference id (UserPreference.activeEnvironmentId) + its setter, and
  // the full Environment row list the pair↔id resolution needs. Both
  // reads are gated on `env` — they only matter while an env is actually
  // active, so pages outside a project env issue neither call.
  const envActive = env !== null;
  const { activeEnvironmentId, setActiveEnvironment } = useActiveEnvironment({
    enabled: envActive,
  });
  const allEnvsQuery = useAllEnvironments({ enabled: envActive });
  const allEnvs = allEnvsQuery.data ?? [];

  // Hold the latest setter in a ref so the reconcile effect can fire the
  // preference write without depending on its (render-churned) identity.
  const saveRef = useRef(setActiveEnvironment);
  useEffect(() => {
    saveRef.current = setActiveEnvironment;
  }, [setActiveEnvironment]);

  // Local → cloud: when the active env changes (URL navigation) and its
  // row has resolved, persist the row id. Null is NOT persisted — a
  // cleared session env is transient; the preference keeps the last env
  // so another device (or the walker) can see where the user was.
  useEffect(() => {
    if (!env) return;
    const row = allEnvs.find(
      (e) => e.projectId === env.projectId && e.slug === env.envSlug,
    );
    if (row && row.id !== activeEnvironmentId) {
      saveRef.current(row.id);
    }
  }, [env, allEnvs, activeEnvironmentId]);

  // Stable setter — local state only. No mutation identity in the
  // closure, so `setEnv` never changes (downstream effects that depend
  // on it — e.g. ProjectDetailPage's URL→context sync — fire once per
  // navigation, not per render).
  const setEnv = useCallback((next: ActiveEnv | null) => {
    setEnvState(next);
  }, []);

  const value = useMemo<ActiveEnvContextValue>(
    () => ({ env, setEnv }),
    [env, setEnv],
  );
  return (
    <ActiveEnvContext.Provider value={value}>
      {children}
    </ActiveEnvContext.Provider>
  );
}

/** Returns the raw context (env + setter). Mostly used by the page
 *  that owns the env (ProjectDetailPage) to push the URL params into
 *  state. Component code that just wants to read should use
 *  `useActiveEnv()`. */
export function useActiveEnvContext(): ActiveEnvContextValue {
  const ctx = useContext(ActiveEnvContext);
  if (!ctx) {
    throw new Error(
      "useActiveEnvContext must be used inside <ActiveEnvProvider>.",
    );
  }
  return ctx;
}

/** Returns the active env or `null` if no project env is active.
 *  Reads are pure and safe to call from any component rendered under
 *  the AppLayout root. */
export function useActiveEnv(): ActiveEnv | null {
  return useActiveEnvContext().env;
}
