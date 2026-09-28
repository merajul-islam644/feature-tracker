// Active project environment — the (projectId, envSlug) pair that the
// Issue Tracker is currently scoped to. Set by ProjectDetailPage when
// the URL resolves to `/projects/:projectId/:envSlug`, and read by
// the Issue Tracker data hooks to filter targets / secrets / issues
// to the right env.
//
// The provider lives at the AppLayout root so it survives navigation
// between `/projects/:id/:envSlug` and the Issue Tracker sub-routes
// (`/issue-tracker/*`). Once set, the env stays active until the user
// navigates away from both — the consumer decides whether to clear
// (e.g. on `/dashboard`) or keep (e.g. on `/issue-tracker/*`). Today
// nothing clears it: leaving the project simply means the Issue
// Tracker menu hides (URL-based gate in AppSidebar) and the hook
// filter is a no-op because no consumer is reading.
//
// Outside a project env the context returns `null`. Hooks that depend
// on it should treat `null` as "no data" (empty list, no mutations
// allowed) rather than throwing — callers already handle this in
// production.

import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

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
  const [env, setEnv] = useState<ActiveEnv | null>(null);
  const value = useMemo<ActiveEnvContextValue>(
    () => ({ env, setEnv }),
    [env],
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
