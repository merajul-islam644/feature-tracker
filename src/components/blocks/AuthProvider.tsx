// Single source of truth for auth state in the React tree. Backed by the
// Blocks SDK, so the actual session lives in IAM (Secure, httpOnly cookie) —
// never in `localStorage` or `sessionStorage`. Status is driven by calls to
// `userInfo()`; we never infer it from a stored token.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { BlocksOidcUserInfo } from "@seliseblocks/client";
import {
  fetchSessionClaims,
  fetchUserRoles,
  logout as sdkLogout,
  startLogin as sdkStartLogin,
} from "@/lib/blocks/auth";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

// Shape consumers depend on. Mirrors the previous `useAuth().currentUser` so
// pages like ProfilePage, DashboardPage, and Topbar keep working unchanged.
export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
  // IAM roles for the signed-in user (e.g. `["manager"]`, `["tester"]`).
  // Populated by `AuthProvider.refresh()` from the IAM user record — the
  // OIDC userInfo payload does NOT include roles, so this is a separate
  // lookup that runs alongside the session-claims fetch. Default `[]`
  // when the lookup has not yet completed or IAM didn't return any.
  roles: string[];
}

interface AuthContextValue {
  status: AuthStatus;
  user: CurrentUser | null;
  claims: BlocksOidcUserInfo | null;
  login: (returnTo?: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STATUS_POLL_MS = 5 * 60 * 1000; // backup interval; visibility refresh is the primary signal.

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [claims, setClaims] = useState<BlocksOidcUserInfo | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  // Guard against re-entrant `refresh()` calls from polling + visibility +
  // explicit clicks all firing together.
  const inflight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (inflight.current) return inflight.current;
    const run = (async () => {
      const next = await fetchSessionClaims();
      setClaims(next);
      setStatus(next ? "authenticated" : "unauthenticated");
      // Roles ride alongside the session check. Only fire the IAM
      // lookup when there's a real session — an unauthenticated poll
      // shouldn't waste a request on a 401-bound call. We hit
      // `iam.me()` which resolves the user id from the session
      // cookie, so we don't need to forward the OIDC `sub`.
      if (next) {
        const nextRoles = await fetchUserRoles(undefined);
        setRoles(nextRoles);
      } else {
        setRoles([]);
      }
    })();
    inflight.current = run;
    try {
      await run;
    } finally {
      inflight.current = null;
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(() => {
      refresh();
    }, STATUS_POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  const login = useCallback(async (returnTo?: string) => {
    await sdkStartLogin(returnTo ?? "/");
  }, []);

  const logout = useCallback(async () => {
    await sdkLogout();
    setClaims(null);
    setRoles([]);
    setStatus("unauthenticated");
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user: claims ? toCurrentUser(claims, roles) : null,
      claims,
      login,
      logout,
      refresh,
    }),
    [status, claims, roles, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuthContext must be used inside <AuthProvider>.");
  }
  return ctx;
}

function toCurrentUser(claims: BlocksOidcUserInfo, roles: string[]): CurrentUser {
  const email = typeof claims.email === "string" ? claims.email : "";
  const name =
    typeof claims.name === "string" && claims.name.length > 0
      ? claims.name
      : deriveNameFromEmail(email);
  const sub = typeof claims.sub === "string" ? claims.sub : email;
  return {
    id: sub,
    name,
    email,
    avatarUrl: typeof claims.picture === "string" ? claims.picture : undefined,
    // OIDC `userInfo()` does not carry timestamps; surface a stable placeholder
    // so `formatRelativeDate` renders sensibly until IAM adds these.
    createdAt:
      typeof claims.iat === "number"
        ? new Date(claims.iat * 1000).toISOString()
        : new Date(0).toISOString(),
    updatedAt:
      typeof claims.iat === "number"
        ? new Date(claims.iat * 1000).toISOString()
        : new Date(0).toISOString(),
    roles,
  };
}

function deriveNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  if (!local) return email || "Signed-in user";
  return local
    .split(/[._\-+]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
