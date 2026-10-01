// Reads VITE_BLOCKS_* env vars and reports whether the app is configured
// enough to call the hosted OIDC login flow. Never read these from
// `import.meta.env` directly elsewhere — go through this module so a missing
// value is reported consistently.

const apiUrl = import.meta.env.VITE_BLOCKS_API_URL ?? "";
const oidcUrl = import.meta.env.VITE_BLOCKS_OIDC_URL ?? "";
const oidcClientId = import.meta.env.VITE_BLOCKS_OIDC_CLIENT_ID ?? "";
const xBlocksKey = import.meta.env.VITE_BLOCKS_KEY ?? "";

export const blocksConfig = {
  apiUrl,
  oidcUrl,
  oidcClientId,
  xBlocksKey,
  appDomain: import.meta.env.VITE_BLOCKS_APP_DOMAIN ?? "",
};

export function isLoginConfigured(): boolean {
  return Boolean(apiUrl && oidcUrl && oidcClientId && xBlocksKey);
}
