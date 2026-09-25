import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import type { ServerResponse } from "http";

// ─────────────────────────────────────────────────────────────────────────
//  AI chat provider abstraction.
//
//  The `x-ai-chat-provider` request header picks a provider factory from
//  `CHAT_PROVIDERS`. Each provider accepts the same Anthropic-format
//  request body the client sends to `/api/ai/chat`, calls its native
//  upstream, and returns a response in Anthropic-format JSON so the React
//  client (`issueTrackerApi.ts → sendChatMessage`) parses exactly one
//  wire shape. Adding Gemini / Bedrock / Mistral later is a single new
//  `createXxxChatProvider` factory + one entry in `CHAT_PROVIDERS`.
//
//  ⚠️  Lockstep with `server/prod-backend.mjs → proxyAiChat`. Every change
//      here MUST be mirrored there (and vice-versa) — both files implement
//      the same wire contract.
//
//  Provider design notes:
//   • AnthropicProvider is a thin pass-through; today's behaviour lives
//     here unchanged.
//   • OpenAIProvider translates Anthropic-style `system`/`messages`/`tools`
//     into the Chat Completions shape, calls `/v1/chat/completions`, and
//     re-shapes the response (choices[0].message.content →
//     content[0]{type:"text"}; tool_calls → content[{type:"tool_use"}]).
//   • The `default anthropic` fallback in `getChatProvider` matches the
//     chosen migration: rows saved before this field existed (no `provider`
//     column) keep working when the request omits `x-ai-chat-provider`.
// ─────────────────────────────────────────────────────────────────────────

// Wire shape we get from the client (same as today; no client change).
type AnthropicRequestBody = {
  model: string;
  max_tokens: number;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  tools?: Array<{
    name: string;
    description?: string;
    input_schema: Record<string, unknown>;
  }>;
};

// Wire shape we return to the client — exactly what `sendChatMessage`
// already parses (content[] with type:"text" / type:"tool_use").
type AnthropicResponseContent =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    };

interface ChatProvider {
  id: "anthropic" | "openai";
  isConfigured: (cfg: { url: string; token: string; model: string }) => boolean;
  notConfiguredMessage: () => string;
  /**
   * Translate the Anthropic-format request body into this provider's
   * native format, call the upstream, and translate the response into
   * Anthropic-format JSON. Returns the JSON-serialisable body — the
   * caller is responsible for writing the HTTP status code (200 on
   * success).
   */
  sendChat: (
    cfg: { url: string; token: string; model: string },
    body: AnthropicRequestBody,
    signal: AbortSignal,
  ) => Promise<{
    id: string;
    type: "message";
    role: "assistant";
    model: string;
    content: AnthropicResponseContent[];
    stop_reason: string;
  }>;
}

function createAnthropicChatProvider(): ChatProvider {
  return {
    id: "anthropic",
    isConfigured: ({ url, token }) => url.length > 0 && token.length > 0,
    notConfiguredMessage: () =>
      "AI gateway is not configured. Open Settings → AI Gateway and pick a provider, then enter the URL and token.",
    async sendChat(cfg, body, signal) {
      // `body.model` already carries the dispatcher-provided value (the
      // OpenAI provider uses `cfg.model` directly because its native wire
      // doesn't include a `model` in the body). Spreading `body` is enough.
      const upstream = await fetch(`${cfg.url.replace(/\/+$/, "")}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${cfg.token}`,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
        signal,
      });
      if (!upstream.ok) {
        // Preserve upstream status verbatim in the error message — chat
        // panel surfaces this, so the user can see "401 unauthorized" /
        // "404 model not found" without tailing logs.
        const text = await upstream.text();
        throw new Error(`upstream_${upstream.status}: ${text.slice(0, 500)}`);
      }
      return (await upstream.json()) as Awaited<ReturnType<ChatProvider["sendChat"]>>;
    },
  };
}

function createOpenAIChatProvider(): ChatProvider {
  return {
    id: "openai",
    isConfigured: ({ url, token }) => url.length > 0 && token.length > 0,
    notConfiguredMessage: () =>
      "OpenAI provider is not configured. Open Settings → AI Gateway, pick OpenAI, and enter the Base URL + API key.",
    async sendChat(cfg, body, signal) {
      // Anthropic → OpenAI request translation.
      //   • Anthropic `system` → OpenAI system message at the head.
      //   • Anthropic `tools[]` → OpenAI `tools[].function.parameters` (we
      //     pass through `input_schema` unchanged — both APIs use JSON
      //     Schema for the function parameter shape).
      const openaiMessages = body.system
        ? [{ role: "system", content: body.system }, ...body.messages]
        : [...body.messages];
      const openaiTools = body.tools?.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description ?? "",
          parameters: t.input_schema,
        },
      }));

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
        throw new Error(`upstream_${upstream.status}: ${text.slice(0, 500)}`);
      }

      // OpenAI → Anthropic response translation. Shape:
      //   { choices: [{ message: { content?, tool_calls? }, finish_reason }],
      //     model }
      const json = (await upstream.json()) as {
        choices?: Array<{
          message?: {
            role?: "assistant";
            content?: string | null;
            tool_calls?: Array<{
              id: string;
              type: "function";
              function: { name: string; arguments: string };
            }>;
          };
          finish_reason?: string;
        }>;
        model?: string;
      };
      const choice = json.choices?.[0];
      const content: AnthropicResponseContent[] = [];
      const text = choice?.message?.content;
      if (typeof text === "string" && text.length > 0) {
        content.push({ type: "text", text });
      }
      for (const tc of choice?.message?.tool_calls ?? []) {
        // `function.arguments` is a JSON-encoded string — parse so the
        // client can read `toolUseBlocks[].input` as a real object.
        // Falls back to {} on parse failure rather than throwing —
        // matches Anthropic's behaviour when a model emits invalid JSON.
        let input: Record<string, unknown> = {};
        try {
          const parsed: unknown = JSON.parse(tc.function.arguments);
          if (parsed && typeof parsed === "object") {
            input = parsed as Record<string, unknown>;
          }
        } catch {
          input = {};
        }
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input,
        });
      }
      // Map finish_reason → stop_reason. Anthropic uses tool_use / end_turn /
      // max_tokens; OpenAI uses tool_calls / stop / length.
      const stopReason =
        choice?.finish_reason === "tool_calls"
          ? "tool_use"
          : choice?.finish_reason === "length"
            ? "max_tokens"
            : "end_turn";
      return {
        id: `chatcmpl-${Date.now()}`,
        type: "message",
        role: "assistant",
        model: json.model ?? cfg.model,
        content,
        stop_reason: stopReason,
      };
    },
  };
}

const CHAT_PROVIDERS: Record<string, () => ChatProvider> = {
  anthropic: createAnthropicChatProvider,
  openai: createOpenAIChatProvider,
};

function getChatProvider(id: string): ChatProvider {
  const factory = CHAT_PROVIDERS[id];
  if (factory) return factory();
  // Unknown / missing → default to anthropic. Matches the migration
  // choice: rows saved before the provider column existed (no header)
  // keep routing through the Anthropic provider until the user opens
  // Settings and picks OpenAI.
  return createAnthropicChatProvider();
}

// Server-side proxy for the Issue Tracker AI Assistant. The browser posts to
// `/api/ai/chat` on the Vite dev server; this middleware reads the
// per-user gateway config off `x-ai-gateway-{url,token,model}` and the
// provider id off `x-ai-chat-provider` (default "anthropic"), then asks
// `getChatProvider(providerId).sendChat(...)` to handle the upstream call
// and return Anthropic-format JSON. The Settings page is the SOLE source
// of truth for these values — see `src/pages/SettingsPage.tsx →
// AiGatewayConfigSection`.
//
// `env` is no longer consulted at runtime (the build-time param is kept
// so the call site stays unchanged). Add a new provider by writing a
// `createXxxChatProvider` factory above and adding it to `CHAT_PROVIDERS`.
function aiChatProxy(_env: Record<string, string>): Plugin {
  // The Settings page is the SOLE source of truth for AI gateway config —
  // there is intentionally no .env fallback. Each user saves their own
  // URL / model / token in Blocks Data; the SPA attaches them as
  // `x-ai-gateway-*` headers on every chat request. If a request arrives
  // without those headers, we 503 with `ai_not_configured` — the chat
  // panel surfaces that as "open Settings and fill in the form".
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
        // `req.headers` is the standard Node IncomingMessage — keys are
        // lowercased. Trim and treat empty as "not set" (same-origin
        // browser fetch → no CORS preflight, custom headers pass through).
        const headerValue = (name: string): string => {
          const v = req.headers[name];
          return typeof v === "string" ? v.trim() : "";
        };
        // Provider id defaults to "anthropic" — rows saved before the
        // provider column existed (no header, no `provider` field) keep
        // routing through Anthropic until the user opens Settings.
        const providerId =
          headerValue("x-ai-chat-provider") || "anthropic";
        const cfg = {
          url: headerValue("x-ai-gateway-url"),
          token: headerValue("x-ai-gateway-token"),
          model:
            headerValue("x-ai-gateway-model") || "claude-sonnet-4-5",
        };
        const provider = getChatProvider(providerId);
        if (!provider.isConfigured(cfg)) {
          res.statusCode = 503;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              error: "ai_not_configured",
              message: provider.notConfiguredMessage(),
            }),
          );
          return;
        }

        // One AbortSignal per request: fires when the browser disconnects
        // mid-call so the upstream fetch stops streaming. Mirrors the
        // pattern in `aiAvatarProxy` below.
        const abort = new AbortController();
        let disconnected = false;
        req.on("close", () => {
          disconnected = true;
          abort.abort();
        });

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
          // Optional `tool_choice` (Anthropic Messages API). Currently set
          // by browser_* walkthrough auto-continuations as `{type:"any"}`
          // to force the model to emit at least one tool_use block —
          // prompt-level "MUST contain tool_use" instructions were
          // advisory-only and the AI still produced narration-only turns
          // after a successful snapshot. An API-level guarantee is what
          // actually keeps the walkthrough moving. Shape is validated so
          // a typo in the client can't crash the upstream call.
          const rawToolChoice = parsed?.tool_choice;
          const toolChoice =
            rawToolChoice &&
            typeof rawToolChoice === "object" &&
            typeof rawToolChoice.type === "string" &&
            ["any", "auto", "tool"].includes(rawToolChoice.type)
              ? rawToolChoice
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

          // Provider receives an Anthropic-format body; each provider
          // factory translates to its native wire (or passes through for
          // Anthropic) and returns Anthropic-format JSON.
          const response = await provider.sendChat(
            cfg,
            {
              model: cfg.model,
              // 4096 — agentic browser walkthroughs end with a long
              // evidence report (findings tables + next-step narration),
              // which overflowed the older 2048 cap mid-sentence.
              max_tokens: 4096,
              system: systemPrompt,
              messages: [...history, { role: "user", content: userText }],
              ...(tools ? { tools } : {}),
              ...(toolChoice ? { tool_choice: toolChoice } : {}),
            },
            abort.signal,
          );
          if (disconnected || abort.signal.aborted) {
            // Browser went away mid-call; nothing to send back.
            res.end();
            return;
          }
          res.statusCode = 200;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(response));
        } catch (err) {
          if (disconnected || abort.signal.aborted) {
            res.end();
            return;
          }
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

// ────────────────────────────────────────────────────────────────────────────
// AI avatar provider abstraction
// ────────────────────────────────────────────────────────────────────────────
//
// The browser POSTs `{ imageBase64, style }` to `/api/ai/avatar` and expects
// back `{ avatarDataUrl, contentType, durationMs }` — a single, vendor-neutral
// contract. This file owns the *server-side* side of that contract. Each
// provider below knows how to translate the request into one upstream API:
//
//   - Replicate       — async prediction model: create → poll → download
//   - Hugging Face    — sync image-to-image via the Inference router
//   - Mock            — no external API; returns the input image (offline dev)
//   - (future) OpenAI, Stability, local ComfyUI, etc.
//
// Adding a new vendor is a single new entry in `AVATAR_PROVIDERS` below; no
// edits to the proxy middleware needed. Selection is driven by the
// `AI_AVATAR_PROVIDER` env var (default: "replicate") so the same wire shape
// works in dev, prod, and any future environment. Tokens stay server-side
// (no `VITE_` prefix) and never ship to the browser bundle.
//
// ────────────────────────────────────────────────────────────────────────────
// ADDING A NEW AI PROVIDER — recipe
// ────────────────────────────────────────────────────────────────────────────
//   1. Write a `create<Name>Provider(env)` function that returns an object
//      satisfying the `AvatarProvider` interface (defined just below).
//      Each provider owns the upstream call shape — the abstraction hides
//      it from the rest of the app.
//   2. Add `create<Name>Provider` to the `AVATAR_PROVIDERS` map.
//   3. Document the env vars it reads in `.env.example`.
//
// That's it. Selection happens via `AI_AVATAR_PROVIDER=<name>`. Per-style
// overrides via `AI_AVATAR_PROVIDER_BY_STYLE=Anime:mock;3D:replicate`.
// Adding a vendor is ~30–100 lines of code, no changes to the middleware
// or to the client. The dev-time mirror lives in `server/prod-backend.mjs`
// — keep both in lockstep.

interface AvatarRequest {
  imageBase64: string;
  style: string;
}

interface AvatarResult {
  avatarDataUrl: string;
  contentType: string;
  durationMs: number;
}

interface AvatarProvider {
  /** Stable id — matches the env var suffix (e.g. "replicate", "huggingface"). */
  readonly id: string;
  /** True when this provider has the env credentials it needs. */
  isConfigured(): boolean;
  /** Human-readable hint used in the 503 response when `isConfigured()` is false. */
  notConfiguredMessage(): string;
  /**
   * Generate the avatar. Implementations must throw on upstream errors
   * (the outer middleware maps them to 502) and respect `signal` so a
   * wall-clock timeout or a disconnected client aborts the work cleanly.
   *
   * `userOverride` carries the per-user Personal AI key + model id
   * (read from `x-ai-avatar-token` / `x-ai-avatar-model`). When present
   * the provider MUST use those instead of its env-derived credentials —
   * the proxy no longer mixes the two systems, so the user is the sole
   * source of truth. `userOverride` is omitted when the user hasn't set
   * a Personal AI key, in which case the middleware returns 503 before
   * reaching here.
   */
  generate(
    req: AvatarRequest,
    signal: AbortSignal,
    userOverride?: { token?: string; modelVersion?: string },
  ): Promise<AvatarResult>;
}

// ── Replicate ───────────────────────────────────────────────────────────────
function createReplicateProvider(
  env: Record<string, string>,
): AvatarProvider {
  const token = env.REPLICATE_API_TOKEN ?? "";
  const model = env.REPLICATE_AVATAR_MODEL ?? "fofr/face-to-many";
  const explicitVersion = env.REPLICATE_AVATAR_MODEL_VERSION ?? "";

  // Resolve the model's latest version lazily + cache it. Replicate's
  // create-prediction API rejects bare model names with `422 — version is
  // required` — `version` (or `model:hash`) is mandatory. The model owner
  // bumping the version is rare; a slightly stale hash is acceptable.
  let resolvedVersion: string | null = null;
  let resolveAttempted = false;
  async function resolveLatestVersion(
    useToken: string,
  ): Promise<string | null> {
    if (resolvedVersion || resolveAttempted) return resolvedVersion;
    resolveAttempted = true;
    const [owner, name] = model.split("/");
    if (!owner || !name) return null;
    try {
      const res = await fetch(
        `https://api.replicate.com/v1/models/${owner}/${name}`,
        { headers: { authorization: `Token ${useToken}` } },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { latest_version?: { id?: string } };
      const id = data.latest_version?.id;
      if (typeof id === "string" && id.length > 0) {
        resolvedVersion = id;
        return id;
      }
    } catch {
      // Network error / Replicate down — fall through; the create call
      // below will surface a clear upstream error.
    }
    return null;
  }

  return {
    id: "replicate",
    isConfigured: () => token.length > 0,
    notConfiguredMessage: () =>
      "REPLICATE_API_TOKEN is not set on the Vite server. Set it (and optionally REPLICATE_AVATAR_MODEL / REPLICATE_AVATAR_MODEL_VERSION) to enable AI avatar generation.",
    async generate(req, signal, userOverride): Promise<AvatarResult> {
      // Per-request credential resolution: when the caller supplies a
      // Personal AI key (read from `x-ai-avatar-token` by the middleware),
      // it overrides the env token + version. If only one is set we still
      // merge — `userOverride.token ?? envToken`, etc. The middleware
      // guarantees at least one of them is non-empty before reaching here,
      // but the guard below makes the provider robust if it's ever called
      // directly from a future code path.
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
        effectiveVersion || (await resolveLatestVersion(effectiveToken));
      if (!pinnedVersion) {
        throw new Error(
          "Could not resolve the Replicate model version. Set REPLICATE_AVATAR_MODEL_VERSION in .env to pin a specific hash, or check the API token / network connectivity.",
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
        throw new Error(`Replicate create failed: ${text.slice(0, 500)}`);
      }
      const prediction = (await create.json()) as {
        id: string;
        status: string;
        output?: unknown;
        error?: string;
      };
      const predictionId = prediction.id;
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
        if (poll.ok) {
          final = (await poll.json()) as typeof prediction;
        }
      }
      if (final.status !== "succeeded") {
        throw new Error(
          typeof final.error === "string"
            ? final.error
            : `prediction ${final.status}`,
        );
      }
      const output = final.output;
      const firstUrl = Array.isArray(output)
        ? output.find((v): v is string => typeof v === "string")
        : typeof output === "string"
          ? output
          : null;
      if (!firstUrl) throw new Error("Replicate returned no output URL");
      const dl = await fetch(firstUrl);
      if (!dl.ok) {
        throw new Error(`Failed to download avatar (${dl.status})`);
      }
      const ab = await dl.arrayBuffer();
      const mime = dl.headers.get("content-type") ?? "image/png";
      const dataUrl = `data:${mime};base64,${Buffer.from(ab).toString("base64")}`;
      return {
        avatarDataUrl: dataUrl,
        contentType: mime,
        durationMs: Date.now() - start,
      };
    },
  };
}

// ── Hugging Face Inference router ───────────────────────────────────────────
//
// Uses the unified router (`router.huggingface.co`) with an image-to-image
// model by default. The default model `timbrooks/instruct-pix2pix` is a
// well-known free option that preserves the input subject's structure
// while applying a text instruction — perfect for "turn this face into X"
// style transfers. Override `HF_AVATAR_MODEL` to swap.
//
// Style → prompt map is a stand-in for Replicate's built-in style enum:
// each preset becomes a natural-language instruction. Missing styles fall
// back to a generic stylization prompt.
const HF_STYLE_PROMPTS: Record<string, string> = {
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
const HF_DEFAULT_PROMPT =
  "stylize this person as a creative portrait";

function createHuggingFaceProvider(
  env: Record<string, string>,
): AvatarProvider {
  const token = env.HF_TOKEN ?? "";
  const model = env.HF_AVATAR_MODEL ?? "timbrooks/instruct-pix2pix";

  return {
    id: "huggingface",
    isConfigured: () => token.length > 0,
    notConfiguredMessage: () =>
      "HF_TOKEN is not set on the Vite server. Get a free token at https://huggingface.co/settings/tokens (Make calls to Inference Providers permission) and set HF_TOKEN + AI_AVATAR_PROVIDER=huggingface in .env.",
    async generate(req, signal, userOverride): Promise<AvatarResult> {
      // Same per-request override as Replicate — `userOverride.token` wins
      // over the env `HF_TOKEN` when present. HF is less commonly used
      // for avatars here, but the symmetric interface keeps future vendor
      // additions (OpenAI DALL-E, Stability) trivial.
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
      // The Inference router returns raw image bytes (PNG/JPEG), not JSON.
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
        throw new Error(`Hugging Face failed (${res.status}): ${text.slice(0, 500)}`);
      }
      const ab = await res.arrayBuffer();
      const mime = res.headers.get("content-type") ?? "image/png";
      if (!mime.startsWith("image/")) {
        // HF sometimes returns a JSON error with a non-2xx masked as 200;
        // surface it so the modal can show a real message.
        const text = Buffer.from(ab).toString("utf8");
        throw new Error(`Hugging Face returned non-image response: ${text.slice(0, 500)}`);
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
// `AI_AVATAR_PROVIDER=mock` in `.env` to enable.
function createMockProvider(): AvatarProvider {
  return {
    id: "mock",
    isConfigured: () => true,
    notConfiguredMessage: () =>
      "Mock provider is always configured — no credentials required.",
    async generate(req, _signal, _userOverride): Promise<AvatarResult> {
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

// Per-style provider override. Parses `AI_AVATAR_PROVIDER_BY_STYLE` from the
// env into a `{ style → providerId }` map so the same app can route, say,
// "Anime" through Hugging Face (free) and "3D" through Replicate (paid).
//
// Format: semicolon-separated `Style:providerId` pairs.
//   AI_AVATAR_PROVIDER_BY_STYLE=Anime:mock;3D:replicate;Emoji:huggingface
// Whitespace is trimmed; unknown style keys are ignored. A style that's
// listed here takes precedence over the global `AI_AVATAR_PROVIDER`.
const AVATAR_PROVIDERS: Record<
  string,
  (env: Record<string, string>) => AvatarProvider
> = {
  replicate: createReplicateProvider,
  huggingface: createHuggingFaceProvider,
  mock: createMockProvider,
};

function parseStyleProviders(value: string | undefined): Record<string, string> {
  if (!value) return {};
  const map: Record<string, string> = {};
  for (const pair of value.split(/[;,]/)) {
    const [k, v] = pair.split(":").map((s) => s?.trim() ?? "");
    if (k && v) map[k] = v.toLowerCase();
  }
  return map;
}

function getAvatarProvider(
  env: Record<string, string>,
  style?: string,
): AvatarProvider {
  // Per-style override wins, then global, then default "replicate".
  const styleOverrides = parseStyleProviders(env.AI_AVATAR_PROVIDER_BY_STYLE);
  const override = style ? styleOverrides[style] : undefined;
  const id = (override ?? env.AI_AVATAR_PROVIDER ?? "replicate").toLowerCase();
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
  return factory(env);
}

// Server-side proxy for the AI avatar generator. The browser POSTs
// `{ imageBase64, style }` to `/api/ai/avatar`; this middleware dispatches
// to the provider selected by `AI_AVATAR_PROVIDER` and returns a `data:`
// URL the client can render in <img src> without a second round-trip.
//
// Body cap, timeout, and req-close handling live here (centralized) so
// every provider gets the same guarantees. Each provider only owns the
// vendor-specific call shape.
function aiAvatarProxy(env: Record<string, string>): Plugin {
  // Provider selection happens per-request inside the middleware so
  // per-style overrides can route different styles to different upstreams.
  // `getAvatarProvider` only reads env, which is constant between
  // requests in dev (and only changes on process restart in prod).

  return {
    name: "feature-tracker:ai-avatar-proxy",
    apply: "serve",
    configureServer(server) {
      // Body cap. Source photo is 4 MB max at the picker; base64 inflates
      // to ~5.3 MB on the wire; 6 MB is generous headroom for the form
      // envelope. Trips early via Content-Length before we start streaming.
      const AVATAR_MAX_BODY_BYTES = 6 * 1024 * 1024;
      // Wall-clock timeout. Generous so a single retry's worth of slack
      // fits before we cancel and (where applicable) bill-stop.
      const AVATAR_TIMEOUT_MS = 65_000;

      server.middlewares.use("/api/ai/avatar", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "method_not_allowed" }));
          return;
        }
        // Read the body once. We need both the style (to resolve the
        // right provider for per-style overrides) and the image (to pass
        // to the provider) from the same payload, so a single read+parse
        // is cleaner than two passes.
        const declared = Number(req.headers["content-length"] ?? 0);
        if (declared > AVATAR_MAX_BODY_BYTES) {
          res.statusCode = 413;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "payload_too_large" }));
          return;
        }
        let imageBase64 = "";
        let style = "3D";
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
          if (raw) {
            const parsed = JSON.parse(raw) as {
              imageBase64?: unknown;
              style?: unknown;
            };
            if (typeof parsed.imageBase64 === "string") {
              imageBase64 = parsed.imageBase64;
            }
            if (typeof parsed.style === "string") {
              style = parsed.style;
            }
          }
        } catch {
          res.statusCode = 400;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              error: "bad_request",
              message: "Invalid JSON body.",
            }),
          );
          return;
        }
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

        // Per-request provider resolution: global `AI_AVATAR_PROVIDER` is
        // the default; `AI_AVATAR_PROVIDER_BY_STYLE` lets specific styles
        // route to a different upstream (e.g. free HF for "Anime", paid
        // Replicate for "3D").
        const provider = getAvatarProvider(env, style);

        // Per-request credential override. The Personal AI key lives in
        // the user's own row (`blx_UserAvatarConfigs`) and rides along on
        // every avatar request as `x-ai-avatar-{provider,token,model}`.
        // The UI is the SOLE source of truth — env values are NOT mixed
        // in. If no user override is set we 503 with a hint pointing at
        // the Settings → Account section, so the avatar button stays
        // hidden until the user configures their own key.
        const headerValue = (name: string): string => {
          const v = req.headers[name];
          return typeof v === "string" ? v.trim() : "";
        };
        const userToken = headerValue("x-ai-avatar-token");
        const userModelVersion = headerValue("x-ai-avatar-model");
        if (!userToken) {
          res.statusCode = 503;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              error: "avatar_not_configured",
              message:
                "Personal AI key is not set. Open Settings → Account → Personal AI Key and add your provider token to enable AI avatar generation.",
            }),
          );
          return;
        }
        // `provider.isConfigured()` is still checked so a future env-only
        // vendor (e.g. a HF-only deployment) can refuse to run when the
        // env token is missing — Replicate + HF both honor the override,
        // but the underlying model id may be hardcoded for env-only modes.
        if (!provider.isConfigured()) {
          res.statusCode = 503;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              error: "avatar_not_configured",
              message: provider.notConfiguredMessage(),
            }),
          );
          return;
        }

        // One AbortSignal per request: fires on the wall-clock timeout OR
        // when the browser disconnects mid-generation. Providers must
        // respect it — Replicate aborts its poll loop, HF aborts the fetch.
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), AVATAR_TIMEOUT_MS);
        let disconnected = false;
        req.on("close", () => {
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
            // Browser went away; nothing to send back.
            res.end();
            return;
          }
          res.statusCode = 200;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(result));
        } catch (err) {
          clearTimeout(timer);
          if (disconnected || abort.signal.aborted) {
            res.end();
            return;
          }
          res.statusCode = 502;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              error: "upstream_failure",
              message:
                err instanceof Error ? err.message : String(err),
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