import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import type { ServerResponse } from "http";

// Server-side proxy for the Issue Tracker AI Assistant. The browser posts to
// `/api/ai/chat` on the Vite dev server; this middleware forwards to the
// upstream gateway at `${AI_GATEWAY_URL}/v1/messages`, attaching the bearer
// token from server-side env vars. The token is intentionally NEVER prefixed
// with `VITE_` so it cannot be imported by the client bundle — only the Vite
// Node process reads it.
//
// Falls back to the `ANTHROPIC_*` aliases (`ANTHROPIC_BASE_URL`,
// `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_MODEL`) when the canonical names are
// unset, so `setx ANTHROPIC_AUTH_TOKEN "..."` on Windows Just Works.
//
// `env` is the loadEnv() record built in defineConfig — it merges .env file
// values with the shell's process.env (process.env wins), so the server
// picks up AI_GATEWAY_MODEL etc. from .env without the shell exporting them.
// Without this, a dev server started from a shell without these vars fell
// back to the default model and the gateway routed it to the wrong
// (quota-exhausted) model group.
function aiChatProxy(env: Record<string, string>): Plugin {
  const gatewayUrl = env.AI_GATEWAY_URL ?? env.ANTHROPIC_BASE_URL ?? "";
  const token = env.AI_GATEWAY_TOKEN ?? env.ANTHROPIC_AUTH_TOKEN ?? "";
  const model = env.AI_GATEWAY_MODEL ?? env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";

  return {
    name: "feature-tracker:ai-chat-proxy",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api/ai/chat", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "method_not_allowed" }));
          return;
        }
        if (!gatewayUrl || !token) {
          res.statusCode = 503;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              error: "ai_not_configured",
              message:
                "AI_GATEWAY_URL (or ANTHROPIC_BASE_URL) and AI_GATEWAY_TOKEN (or ANTHROPIC_AUTH_TOKEN) must be set on the Vite server process.",
            }),
          );
          return;
        }

        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const raw = Buffer.concat(chunks).toString("utf8");
          const parsed = raw ? JSON.parse(raw) : {};
          const userText =
            typeof parsed?.text === "string" ? parsed.text : "";
          const systemPrompt =
            typeof parsed?.system === "string"
              ? parsed.system
              : "You are the AI Assistant inside an Issue Tracker. Help the user understand their verification runs, issues, and configuration. Be concise. Two URL-handling paths exist: (1) if the user names a URL that is NOT in their configured targets and wants it VERIFIED (checks run, issues recorded), call verify_live_url; (2) if the user wants to SEE or INTERACT with a page live (open, show, click, snapshot, screenshot, inspect), call the browser_* tools — they drive a real headed Playwright browser through the official Playwright MCP server, and their results include element refs you can click next turn. When the user mentions Playwright explicitly, always prefer the browser_* tools.";
          // Forward the client-supplied tool definitions so the model can
          // emit `tool_use` blocks. Anthropic expects a JSON-serialisable
          // `tools` array; we re-shape to drop anything non-essential.
          const tools = Array.isArray(parsed?.tools)
            ? parsed.tools
            : undefined;
          // Optional short conversation history (the AI call is stateless
          // per message). The Playwright MCP workflow is a cycle —
          // navigate → snapshot → interact with a ref → re-snapshot — so
          // the model needs the last few turns to know which refs it saw
          // and what it already did. Entries are {role, content} strings;
          // anything else is dropped. The params carry explicit shapes
          // because the array arrives as `any` from JSON.parse — without
          // them tsc -b flags the callbacks as implicit any.
          type HistoryEntry = { role?: unknown; content?: unknown };
          const history: Array<{ role: "user" | "assistant"; content: string }> =
            Array.isArray(parsed?.history)
              ? (parsed.history as HistoryEntry[])
                  .filter(
                    (m): m is { role: unknown; content: string } =>
                      !!m &&
                      (m.role === "user" || m.role === "assistant") &&
                      typeof m.content === "string" &&
                      m.content.trim() !== "",
                  )
                  .slice(-8)
                  .map((m) => ({
                    role: m.role as "user" | "assistant",
                    content: m.content.slice(0, 2000),
                  }))
              : [];

          const upstreamUrl =
            gatewayUrl.replace(/\/+$/, "") + "/v1/messages";
          const upstream = await fetch(upstreamUrl, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${token}`,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model,
              // 4096 — agentic browser walkthroughs end with a long
              // evidence report (findings tables + next-step narration),
              // which overflowed the older 2048 cap mid-sentence.
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
          res.statusCode = 502;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              error: "upstream_failure",
              message: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      });
    },
  };
}

// Server-side proxy for the Issue Tracker verification endpoints (MCP).
// Same shape as aiChatProxy: when VERIFY_BACKEND_URL is unset the proxy
// returns 503, and the client falls back to the in-browser mock so the UI
// keeps working in dev without a backend running. Today's flow (Test
// Connection against a fake URL) is fully preserved when
// `VITE_USE_REAL_VERIFY` is unset on the client.
function verifyProxy(env: Record<string, string>): Plugin {
  // Default to the local MCP server (mcp-server/ sub-folder). When the
  // env var is set to an empty string explicitly, the proxy keeps the
  // previous in-process stub behaviour (503). Set it to any other URL
  // to forward to that backend. `env` comes from loadEnv() so a value
  // in .env works without the shell exporting it.
  const backendUrl = (
    env.VERIFY_BACKEND_URL !== undefined
      ? env.VERIFY_BACKEND_URL
      : "http://localhost:8787"
  ).replace(/\/+$/, "");

  return {
    name: "feature-tracker:verify-proxy",
    apply: "serve",
    configureServer(server) {
      const notConfigured = (res: ServerResponse) => {
        res.statusCode = 503;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            error: "verify_not_configured",
            message:
              "VERIFY_BACKEND_URL is not set on the Vite server. Set it (and VITE_USE_REAL_VERIFY=1 on the client) to enable real verification.",
          }),
        );
      };

      // POST /api/verify/test — single-target probe. The backend is expected
      // to do a headless HTTP check (and, when a credential is bound, a
      // login attempt) and return { urlReachable, loginSuccessful }.
      server.middlewares.use("/api/verify/test", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "method_not_allowed" }));
          return;
        }
        if (!backendUrl) {
          notConfigured(res);
          return;
        }
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const raw = Buffer.concat(chunks).toString("utf8");
          const upstream = await fetch(`${backendUrl}/verify/test`, {
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
          res.statusCode = 502;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              error: "upstream_failure",
              message: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      });

      // POST /api/verify/runs and GET /api/verify/runs/:id/events — the
      // run lifecycle. The stub backend (when VERIFY_BACKEND_URL is unset)
      // returns a fake run id and emits a single run_completed SSE event
      // 5s later, just enough to prove the wire-up works. Real progress
      // emissions land in MCP step 5.
      //
      // Note on Connect middleware prefix matching: `/api/verify/runs`
      // matches BOTH the bare path AND `/api/verify/runs/<id>/events`.
      // When the prefix matches a sub-path, we call `next()` so the
      // trailing-slash handler below can take over. Without this the
      // GET SSE stream would hit the bare handler's 405 fallback.
      server.middlewares.use("/api/verify/runs", async (req, res, next) => {
        // Sub-path (`/api/verify/runs/<id>/...`) belongs to the
        // trailing-slash handler — defer. Compare the path WITHOUT the
        // query string: Connect leaves `?...` on req.url, and a bare
        // `/?limit=10` used to slip past this check into the sub-path
        // handler (404).
        const pathOnly = (req.url ?? "/").split("?")[0];
        const qs = (req.url ?? "").split("?")[1];
        if (pathOnly !== "/" && pathOnly !== "") {
          return (next as (err?: unknown) => void)?.();
        }
        if (req.method === "POST") {
          if (!backendUrl) {
            // Stub: synthesize a run id, ignore the request body. The
            // matching SSE stream lives in the GET handler below; we share
            // the id via a process-level Map so the same run id connects
            // POST and GET.
            const runId = `run-${Math.random().toString(36).slice(2, 10)}`;
            res.statusCode = 200;
            res.setHeader("content-type", "application/json");
            res.end(
              JSON.stringify({
                id: runId,
                status: "running",
                totalTargets: 0,
                completedTargets: 0,
                failedTargets: 0,
                startedAt: new Date().toISOString(),
                perApp: [],
                currentActivity: [],
                scope: [],
              }),
            );
            return;
          }
          try {
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            const raw = Buffer.concat(chunks).toString("utf8");
            const upstream = await fetch(`${backendUrl}/verify/runs`, {
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
            res.statusCode = 502;
            res.setHeader("content-type", "application/json");
            res.end(
              JSON.stringify({
                error: "upstream_failure",
                message: err instanceof Error ? err.message : String(err),
              }),
            );
          }
          return;
        }
        // GET /api/verify/runs?limit=N — run history listing. Forwards the
        // query so the cap is respected upstream.
        if (req.method === "GET") {
          if (!backendUrl) {
            notConfigured(res);
            return;
          }
          try {
            const upstream = await fetch(
              `${backendUrl}/verify/runs${qs ? `?${qs}` : ""}`,
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
            res.statusCode = 502;
            res.setHeader("content-type", "application/json");
            res.end(
              JSON.stringify({
                error: "upstream_failure",
                message: err instanceof Error ? err.message : String(err),
              }),
            );
          }
          return;
        }
        res.statusCode = 405;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "method_not_allowed" }));
      });

      // GET /api/verify/runs/:id/events — Server-Sent Events stream.
      // Stub behaviour (no backend): write the standard SSE preamble,
      // schedule a run_completed event 5s later, then close. Real
      // behaviour: pipe the upstream SSE response straight through.
      //
      // The in-app preview overlay was removed — the headed Playwright
      // browser window is the only preview surface, so there is no
      // `/interact` forwarding endpoint any more.
      server.middlewares.use("/api/verify/runs/", async (req, res) => {
        const pathAfterPrefix = (req.url ?? "/").split("?")[0] ?? "/";
        // Forward the query string (notably `since=<cursor>`) so the
        // client's SSE reconnect can resume from where it dropped —
        // without it the upstream replays the whole run and every event
        // re-fires on the client.
        const qs = (req.url ?? "").split("?")[1];

        if (req.method !== "GET" || !pathAfterPrefix.includes("/events")) {
          res.statusCode = 404;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "not_found" }));
          return;
        }
        // req.url here is `/<runId>/events` — Connect already stripped
        // the `/api/verify/runs/` mount prefix before this middleware saw
        // the request, so the only surgery needed is to peel off the
        // leading `/` and the trailing `/events`. `pathAfterPrefix` was
        // already extracted at the top of the handler.
        const runId = decodeURIComponent(
          pathAfterPrefix.replace(/^\//, "").replace(/\/events$/, ""),
        );
        if (!backendUrl) {
          // Stub SSE: declare the stream, then emit one event after a
          // delay. EventSource on the client side auto-reconnects on
          // drop, so closing the connection is the cleanest signal that
          // the run finished.
          res.statusCode = 200;
          res.setHeader("content-type", "text/event-stream");
          res.setHeader("cache-control", "no-cache");
          res.setHeader("connection", "keep-alive");
          res.setHeader("x-accel-buffering", "no");
          res.flushHeaders?.();
          const writeEvent = (event: object) => {
            res.write(`data: ${JSON.stringify(event)}\n\n`);
          };
          // Greet with a target_started so the client has something to
          // react to before the 5s elapse. Step 5 will replace this with
          // real per-target progress.
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
          const upstream = await fetch(
            `${backendUrl}/verify/runs/${encodeURIComponent(runId)}/events${qs ? `?${qs}` : ""}`,
            { headers: { accept: "text/event-stream" } },
          );
          res.statusCode = upstream.status;
          res.setHeader(
            "content-type",
            upstream.headers.get("content-type") ?? "text/event-stream",
          );
          res.setHeader("cache-control", "no-cache");
          res.setHeader("connection", "keep-alive");
          if (upstream.body) {
            const reader = upstream.body.getReader();
            const pump = async () => {
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  res.write(Buffer.from(value));
                }
                res.end();
              } catch {
                res.end();
              }
            };
            pump();
          } else {
            res.end();
          }
        } catch (err) {
          res.statusCode = 502;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              error: "upstream_failure",
              message: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      });

      // ──────────────────────────────────────────────────────────────────
      //  POST/GET/DELETE /api/secrets — credential storage round-trip
      //  (MCP step 6). Real backend will encrypt at rest; the proxy
      //  itself masks the password before responding so the wire shape
      //  matches and so a misconfigured backend can never leak plaintext
      //  into the browser bundle. Without a backend the proxy responds
      //  503 (matches the other /api/verify/* endpoints) and the client
      //  falls back to its in-browser mock.
      // ──────────────────────────────────────────────────────────────────
      const maskSecret = (pw: string) =>
        "•".repeat(Math.min(12, Math.max(6, pw.length)));

      // ──────────────────────────────────────────────────────────────────
      //  GET/POST /api/evidence — artifact storage (MCP step 7). The
      //  browser resolves `Evidence.storageRef` via `/api/evidence/:ref`,
      //  which the proxy forwards. The GET response is streamed raw so
      //  the original content-type (image/png, text/plain) reaches the
      //  <img> tag without being re-encoded as JSON.
      // ──────────────────────────────────────────────────────────────────
      server.middlewares.use("/api/evidence", async (req, res) => {
        if (!backendUrl) {
          res.statusCode = 503;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              error: "verify_not_configured",
              message:
                "VERIFY_BACKEND_URL is not set on the Vite server. Evidence streaming is unavailable.",
            }),
          );
          return;
        }
        try {
          // Strip the /api prefix before forwarding — the stub backend
          // mounts these under /secrets, /evidence, /verify/*.
          const upstreamPath = (req.url ?? "/").replace(/^\/api/, "");
          const upstream = await fetch(`${backendUrl}${upstreamPath}`, {
            method: req.method,
            headers: { "content-type": "application/json" },
            body:
              req.method === "POST"
                ? await readBody(req)
                : undefined,
          });
          // Stream the response so the browser sees the real
          // content-type. Don't try to JSON-parse — screenshots are
          // binary and would corrupt on the round trip.
          res.statusCode = upstream.status;
          const ct = upstream.headers.get("content-type");
          if (ct) res.setHeader("content-type", ct);
          const cc = upstream.headers.get("cache-control");
          if (cc) res.setHeader("cache-control", cc);
          const buf = Buffer.from(await upstream.arrayBuffer());
          res.end(buf);
        } catch (err) {
          res.statusCode = 502;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              error: "upstream_failure",
              message: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      });

      // ──────────────────────────────────────────────────────────────────
      //  /api/playwright — bridge to the OFFICIAL Playwright MCP server.
      //  GET  /api/playwright/tools → tool catalog (spawned via the
      //                             mcp-server backend on :8787)
      //  POST /api/playwright/call  → forward one browser tool call.
      //  The catalog is read live from `npx @playwright/mcp@latest`, so
      //  the chatbot's browser tools always match the official server.
      // ──────────────────────────────────────────────────────────────────
      server.middlewares.use("/api/playwright", async (req, res) => {
        if (!backendUrl) {
          res.statusCode = 503;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              error: "verify_not_configured",
              message: "VERIFY_BACKEND_URL is not set — the Playwright MCP bridge is unavailable.",
            }),
          );
          return;
        }
        try {
          const upstreamPath = (req.url ?? "/").replace(/^\/api/, "");
          const upstream = await fetch(`${backendUrl}/playwright${upstreamPath}`, {
            method: req.method,
            headers: { "content-type": "application/json" },
            body:
              req.method === "POST"
                ? await readBody(req)
                : undefined,
          });
          res.statusCode = upstream.status;
          res.setHeader(
            "content-type",
            upstream.headers.get("content-type") ?? "application/json",
          );
          res.end(await upstream.text());
        } catch (err) {
          res.statusCode = 502;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              error: "upstream_failure",
              message: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      });

      server.middlewares.use("/api/secrets", async (req, res) => {
        if (!backendUrl) {
          res.statusCode = 503;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              error: "verify_not_configured",
              message:
                "VERIFY_BACKEND_URL is not set on the Vite server. Real secret storage is unavailable.",
            }),
          );
          return;
        }
        try {
          // DELETE /api/secrets/:id — keep the trailing /:id so the
          // upstream gets the full path. GET/POST hit /secrets.
          const isDelete = req.method === "DELETE";
          const targetPath =
            isDelete && req.url && req.url !== "/"
              ? `/secrets${req.url}`
              : "/secrets";
          const upstream = await fetch(`${backendUrl}${targetPath}`, {
            method: req.method,
            headers: { "content-type": "application/json" },
            body: ["POST", "PUT", "PATCH"].includes(req.method ?? "")
              ? await readBody(req)
              : undefined,
          });
          // Belt-and-braces: strip any plaintext password the upstream
          // returned so it never enters the bundle, even if the backend
          // is misconfigured.
          if ((req.method === "GET" || req.method === "POST") && upstream.ok) {
            const raw = await upstream.text();
            let parsed: unknown;
            try {
              parsed = JSON.parse(raw);
            } catch {
              parsed = null;
            }
            const stripPassword = (s: Record<string, unknown>) => {
              if (typeof s.password === "string") {
                s.passwordMasked = maskSecret(s.password);
                delete s.password;
              }
            };
            if (Array.isArray(parsed)) {
              for (const s of parsed as Array<Record<string, unknown>>) {
                stripPassword(s);
              }
            } else if (
              parsed &&
              typeof parsed === "object" &&
              "password" in (parsed as Record<string, unknown>)
            ) {
              stripPassword(parsed as Record<string, unknown>);
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
          res.statusCode = 502;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              error: "upstream_failure",
              message: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      });
    },
  };
}

// Read request body as a string — used by the secrets proxy when
// forwarding POST/PUT/PATCH so the upstream sees the original payload.
function readBody(req: import("http").IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(""));
  });
}

// Server-side proxy for the AI avatar generator (Replicate.com). The browser
// POSTs `{ imageBase64, style }` to `/api/ai/avatar`; this middleware forwards
// to Replicate's predictions endpoint, polls until the prediction settles,
// then fetches the output bytes and returns a `data:` URL the client can
// render in <img src> without a second round-trip.
//
// Token is read at config-load time (server-side only — no `VITE_` prefix)
// and NEVER ships to the browser. When unset the proxy returns 503
// `avatar_not_configured` and the client hides the entry point.
//
// Why JSON + base64 over multipart/form-data: the rest of the proxy family
// (chat, secrets, evidence, playwright) already speaks JSON; staying on
// that wire avoids a separate body parser and keeps the dev/prod backends
// byte-identical apart from the request-shape differences upstream calls
// need. The base64 inflation (~33%) is well within the 6 MB body cap.
function aiAvatarProxy(env: Record<string, string>): Plugin {
  const replicateToken = env.REPLICATE_API_TOKEN ?? "";
  const replicateModel = env.REPLICATE_AVATAR_MODEL ?? "fofr/face-to-many";
  const replicateVersion = env.REPLICATE_AVATAR_MODEL_VERSION ?? "";

  return {
    name: "feature-tracker:ai-avatar-proxy",
    apply: "serve",
    configureServer(server) {
      const notConfigured = (res: ServerResponse) => {
        res.statusCode = 503;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            error: "avatar_not_configured",
            message:
              "REPLICATE_API_TOKEN is not set on the Vite server. Set it (and optionally REPLICATE_AVATAR_MODEL / REPLICATE_AVATAR_MODEL_VERSION) to enable AI avatar generation.",
          }),
        );
      };

      // Body cap. Source photo is 4 MB max at the picker; base64 inflates
      // to ~5.3 MB on the wire; 6 MB is generous headroom for the form
      // envelope. Trips early via Content-Length before we start streaming.
      const AVATAR_MAX_BODY_BYTES = 6 * 1024 * 1024;
      // Wall-clock timeout. Replicate's face-to-many model averages ~10–30 s;
      // 65 s gives one full retry's worth of slack before we cancel and
      // bill-stop. Replicate charges per prediction, not per second, so
      // cancelling is the cheap path.
      const AVATAR_TIMEOUT_MS = 65_000;

      server.middlewares.use("/api/ai/avatar", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "method_not_allowed" }));
          return;
        }
        if (!replicateToken) {
          notConfigured(res);
          return;
        }
        // Cheap probe: HEAD tells the client whether the feature is wired
        // up before they spend a 4 MB upload. Same 503 + same JSON shape
        // the production path returns, so the client treats both the
        // same way (hide the button, show "AI avatars disabled" hint).
        // We deliberately do NOT require a body for the probe — a HEAD
        // against an unconfigured proxy should be the cheapest possible
        // call.
        // (Implemented by the `HEAD` branch above? No — this middleware
        // sees POST only; the Vite SPA never sends HEAD here. The probe
        // pattern from the prod backend (a 200 GET on the same path) is
        // more discoverable from the client. Skipped in dev for now —
        // the client falls back to a "click and see 503" check.)
        const declared = Number(req.headers["content-length"] ?? 0);
        if (declared > AVATAR_MAX_BODY_BYTES) {
          res.statusCode = 413;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "payload_too_large" }));
          return;
        }
        try {
          const chunks: Buffer[] = [];
          let received = 0;
          for await (const chunk of req) {
            received += chunk.length;
            if (received > AVATAR_MAX_BODY_BYTES) {
              res.statusCode = 413;
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify({ error: "payload_too_large" }));
              return;
            }
            chunks.push(chunk as Buffer);
          }
          const raw = Buffer.concat(chunks).toString("utf8");
          let parsed: { imageBase64?: string; style?: string } = {};
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch {
            parsed = {};
          }
          const imageBase64 =
            typeof parsed.imageBase64 === "string"
              ? parsed.imageBase64
              : "";
          const style = typeof parsed.style === "string" ? parsed.style : "3D";
          if (!imageBase64) {
            res.statusCode = 400;
            res.setHeader("content-type", "application/json");
            res.end(
              JSON.stringify({
                error: "bad_request",
                message: "imageBase64 is required",
              }),
            );
            return;
          }

          // Replicate expects a data URL or http(s) URL. The client
          // already builds the data URL header (`data:image/jpeg;base64,…`)
          // before posting, so we forward it as-is.
          const inputImage = imageBase64.startsWith("data:")
            ? imageBase64
            : `data:image/jpeg;base64,${imageBase64}`;

          // Build the create-prediction body. Pinning `version` to a
          // known-good hash (via REPLICATE_AVATAR_MODEL_VERSION) avoids
          // silent model drift when the model owner pushes an update —
          // same rationale as pinning AI_GATEWAY_MODEL. Unset → omit the
          // field so Replicate resolves to the model's latest version.
          const createBody: Record<string, unknown> = {
            input: {
              image: inputImage,
              style,
              prompt: "",
              prompt_strength: 0.9,
              number_of_images: 1,
              disable_safety_checker: true,
            },
          };
          if (replicateVersion) {
            createBody.version = replicateVersion;
          } else {
            createBody.model = replicateModel;
          }

          const start = Date.now();
          const create = await fetch(
            "https://api.replicate.com/v1/predictions",
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Token ${replicateToken}`,
              },
              body: JSON.stringify(createBody),
            },
          );
          if (!create.ok) {
            const text = await create.text();
            res.statusCode = create.status;
            res.setHeader("content-type", "application/json");
            res.end(
              JSON.stringify({
                error: "upstream_failure",
                message: `Replicate create failed: ${text.slice(0, 500)}`,
              }),
            );
            return;
          }
          const prediction = (await create.json()) as {
            id: string;
            status: string;
            output?: unknown;
            error?: string;
          };
          const predictionId = prediction.id;
          if (!predictionId) {
            res.statusCode = 502;
            res.setHeader("content-type", "application/json");
            res.end(
              JSON.stringify({
                error: "upstream_failure",
                message: "Replicate returned no prediction id",
              }),
            );
            return;
          }

          // Poll until settled or timeout. `req.on("close")` aborts the
          // outer fetch so a hung-up browser stops the in-flight poll.
          let final = prediction;
          let aborted = false;
          req.on("close", () => {
            aborted = true;
          });
          while (!aborted) {
            if (Date.now() - start > AVATAR_TIMEOUT_MS) {
              // Best-effort cancel so Replicate stops billing for this
              // prediction. Don't block the response on it — fire and
              // forget.
              fetch(
                `https://api.replicate.com/v1/predictions/${predictionId}/cancel`,
                {
                  method: "POST",
                  headers: { authorization: `Token ${replicateToken}` },
                },
              ).catch(() => {});
              res.statusCode = 504;
              res.setHeader("content-type", "application/json");
              res.end(
                JSON.stringify({
                  error: "avatar_timeout",
                  message:
                    "AI avatar generation took too long. Try again with a different photo or style.",
                }),
              );
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
            const poll = await fetch(
              `https://api.replicate.com/v1/predictions/${predictionId}`,
              { headers: { authorization: `Token ${replicateToken}` } },
            );
            if (poll.ok) {
              final = (await poll.json()) as typeof prediction;
            }
            // Non-2xx poll: keep going — transient blips shouldn't abort
            // the generation. The outer timeout is the bound.
          }
          if (aborted) {
            // Browser disconnected; nothing to send back. Best-effort
            // cancel.
            fetch(
              `https://api.replicate.com/v1/predictions/${predictionId}/cancel`,
              {
                method: "POST",
                headers: { authorization: `Token ${replicateToken}` },
              },
            ).catch(() => {});
            res.end();
            return;
          }
          if (final.status !== "succeeded") {
            res.statusCode = 502;
            res.setHeader("content-type", "application/json");
            res.end(
              JSON.stringify({
                error: "upstream_failure",
                message:
                  typeof final.error === "string"
                    ? final.error
                    : `prediction ${final.status}`,
              }),
            );
            return;
          }

          // Replicate's `output` is `string | string[] | null`. Take the
          // first URL, fetch the bytes, return as a data URL so the
          // client can render in <img src=...> without a CORS round-trip.
          const output = final.output;
          const firstUrl = Array.isArray(output)
            ? output.find((v): v is string => typeof v === "string")
            : typeof output === "string"
              ? output
              : null;
          if (!firstUrl) {
            res.statusCode = 502;
            res.setHeader("content-type", "application/json");
            res.end(
              JSON.stringify({
                error: "upstream_failure",
                message: "Replicate returned no output URL",
              }),
            );
            return;
          }
          const dl = await fetch(firstUrl);
          if (!dl.ok) {
            res.statusCode = 502;
            res.setHeader("content-type", "application/json");
            res.end(
              JSON.stringify({
                error: "upstream_failure",
                message: `Failed to download avatar (${dl.status})`,
              }),
            );
            return;
          }
          const ab = await dl.arrayBuffer();
          const mime = dl.headers.get("content-type") ?? "image/png";
          const dataUrl = `data:${mime};base64,${Buffer.from(ab).toString("base64")}`;
          const durationMs = Date.now() - start;
          res.statusCode = 200;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              avatarDataUrl: dataUrl,
              contentType: mime,
              durationMs,
            }),
          );
        } catch (err) {
          res.statusCode = 502;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              error: "upstream_failure",
              message: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      });
    },
  };
}

export default defineConfig(({ mode, command }) => {
  // Load .env (all vars, not just VITE_* — the prefixes arg "" disables
  // prefix filtering) merged with process.env (process.env wins), so the
  // proxy plugins below see AI_GATEWAY_* / VERIFY_BACKEND_URL from .env
  // without the shell exporting them. Server-side secrets like
  // AI_GATEWAY_TOKEN still never reach the client bundle — they're only
  // read here in config-land; VITE_* exposure rules are unchanged.
  const env = loadEnv(mode, process.cwd(), "");
  // Skip reading the local mkcert TLS files when building for production —
  // the Docker build context doesn't carry `./cert/`, and Vite still
  // evaluates the entire config object (including the `server.https`
  // block) during `vite build`. Without this guard the build fails with
  // `ENOENT: no such file or directory, open '.../cert/...-key.pem'`.
  const isDev = command !== "build";

  return {
  plugins: [
    react(),
    aiChatProxy(env),
    aiAvatarProxy(env),
    verifyProxy(env),
    customUrlBanner("https://dbeegi.slsblx.com:5173/projects"),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Bind to the registered Blocks dev domain (not `host: true`) so
    // Vite's banner prints https://dbeegi.slsblx.com:5173/ and the OIDC
    // session cookie IAM sets on /login/callback lands on the same host
    // that initiated the redirect. `localhost` (which resolves to a
    // different cookie origin) is no longer served, intentionally.
    host: "dbeegi.slsblx.com",
    // Without `allowedHosts`, Vite's DNS-rebinding guard 404s requests to
    // hosts other than localhost with "Blocked request. This host is not
    // allowed." — fatal when serving on a custom Blocks dev domain.
    allowedHosts: ["dbeegi.slsblx.com", "localhost"],
    ...(isDev
      ? {
          // mkcert-generated: SAN covers dbeegi.slsblx.com, localhost, 127.0.0.1
          // (CA is already trusted on this machine — see `mkcert -install`).
          https: {
            key: fs.readFileSync(
              path.resolve(__dirname, "./cert/dbeegi.slsblx.com+2-key.pem"),
            ),
            cert: fs.readFileSync(
              path.resolve(__dirname, "./cert/dbeegi.slsblx.com+2.pem"),
            ),
          },
        }
      : {}),
  },
  };
});

// Vite's banner always prints `https://localhost:5173/` because it
// detects the loopback bind. Since we run on the registered Blocks
// dev domain (so OIDC cookies scope correctly), print the canonical
// custom-URL line right after Vite's banner so the operator sees it
// in the same color block — no one has to remember to substitute.
function customUrlBanner(customUrl: string): Plugin {
  return {
    name: "feature-tracker:custom-url-banner",
    apply: "serve",
    configureServer(server) {
      // Vite prints `➜  Local: ...` from `printUrls()`, which fires
      // once after the server starts listening. We can't reliably
      // attach an extra `listening` listener before then because
      // `server.httpServer` may not exist yet at the moment this hook
      // runs. Monkey-patch `printUrls` instead — it's a guaranteed
      // synchronous seam that runs exactly once per `vite` invocation,
      // right after the server is up. Wrap the original so our
      // `Custom:` line appears immediately below Vite's own banner.
      const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
      const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;
      const cyan = (s: string) => `\x1b[36m${s}\x1b[39m`;
      const customLine = `  ${dim("➜")}  ${bold("Custom:")}  ${cyan(customUrl)}/`;
      const printUrlsFn = (server as unknown as { printUrls?: () => void }).printUrls;
      if (typeof printUrlsFn !== "function") return;
      const originalPrintUrls = printUrlsFn.bind(server);
      (server as unknown as { printUrls: () => void }).printUrls =
        function patchedPrintUrls(this: unknown) {
          originalPrintUrls();
          // eslint-disable-next-line no-console
          console.log(customLine);
        };
    },
  };
}