// Hosted-login button. Replaces the previous email/password mock. The
// SDK's `redirectToProvider` triggers the Blocks IAM hosted flow; IAM
// redirects back to `${origin}/login/callback`, which `CallbackPage` handles.
//
// Visual hierarchy per DESIGN-APP-v1.md §6.1.

import { useEffect, useState } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";
import { TriangleAlert } from "lucide-react";
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-indigo-50 via-white to-violet-50 px-4 py-12 dark:from-indigo-950/30 dark:via-background dark:to-violet-950/20">
      {/* Subtle background ornaments — soft indigo + violet blobs */}
      <div
        className="pointer-events-none absolute -left-32 top-1/3 h-96 w-96 rounded-full bg-indigo-200/30 blur-3xl dark:bg-indigo-500/10"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -right-32 bottom-1/4 h-96 w-96 rounded-full bg-violet-200/30 blur-3xl dark:bg-violet-500/10"
        aria-hidden="true"
      />

      <div className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-card/95 p-8 shadow-elevated backdrop-blur">
        <div className="mb-7 flex flex-col items-center text-center">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-ai"
            aria-hidden="true"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1-2-2h11" />
            </svg>
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">
            {t("auth.loginTitle", "Welcome to Feature Tracker")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t(
              "auth.loginSubtitle",
              "Sign in to continue to your workspace.",
            )}
          </p>
        </div>

        {!configured ? (
          <div
            role="alert"
            className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                <TriangleAlert className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="space-y-2">
                <p className="text-sm font-semibold">
                  {t(
                    "auth.notConfiguredTitle",
                    "Callback URL not configured",
                  )}
                </p>
                <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-200/90">
                  {t(
                    "auth.notConfiguredDesc",
                    "Add this URL to your Blocks IAM application's allowed callback list.",
                  )}
                </p>
                <p className="text-xs leading-relaxed text-amber-800/90 dark:text-amber-200/80">
                  {t("auth.notConfiguredEnv", "Set")}{" "}
                  <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[11px] dark:bg-amber-500/20">
                    VITE_BLOCKS_OIDC_CLIENT_ID
                  </code>
                  ,{" "}
                  <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[11px] dark:bg-amber-500/20">
                    VITE_BLOCKS_OIDC_URL
                  </code>
                  ,{" "}
                  <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[11px] dark:bg-amber-500/20">
                    VITE_BLOCKS_API_URL
                  </code>
                  {", "}
                  {t("auth.notConfiguredAnd", "and")}{" "}
                  <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[11px] dark:bg-amber-500/20">
                    VITE_BLOCKS_KEY
                  </code>{" "}
                  {t("auth.notConfiguredInEnv", "in your .env file.")}
                </p>
                <p className="break-all rounded-md border border-amber-200 bg-amber-100/60 px-2 py-1.5 font-mono text-[11px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                  {callbackUrl}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            onClick={handleLogin}
            fullWidth
            loading={pending}
            size="lg"
          >
            {pending
              ? t("auth.redirecting", "Redirecting…")
              : t("auth.loginButton", "Continue with hosted login")}
          </Button>
        )}

        <p className="pt-5 text-center text-xs text-muted-foreground">
          {t(
            "auth.hostedBy",
            "Hosted by Blocks IAM at {url}.",
          ).replace("{url}", blocksConfig.oidcUrl)}
        </p>
      </div>
    </div>
  );
}
