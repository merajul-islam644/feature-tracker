// Single Blocks SDK instance. Reuse everywhere — never create a second one.
// All Blocks API access from app code goes through `blocksClient`; never
// hand-roll `fetch`/`curl` against a Blocks endpoint from React code.

import { createBlocksClient } from "@seliseblocks/client";
import { blocksConfig } from "./config";

// --- Bearer-token overlay -----------------------------------------------------
//
// The hosted login is cookie-only by default, but `auth.switchOrganization`
// returns a fresh `BlocksAuthResponse` carrying tokens for the NEW org
// context — and the SDK never stores tokens ("replace app-owned session state
// with the response"). Without this overlay a successful switch response would
// be dropped and every subsequent call would still ride the old-org session.
// Tokens live in memory + sessionStorage (survives reloads within the tab;
// cleared on login/logout). Never logged, never embedded anywhere else.

interface OverlayTokens {
  accessToken: string;
  refreshToken?: string;
  /** ms epoch at which the access token expires, when IAM says. */
  expiresAt?: number;
}

const OVERLAY_KEY = "blocks:auth-overlay";
let overlay: OverlayTokens | null = null;

function readOverlayStorage(): OverlayTokens | null {
  try {
    const raw = sessionStorage.getItem(OVERLAY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OverlayTokens | null;
    return parsed && typeof parsed.accessToken === "string" && parsed.accessToken
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function persistOverlay(): void {
  try {
    if (overlay) sessionStorage.setItem(OVERLAY_KEY, JSON.stringify(overlay));
    else sessionStorage.removeItem(OVERLAY_KEY);
  } catch {
    // sessionStorage unavailable — the in-memory overlay still works in-tab.
  }
}

function isExpired(t: OverlayTokens): boolean {
  // 30s clock-skew guard; an unknown expiry is treated as unexpired.
  return typeof t.expiresAt === "number" && Date.now() >= t.expiresAt - 30_000;
}

function firstString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v) return v;
  }
  return undefined;
}

/**
 * Applies tokens from an IAM auth response (`switchOrganization`, `refresh`).
 * `BlocksAuthResponse` tolerates camelCase/snake_case and a `{ data }` wrapper,
 * so all documented spellings are checked. Returns true when tokens were found.
 */
export function applyAuthOverlay(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  const d =
    o.data && typeof o.data === "object"
      ? (o.data as Record<string, unknown>)
      : undefined;
  const accessToken = firstString(
    o.accessToken,
    o.access_token,
    d?.accessToken,
    d?.access_token,
  );
  if (!accessToken) return false;
  const refreshToken = firstString(
    o.refreshToken,
    o.refresh_token,
    d?.refreshToken,
    d?.refresh_token,
  );
  const expiresInSeconds = [o.expiresIn, o.expires_in, d?.expiresIn, d?.expires_in].find(
    (v): v is number => typeof v === "number" && v > 0,
  );
  overlay = {
    accessToken,
    refreshToken,
    expiresAt: expiresInSeconds ? Date.now() + expiresInSeconds * 1000 : undefined,
  };
  persistOverlay();
  return true;
}

/** Forgets the overlay session — call on login (fresh hosted session) and logout. */
export function clearAuthOverlay(): void {
  overlay = null;
  persistOverlay();
}

/** The overlay refresh token, when one is stored and still plausible — `switchOrganization` accepts it. */
export function getOverlayRefreshToken(): string | undefined {
  overlay = overlay ?? readOverlayStorage();
  return overlay && !isExpired(overlay) ? overlay.refreshToken : undefined;
}

function getOverlayAccessToken(): string | undefined {
  overlay = overlay ?? readOverlayStorage();
  if (!overlay || isExpired(overlay)) return undefined;
  return overlay.accessToken;
}

export const blocksClient = createBlocksClient({
  apiUrl: blocksConfig.apiUrl,
  appDomain: blocksConfig.appDomain || undefined,
  oidc: {
    clientId: blocksConfig.oidcClientId,
    // `redirectUri` is left to the SDK's browser default of
    // `${window.location.origin}/login/callback` — must match the URI
    // registered for the OIDC client on every origin the app runs on.
    url: blocksConfig.oidcUrl,
  },
  xBlocksKey: blocksConfig.xBlocksKey,
  // The hosted-login session lives in a Secure, httpOnly cookie (sent via
  // `credentials: "include"`), and `undefined` keeps the SDK off the
  // accessToken path — UNTIL an org switch or refresh response leaves an
  // overlay session, in which case the overlay token rides along as the
  // Authorization header and takes the session into the new org context.
  // (Never call `blocksClient.auth.accessToken()` from inside this callback —
  // the SDK calls it back to resolve outgoing tokens; that recurses and
  // stack-overflows.)
  accessToken: () => Promise.resolve(getOverlayAccessToken()),
});
