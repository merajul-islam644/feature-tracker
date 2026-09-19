// Backwards-compatible `useAuth` hook for the existing app code. Backs onto
// `AuthProvider` (which owns the real session cookie); preserves the original
// return shape so pages like ProfilePage, DashboardPage, Topbar, and
// CreateProjectModal keep working without per-callsite rewrites.

import { useEffect, type ReactElement } from "react";
import { Navigate, useLocation } from "react-router-dom";
import {
  useAuthContext,
  type CurrentUser,
} from "@/components/blocks/AuthProvider";

interface UseAuthReturn {
  currentUser: CurrentUser | null;
  isHydrated: boolean;
  isAuthenticated: boolean;
  // Real login is a redirect, not a function call. Returns `void` so callers
  // that `await` it (e.g. `LoginPage.onSubmit`) keep type-checking.
  login: (returnTo?: string) => Promise<void>;
  logout: () => Promise<void>;
}

export function useAuth(): UseAuthReturn {
  const { status, user, login, logout } = useAuthContext();
  return {
    currentUser: user,
    isHydrated: status !== "loading",
    isAuthenticated: status === "authenticated",
    login,
    logout,
  };
}

// `useIsRole` returns true when the signed-in user holds the given IAM
// role. Reads from `currentUser.roles` (populated by `AuthProvider` from
// the IAM user record alongside the session check). Defaults to `false`
// while the user object is missing (loading or unauthenticated) so UI
// gates stay "open" during the brief window between sign-in and the IAM
// role lookup resolving — once roles land, gated buttons either appear
// (current behavior) or disappear (tester mode). Components that hide
// actions on `true` should pair this with the role check at the mutation
// hook layer as defense-in-depth: a UI hide is a UX nicety, the hook
// guard is the actual enforcement.
//
// Example: `const isTester = useIsRole("tester");`
export function useIsRole(role: string): boolean {
  const { currentUser } = useAuth();
  const roles = currentUser?.roles ?? [];
  return roles.includes(role);
}

interface RequireAuthProps {
  children: ReactElement;
}

// `RequireAuth` keeps the protected route table working. While auth is still
// loading it shows a spinner; once it resolves to `unauthenticated` it
// navigates to `/login?returnTo=<currentPath>` from a `useEffect` (not
// render-time, so Strict Mode's double-invoke can't nest the param twice).
export function RequireAuth({ children }: RequireAuthProps) {
  const { isAuthenticated, isHydrated } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (isHydrated && !isAuthenticated) {
      const returnTo = location.pathname + location.search;
      const url = `/login?returnTo=${encodeURIComponent(returnTo)}`;
      window.location.replace(url);
    }
  }, [isHydrated, isAuthenticated, location.pathname, location.search]);

  if (!isHydrated) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-background"
        role="status"
        aria-live="polite"
        aria-label="Loading application"
      >
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}
