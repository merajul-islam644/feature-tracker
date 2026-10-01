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
    document.title = `${t("auth.loginTitle", "Sign in to Lattice")} — Lattice`;
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12">
      <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-surface p-8 shadow-lg">
        <div className="mb-7 flex flex-col items-center text-center">
          <div
            className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-md"
            aria-hidden="true"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 32 32"
              width="48"
              height="48"
            >
              <defs>
                <linearGradient id="latticeBgLogin" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#3730A3" />
                  <stop offset="100%" stopColor="#1E1B4B" />
                </linearGradient>
              </defs>
              <rect width="32" height="32" rx="9" fill="url(#latticeBgLogin)" />
              <rect
                x="0.5"
                y="0.5"
                width="31"
                height="31"
                rx="8.5"
                fill="none"
                stroke="#FFFFFF"
                strokeWidth="0.5"
                opacity="0.08"
              />
              <g
                stroke="#FFFFFF"
                strokeLinecap="round"
                strokeWidth="1.25"
                opacity="0.35"
              >
                <line x1="9" y1="8" x2="9" y2="23" />
                <line x1="9" y1="23" x2="23" y2="23" />
                <line x1="9" y1="8" x2="23" y2="8" />
                <line x1="23" y1="8" x2="23" y2="23" />
                <line x1="9" y1="8" x2="16" y2="23" />
              </g>
              <g>
                <circle cx="9" cy="8" r="3.5" fill="#818CF8" opacity="0.25" />
                <circle cx="23" cy="8" r="3.5" fill="#C084FC" opacity="0.25" />
                <circle cx="9" cy="23" r="3.5" fill="#34D399" opacity="0.25" />
                <circle cx="16" cy="23" r="3.5" fill="#FBBF24" opacity="0.25" />
                <circle cx="23" cy="23" r="3.5" fill="#FB7185" opacity="0.25" />
              </g>
              <g>
                <circle cx="9" cy="8" r="2.25" fill="#818CF8" />
                <circle cx="23" cy="8" r="2.25" fill="#C084FC" />
                <circle cx="9" cy="23" r="2.25" fill="#34D399" />
                <circle cx="16" cy="23" r="2.25" fill="#FBBF24" />
                <circle cx="23" cy="23" r="2.25" fill="#FB7185" />
              </g>
            </svg>
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">
            {t("auth.loginTitle", "Welcome to Lattice")}
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
