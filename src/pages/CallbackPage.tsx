// `/login/callback` handler. Reachable without `RequireAuth` because the user
// is by definition not yet authenticated when they land here. One-shot effect
// calls `completeLogin(window.location.href)` exactly once (guarded with a
// `useRef` so React 18 Strict Mode's double-invoke doesn't double-submit).

import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { completeLogin } from "@/lib/blocks/auth";
import { useAuthContext } from "@/components/blocks/AuthProvider";
import { Button } from "@/components/ui/button";

export function CallbackPage() {
  const navigate = useNavigate();
  const { refresh } = useAuthContext();
  const ran = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      const result = await completeLogin(window.location.href);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      await refresh();
      navigate(result.returnTo, { replace: true });
    })();
  }, [navigate, refresh]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
        <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6">
          <h1 className="text-lg font-semibold text-foreground">
            Sign-in failed
          </h1>
          <p
            role="alert"
            className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </p>
          <Button asChild className="mt-4">
            <a href="/login">Back to sign in</a>
          </Button>
        </div>
      </div>
    );
  }

  // Mid-flight render — don't strand the user on a blank screen.
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-background"
      role="status"
      aria-live="polite"
      aria-label="Completing sign-in"
    >
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
    </div>
  );
}

// Belt-and-braces: if a user pastes a `/login/callback` URL with no params
// straight into the address bar, bounce them to the dashboard.
export function CallbackPageGuard() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("code") && !params.has("error")) {
    return <Navigate to="/dashboard" replace />;
  }
  return <CallbackPage />;
}
