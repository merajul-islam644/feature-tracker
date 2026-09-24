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
//  Blocks platform sets $PORT; AI_GATEWAY_* / VERIFY_BACKEND_URL arrive via
//  `blocks release deploy --with-secrets .env.production`. We also accept the
//  ANTHROPIC_* aliases (same convention as the Vite proxy and as Claude Code
//  itself) so users who set those instead still Just Work.
// ────────────────────────────────────────────────────────────────────────────
const GATEWAY_URL = (
  process.env.AI_GATEWAY_URL ?? process.env.ANTHROPIC_BASE_URL ?? ""
).replace(/\/+$/, "");
const GATEWAY_TOKEN =
  process.env.AI_GATEWAY_TOKEN ?? process.env.ANTHROPIC_AUTH_TOKEN ?? "";
const GATEWAY_MODEL =
  process.env.AI_GATEWAY_MODEL ??
  process.env.ANTHROPIC_MODEL ??
  "claude-sonnet-4-5";
const VERIFY_URL = (process.env.VERIFY_BACKEND_URL ?? "").replace(/\/+$/, "");
const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN ?? "";
const REPLICATE_MODEL =
  process.env.REPLICATE_AVATAR_MODEL ?? "fofr/face-to-many";
const REPLICATE_VERSION = process.env.REPLICATE_AVATAR_MODEL_VERSION ?? "";
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
  // eslint-disable-next-line no-console
  console.log(`[prod-backend]   AI_GATEWAY_URL=${GATEWAY_URL || "(unset — /api/ai/chat returns 503)"}`);
  // eslint-disable-next-line no-console
  console.log(`[prod-backend]   AI_GATEWAY_TOKEN=${GATEWAY_TOKEN ? "(set)" : "(unset — /api/ai/chat returns 503)"}`);
  // eslint-disable-next-line no-console
  console.log(`[prod-backend]   VERIFY_BACKEND_URL=${VERIFY_URL || "(unset — /api/verify/* returns 503)"}`);
  // eslint-disable-next-line no-console
  console.log(`[prod-backend]   REPLICATE_API_TOKEN=${REPLICATE_TOKEN ? "(set)" : "(unset — /api/ai/avatar returns 503)"}`);
  // eslint-disable-next-line no-console
  console.log(`[prod-backend]   REPLICATE_AVATAR_MODEL=${REPLICATE_MODEL}`);
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

  // POST /api/ai/avatar — Replicate face stylization. Returns the
  // generated image as a data URL so the browser can render it without a
  // CORS round-trip.
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
//  POST /api/ai/chat — port of vite.config.ts aiChatProxy (lines 33-134).
// ────────────────────────────────────────────────────────────────────────────
async function proxyAiChat(req, res) {
  if (!GATEWAY_URL || !GATEWAY_TOKEN) {
    sendJson(res, 503, {
      error: "ai_not_configured",
      message:
        "AI_GATEWAY_URL (or ANTHROPIC_BASE_URL) and AI_GATEWAY_TOKEN (or ANTHROPIC_AUTH_TOKEN) must be set on the prod-backend process.",
    });
    return;
  }

  try {
    const raw = await readBodyCapped(req, MAX_BODY_BYTES);
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

    const upstream = await fetch(`${GATEWAY_URL}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${GATEWAY_TOKEN}`,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: GATEWAY_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [...history, { role: "user", content: userText }],
        ...(tools ? { tools } : {}),
      }),
    });

    const upstreamText = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader(
      "content-type",
      upstream.headers.get("content-type") ?? "application/json",
    );
    res.end(upstreamText);
  } catch (err) {
    sendUpstreamError(res, err);
  }
}

// ────────────────────────────────────────────────────────────────────────────
//  POST /api/ai/avatar — port of vite.config.ts aiAvatarProxy.
//
//  Wire shape (JSON, matches the dev proxy so the client is the same
//  in both environments):
//    request:   { imageBase64: string, style?: string }
//    response:  { avatarDataUrl: string, contentType: string, durationMs: number }
//  Error codes: `avatar_not_configured` (503), `payload_too_large` (413),
//  `bad_request` (400), `avatar_timeout` (504), `upstream_failure` (502).
// ────────────────────────────────────────────────────────────────────────────
async function proxyAiAvatar(req, res) {
  if (!REPLICATE_TOKEN) {
    sendJson(res, 503, {
      error: "avatar_not_configured",
      message:
        "REPLICATE_API_TOKEN is not set on the prod-backend process. Set it (and optionally REPLICATE_AVATAR_MODEL / REPLICATE_AVATAR_MODEL_VERSION) to enable AI avatar generation.",
    });
    return;
  }

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

  const inputImage = imageBase64.startsWith("data:")
    ? imageBase64
    : `data:image/jpeg;base64,${imageBase64}`;

  // Pin version when set; otherwise send the model name so Replicate
  // resolves the latest version. Identical policy to the dev proxy.
  const createBody = {
    input: {
      image: inputImage,
      style,
      prompt: "",
      prompt_strength: 0.9,
      number_of_images: 1,
      disable_safety_checker: true,
    },
    ...(REPLICATE_VERSION
      ? { version: REPLICATE_VERSION }
      : { model: REPLICATE_MODEL }),
  };

  const start = Date.now();
  let createRes;
  try {
    createRes = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Token ${REPLICATE_TOKEN}`,
      },
      body: JSON.stringify(createBody),
    });
  } catch (err) {
    sendUpstreamError(res, err);
    return;
  }

  if (!createRes.ok) {
    const text = await createRes.text();
    sendJson(res, createRes.status, {
      error: "upstream_failure",
      message: `Replicate create failed: ${text.slice(0, 500)}`,
    });
    return;
  }

  const prediction = await createRes.json();
  const predictionId = prediction?.id;
  if (!predictionId) {
    sendJson(res, 502, {
      error: "upstream_failure",
      message: "Replicate returned no prediction id",
    });
    return;
  }

  // Poll until settled / timeout / browser disconnect. The chat / verify
  // helpers don't need this; the avatar handler is the only one whose
  // upstream is genuinely async. req.on("close") is best-effort — Node
  // keeps the connection alive for the duration of the wait regardless,
  // but if the client disconnects we stop polling.
  let final = prediction;
  let aborted = false;
  req.on("close", () => {
    aborted = true;
  });

  while (!aborted) {
    if (Date.now() - start > AVATAR_TIMEOUT_MS) {
      fetch(
        `https://api.replicate.com/v1/predictions/${predictionId}/cancel`,
        {
          method: "POST",
          headers: { authorization: `Token ${REPLICATE_TOKEN}` },
        },
      ).catch(() => {});
      sendJson(res, 504, {
        error: "avatar_timeout",
        message:
          "AI avatar generation took too long. Try again with a different photo or style.",
      });
      return;
    }
    if (
      final.status === "succeeded" ||
      final.status === "failed" ||
      final.status === "canceled"
    ) {
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
    const pollRes = await fetch(
      `https://api.replicate.com/v1/predictions/${predictionId}`,
      { headers: { authorization: `Token ${REPLICATE_TOKEN}` } },
    );
    if (pollRes.ok) {
      final = await pollRes.json();
    }
  }
  if (aborted) {
    fetch(
      `https://api.replicate.com/v1/predictions/${predictionId}/cancel`,
      {
        method: "POST",
        headers: { authorization: `Token ${REPLICATE_TOKEN}` },
      },
    ).catch(() => {});
    res.end();
    return;
  }
  if (final.status !== "succeeded") {
    sendJson(res, 502, {
      error: "upstream_failure",
      message:
        typeof final?.error === "string"
          ? final.error
          : `prediction ${final.status}`,
    });
    return;
  }

  const output = final.output;
  const firstUrl = Array.isArray(output)
    ? output.find((v) => typeof v === "string")
    : typeof output === "string"
      ? output
      : null;
  if (!firstUrl) {
    sendJson(res, 502, {
      error: "upstream_failure",
      message: "Replicate returned no output URL",
    });
    return;
  }

  let dlRes;
  try {
    dlRes = await fetch(firstUrl);
  } catch (err) {
    sendUpstreamError(res, err);
    return;
  }
  if (!dlRes.ok) {
    sendJson(res, 502, {
      error: "upstream_failure",
      message: `Failed to download avatar (${dlRes.status})`,
    });
    return;
  }
  const mime = dlRes.headers.get("content-type") ?? "image/png";
  const buf = Buffer.from(await dlRes.arrayBuffer());
  const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
  const durationMs = Date.now() - start;
  sendJson(res, 200, {
    avatarDataUrl: dataUrl,
    contentType: mime,
    durationMs,
  });
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
