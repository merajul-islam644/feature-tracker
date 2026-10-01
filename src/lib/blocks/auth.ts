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

// Fetches the signed-in user's IAM roles. The Blocks OIDC userInfo payload
// does not include roles (those live on the IAM user record, not the OIDC
// claim set), so we hit `iam.me()` — the SDK-documented "current
// authenticated IAM account" endpoint that returns the signed-in user's
// own record including their roles. We deliberately do NOT use
// `iam.users.get(userId)`: that route reads any user by id and requires
// admin privileges, which causes a 403 for ordinary signed-in users (and
// breaks the role-gated UI for non-admins).
//
// The shape is intentionally loose: the SDK's response envelope is
// `{ data: { ... } }` for the data layer, and `roles` is an optional
// array. We never throw — a missing or malformed response becomes an
// empty array so the AuthProvider never blocks the UI on a role hiccup.
export async function fetchUserRoles(
  _userId: string | null | undefined,
): Promise<string[]> {
  // Argument kept for backward compatibility with earlier callers — IAM
  // resolves the user id from the session cookie for `iam.me()`, so we
  // ignore whatever id the caller passes.
  void _userId;
  try {
    const me = (await blocksClient.iam.me()) as {
      data?: { roles?: unknown };
    };
    const roles = me.data?.roles;
    if (!Array.isArray(roles)) return [];
    return roles.filter((r): r is string => typeof r === "string");
  } catch {
    // IAM hiccup — treat as "no roles" so the UI doesn't lock out on a
    // transient lookup failure. The next 5-minute poll / visibility
    // refresh will retry.
    return [];
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
