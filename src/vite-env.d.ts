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
  // Domain that serves per-user inbound mail addresses (the Mail page's
  // "Get Your Email" dialog builds <name>.<uid6>@<domain> from the
  // signed-in user). Must match the domain your Cloudflare Email
  // Routing catch-all delivers to the mail-server.
  readonly VITE_MAIL_INBOUND_DOMAIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
