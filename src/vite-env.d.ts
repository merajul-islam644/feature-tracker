/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BLOCKS_API_URL: string;
  readonly VITE_BLOCKS_OIDC_CLIENT_ID: string;
  readonly VITE_BLOCKS_OIDC_URL: string;
  readonly VITE_BLOCKS_KEY: string;
  readonly VITE_BLOCKS_APP_DOMAIN?: string;
  // MCP feature flag — when "1", the Issue Tracker routes testConnection
  // and startVerification through /api/verify/* instead of the in-browser
  // mocks. Default is empty / off.
  readonly VITE_USE_REAL_VERIFY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
