// Hosted-login button. Replaces the previous email/password mock. The
// SDK's `redirectToProvider` triggers the Blocks IAM hosted flow; IAM
// redirects back to `${origin}/login/callback`, which `CallbackPage` handles.

import { useEffect, useState } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useAuthContext } from "@/components/blocks/AuthProvider";
import { isLoginConfigured, blocksConfig } from "@/lib/blocks/config";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/blocks/i18n";

export function LoginPage() {
  const { isAuthenticated, isHydrated } = useAuth();
  const { login } = useAuthContext();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [pending, setPending] = useState(false);
  const t = useT();

  useEffect(() => {
    document.title = `${t("auth.loginTitle", "Sign in to Feature Tracker")} — Feature Tracker`;
  }, [t]);

  if (isHydrated && isAuthenticated) {
    const fromState = (location.state as { from?: { pathname: string } } | null)
      ?.from?.pathname;
    const fromQuery = searchParams.get("returnTo");
    const target = fromState ?? fromQuery ?? "/dashboard";
    return <Navigate to={target} replace />;
  }

  const handleLogin = async () => {
    const fromState = (location.state as { from?: { pathname: string } } | null)
      ?.from?.pathname;
    const fromQuery = searchParams.get("returnTo");
    const returnTo = fromState ?? fromQuery ?? "/dashboard";
    setPending(true);
    try {
      await login(returnTo);
    } finally {
      setPending(false);
    }
  };

  const configured = isLoginConfigured();
  const callbackUrl = `${window.location.origin}/login/callback`;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-soft">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary-600 text-white">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1-2-2h11" />
            </svg>
          </div>
          <h1 className="mt-3 text-lg font-semibold text-slate-900">
            {t("auth.loginTitle", "Sign in to Feature Tracker")}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {t("auth.loginSubtitle", "Use the hosted identity provider to sign in.")}
          </p>
        </div>

        {!configured ? (
          <div
            role="alert"
            className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
          >
            <p className="font-medium">Login is not configured.</p>
            <p className="mt-1 text-xs leading-relaxed">
              Set <code>VITE_BLOCKS_OIDC_CLIENT_ID</code>,{" "}
              <code>VITE_BLOCKS_OIDC_URL</code>, <code>VITE_BLOCKS_API_URL</code>,
              and <code>VITE_BLOCKS_KEY</code> in your <code>.env</code> file.
            </p>
            <p className="mt-2 text-xs">
              Register the callback URL{" "}
              <code className="break-all">{callbackUrl}</code> against your OIDC
              client.
            </p>
          </div>
        ) : (
          <Button
            type="button"
            onClick={handleLogin}
            fullWidth
            loading={pending}
            className="mt-2"
          >
            {pending ? "Redirecting…" : t("auth.loginButton", "Continue with hosted login")}
          </Button>
        )}

        <p className="pt-3 text-center text-xs text-slate-500">
          Hosted by Blocks IAM at{" "}
          <span className="break-all">{blocksConfig.oidcUrl}</span>.
        </p>
      </div>
    </div>
  );
}