import { defineConfig, type Plugin } from "vite";
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
function aiChatProxy(): Plugin {
  const gatewayUrl =
    process.env.AI_GATEWAY_URL ?? process.env.ANTHROPIC_BASE_URL ?? "";
  const token =
    process.env.AI_GATEWAY_TOKEN ?? process.env.ANTHROPIC_AUTH_TOKEN ?? "";
  const model =
    process.env.AI_GATEWAY_MODEL ??
    process.env.ANTHROPIC_MODEL ??
    "claude-sonnet-4-5";

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
              : "You are the AI Assistant inside an Issue Tracker. Help the user understand their verification runs, issues, and configuration. Be concise.";

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
              max_tokens: 1024,
              system: systemPrompt,
              messages: [{ role: "user", content: userText }],
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
function verifyProxy(): Plugin {
  const backendUrl = (process.env.VERIFY_BACKEND_URL ?? "").replace(/\/+$/, "");

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
      server.middlewares.use("/api/verify/runs", async (req, res) => {
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
        res.statusCode = 405;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "method_not_allowed" }));
      });

      // GET /api/verify/runs/:id/events — Server-Sent Events stream.
      // Stub behaviour (no backend): write the standard SSE preamble,
      // schedule a run_completed event 5s later, then close. Real
      // behaviour: pipe the upstream SSE response straight through.
      server.middlewares.use("/api/verify/runs/", async (req, res) => {
        if (req.method !== "GET" || !req.url?.includes("/events")) {
          res.statusCode = 404;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "not_found" }));
          return;
        }
        const runId = decodeURIComponent(
          req.url.split("?")[0]!.replace("/api/verify/runs/", "").replace("/events", ""),
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
            `${backendUrl}/verify/runs/${encodeURIComponent(runId)}/events`,
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

export default defineConfig({
  plugins: [
    react(),
    aiChatProxy(),
    verifyProxy(),
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
    https: {
      // mkcert-generated: SAN covers dbeegi.slsblx.com, localhost, 127.0.0.1
      // (CA is already trusted on this machine — see `mkcert -install`).
      key: fs.readFileSync(path.resolve(__dirname, "./cert/dbeegi.slsblx.com+2-key.pem")),
      cert: fs.readFileSync(path.resolve(__dirname, "./cert/dbeegi.slsblx.com+2.pem")),
    },
  },
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