// Session / token helpers around the Blocks SDK. UI calls these through
// `AuthProvider`; this file is the only place that talks to `blocksClient.auth`
// for login/callback/logout/session-claims work.

import type { BlocksOidcUserInfo } from "@seliseblocks/client";
import { blocksClient } from "./client";

const RETURN_TO_KEY = "blocks:returnTo";

// `startLogin` stashes the post-login destination, then triggers the hosted
// OIDC redirect. The SDK's `redirectToProvider` reads the OIDC config off
// `createBlocksClient`, so we don't pass it here.
export async function startLogin(returnTo: string = "/"): Promise<void> {
  try {
    sessionStorage.setItem(RETURN_TO_KEY, returnTo);
  } catch {
    // sessionStorage unavailable — fall through; default return is "/".
  }
  await blocksClient.auth.idp.redirectToProvider();
}

// `completeLogin` is called once from the `/login/callback` route. It hands
// the full callback URL (including `code` / `state` / error params) to the
// SDK so IAM can finish the flow. In the default cookie-only flow IAM sets
// the session cookie via `Set-Cookie` and returns no token in the body.
export async function completeLogin(
  callbackUrl: string
): Promise<{ ok: true; returnTo: string } | { ok: false; message: string }> {
  const returnTo = readReturnTo();
  try {
    const response = await blocksClient.auth.idp.callback(callbackUrl);
    if ((response as { error?: unknown }).error) {
      return {
        ok: false,
        message:
          (response as { error_description?: string }).error_description ??
          (response as { error?: string }).error ??
          "Authentication failed.",
      };
    }
    return { ok: true, returnTo };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error ? err.message : "Authentication failed.",
    };
  }
}

// Confirms the session cookie is real by hitting `/iam/v4/auth/me`.
// Returns `null` if IAM says the caller is not authenticated.
export async function fetchSessionClaims(): Promise<BlocksOidcUserInfo | null> {
  try {
    return await blocksClient.auth.userInfo();
  } catch {
    return null;
  }
}

// Asks IAM to invalidate the current session cookie, then forgets it locally.
// Always returns; errors are swallowed because the local logout still succeeds.
export async function logout(): Promise<void> {
  try {
    await blocksClient.auth.logout();
  } catch {
    // Ignore — the session cookie may already be gone.
  }
}

// For the default cookie-only flow there is no caller-owned bearer token to
// refresh; IAM owns the cookie. Kept as a stub so future callers (e.g. a
// server-to-server adapter that returns tokens in the body) have a stable
// home for the refresh-token path.
export async function getValidAccessToken(): Promise<string | undefined> {
  const token = await blocksClient.auth.accessToken();
  return token ?? undefined;
}

function readReturnTo(): string {
  try {
    const v = sessionStorage.getItem(RETURN_TO_KEY);
    if (v) sessionStorage.removeItem(RETURN_TO_KEY);
    return v && v.startsWith("/") ? v : "/";
  } catch {
    return "/";
  }
}
