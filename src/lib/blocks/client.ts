// Single Blocks SDK instance. Reuse everywhere — never create a second one.
// All Blocks API access from app code goes through `blocksClient`; never
// hand-roll `fetch`/`curl` against a Blocks endpoint from React code.

import { createBlocksClient } from "@seliseblocks/client";
import { blocksConfig } from "./config";

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
  // `accessToken` resolves a caller-owned bearer token (or `undefined` if
  // the session is cookie-only). The SDK reads it before every protected
  // call; we never store or refresh the token ourselves. In the OIDC
  // hosted-IdP flow with httpOnly session cookies there is no body token
  // to forward, so this returns `undefined` and the SDK sends the cookie.
  accessToken: () =>
    blocksClient.auth
      .accessToken()
      .then((token) => (typeof token === "string" ? token : undefined))
      .catch(() => undefined),
});