/// <reference types="vite/client" />

// `vite-plugin-svgr` rewrites `import X from './foo.svg?react'` into a
// real React component at build time, so TS needs an ambient declaration
// for the `?react` query suffix — otherwise `tsc -b` errors with
// TS2307 on every SVG import.
declare module "*.svg?react" {
  import type { FC, SVGProps } from "react";
  const ReactComponent: FC<SVGProps<SVGSVGElement>>;
  export default ReactComponent;
}

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
  // (VITE_USE_DEV_SERVER removed — the /panel workspace is always on.)
  // Domain that serves per-user inbound mail addresses (the Mail page's
  // "Get Your Email" dialog builds <name>.<uid6>@<domain> from the
  // signed-in user). Must match the domain your Cloudflare Email
  // Routing catch-all delivers to the mail-server.
  readonly VITE_MAIL_INBOUND_DOMAIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
