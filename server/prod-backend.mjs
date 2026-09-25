// Production HTTP server for the Feature Tracker SPA.
//
// What this is:
//   A vanilla `node:http` server that runs inside the runtime container.
//   It serves the built SPA (dist/) with SPA fallback + gzip + cache-control
//   headers (mirroring the behaviour of the old nginx.conf), and proxies
//   /api/ai/chat + /api/verify/* + /api/secrets + /api/evidence +
//   /api/playwright to upstream backends using server-side env vars. The
//   shape of every endpoint is a port of the dev-only Vite plugins in
//   vite.config.ts (aiChatProxy + verifyProxy) — same JSON keys, same
//   status codes, same fallback behaviour.
//
// What this is NOT:
//   This is NOT a replacement for the dev-time `server/verify-backend.mjs`
//   stub. That file stays untouched and continues to be the local dev MCP
//   stub. prod-backend.mjs is the production counterpart that lives inside
//   the Blocks-deployed container.
//
// Run locally:
//   node server/prod-backend.mjs                      # serves from ./dist, port 8080
//   PORT=9000 AI_GATEWAY_URL=... AI_GATEWAY_TOKEN=... \
//     node server/prod-backend.mjs                    # with upstream config
//
// Verify end-to-end:
//   1. node server/prod-backend.mjs                       (in one terminal)
//   2. curl -fsS http://127.0.0.1:8080/api/health
//   3. curl -fsS -X POST http://127.0.0.1:8080/api/ai/chat \
//        -H 'content-type: application/json' \
//        -d '{"text":"hi","system":"Reply with one word."}'

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { Readable } from "node:stream";

// ────────────────────────────────────────────────────────────────────────────
//  Config — read at module load. The Cloud Run / Kubernetes contract on the
//  Blocks platform sets $PORT; VERIFY_BACKEND_URL arrives via
//  `blocks release deploy --with-secrets .env.production`.
//
//  AI_GATEWAY_* is intentionally NOT read here — the Settings page is the
//  sole source of truth for the chat gateway config. Each user saves their
//  own URL / model / token in Blocks Data; the SPA attaches them as
//  `x-ai-gateway-*` headers on every chat request. If a request arrives
//  without those headers, `proxyAiChat` returns 503 `ai_not_configured`.
//  We also accept the ANTHROPIC_* aliases for forward-compat with anyone
//  who has them exported in their environment, but only as a hard last
//  resort if no header is supplied — same precedence as the Vite proxy.
// ────────────────────────────────────────────────────────────────────────────
const VERIFY_URL = (process.env.VERIFY_BACKEND_URL ?? "").replace(/\/+$/, "");

// ────────────────────────────────────────────────────────────────────────────
// AI avatar provider abstraction
// ────────────────────────────────────────────────────────────────────────────
//
// The browser POSTs `{ imageBase64, style }` to `/api/ai/avatar` and expects
// back `{ avatarDataUrl, contentType, durationMs }` — a single, vendor-neutral
// contract. The handlers below own the *server-side* side of that contract.
// Each provider knows how to translate the request into one upstream API:
//
//   - Replicate    — async prediction model: create → poll → download
//   - Hugging Face — sync image-to-image via the Inference router
//   - Mock         — no external API; returns the input image (offline dev)
//   - (future) OpenAI, Stability, local ComfyUI, etc.
//
// Adding a new vendor is a single new entry in `AVATAR_PROVIDERS` below; no
// edits to `proxyAiAvatar` needed. Selection is driven by the
// `AI_AVATAR_PROVIDER` env var (default: "replicate") so the same wire shape
// works in dev, prod, and any future environment. Tokens stay server-side
// (no `VITE_` prefix) and never ship to the browser bundle.
//
// The dev-time mirror of this module lives in vite.config.ts (the
// `aiAvatarProxy` plugin); keep the two in lockstep.
//
// ────────────────────────────────────────────────────────────────────────────
// ADDING A NEW AI PROVIDER — recipe
// ────────────────────────────────────────────────────────────────────────────
//   1. Write a `create<Name>Provider(env)` function that returns an object
//      satisfying the `AvatarProvider` interface (JSDoc typedef above).
//      Each provider owns the upstream call shape — the abstraction hides
//      it from the rest of the app.
//   2. Add `create<Name>Provider` to the `AVATAR_PROVIDERS` map.
//   3. Document the env vars it reads in `.env.example`.
//
// That's it. Selection happens via `AI_AVATAR_PROVIDER=<name>`. Per-style
// overrides via `AI_AVATAR_PROVIDER_BY_STYLE=Anime:mock;3D:replicate`.
// Adding a vendor is ~30–100 lines of code, no changes to the middleware
// or to the client.

/**
 * @typedef {{ imageBase64: string, style: string }} AvatarRequest
 * @typedef {{
 *   avatarDataUrl: string,
 *   contentType: string,
 *   durationMs: number,
 * }} AvatarResult
 * @typedef {{
 *   id: string,
 *   isConfigured: () => boolean,
 *   notConfiguredMessage: () => string,
 *   generate: (
 *     req: AvatarRequest,
 *     signal: AbortSignal,
 *     userOverride?: { token?: string, modelVersion?: string },
 *   ) => Promise<AvatarResult>,
 * }} AvatarProvider
 */

const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN ?? "";
const REPLICATE_MODEL =
  process.env.REPLICATE_AVATAR_MODEL ?? "fofr/face-to-many";
const REPLICATE_VERSION = process.env.REPLICATE_AVATAR_MODEL_VERSION ?? "";
// Lazily resolved latest version hash for `REPLICATE_MODEL`. Replicate's
// create-prediction API rejects bare model names with `422 — version is
// required`; explicit `REPLICATE_VERSION` wins when set, otherwise we
// hit `/v1/models/{owner}/{name}` once per process and pin to the
// returned hash. Cached for the process's lifetime — model bumps are
// rare, a stale hash is acceptable, and a restart picks up new pins.
let REPLICATE_RESOLVED_VERSION = null;
let REPLICATE_RESOLVE_ATTEMPTED = false;
async function resolveReplicateLatestVersion(useToken) {
  if (REPLICATE_RESOLVED_VERSION || REPLICATE_RESOLVE_ATTEMPTED) {
    return REPLICATE_RESOLVED_VERSION;
  }
  REPLICATE_RESOLVE_ATTEMPTED = true;
  const [owner, name] = REPLICATE_MODEL.split("/");
  if (!owner || !name) return null;
  try {
    const res = await fetch(
      `https://api.replicate.com/v1/models/${owner}/${name}`,
      { headers: { authorization: `Token ${useToken}` } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const id = data?.latest_version?.id;
    if (typeof id === "string" && id.length > 0) {
      REPLICATE_RESOLVED_VERSION = id;
      return id;
    }
  } catch {
    // Network/Replicate failure — fall through; create-prediction will
    // surface a clear upstream error if it can't proceed.
  }
  return null;
}

/** @returns {AvatarProvider} */
function createReplicateProvider() {
  const token = REPLICATE_TOKEN;
  const model = REPLICATE_MODEL;
  const explicitVersion = REPLICATE_VERSION;
  return {
    id: "replicate",
    isConfigured: () => token.length > 0,
    notConfiguredMessage: () =>
      "REPLICATE_API_TOKEN is not set on the prod-backend process. Set it (and optionally REPLICATE_AVATAR_MODEL / REPLICATE_AVATAR_MODEL_VERSION) to enable AI avatar generation.",
    async generate(req, signal, userOverride) {
      // Per-request credential resolution: the caller's Personal AI key
      // (`x-ai-avatar-token`) wins over the env token. The middleware
      // already 503s when no user token is supplied, so reaching here
      // implies at least one source is non-empty — but the guard below
      // keeps the provider robust if it's ever called from a new code
      // path that forgets the check.
      const effectiveToken = userOverride?.token || token;
      const effectiveVersion = userOverride?.modelVersion || explicitVersion;
      if (!effectiveToken) {
        throw new Error(
          "Replicate token is missing — set Personal AI key in Settings → Account, or configure REPLICATE_API_TOKEN on the server.",
        );
      }
      const inputImage = req.imageBase64.startsWith("data:")
        ? req.imageBase64
        : `data:image/jpeg;base64,${req.imageBase64}`;
      const pinnedVersion =
        effectiveVersion || (await resolveReplicateLatestVersion(effectiveToken));
      if (!pinnedVersion) {
        throw new Error(
          "Could not resolve the Replicate model version. Set REPLICATE_AVATAR_MODEL_VERSION in the prod env to pin a specific hash, or check the API token / network connectivity.",
        );
      }
      const createBody = {
        version: pinnedVersion,
        input: {
          image: inputImage,
          style: req.style,
          prompt: "",
          prompt_strength: 0.9,
          number_of_images: 1,
          disable_safety_checker: true,
        },
      };
      const start = Date.now();
      const create = await fetch(
        "https://api.replicate.com/v1/predictions",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Token ${effectiveToken}`,
          },
          body: JSON.stringify(createBody),
        },
      );
      if (!create.ok) {
        const text = await create.text();
        throw new Error(
          `Replicate create failed: ${text.slice(0, 500)}`,
        );
      }
      const prediction = await create.json();
      const predictionId = prediction?.id;
      if (!predictionId) {
        throw new Error("Replicate returned no prediction id");
      }

      // Poll until settled. Throws on abort — the outer middleware maps
      // that to 504. Best-effort cancel so Replicate stops billing when
      // the client disconnects mid-generation.
      let final = prediction;
      while (true) {
        if (signal.aborted) {
          fetch(
            `https://api.replicate.com/v1/predictions/${predictionId}/cancel`,
            {
              method: "POST",
              headers: { authorization: `Token ${effectiveToken}` },
            },
          ).catch(() => {});
          throw new Error("aborted");
        }
        if (
          final.status === "succeeded" ||
          final.status === "failed" ||
          final.status === "canceled"
        ) {
          break;
        }
        await new Promise((r) => setTimeout(r, 2000));
        const poll = await fetch(
          `https://api.replicate.com/v1/predictions/${predictionId}`,
          { headers: { authorization: `Token ${effectiveToken}` } },
        );
        if (poll.ok) final = await poll.json();
      }
      if (final.status !== "succeeded") {
        throw new Error(
          typeof final?.error === "string"
            ? final.error
            : `prediction ${final.status}`,
        );
      }
      const output = final.output;
      const firstUrl = Array.isArray(output)
        ? output.find((v) => typeof v === "string")
        : typeof output === "string"
          ? output
          : null;
      if (!firstUrl) throw new Error("Replicate returned no output URL");
      const dl = await fetch(firstUrl);
      if (!dl.ok) {
        throw new Error(`Failed to download avatar (${dl.status})`);
      }
      const mime = dl.headers.get("content-type") ?? "image/png";
      const buf = Buffer.from(await dl.arrayBuffer());
      const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
      return {
        avatarDataUrl: dataUrl,
        contentType: mime,
        durationMs: Date.now() - start,
      };
    },
  };
}

// Hugging Face Inference router. The default model
// `timbrooks/instruct-pix2pix` is a well-known free option that preserves
// the input subject's structure while applying a text instruction — good
// for "turn this face into X" style transfers. Override `HF_AVATAR_MODEL`
// to swap.
//
// Style → prompt map stands in for Replicate's built-in style enum: each
// preset becomes a natural-language instruction. Missing styles fall
// back to a generic stylization prompt.
const HF_STYLE_PROMPTS = {
  "3D": "turn this person into a 3D rendered character",
  Anime: "turn this person into anime",
  Cartoon: "turn this person into a cartoon",
  Emoji: "turn this person into an emoji",
  "Video game": "turn this person into a video game character",
  "Pixel art": "convert this person into pixel art",
  Clay: "make this person look like a clay sculpture",
  Illustration: "make this person a hand drawn illustration",
  Toy: "turn this person into a toy figure",
};
const HF_DEFAULT_PROMPT = "stylize this person as a creative portrait";

/** @returns {AvatarProvider} */
function createHuggingFaceProvider() {
  const token = process.env.HF_TOKEN ?? "";
  const model = process.env.HF_AVATAR_MODEL ?? "timbrooks/instruct-pix2pix";
  return {
    id: "huggingface",
    isConfigured: () => token.length > 0,
    notConfiguredMessage: () =>
      "HF_TOKEN is not set on the prod-backend process. Get a free token at https://huggingface.co/settings/tokens (Make calls to Inference Providers permission) and set HF_TOKEN + AI_AVATAR_PROVIDER=huggingface in the prod env.",
    async generate(req, signal, userOverride) {
      // Same per-request override as Replicate — `userOverride.token` wins
      // over the env `HF_TOKEN` when present. Mirrors the dev proxy in
      // `vite.config.ts`.
      const effectiveToken = userOverride?.token || token;
      if (!effectiveToken) {
        throw new Error(
          "Hugging Face token is missing — set Personal AI key in Settings → Account, or configure HF_TOKEN on the server.",
        );
      }
      const prompt = HF_STYLE_PROMPTS[req.style] ?? HF_DEFAULT_PROMPT;
      const inputImage = req.imageBase64.startsWith("data:")
        ? req.imageBase64
        : `data:image/jpeg;base64,${req.imageBase64}`;
      const start = Date.now();
      const res = await fetch(
        `https://router.huggingface.co/hf-inference/models/${model}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${effectiveToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            inputs: inputImage,
            parameters: {
              prompt,
              num_inference_steps: 25,
              image_guidance_scale: 1.5,
            },
          }),
          signal,
        },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(
          `Hugging Face failed (${res.status}): ${text.slice(0, 500)}`,
        );
      }
      const ab = await res.arrayBuffer();
      const mime = res.headers.get("content-type") ?? "image/png";
      if (!mime.startsWith("image/")) {
        const text = Buffer.from(ab).toString("utf8");
        throw new Error(
          `Hugging Face returned non-image response: ${text.slice(0, 500)}`,
        );
      }
      const dataUrl = `data:${mime};base64,${Buffer.from(ab).toString("base64")}`;
      return {
        avatarDataUrl: dataUrl,
        contentType: mime,
        durationMs: Date.now() - start,
      };
    },
  };
}

// ── Mock provider (no external API) ─────────────────────────────────────────
//
// Returns the input image unchanged. Useful for:
//   - offline development (no API key required),
//   - UI / wire-shape testing without burning API credits,
//   - as a placeholder when no real provider is configured.
//
// Always "configured" — no credentials to set. Override
// `AI_AVATAR_PROVIDER=mock` in the prod env to enable.
/** @returns {AvatarProvider} */
function createMockProvider() {
  return {
    id: "mock",
    isConfigured: () => true,
    notConfiguredMessage: () =>
      "Mock provider is always configured — no credentials required.",
    async generate(req, _signal, _userOverride) {
      const inputImage = req.imageBase64.startsWith("data:")
        ? req.imageBase64
        : `data:image/jpeg;base64,${req.imageBase64}`;
      return {
        avatarDataUrl: inputImage,
        contentType: "image/png",
        durationMs: 0,
      };
    },
  };
}

// Per-style provider override. Parses `AI_AVATAR_PROVIDER_BY_STYLE` from
// the env into a `{ style → providerId }` map so the same app can route,
// say, "Anime" through Hugging Face (free) and "3D" through Replicate
// (paid).
//
// Format: semicolon-separated `Style:providerId` pairs.
//   AI_AVATAR_PROVIDER_BY_STYLE=Anime:mock;3D:replicate;Emoji:huggingface
// Whitespace is trimmed; unknown style keys are ignored. A style that's
// listed here takes precedence over the global `AI_AVATAR_PROVIDER`.
const AVATAR_PROVIDERS = {
  replicate: createReplicateProvider,
  huggingface: createHuggingFaceProvider,
  mock: createMockProvider,
};

function parseStyleProviders(value) {
  if (!value) return {};
  const map = {};
  for (const pair of value.split(/[;,]/)) {
    const [k, v] = pair.split(":").map((s) => (s ?? "").trim());
    if (k && v) map[k] = v.toLowerCase();
  }
  return map;
}

/**
 * Resolve the active provider. Per-style override wins, then global
 * `AI_AVATAR_PROVIDER`, then default "replicate".
 * @param {string} [style] — the style preset the client requested.
 * @returns {AvatarProvider}
 */
function getAvatarProvider(style) {
  const styleOverrides = parseStyleProviders(
    process.env.AI_AVATAR_PROVIDER_BY_STYLE,
  );
  const override = style ? styleOverrides[style] : undefined;
  const id = (override ?? process.env.AI_AVATAR_PROVIDER ?? "replicate").toLowerCase();
  const factory = AVATAR_PROVIDERS[id];
  if (!factory) {
    const known = Object.keys(AVATAR_PROVIDERS).join(", ");
    return {
      id,
      isConfigured: () => false,
      notConfiguredMessage: () =>
        `AI_AVATAR_PROVIDER="${id}" is not recognized. Known providers: ${known}.`,
      generate: async () => {
        throw new Error(`Unknown AI avatar provider: ${id}`);
      },
    };
  }
  return factory();
}

const PORT = Number(process.env.PORT ?? 8080);
const HOST = "0.0.0.0";
const DIST_DIR = path.resolve(process.cwd(), "dist");

// Belt-and-braces: cap request bodies. Anthropic + tool-catalog bodies stay
// well under 1 MB; 5 MB is generous headroom for any future expansion.
// The AI avatar endpoint needs more — the source photo is 4 MB at the
// picker and base64 inflates to ~5.3 MB on the wire; 10 MB gives a safety
// margin. Each handler that needs the wider cap passes the constant in
// directly; the chat / verify / secrets / evidence paths keep the 5 MB
// default by reading from `MAX_BODY_BYTES` explicitly.
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const AVATAR_MAX_BODY_BYTES = 10 * 1024 * 1024;
const AVATAR_TIMEOUT_MS = 65_000;
// /api/ai/chat upstream fetch cap. Must be strictly less than both:
//   • Azure App Gateway request timeout (30 s on Standard v2, 4 min on
//     WAF_v2) — the load balancer in front of this app terminates the
//     client connection when this fires, so by then `disconnected` is
//     already true and we'd serve an empty 200 to nothing.
//   • Cloud Run default request timeout (60 s for the prod env) —
//     same story, just at a different layer.
// 25 s leaves room for the body parse + serialise round trip before any
// load balancer would reap the request from under the chat client.
const CHAT_TIMEOUT_MS = 25_000;
// requestTimeout: 90 s. Anthropic with max_tokens 4096 + tools can run 30–60 s.
// SSE endpoint overrides this per-request via res.setTimeout(0) below.
const REQUEST_TIMEOUT_MS = 90_000;
const HEADERS_TIMEOUT_MS = 95_000;

// ────────────────────────────────────────────────────────────────────────────
//  MIME map. Inline (no `mime-types` dep) — the SPA only ships these.
// ────────────────────────────────────────────────────────────────────────────
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

// Cache headers mirror nginx.conf lines 25-34.
const ASSETS_RE = /^\/assets\//;
const HAS_EXTENSION_RE = /\.[a-z0-9]+$/i;
const TEXT_GZIP_TYPES = new Set([
  "text/plain",
  "text/css",
  "application/javascript",
  "application/json",
  "image/svg+xml",
]);

// ────────────────────────────────────────────────────────────────────────────
//  Server
// ────────────────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const reqUrl = req.url ?? "/";
  const pathname = reqUrl.split("?")[0] || "/";

  // ── /api/* ───────────────────────────────────────────────────────────────
  if (pathname.startsWith("/api/")) {
    handleApi(req, res, pathname, reqUrl);
    return;
  }

  // ── static SPA ───────────────────────────────────────────────────────────
  if (req.method === "GET" || req.method === "HEAD") {
    handleStatic(req, res, pathname);
    return;
  }

  sendJson(res, 405, { error: "method_not_allowed" });
});

server.requestTimeout = REQUEST_TIMEOUT_MS;
server.headersTimeout = HEADERS_TIMEOUT_MS;
server.maxHeadersCount = 64;

// Graceful shutdown — Cloud Run sends SIGTERM with ~10 s grace; without this
// in-flight Anthropic calls and SSE streams drop mid-flight.
process.on("SIGTERM", () => {
  // eslint-disable-next-line no-console
  console.log("[prod-backend] SIGTERM — draining");
  server.close(() => process.exit(0));
  // Hard-exit safety net in case a connection refuses to close.
  setTimeout(() => process.exit(1), 10_000).unref();
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`[prod-backend] listening on http://${HOST}:${PORT}`);
  // The AI chat gateway is intentionally NOT read from env — each user
  // supplies URL / model / token via Settings → AI Gateway, and the SPA
  // forwards them as `x-ai-gateway-*` headers on every chat request
  // (see the comment block at the top of this file). If a request
  // arrives without those headers, `proxyAiChat` returns 503
  // `ai_not_configured`. The startup log just notes that the gateway is
  // user-supplied rather than printing a (nonexistent) env value.
  // eslint-disable-next-line no-console
  console.log(`[prod-backend]   AI_GATEWAY=user-supplied via Settings → AI Gateway (no env read — per-user only)`);
  // eslint-disable-next-line no-console
  console.log(`[prod-backend]   VERIFY_BACKEND_URL=${VERIFY_URL || "(unset — /api/verify/* returns 503)"}`);
  // eslint-disable-next-line no-console
  console.log(`[prod-backend]   AI_AVATAR_PROVIDER=${getAvatarProvider().id}${getAvatarProvider().isConfigured() ? "" : " (no credentials — /api/ai/avatar returns 503)"}`);
  // eslint-disable-next-line no-console
  console.log(`[prod-backend]   DIST_DIR=${DIST_DIR}`);
});

// ────────────────────────────────────────────────────────────────────────────
//  /api/* router
// ────────────────────────────────────────────────────────────────────────────
function handleApi(req, res, pathname, reqUrl) {
  const method = req.method;

  // /api/health — used by HEALTHCHECK in the Dockerfile. Cheap and
  // unambiguously tied to this service (a GET / healthcheck would return
  // index.html and tell you nothing about which process answered).
  if (method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, { ok: true, mode: "prod-backend" });
    return;
  }

  // POST /api/ai/chat
  if (pathname === "/api/ai/chat") {
    if (method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }
    proxyAiChat(req, res);
    return;
  }

  // POST /api/ai/avatar — Vendor-agnostic avatar generation. Returns the
  // generated image as a data URL so the browser can render it without a
  // CORS round-trip. The actual upstream is selected by AI_AVATAR_PROVIDER
  // (Replicate by default; Hugging Face and others live alongside).
  if (pathname === "/api/ai/avatar") {
    if (method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }
    proxyAiAvatar(req, res);
    return;
  }

  // /api/verify/test (POST), /api/verify/runs (POST + GET),
  // /api/verify/runs/<id>/events (GET, SSE).
  if (pathname === "/api/verify/test") {
    if (method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }
    proxyVerifyTest(req, res);
    return;
  }
  if (pathname === "/api/verify/runs") {
    if (method === "POST") {
      proxyVerifyRunsCreate(req, res);
      return;
    }
    if (method === "GET") {
      proxyVerifyRunsList(req, res, reqUrl);
      return;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  const verifyEventsMatch = pathname.match(
    /^\/api\/verify\/runs\/([^/]+)\/events$/,
  );
  if (verifyEventsMatch && method === "GET") {
    proxyVerifyRunEvents(req, res, decodeURIComponent(verifyEventsMatch[1]), reqUrl);
    return;
  }

  // /api/secrets, /api/secrets/:id — proxied to the MCP backend (or 503).
  if (pathname === "/api/secrets" || pathname.startsWith("/api/secrets/")) {
    proxySecrets(req, res, pathname);
    return;
  }

  // /api/evidence, /api/evidence/:ref — proxied to the MCP backend. GET
  // streams raw bytes (screenshot PNGs etc.) so the upstream content-type
  // survives the round trip.
  if (pathname === "/api/evidence" || pathname.startsWith("/api/evidence/")) {
    proxyEvidence(req, res, reqUrl);
    return;
  }

  // /api/playwright/* — bridge to the official Playwright MCP server.
  if (pathname === "/api/playwright" || pathname.startsWith("/api/playwright/")) {
    proxyPlaywright(req, res, reqUrl);
    return;
  }

  sendJson(res, 404, { error: "not_found", path: pathname });
}

// ────────────────────────────────────────────────────────────────────────────
//  POST /api/ai/chat — port of vite.config.ts aiChatProxy.
//
//  Per-request overrides from `x-ai-gateway-{url,model,token}` headers
//  (sent by the SPA from the user's saved UserAiConfig row in Blocks Data)
//  AND the provider id from `x-ai-chat-provider` are the ONLY source of
//  truth. There is no .env fallback by design — the Settings page is
//  where the user manages these values. A request without the required
//  headers returns 503 `ai_not_configured`. Same-origin browser fetch →
//  no CORS preflight, so custom headers pass through.
//
//  The provider id selects the wire format. Anthropic passes through;
//  OpenAI translates. Adding more providers = a new factory below
//  + one entry in `CHAT_PROVIDERS`. Mirrors vite.config.ts in lockstep.
// ────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {{
 *   model: string,
 *   max_tokens: number,
 *   system: string,
 *   messages: Array<{ role: "user" | "assistant", content: string }>,
 *   tools?: Array<{ name: string, description?: string, input_schema: Record<string, unknown> }>,
 * }} AnthropicRequestBody
 *
 * @typedef {{
 *   id: string,
 *   type: "message",
 *   role: "assistant",
 *   model: string,
 *   content: Array<{ type: "text", text: string } | { type: "tool_use", id: string, name: string, input: Record<string, unknown> }>,
 *   stop_reason: string,
 * }} AnthropicResponseBody
 *
 * @typedef {{
 *   url: string,
 *   token: string,
 *   model: string,
 * }} ChatProviderConfig
 *
 * @typedef {{
 *   id: "anthropic" | "openai",
 *   isConfigured: (cfg: ChatProviderConfig) => boolean,
 *   notConfiguredMessage: () => string,
 *   sendChat: (cfg: ChatProviderConfig, body: AnthropicRequestBody, signal: AbortSignal) => Promise<AnthropicResponseBody>,
 * }} ChatProvider
 */

/** @returns {ChatProvider} */
function createAnthropicChatProvider() {
  return {
    id: "anthropic",
    isConfigured: ({ url, token }) =>
      typeof url === "string" && url.length > 0 &&
      typeof token === "string" && token.length > 0,
    notConfiguredMessage: () =>
      "AI gateway is not configured. Open Settings → AI Gateway and pick a provider, then enter the URL and token.",
    async sendChat(cfg, body, signal) {
      // `body.model` already carries the dispatcher-provided value (the
      // OpenAI provider uses `cfg.model` directly because its native wire
      // doesn't include a `model` in the body). Spreading `body` is enough.
      const upstream = await fetch(
        `${cfg.url.replace(/\/+$/, "")}/v1/messages`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${cfg.token}`,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify(body),
          signal,
        },
      );
      if (!upstream.ok) {
        const text = await upstream.text();
        throw new Error(
          `upstream_${upstream.status}: ${text.slice(0, 500)}`,
        );
      }
      return /** @type {AnthropicResponseBody} */ (await upstream.json());
    },
  };
}

/** @returns {ChatProvider} */
function createOpenAIChatProvider() {
  return {
    id: "openai",
    isConfigured: ({ url, token }) =>
      typeof url === "string" && url.length > 0 &&
      typeof token === "string" && token.length > 0,
    notConfiguredMessage: () =>
      "OpenAI provider is not configured. Open Settings → AI Gateway, pick OpenAI, and enter the Base URL + API key.",
    async sendChat(cfg, body, signal) {
      // Anthropic → OpenAI request translation.
      //   • Anthropic `system` → OpenAI system message at the head.
      //   • Anthropic `tools[]` → OpenAI `tools[].function.parameters`
      //     (both APIs use JSON Schema for the function-parameter shape
      //     so `input_schema` passes through unchanged).
      const openaiMessages = body.system
        ? [{ role: "system", content: body.system }, ...body.messages]
        : [...body.messages];
      const openaiTools = Array.isArray(body.tools)
        ? body.tools.map((t) => ({
            type: "function",
            function: {
              name: t.name,
              description: t.description ?? "",
              parameters: t.input_schema,
            },
          }))
        : undefined;

      const upstream = await fetch(
        `${cfg.url.replace(/\/+$/, "")}/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${cfg.token}`,
          },
          body: JSON.stringify({
            model: cfg.model,
            max_tokens: body.max_tokens,
            messages: openaiMessages,
            ...(openaiTools ? { tools: openaiTools } : {}),
          }),
          signal,
        },
      );
      if (!upstream.ok) {
        const text = await upstream.text();
        throw new Error(
          `upstream_${upstream.status}: ${text.slice(0, 500)}`,
        );
      }

      // OpenAI → Anthropic response translation. Shape:
      //   { choices: [{ message: { content?, tool_calls? }, finish_reason }],
      //     model }
      const json = (await upstream.json()) || {};
      const choice = Array.isArray(json.choices) ? json.choices[0] : null;
      const content = [];
      const msg = choice?.message || {};
      if (typeof msg.content === "string" && msg.content.length > 0) {
        content.push({ type: "text", text: msg.content });
      }
      const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      for (const tc of toolCalls) {
        // `function.arguments` is a JSON-encoded string — parse so the
        // client sees a real `toolUseBlocks[].input` object. Falls back
        // to {} on parse failure (matches Anthropic's tolerance when a
        // model emits invalid JSON).
        let input = {};
        try {
          const parsed = JSON.parse(tc.function?.arguments || "{}");
          if (parsed && typeof parsed === "object") input = parsed;
        } catch {
          input = {};
        }
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function?.name || "",
          input,
        });
      }
      // Map finish_reason → stop_reason. Anthropic uses tool_use /
      // end_turn / max_tokens; OpenAI uses tool_calls / stop / length.
      const finish = choice?.finish_reason;
      const stopReason =
        finish === "tool_calls"
          ? "tool_use"
          : finish === "length"
            ? "max_tokens"
            : "end_turn";
      return {
        id: `chatcmpl-${Date.now()}`,
        type: "message",
        role: "assistant",
        model: json.model || cfg.model,
        content,
        stop_reason: stopReason,
      };
    },
  };
}

const CHAT_PROVIDERS = {
  anthropic: createAnthropicChatProvider,
  openai: createOpenAIChatProvider,
};

/** @returns {ChatProvider} */
function getChatProvider(id) {
  const factory = CHAT_PROVIDERS[id];
  if (factory) return factory();
  // Unknown / missing → default to anthropic. Matches the migration
  // choice: rows saved before the provider column existed (no header)
  // keep routing through the Anthropic provider until the user opens
  // Settings and picks OpenAI.
  return createAnthropicChatProvider();
}

async function proxyAiChat(req, res) {
  const headerValue = (name) => {
    const v = req.headers[name];
    return typeof v === "string" ? v.trim() : "";
  };
  // Provider id defaults to "anthropic" — rows saved before the
  // provider column existed (no header, no `provider` field) keep
  // routing through Anthropic until the user opens Settings.
  const providerId = headerValue("x-ai-chat-provider") || "anthropic";
  const cfg = {
    url: headerValue("x-ai-gateway-url"),
    token: headerValue("x-ai-gateway-token"),
    model: headerValue("x-ai-gateway-model") || "claude-sonnet-4-5",
  };
  const provider = getChatProvider(providerId);
  if (!provider.isConfigured(cfg)) {
    sendJson(res, 503, {
      error: "ai_not_configured",
      message: provider.notConfiguredMessage(),
    });
    return;
  }

  // One AbortSignal per request, shared by three abort sources:
  //   1. `req.on("close")` fires when the browser disconnects mid-call.
  //   2. `setTimeout(CHAT_TIMEOUT_MS)` caps the upstream fetch so a slow
  //      AI gateway can't hang the proxy forever — Cloud Run's default
  //      request timeout is 60s, and Azure App Gateway's is 30s, so we
  //      bail out well before either would reap the request from under
  //      us and surface the slowdown as a 502 the chat client can retry.
  //   3. `provider.sendChat` itself aborts on signal.
  //
  // IMPORTANT: `req.on("close")` in production also fires spuriously
  // during normal HTTP/1.1 keep-alive cleanup, or when an intermediate
  // hop (Azure ALB → Cloud Run → container) tears down its hop-level
  // connection for reasons unrelated to the user's intent (idle
  // reaper, instance recycling, response-was-already-streamed, etc).
  // The visible symptom is a 499 returned ~500 ms after the request
  // lands even though the browser never actually navigated away. We
  // treat that as a SOFT disconnect: we still tear down `res`, but we
  // keep the upstream call running so a client-side retry (now in the
  // 499 retry list) gets a fresh request that isn't fighting the dead
  // socket. The original response is logged-and-dropped.
  const abort = new AbortController();
  let responseStarted = false;
  let abortedReason = null;
  let bodyReadMs = null;
  let upstreamMs = null;
  const reqStartedAt = Date.now();
  const chatTimer = setTimeout(() => {
    abortedReason = "upstream_timeout";
    // eslint-disable-next-line no-console
    console.warn(
      `[prod-backend] /api/ai/chat upstream timeout fired after ${CHAT_TIMEOUT_MS}ms (provider=${providerId}, url=${cfg.url})`,
    );
    abort.abort();
  }, CHAT_TIMEOUT_MS);
  // Disconnect-only flag — flipped when the request body is closed
  // before we've sent a response. We do NOT abort the upstream fetch
  // here (see the IMPORTANT comment above); we just stop trying to
  // write to `res`. The upstream promise still resolves and the result
  // is logged-and-dropped.
  let disconnected = false;
  req.on("close", () => {
    // Node emits 'close' on the IncomingMessage TWICE in normal HTTP/1.1
    // keep-alive: once when the request is "completed" (we sent our
    // response), and again when the underlying socket closes. The first
    // is expected and not a bug; only the pre-response one is interesting.
    //
    // Production note: in production, this fires for LEGITIMATE
    // requests too (HTTP/1.1 keep-alive cleanup at the Cloud Run or
    // Azure LB hop, idle reaper, body-already-streamed). The 787007c
    // "soft disconnect" path was supposed to keep the upstream call
    // running but ended up also writing 499 on success because of
    // the dropResponse check below — and that's the bug making every
    // live chat fail (verified: live /api/ai/chat returns 499 in
    // 1.5s from Azure LB). We now ONLY set the bookkeeping flag and
    // log; the response-write paths deliberately ignore `disconnected`
    // and try to write the response anyway. If the socket really is
    // dead, sendJson → res.end() throws ERR_STREAM_DESTROYED / EPIPE
    // which we catch at each write site.
    if (responseStarted) return;
    const sinceStart = Date.now() - reqStartedAt;
    // eslint-disable-next-line no-console
    console.warn(
      `[prod-backend] /api/ai/chat req.close fired (pre-response) after ${sinceStart}ms — bodyReadMs=${bodyReadMs}, upstreamMs=${upstreamMs}, provider=${providerId}, url=${cfg.url}`,
    );
    disconnected = true;
  });

  try {
    const bodyReadStart = Date.now();
    const raw = await readBodyCapped(req, MAX_BODY_BYTES);
    bodyReadMs = Date.now() - bodyReadStart;
    const parsed = raw ? safeJsonParse(raw) : {};
    const userText = typeof parsed?.text === "string" ? parsed.text : "";
    const systemPrompt =
      typeof parsed?.system === "string"
        ? parsed.system
        : "You are the AI Assistant inside an Issue Tracker. Help the user understand their verification runs, issues, and configuration. Be concise. Two URL-handling paths exist: (1) if the user names a URL that is NOT in their configured targets and wants it VERIFIED (checks run, issues recorded), call verify_live_url; (2) if the user wants to SEE or INTERACT with a page live (open, show, click, snapshot, screenshot, inspect), call the browser_* tools — they drive a real headed Playwright browser through the official Playwright MCP server, and their results include element refs you can click next turn. When the user mentions Playwright explicitly, always prefer the browser_* tools.";
    const tools = Array.isArray(parsed?.tools) ? parsed.tools : undefined;

    // History: last 8 entries, {role:user|assistant, content:string ≤ 2000}.
    const history = Array.isArray(parsed?.history)
      ? parsed.history
          .filter(
            (m) =>
              m &&
              (m.role === "user" || m.role === "assistant") &&
              typeof m.content === "string" &&
              m.content.trim() !== "",
          )
          .slice(-8)
          .map((m) => ({
            role: m.role,
            content: m.content.slice(0, 2000),
          }))
      : [];

    // Provider receives an Anthropic-format body; each provider
    // factory translates to its native wire (or passes through for
    // Anthropic) and returns Anthropic-format JSON.
    const upstreamStart = Date.now();
    const response = await provider.sendChat(
      cfg,
      {
        model: cfg.model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [...history, { role: "user", content: userText }],
        ...(tools ? { tools } : {}),
      },
      abort.signal,
    );
    upstreamMs = Date.now() - upstreamStart;
    // eslint-disable-next-line no-console
    console.log(
      `[prod-backend] /api/ai/chat upstream returned in ${upstreamMs}ms (provider=${providerId}, responseKeys=${response && typeof response === "object" ? Object.keys(response).join(",") : typeof response})`,
    );
    clearTimeout(chatTimer);
    if (disconnected) {
      // Pre-response `req.close` fired but the upstream call already
      // produced a real answer.  In production the close event fires
      // spuriously for legitimate requests too (HTTP/1.1 keep-alive
      // cleanup, Azure ALB hop teardown, Cloud Run idle reaper), and
      // dropping the response here made every live chat land as 499.
      // We now TRY to write the response anyway — if the socket is
      // truly dead, sendJson → res.end() will throw ERR_STREAM_DESTROYED
      // and we catch it below.
      // eslint-disable-next-line no-console
      console.log(
        `[prod-backend] /api/ai/chat attempting write after req.close (upstream=${upstreamMs}ms, bodyRead=${bodyReadMs}ms)`,
      );
    }
    if (abort.signal.aborted) {
      // Upstream timeout fired. Don't try to write a 200-with-empty-body
      // — that's the bug that broke the chat UI (the client called
      // `res.json()` on an empty payload and threw "Unexpected end of
      // JSON input"). Send 499 (Nginx-style "Client Closed Request") so
      // the socket is cleanly closed AND the chat client's retry loop
      // — which now retries on 499/502/503/504/429 — has a chance to
      // succeed before falling through to its local mock fallback.
      // eslint-disable-next-line no-console
      console.warn(
        `[prod-backend] /api/ai/chat aborted (${abortedReason ?? "upstream_timeout"}) after upstream=${upstreamMs}ms bodyRead=${bodyReadMs}ms — returning 499`,
      );
      responseStarted = true;
      res.statusCode = 499;
      res.end();
      return;
    }
    responseStarted = true;
    sendJson(res, 200, response);
  } catch (err) {
    clearTimeout(chatTimer);
    if (abort.signal.aborted) {
      // eslint-disable-next-line no-console
      console.warn(
        `[prod-backend] /api/ai/chat upstream_timeout mid-error: ${
          err instanceof Error ? err.message : String(err)
        } (upstreamMs=${upstreamMs}, bodyReadMs=${bodyReadMs}) — returning 499`,
      );
      responseStarted = true;
      res.statusCode = 499;
      res.end();
      return;
    }
    // eslint-disable-next-line no-console
    console.warn(
      `[prod-backend] /api/ai/chat upstream failure (provider=${providerId}, url=${cfg.url}): ${
        err instanceof Error ? err.message : String(err)
      } (upstreamMs=${upstreamMs}, bodyReadMs=${bodyReadMs})`,
    );
    responseStarted = true;
    sendUpstreamError(res, err);
  }
}

// ────────────────────────────────────────────────────────────────────────────
//  POST /api/ai/avatar — vendor-agnostic port of vite.config.ts aiAvatarProxy.
//
//  Wire shape (JSON, matches the dev proxy so the client is the same
//  in both environments):
//    request:   { imageBase64: string, style?: string }
//    response:  { avatarDataUrl: string, contentType: string, durationMs: number }
//  Error codes: `avatar_not_configured` (503), `payload_too_large` (413),
//  `bad_request` (400), `upstream_failure` (502).
//
//  The selected provider (resolved per-request from `AI_AVATAR_PROVIDER`,
//  optionally overridden per-style via `AI_AVATAR_PROVIDER_BY_STYLE`)
//  owns the upstream call shape; this handler only handles body parsing,
//  the wall-clock timeout, and disconnect cleanup. Each provider MUST
//  respect `signal` so a timeout or a hung-up browser aborts the upstream
//  call cleanly.
// ────────────────────────────────────────────────────────────────────────────
async function proxyAiAvatar(req, res) {
  let raw;
  try {
    raw = await readBodyCapped(req, AVATAR_MAX_BODY_BYTES);
  } catch (err) {
    // readBodyCapped throws a statusCode-bearing Error on cap trips; route
    // it through the shared helper so 413 lands as `payload_too_large`,
    // not the generic 502.
    if (err && err.statusCode === 413) {
      sendJson(res, 413, {
        error: "payload_too_large",
        message: "Avatar request body too large",
      });
      return;
    }
    sendUpstreamError(res, err);
    return;
  }

  const parsed = raw ? safeJsonParse(raw) : {};
  const imageBase64 =
    typeof parsed?.imageBase64 === "string" ? parsed.imageBase64 : "";
  const style = typeof parsed?.style === "string" ? parsed.style : "3D";
  if (!imageBase64) {
    sendJson(res, 400, {
      error: "bad_request",
      message: "imageBase64 is required",
    });
    return;
  }

  // Per-request provider resolution: global `AI_AVATAR_PROVIDER` is the
  // default; `AI_AVATAR_PROVIDER_BY_STYLE` lets specific styles route to
  // a different upstream (e.g. free HF for "Anime", paid Replicate for
  // "3D").
  const provider = getAvatarProvider(style);

  // Per-request credential override. The Personal AI key lives in the
  // user's own row (`blx_UserAvatarConfigs`) and rides along on every
  // avatar request as `x-ai-avatar-{provider,token,model}`. The UI is
  // the SOLE source of truth — env values are NOT mixed in. If no user
  // override is set we 503 with a hint pointing at the Settings → Account
  // section, so the avatar button stays hidden until the user configures
  // their own key.
  const headerValue = (name) => {
    const v = req.headers[name];
    return typeof v === "string" ? v.trim() : "";
  };
  const userToken = headerValue("x-ai-avatar-token");
  const userModelVersion = headerValue("x-ai-avatar-model");
  if (!userToken) {
    sendJson(res, 503, {
      error: "avatar_not_configured",
      message:
        "Personal AI key is not set. Open Settings → Account → Personal AI Key and add your provider token to enable AI avatar generation.",
    });
    return;
  }
  // `provider.isConfigured()` is still checked so a future env-only
  // vendor (e.g. a HF-only deployment) can refuse to run when the env
  // token is missing — Replicate + HF both honor the override, but the
  // underlying model id may be hardcoded for env-only modes.
  if (!provider.isConfigured()) {
    sendJson(res, 503, {
      error: "avatar_not_configured",
      message: provider.notConfiguredMessage(),
    });
    return;
  }

  // One AbortSignal per request: fires on the wall-clock timeout OR when
  // the browser disconnects mid-generation. Providers must respect it —
  // Replicate aborts its poll loop, HF aborts the fetch.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), AVATAR_TIMEOUT_MS);
  let disconnected = false;
  let responseStarted = false;
  req.on("close", () => {
    // See proxyAiChat for the responseStarted rationale — Node fires
    // 'close' once at request completion (post-response, normal) and
    // again at socket teardown. Only the pre-response one is interesting.
    if (responseStarted) return;
    disconnected = true;
    abort.abort();
  });

  try {
    const result = await provider.generate(
      { imageBase64, style },
      abort.signal,
      {
        token: userToken,
        modelVersion: userModelVersion || undefined,
      },
    );
    clearTimeout(timer);
    if (disconnected) {
      // Browser hung up. Set 499 before res.end() so we never emit
      // an empty 200 — same defensive pattern as proxyAiChat.
      responseStarted = true;
      res.statusCode = 499;
      res.end();
      return;
    }
    responseStarted = true;
    sendJson(res, 200, result);
  } catch (err) {
    clearTimeout(timer);
    if (disconnected || abort.signal.aborted) {
      responseStarted = true;
      res.statusCode = 499;
      res.end();
      return;
    }
    responseStarted = true;
    sendJson(res, 502, {
      error: "upstream_failure",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

// ────────────────────────────────────────────────────────────────────────────
//  POST /api/verify/test — port of vite.config.ts:176-213.
// ────────────────────────────────────────────────────────────────────────────
async function proxyVerifyTest(req, res) {
  if (!VERIFY_URL) {
    sendJson(res, 503, {
      error: "verify_not_configured",
      message:
        "VERIFY_BACKEND_URL is not set on the prod-backend process. Real verification is unavailable.",
    });
    return;
  }
  try {
    const raw = await readBodyCapped(req, MAX_BODY_BYTES);
    const upstream = await fetch(`${VERIFY_URL}/verify/test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw,
    });
    const text = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader(
      "content-type",
      upstream.headers.get("content-type") ?? "application/json",
    );
    res.end(text);
  } catch (err) {
    sendUpstreamError(res, err);
  }
}

// ────────────────────────────────────────────────────────────────────────────
//  POST /api/verify/runs — port of vite.config.ts:237-287 (no /api prefix).
// ────────────────────────────────────────────────────────────────────────────
async function proxyVerifyRunsCreate(req, res) {
  if (!VERIFY_URL) {
    // Stub: synthesise a run id. The client doesn't read this stub
    // (VITE_USE_REAL_VERIFY is off in the production bundle) but if a
    // future build flips it on without setting VERIFY_BACKEND_URL, the
    // client still gets a usable shape.
    const runId = `run-${Math.random().toString(36).slice(2, 10)}`;
    sendJson(res, 200, {
      id: runId,
      status: "running",
      totalTargets: 0,
      completedTargets: 0,
      failedTargets: 0,
      startedAt: new Date().toISOString(),
      perApp: [],
      currentActivity: [],
      scope: [],
    });
    return;
  }
  try {
    const raw = await readBodyCapped(req, MAX_BODY_BYTES);
    const upstream = await fetch(`${VERIFY_URL}/verify/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw,
    });
    const text = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader(
      "content-type",
      upstream.headers.get("content-type") ?? "application/json",
    );
    res.end(text);
  } catch (err) {
    sendUpstreamError(res, err);
  }
}

// ────────────────────────────────────────────────────────────────────────────
//  GET /api/verify/runs?limit=N — port of vite.config.ts:291-319.
// ────────────────────────────────────────────────────────────────────────────
async function proxyVerifyRunsList(req, res, reqUrl) {
  if (!VERIFY_URL) {
    sendJson(res, 503, {
      error: "verify_not_configured",
      message: "VERIFY_BACKEND_URL is not set on the prod-backend process.",
    });
    return;
  }
  try {
    const qs = reqUrl.split("?")[1];
    const upstream = await fetch(
      `${VERIFY_URL}/verify/runs${qs ? `?${qs}` : ""}`,
      { headers: { accept: "application/json" } },
    );
    const text = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader(
      "content-type",
      upstream.headers.get("content-type") ?? "application/json",
    );
    res.end(text);
  } catch (err) {
    sendUpstreamError(res, err);
  }
}

// ────────────────────────────────────────────────────────────────────────────
//  GET /api/verify/runs/<id>/events — SSE. Port of vite.config.ts:333-430
//  with two additions:
//    * Drop `x-accel-buffering: no` (nginx-in-front header; we're the front).
//    * Cancel upstream reader on client disconnect so a hung-up browser
//      doesn't leak sockets on the MCP server.
// ────────────────────────────────────────────────────────────────────────────
async function proxyVerifyRunEvents(req, res, runId, reqUrl) {
  // SSE: override per-request timeout. The connection is meant to stay open
  // for the life of a verification run (potentially minutes).
  res.setTimeout(0);
  req.setTimeout(0);

  if (!VERIFY_URL) {
    // Stub SSE. Emit target_started immediately and run_completed at 5 s,
    // matching vite.config.ts:355-389.
    res.statusCode = 200;
    res.setHeader("content-type", "text/event-stream");
    res.setHeader("cache-control", "no-cache");
    res.setHeader("connection", "keep-alive");
    res.setHeader("vary", "Accept-Encoding");
    res.flushHeaders?.();

    const writeEvent = (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    writeEvent({
      kind: "target_started",
      runId,
      targetId: "stub",
      applicationName: "stub target",
    });
    const timer = setTimeout(() => {
      writeEvent({
        kind: "run_completed",
        runId,
        completedAt: new Date().toISOString(),
        failedTargets: 0,
      });
      res.end();
    }, 5000);
    req.on("close", () => clearTimeout(timer));
    return;
  }

  try {
    const qs = reqUrl.split("?")[1];
    const upstream = await fetch(
      `${VERIFY_URL}/verify/runs/${encodeURIComponent(runId)}/events${
        qs ? `?${qs}` : ""
      }`,
      { headers: { accept: "text/event-stream" } },
    );
    res.statusCode = upstream.status;
    res.setHeader(
      "content-type",
      upstream.headers.get("content-type") ?? "text/event-stream",
    );
    res.setHeader("cache-control", "no-cache");
    res.setHeader("connection", "keep-alive");
    res.setHeader("vary", "Accept-Encoding");

    if (upstream.body) {
      const reader = upstream.body.getReader();
      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            // Node http accepts Uint8Array via res.write — auto-converted.
            res.write(Buffer.from(value));
          }
          res.end();
        } catch {
          res.end();
        }
      };
      // Cancel upstream if the client hangs up so the MCP server's socket
      // is released immediately (missing in both the Vite proxy and the
      // dev stub; cheap and important).
      req.on("close", () => {
        reader.cancel().catch(() => {});
      });
      pump();
    } else {
      res.end();
    }
  } catch (err) {
    sendUpstreamError(res, err);
  }
}

// ────────────────────────────────────────────────────────────────────────────
//  /api/secrets — port of vite.config.ts:546-627. Password masking
//  belt-and-braces matches the dev proxy so a misconfigured backend can
//  never leak plaintext into the bundle.
// ────────────────────────────────────────────────────────────────────────────
const maskSecret = (pw) =>
  "•".repeat(Math.min(12, Math.max(6, pw.length)));

async function proxySecrets(req, res, pathname) {
  if (!VERIFY_URL) {
    sendJson(res, 503, {
      error: "verify_not_configured",
      message:
        "VERIFY_BACKEND_URL is not set on the prod-backend process. Real secret storage is unavailable.",
    });
    return;
  }
  try {
    const isDelete = req.method === "DELETE";
    // Strip the /api prefix before forwarding. DELETE keeps the trailing
    // /:id so the upstream gets the full path; GET/POST hit /secrets.
    const upstreamPath =
      isDelete && pathname !== "/api/secrets"
        ? `/secrets${pathname.slice("/api".length)}`
        : "/secrets";
    const upstream = await fetch(`${VERIFY_URL}${upstreamPath}`, {
      method: req.method,
      headers: { "content-type": "application/json" },
      body: ["POST", "PUT", "PATCH"].includes(req.method ?? "")
        ? await readBodyCapped(req, MAX_BODY_BYTES)
        : undefined,
    });
    if ((req.method === "GET" || req.method === "POST") && upstream.ok) {
      const raw = await upstream.text();
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
      const stripPassword = (s) => {
        if (s && typeof s.password === "string") {
          s.passwordMasked = maskSecret(s.password);
          delete s.password;
        }
      };
      if (Array.isArray(parsed)) {
        for (const s of parsed) stripPassword(s);
      } else if (parsed && typeof parsed === "object") {
        stripPassword(parsed);
      }
      res.statusCode = upstream.status;
      res.setHeader(
        "content-type",
        upstream.headers.get("content-type") ?? "application/json",
      );
      res.end(JSON.stringify(parsed));
      return;
    }
    const text = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader(
      "content-type",
      upstream.headers.get("content-type") ?? "application/json",
    );
    res.end(text);
  } catch (err) {
    sendUpstreamError(res, err);
  }
}

// ────────────────────────────────────────────────────────────────────────────
//  /api/evidence — port of vite.config.ts:451-496. Stream raw bytes so
//  screenshot PNGs survive the round trip without JSON re-encoding.
// ────────────────────────────────────────────────────────────────────────────
async function proxyEvidence(req, res, reqUrl) {
  if (!VERIFY_URL) {
    sendJson(res, 503, {
      error: "verify_not_configured",
      message:
        "VERIFY_BACKEND_URL is not set on the prod-backend process. Evidence streaming is unavailable.",
    });
    return;
  }
  try {
    const upstreamPath = reqUrl.replace(/^\/api/, "");
    const upstream = await fetch(`${VERIFY_URL}${upstreamPath}`, {
      method: req.method,
      headers: { "content-type": "application/json" },
      body:
        req.method === "POST"
          ? await readBodyCapped(req, MAX_BODY_BYTES)
          : undefined,
    });
    res.statusCode = upstream.status;
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("content-type", ct);
    const cc = upstream.headers.get("cache-control");
    if (cc) res.setHeader("cache-control", cc);
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.end(buf);
  } catch (err) {
    sendUpstreamError(res, err);
  }
}

// ────────────────────────────────────────────────────────────────────────────
//  /api/playwright — port of vite.config.ts:506-544.
// ────────────────────────────────────────────────────────────────────────────
async function proxyPlaywright(req, res, reqUrl) {
  if (!VERIFY_URL) {
    sendJson(res, 503, {
      error: "verify_not_configured",
      message:
        "VERIFY_BACKEND_URL is not set — the Playwright MCP bridge is unavailable.",
    });
    return;
  }
  try {
    const upstreamPath = reqUrl.replace(/^\/api/, "");
    const upstream = await fetch(`${VERIFY_URL}/playwright${upstreamPath}`, {
      method: req.method,
      headers: { "content-type": "application/json" },
      body:
        req.method === "POST"
          ? await readBodyCapped(req, MAX_BODY_BYTES)
          : undefined,
    });
    res.statusCode = upstream.status;
    res.setHeader(
      "content-type",
      upstream.headers.get("content-type") ?? "application/json",
    );
    res.end(await upstream.text());
  } catch (err) {
    sendUpstreamError(res, err);
  }
}

// ────────────────────────────────────────────────────────────────────────────
//  Static SPA — replaces nginx.conf lines 13-43.
// ────────────────────────────────────────────────────────────────────────────
function handleStatic(req, res, pathname) {
  // /favicon.ico — there's no favicon in dist/. Return 204 so the browser
  // stops asking and we don't pollute logs with index.html hits.
  if (pathname === "/favicon.ico") {
    res.statusCode = 204;
    return res.end();
  }

  // Decode + sanitize. Reject path traversal.
  let safeRel;
  try {
    safeRel = decodeURIComponent(pathname);
  } catch {
    return sendJson(res, 400, { error: "bad_request" });
  }
  const safe = path.resolve(DIST_DIR, "." + safeRel);
  if (!safe.startsWith(DIST_DIR + path.sep) && safe !== DIST_DIR) {
    return sendJson(res, 404, { error: "not_found" });
  }

  let stat;
  try {
    stat = fs.statSync(safe);
  } catch {
    // File not found. Decide between 404 and SPA fallback:
    //  * SPA route (no extension): serve index.html.
    //  * Static asset (with extension): 404 — a missing hash is a broken
    //    build; don't paper over it with index.html.
    if (!HAS_EXTENSION_RE.test(pathname)) {
      return serveIndex(req, res);
    }
    return sendJson(res, 404, { error: "not_found", path: pathname });
  }

  // Directory → SPA fallback (matches nginx try_files $uri $uri/).
  if (stat.isDirectory()) {
    return serveIndex(req, res);
  }

  // File found. Determine cache policy.
  const isIndex = pathname === "/index.html";
  const isAssets = ASSETS_RE.test(pathname);

  // ETag — weak validator based on mtime + size. Cheap, no full-hash.
  const etag = `"${crypto
    .createHash("sha1")
    .update(`${stat.mtimeMs}-${stat.size}`)
    .digest("base64")
    .slice(0, 22)}"`;
  res.setHeader("etag", etag);
  if (req.headers["if-none-match"] === etag) {
    res.statusCode = 304;
    return res.end();
  }

  if (isIndex) {
    res.setHeader("cache-control", "no-store");
    res.setHeader("pragma", "no-cache");
  } else if (isAssets) {
    res.setHeader(
      "cache-control",
      "public, max-age=31536000, immutable",
    );
  }

  res.setHeader("accept-ranges", "bytes");
  res.setHeader("vary", "Accept-Encoding");

  const ext = path.extname(safe).toLowerCase();
  const contentType = MIME[ext] ?? "application/octet-stream";

  // Range request — honour `bytes=<start>-<end>` with 206 + Content-Range.
  const range = req.headers.range;
  if (range && /^bytes=\d*-\d*$/.test(range)) {
    const [startStr, endStr] = range.replace(/^bytes=/, "").split("-");
    const start = startStr ? parseInt(startStr, 10) : 0;
    const end = endStr ? Math.min(parseInt(endStr, 10), stat.size - 1) : stat.size - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
      res.statusCode = 416;
      res.setHeader("content-range", `bytes */${stat.size}`);
      return res.end();
    }
    const chunkLen = end - start + 1;
    res.statusCode = 206;
    res.setHeader("content-range", `bytes ${start}-${end}/${stat.size}`);
    res.setHeader("content-length", chunkLen);
    res.setHeader("content-type", contentType);
    if (req.method === "HEAD") return res.end();
    return pipeFileRange(res, safe, start, chunkLen, contentType, req);
  }

  // Plain 200. Set content-length up front for HEAD support and for clients
  // that don't do chunked decoding (some load balancers prefer it).
  res.statusCode = 200;
  res.setHeader("content-length", stat.size);
  res.setHeader("content-type", contentType);
  if (req.method === "HEAD") return res.end();
  serveBody(res, safe, stat.size, contentType, req);
}

function serveIndex(req, res) {
  const safe = path.join(DIST_DIR, "index.html");
  let stat;
  try {
    stat = fs.statSync(safe);
  } catch {
    return sendJson(res, 500, { error: "missing_dist" });
  }
  res.setHeader("cache-control", "no-store");
  res.setHeader("pragma", "no-cache");
  res.setHeader("vary", "Accept-Encoding");
  res.setHeader("content-type", MIME[".html"]);
  res.setHeader("content-length", stat.size);
  res.statusCode = 200;
  if (req.method === "HEAD") return res.end();
  serveBody(res, safe, stat.size, MIME[".html"], req);
}

function serveBody(res, filePath, size, contentType, req) {
  const stream = fs.createReadStream(filePath);
  const acceptsGzip =
    (req.headers["accept-encoding"] ?? "").includes("gzip") &&
    TEXT_GZIP_TYPES.has(contentType.split(";")[0]) &&
    size >= 1024;
  if (!acceptsGzip) {
    stream.on("error", () => res.destroy());
    stream.pipe(res);
    return;
  }
  // gzip — strip content-length (we don't know the compressed size yet),
  // let Node send Transfer-Encoding: chunked.
  res.removeHeader("content-length");
  res.setHeader("content-encoding", "gzip");
  const gz = zlib.createGzip({ level: 6 });
  stream.on("error", () => {
    gz.destroy();
    res.destroy();
  });
  gz.on("error", () => res.destroy());
  stream.pipe(gz).pipe(res);
}

function pipeFileRange(res, filePath, start, chunkLen, contentType, req) {
  const stream = fs.createReadStream(filePath, { start, end: start + chunkLen - 1 });
  stream.on("error", () => res.destroy());
  // Range responses are NOT gzipped — clients that ask for a byte range
  // usually want raw bytes (e.g. media seeking), and the compressed-range
  // story is messy. Keep it simple.
  stream.pipe(res);
}

// ────────────────────────────────────────────────────────────────────────────
//  Helpers
// ────────────────────────────────────────────────────────────────────────────
function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

// Catch-block helper. Honours an `err.statusCode` thrown by readBodyCapped
// so body-cap trips land as 413 (not 502). Everything else is upstream_failure.
function sendUpstreamError(res, err) {
  if (err && typeof err.statusCode === "number") {
    sendJson(res, err.statusCode, {
      error: err.statusCode === 413 ? "payload_too_large" : "request_error",
      message: err.message,
    });
    return;
  }
  sendJson(res, 502, {
    error: "upstream_failure",
    message: err instanceof Error ? err.message : String(err),
  });
}

async function readBodyCapped(req, maxBytes) {
  // If the client declared Content-Length, reject up front so we never
  // start streaming an oversized body. Cheaper than reading until the
  // counter trips.
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > maxBytes) {
    const err = new Error("payload_too_large");
    err.statusCode = 413;
    throw err;
  }
  const chunks = [];
  let received = 0;
  for await (const chunk of req) {
    received += chunk.length;
    if (received > maxBytes) {
      // Don't req.destroy() — that tears down the response stream and the
      // client never sees a status. Just stop accumulating and surface a
      // 413 via the wrapper's try/catch.
      const err = new Error("payload_too_large");
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
