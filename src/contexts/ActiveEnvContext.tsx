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
//
// Persistence (v2): the canonical store is the `SecretBinding` row at
// the `__active__::` sentinel scope (see `useActiveEnvSelection` in
// `src/lib/blocks/hooks.ts`). The active env is per-user — same
// reasoning as the notepad / custom verification checks — so we keep
// the row inside `SecretBinding` instead of adding a fifth schema.
// A `lattice.mirror.active-env.v1` mirror under the same shape is
// written synchronously on each set so cold-boot reads it before the
// cloud query resolves. Cross-tab sync via the `storage` event is
// retained for the mirror.

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
  useActiveEnvSelection,
  useSaveActiveEnvSelection,
} from "@/lib/blocks/hooks";

export interface ActiveEnv {
  projectId: string;
  envSlug: string;
}

interface ActiveEnvContextValue {
  env: ActiveEnv | null;
  setEnv: (env: ActiveEnv | null) => void;
}

const ACTIVE_ENV_MIRROR_KEY = "lattice.mirror.active-env.v1";

function readMirrorEnv(): ActiveEnv | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ACTIVE_ENV_MIRROR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as ActiveEnv).projectId === "string" &&
      typeof (parsed as ActiveEnv).envSlug === "string"
    ) {
      return {
        projectId: (parsed as ActiveEnv).projectId,
        envSlug: (parsed as ActiveEnv).envSlug,
      };
    }
  } catch {
    // Corrupt JSON / private mode — fall through to null.
  }
  return null;
}

function writeMirrorEnv(env: ActiveEnv | null): void {
  if (typeof window === "undefined") return;
  try {
    if (env === null) {
      window.localStorage.removeItem(ACTIVE_ENV_MIRROR_KEY);
    } else {
      window.localStorage.setItem(
        ACTIVE_ENV_MIRROR_KEY,
        JSON.stringify(env),
      );
    }
  } catch {
    // best-effort
  }
}

const ActiveEnvContext = createContext<ActiveEnvContextValue | null>(null);

export function ActiveEnvProvider({ children }: { children: ReactNode }) {
  // Hydrate from the localStorage mirror so a hard refresh on
  // `/issue-tracker/*` (or any other env-only path that doesn't carry
  // the (projectId, envSlug) pair in the URL) doesn't kick the user
  // out of their env. The cloud read below replaces the value once it
  // resolves — so a different device sees the right env on next load.
  const [env, setEnvState] = useState<ActiveEnv | null>(() => readMirrorEnv());

  const cloudSelection = useActiveEnvSelection();
  const saveCloudSelection = useSaveActiveEnvSelection();

  // Hold the latest `mutateAsync` in a ref so `setEnv`'s identity is
  // stable across renders. Without this, the `useCallback` below would
  // recreate `setEnv` whenever TanStack Query hands us a new mutation
  // object, which would re-fire downstream effects that depend on
  // `setEnv` (e.g. ProjectDetailPage's URL→context effect), which would
  // re-fire this mutation, which would re-invalidate, which would
  // re-fetch the cloud read — a feedback loop that surfaces as
  // "Maximum update depth exceeded" on any project env URL.
  const mutateRef = useRef(saveCloudSelection.mutateAsync);
  useEffect(() => {
    mutateRef.current = saveCloudSelection.mutateAsync;
  }, [saveCloudSelection.mutateAsync]);

  // Promote the cloud read into local state + mirror once it resolves.
  // Guard against identity churn: only commit when the cloud value
  // actually differs from the current local state — otherwise a
  // refetch after the user pushes a new env would just re-create the
  // state object reference and trip downstream effects (see above).
  useEffect(() => {
    if (cloudSelection.data === undefined) return;
    setEnvState((prev) => {
      const next = cloudSelection.data;
      if (
        (prev === null && next === null) ||
        (prev !== null &&
          next !== null &&
          prev.projectId === next.projectId &&
          prev.envSlug === next.envSlug)
      ) {
        return prev;
      }
      writeMirrorEnv(next);
      return next;
    });
  }, [cloudSelection.data]);

  // Stable setter — never recreated. Reads the latest `mutateAsync`
  // through `mutateRef.current` so callers don't depend on the
  // mutation object's identity either.
  const setEnv = useCallback((next: ActiveEnv | null) => {
    setEnvState(next);
    writeMirrorEnv(next);
    void mutateRef.current(next);
  }, []);

  // Cross-tab sync. The `storage` event fires ONLY on the tabs that
  // didn't write the change, so within-tab updates keep flowing
  // through `setEnv` above without retriggering this handler.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== ACTIVE_ENV_MIRROR_KEY) return;
      setEnvState(readMirrorEnv());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
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
