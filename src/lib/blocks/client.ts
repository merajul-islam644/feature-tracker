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
  // The cookie-only hosted-login flow has no caller-owned bearer token to
  // forward — IAM stores the session as a Secure, httpOnly cookie on
  // /login/callback and the SDK sends it via `credentials: "include"` on
  // every call. Returning `undefined` keeps the SDK off the accessToken
  // path entirely; calling `blocksClient.auth.accessToken()` from inside
  // this callback recurses and stack-overflows (the SDK calls this back
  // to resolve outgoing tokens).
  accessToken: () => Promise.resolve(undefined),
});