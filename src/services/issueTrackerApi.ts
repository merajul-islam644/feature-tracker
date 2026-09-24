// Backend-facing methods for the Issue Tracker.
//
// CRUD on per-user data (verification targets, secrets, issues) now
// lives in `src/lib/blocks/hooks.ts` — those hooks own the TanStack
// Query cache and route everything through the Blocks Data SDK. The
// Issue Tracker page consumes them via `useIssueTracker`.
//
// This module keeps only the four pieces that still talk to the live
// backend (or fall back to mocks when the backend isn't wired up):
//
//   * `testConnection` — POSTs to `/api/verify/test` for a per-target
//     reachability + login check. Falls back to a deterministic local
//     heuristic when `VITE_USE_REAL_VERIFY` is off.
//   * `startVerification` — POSTs to `/api/verify/runs` to schedule the
//     run; returns the new run id (real progress arrives over SSE).
//   * `subscribeRun` — opens the SSE stream that the backend emits while
//     the run is in flight; returns a teardown function. No-op when the
//     flag is off — the page's mock-run driver fills the gap.
//   * `sendChatMessage` — POSTs to the Vite-side proxy at `/api/ai/chat`
//     for a real Assistant reply. Falls back to a canned-reply matcher
//     when the proxy returns 503 / errors out.
//
// MCP cutover (step 8 of prompt/Issue-Tracker-MCP-Design.md): the
// production-ready version of this file is the same module with
// `USE_REAL_VERIFY` set to `true`. That change is one line; this comment
// marks where it happens so the diff stays auditable.
//
// IMPORTANT: This file must never log credentials, never write secrets to
// localStorage, and never hardcode real passwords. See spec section 12.3.

import type {
  AnthropicTool,
  ChatMessage,
  ChatAction,
  RunEvent,
  ToolUseBlock,
  VerificationRun,
  VerificationTarget,
} from "@/types/issue-tracker";
import { verificationChecks } from "@/data/issueTrackerConstants";
import type { IssueTrackerContextSnapshot } from "@/lib/issueTrackerContext";
import { renderContextForSystemPrompt } from "@/lib/issueTrackerContext";
import { buildSystemPrompt } from "@/lib/chatSystemPrompt";

// MCP feature flag — read once at module load; flipping it requires a
// rebuild. Default off keeps today's behaviour bit-identical for users
// without a backend running. The cutover to the real backend is a single
// constant flip + dropping the canned fallback in `sendChatMessage`.
const USE_REAL_VERIFY = import.meta.env.VITE_USE_REAL_VERIFY === "1";

export const issueTrackerApi = {
  // ────────────────────────────────────────────────────────────────────────
  //  Test connection (section 14)
  //
  //  MCP integration step 1: gated behind `VITE_USE_REAL_VERIFY=1`. When
  //  off (the default), the deterministic mock below runs unchanged —
  //  same behaviour every existing user has today. When on, the client
  //  POSTs to `/api/verify/test`, which the Vite proxy either forwards to
  //  a real backend or responds 503 with `verify_not_configured`. On any
  //  failure (non-2xx, network error, parse error) we fall through to the
  //  mock so the UI never gets stuck — same fallback strategy the chat
  //  uses for an unconfigured AI gateway.
  // ────────────────────────────────────────────────────────────────────────

  // interactRun was removed — the in-app preview overlay is gone and the
  // headed Playwright browser is the only preview surface. Click
  // forwarding through this API no longer makes sense.

  async testConnection(target: VerificationTarget): Promise<{
    urlReachable: boolean;
    loginSuccessful: boolean;
  }> {
    return gateVerify<{ urlReachable: boolean; loginSuccessful: boolean }>(
      () =>
        fetch("/api/verify/test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            target: {
              id: target.id,
              applicationName: target.applicationName,
              url: target.url,
              credentialId: target.credentialId ?? null,
            },
          }),
        }),
      // Trust the backend's view of the world, but keep the same shape
      // even if a field is missing.
      async (res) => {
        const data = (await res.json()) as {
          urlReachable: boolean;
          loginSuccessful: boolean;
        };
        return {
          urlReachable: !!data.urlReachable,
          loginSuccessful: !!data.loginSuccessful,
        };
      },
      async () => {
        await delay(900);
        // Deterministic mock — reachable if hostname looks valid.
        const reachable = /^https?:\/\//.test(target.url);
        return {
          urlReachable: reachable,
          loginSuccessful: reachable && !!target.credentialId,
        };
      },
    );
  },

  // ────────────────────────────────────────────────────────────────────────
  //  Verification runs (sections 16, 19, 20)
  // ────────────────────────────────────────────────────────────────────────

  async startVerification(
    targets: VerificationTarget[],
    options: {
      scope?: string[];
      userId?: string;
      // Device emulation preset — forwarded to the backend so the run's
      // browser context gets the matching viewport + touch flags.
      device?: "desktop" | "mobile" | "tablet";
    } = {},
  ): Promise<VerificationRun> {
    // Stable run id (32 hex chars) — the MCP server uses it as the
    // idempotency key plus the file-naming prefix for evidence.
    // Spec §6 step 5 / §7: duplicate Start with same enabled targets
    // and same scope returns the existing run.
    const runId = generateRunId();
    const scope = (options.scope ?? verificationChecks.filter((c) => c.recommended).map((c) => c.id)) as string[];

    // MCP step 2: when the flag is on, ask the backend to schedule the run.
    // The backend returns immediately with `{ id, replay, status }`; real
    // progress arrives via the SSE stream returned by `subscribeRun`. On any
    // failure (proxy 503, network error, parse error) we fall back to the
    // local mock so the UI never blocks.
    return gateVerify<VerificationRun>(
      () =>
        fetch("/api/verify/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            runId,
            userId: options.userId ?? "local",
            targets: targets.map((t) => ({
              id: t.id,
              applicationName: t.applicationName,
              url: t.url,
              enabled: t.enabled,
              credentialId: t.credentialId ?? null,
            })),
            scope,
            ...(options.device ? { device: options.device } : {}),
          }),
        }),
      async (res) => {
        const payload = (await res.json()) as { id: string; replay?: boolean; status?: string };
        const now = new Date().toISOString();
        return {
          id: payload.id,
          // The backend answers "queued" but starts the agent immediately
          // and has no run_started event to flip it later — map it to
          // "running" here so run-dependent UI (chat feed spinner, pause
          // controls) is live for the whole run, not just after completion.
          status: (!payload.status || payload.status === "queued"
            ? "running"
            : payload.status) as VerificationRun["status"],
          totalTargets: targets.length,
          completedTargets: 0,
          failedTargets: 0,
          startedAt: now,
          perApp: targets.map((t) => ({
            targetId: t.id,
            applicationName: t.applicationName,
            status: "queued",
          })),
          currentActivity: [],
          scope: scope as VerificationRun["scope"],
        };
      },
      async () => {
        await delay(150);
        const now = new Date().toISOString();
        return {
          id: runId,
          status: "running",
          totalTargets: targets.length,
          completedTargets: 0,
          failedTargets: 0,
          startedAt: now,
          perApp: targets.map((t) => ({
            targetId: t.id,
            applicationName: t.applicationName,
            status: "queued",
          })),
          currentActivity: [
            { step: "Open application",          done: false },
            { step: "Check page load",           done: false },
            { step: "Authenticate",              done: false },
            { step: "Inspect navigation",        done: false },
            { step: "Detect UI issues",          done: false },
            { step: "Generate report",           done: false },
          ],
          scope: scope as VerificationRun["scope"],
        };
      },
    );
  },

  // Run history — the persisted records the backend keeps across restarts
  // (newest first, without their event logs). Used by the history panel to
  // show past runs with status/duration. Empty when the flag is off: there
  // is no local mock history worth fabricating.
  async listRuns(limit = 10): Promise<
    Array<{
      id: string;
      status: string;
      scope: string[];
      targetNames: Record<string, string>;
      startedAt: string;
      completedAt?: string;
      eventCount: number;
    }>
  > {
    type RunSummary = {
      id: string;
      status: string;
      scope: string[];
      targetNames: Record<string, string>;
      startedAt: string;
      completedAt?: string;
      eventCount: number;
    };
    const parse = async (res: Response): Promise<RunSummary[]> => {
      const data = (await res.json()) as { runs?: RunSummary[] };
      return data.runs ?? [];
    };
    return gateVerify(
      () => fetch(`/api/verify/runs?limit=${limit}`),
      parse,
      // Dev fallback: the dev proxy only learned GET /verify/runs recently
      // (vite.config.ts) and needs a dev-server restart to pick it up. The
      // MCP backend itself sends permissive CORS, and http://localhost is a
      // potentially-trustworthy origin, so a direct fetch works from the
      // page without mixed-content blocks — try that before giving up.
      async () => {
        if (!USE_REAL_VERIFY) return [];
        try {
          const res = await fetch(
            `http://localhost:8787/verify/runs?limit=${limit}`,
          );
          if (!res.ok) return [];
          return await parse(res);
        } catch {
          return [];
        }
      },
    );
  },

  // Subscribes to the SSE stream that the backend emits while a run is in
  // flight. The returned function tears down the underlying EventSource.
  //
  // When the flag is off, returns a no-op unsubscribe and never opens a
  // connection — the hook falls back to the local mock-run driver instead.
  // When the flag is on but the proxy says "not configured" (503), we
  // fire `onError` with a friendly message so the hook can downgrade to
  // the mock and still keep the UI animated.
  subscribeRun(
    runId: string,
    handlers: {
      onEvent: (event: RunEvent) => void;
      onError: (err: Error) => void;
    },
  ): () => void {
    if (!USE_REAL_VERIFY) {
      // Local mode — no stream to subscribe to. Returning a no-op keeps
      // the hook's lifecycle tidy (no special-case branching).
      return () => {};
    }
    // Manual reconnect instead of EventSource's built-in retry. Two
    // reasons: (1) the backend tail supports `?since=<cursor>` resume,
    // so a reconnect asks for ONLY the events missed during the drop —
    // native auto-reconnect re-requests from 0 and replays the whole
    // run (re-firing target_started, re-persisting issues…); (2) a
    // flapping proxy gets exponential backoff instead of a reconnect
    // storm at the browser's default interval.
    let es: EventSource | null = null;
    let reconnectTimer: number | undefined;
    let disposed = false;
    let openedOnce = false;
    let settled = false;
    // The first URL omits `since`, so the stream starts at backend
    // cursor 0 — counting received `event` envelopes therefore tracks
    // the backend cursor exactly.
    let cursor = 0;
    const MAX_FAILURES = 3;
    let consecutiveFailures = 0;
    let backoffMs = 1_000;

    const connect = () => {
      if (disposed || settled) return;
      es = new EventSource(
        cursor > 0
          ? `/api/verify/runs/${runId}/events?since=${cursor}`
          : `/api/verify/runs/${runId}/events`,
      );
      es.onopen = () => {
        openedOnce = true;
        // Contact made — transient drops don't count toward the budget
        // and the next drop starts back at the initial delay.
        consecutiveFailures = 0;
        backoffMs = 1_000;
      };
      es.onmessage = (msg) => {
        try {
          // The MCP server wraps each event as
          //   { type: "event", event: <RunEvent> }
          // (with a separate `{ type: "done" }` sentinel when the run
          // settles). Unwrap before handing the typed payload to the
          // hook — without this the consumer sees `event.kind === "event"`
          // and falls through every switch arm, so the VerificationPanel
          // stays at "Queued" forever.
          const envelope = JSON.parse(msg.data) as
            | { type: "event"; event: RunEvent }
            | { type: "done" }
            | { type?: string };
          if (
            envelope &&
            (envelope as { type?: string }).type === "event" &&
            (envelope as { event?: RunEvent }).event
          ) {
            cursor += 1;
            handlers.onEvent((envelope as { event: RunEvent }).event);
          }
          // `done` = the run settled server-side. Close and never
          // reconnect — an error on a finished run's stream would
          // otherwise look like a live failure.
          if (envelope && (envelope as { type?: string }).type === "done") {
            settled = true;
            es?.close();
          }
        } catch (err) {
          handlers.onError(err instanceof Error ? err : new Error(String(err)));
        }
      };
      es.onerror = () => {
        // Close immediately — WE own the retry decision now, so the
        // browser must not race us with its own auto-reconnect.
        es?.close();
        es = null;
        if (disposed || settled) return;
        // If the proxy returned 503 on the very first request, the
        // connection never opened and no event arrived — that's the
        // signal to downgrade to the local mock-run driver.
        if (!openedOnce && cursor === 0) {
          handlers.onError(new Error("real stream unavailable"));
        } else {
          handlers.onError(new Error("run stream error"));
        }
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_FAILURES) {
          // Budget burnt — stop trying. The caller downgrades on its
          // side (see `useIssueTracker.startVerification`).
          return;
        }
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = undefined;
          connect();
        }, backoffMs);
        backoffMs = Math.min(backoffMs * 2, 8_000);
      };
    };
    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      es?.close();
    };
  },

  // ────────────────────────────────────────────────────────────────────────
  //  Official Playwright MCP bridge — the chatbot's browser tools.
  //  The catalog is read LIVE from the backend (which spawns the official
  //  `npx @playwright/mcp@latest` server); nothing is hardcoded here. Both
  //  methods degrade silently (empty catalog / thrown Error) so the chat
  //  keeps working when the backend or the MCP child is unavailable.
  // ────────────────────────────────────────────────────────────────────────

  async listBrowserTools(): Promise<AnthropicTool[]> {
    try {
      const res = await fetch("/api/playwright/tools");
      if (!res.ok) return [];
      const data = (await res.json()) as {
        tools?: Array<{
          name: string;
          description: string;
          inputSchema: Record<string, unknown>;
        }>;
      };
      return (data.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        // The official server ships full JSON Schemas — spread them in and
        // pin the type so an odd schema still serialises cleanly.
        input_schema: {
          type: "object",
          ...t.inputSchema,
        } as AnthropicTool["input_schema"],
      }));
    } catch {
      return [];
    }
  },

  async callBrowserTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const res = await fetch("/api/playwright/call", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool: name, arguments: args }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(err.message ?? `Playwright bridge error (${res.status})`);
    }
    const data = (await res.json()) as { result?: string };
    return data.result ?? "(no output)";
  },

  // ────────────────────────────────────────────────────────────────────────
  //  Chat (section 7) — POSTs to the Vite-side proxy at `/api/ai/chat`,
  //  which forwards to the upstream AI gateway with the bearer token. When
  //  the proxy reports the gateway isn't configured (503), or the request
  //  fails for any reason, we fall back to a local pattern-matcher so the
  //  chat still returns useful canned replies in a setup without an AI
  //  backend (e.g. running `npm run dev` without setting `AI_GATEWAY_TOKEN`).
  // ────────────────────────────────────────────────────────────────────────

  async sendChatMessage(
    text: string,
    options: {
      context?: IssueTrackerContextSnapshot;
      tools?: AnthropicTool[];
      /** Last few turns, so multi-step browser sessions (navigate →
       *  snapshot → click a ref) survive the stateless AI call. */
      history?: Array<{ role: "user" | "assistant"; content: string }>;
      /** Fired just before a gateway-retry backoff sleep, so the UI can
       * show "Retrying AI request… 2/3" instead of silent dead air. */
      onRetry?: (attempt: number, maxAttempts: number) => void;
      // Per-request AI gateway overrides sourced from the caller's saved
      // `UserAiConfig` row (Settings page). Empty string is the same as
      // "no override" — the server-side proxy falls back to its .env
      // default. Headers only attach when non-empty so we don't churn
      // request fingerprints when the user has cleared their config.
      gatewayProvider?: "anthropic" | "openai";
      gatewayUrl?: string;
      gatewayModel?: string;
      gatewayToken?: string;
    } = {},
  ): Promise<ChatMessage> {
    try {
      // Prepend the context inside the user message as well — some
      // gateways rewrite / drop the `system` field, so a model that
      // ignores our base prompt still sees the current state. The model
      // can answer in any language (we keep the user's own text after
      // a clear separator), and the prose reply renders without the
      // state block because we read the response off `content[]` not
      // off the user's request.
      const userText = options.context
        ? `${renderContextForSystemPrompt(options.context)}\n\n---\n\nUser request: ${text}`
        : text;
      const chatFetch = () =>
        fetch("/api/ai/chat", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            // `x-ai-chat-provider` picks the route (anthropic | openai).
            // The proxy defaults to "anthropic" when this header is absent,
            // matching the migration of pre-existing UserAiConfig rows.
            ...(options.gatewayProvider
              ? { "x-ai-chat-provider": options.gatewayProvider }
              : {}),
            ...(options.gatewayUrl
              ? { "x-ai-gateway-url": options.gatewayUrl }
              : {}),
            ...(options.gatewayModel
              ? { "x-ai-gateway-model": options.gatewayModel }
              : {}),
            ...(options.gatewayToken
              ? { "x-ai-gateway-token": options.gatewayToken }
              : {}),
          },
          body: JSON.stringify({
            text: userText,
            // Full app knowledge (pages, hierarchy, verification internals,
            // security posture, tool routing). The proxy prefers this over
            // its built-in default — see vite.config.ts aiChatProxy.
            system: buildSystemPrompt(),
            context: options.context,
            tools: options.tools,
            history: options.history,
          }),
        });
      // The AI gateway intermittently flaps (502/503/504, occasionally
      // 429). Retrying the MODEL call is safe — it executes nothing;
      // state changes happen only on an Allow click — so retry transient
      // statuses with short exponential backoff (1s, 2s; 3 attempts
      // total) before falling through to the offline matcher.
      //
      // 499 (Nginx-style "Client Closed Request") is included because the
      // prod proxy emits it whenever `req.on("close")` fires pre-response
      // — which in production happens transiently when an intermediate hop
      // (Azure ALB / Cloud Run) closes the underlying socket without
      // actually forwarding a disconnect signal. A single retry gives the
      // second hop a fresh connection and almost always succeeds; without
      // it, the chat panel would fall through to the local mock on
      // benign infra noise.
      let res = await chatFetch();
      for (
        let attempt = 1;
        attempt <= 2 &&
        !res.ok &&
        [499, 502, 503, 504, 429].includes(res.status);
        attempt++
      ) {
        options.onRetry?.(attempt + 1, 3);
        await delay(attempt * 1000);
        res = await chatFetch();
      }
      if (res.ok) {
        const payload = (await res.json()) as {
          content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
          stop_reason?: string;
          message?: string;
        };
        const content = payload.content ?? [];
        const textBlock = content.find((c) => c.type === "text");
        const toolUseBlocks: ToolUseBlock[] = content
          .filter(
            (c): c is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } =>
              c.type === "tool_use" &&
              typeof (c as { id?: unknown }).id === "string" &&
              typeof (c as { name?: unknown }).name === "string",
          )
          .map((c) => ({
            id: c.id,
            name: c.name,
            input: c.input ?? {},
          }));

        if (toolUseBlocks.length > 0) {
          // Tool-use turn — assistant proposes actions. Render a short
          // summary of the first tool in the content text, keep the full
          // proposal in `toolUse` so the permission UI can show "Allow".
          const summary = textBlock?.text ?? toolUseSummary(toolUseBlocks);
          return {
            id: `msg-${Math.random().toString(36).slice(2, 8)}`,
            role: "assistant",
            content: summary,
            timestamp: new Date().toISOString(),
            toolUse: toolUseBlocks,
            actions: toolUseBlocks.map((t) => ({
              id: `perm-${t.id}`,
              label: "Allow",
              kind: "request_tool_permission",
              payload: { toolUseId: t.id, toolName: t.name, toolInput: t.input },
            })),
          };
        }

        if (textBlock?.text) {
          return {
            id: `msg-${Math.random().toString(36).slice(2, 8)}`,
            role: "assistant",
            content: textBlock.text,
            timestamp: new Date().toISOString(),
          };
        }
        if (typeof payload.message === "string" && payload.message) {
          return {
            id: `msg-${Math.random().toString(36).slice(2, 8)}`,
            role: "assistant",
            content: payload.message,
            timestamp: new Date().toISOString(),
          };
        }
      }
      // 503 (not configured) or any other non-2xx → fall through to the
      // local mock so the chat surface still responds.
    } catch {
      // Network / parse error → fall through.
    }
    return mockAssistantReply(text);
  },
};

// Local fallback used when the AI gateway proxy is unavailable or unconfigured.
// Keeps the chat surface useful in dev environments without AI creds.
//
// Operates on content hints rather than the (now removed) in-memory store,
// so the canned replies stay useful after targets and issues moved out to
// the Blocks collections. Also pattern-matches a small set of action
// intents (toggle a check, start verification, change filters) and
// returns them as tool_use-style proposals — the same permission card
// the live model emits, just with no upstream model involved. That way
// the user can demo the "Allow / Deny" flow without a gateway token.
async function mockAssistantReply(text: string): Promise<ChatMessage> {
  await delay(450);
  const lower = text.toLowerCase();
  const actions: ChatAction[] = [];
  const toolUse: ToolUseBlock[] = [];

  // Pattern-match intent → emit a tool_use proposal. Each pattern
  // produces a single tool block so the permission card stays tidy.
  const checkMatch = matchCheckIntent(lower);
  if (checkMatch) {
    const block: ToolUseBlock = {
      id: `tool-mock-${Math.random().toString(36).slice(2, 8)}`,
      name: "toggle_verification_check",
      input: {
        checkId: checkMatch.checkId,
        // Carry the parsed verb as an explicit flag so the dispatcher
        // sets the desired end-state instead of flipping blind.
        ...(checkMatch.action !== "toggle"
          ? { enabled: checkMatch.action === "enable" }
          : {}),
      },
    };
    toolUse.push(block);
    return {
      id: `msg-${Math.random().toString(36).slice(2, 8)}`,
      role: "assistant",
      content: `I'd like to ${checkMatch.action} the "${checkMatch.checkId}" verification check. Allow?`,
      timestamp: new Date().toISOString(),
      toolUse: [block],
      actions: [
        {
          id: `perm-${block.id}`,
          label: "Allow",
          kind: "request_tool_permission",
          payload: { toolUseId: block.id, toolName: block.name, toolInput: block.input },
        },
      ],
    };
  }

  if (
    lower.includes("start verification") ||
    lower.includes("verify all") ||
    lower.includes("run verification")
  ) {
    const block: ToolUseBlock = {
      id: `tool-mock-${Math.random().toString(36).slice(2, 8)}`,
      name: "start_verification",
      input: {},
    };
    toolUse.push(block);
    return {
      id: `msg-${Math.random().toString(36).slice(2, 8)}`,
      role: "assistant",
      content: `I'd like to start a verification run on your enabled targets. Allow?`,
      timestamp: new Date().toISOString(),
      toolUse: [block],
      actions: [
        {
          id: `perm-${block.id}`,
          label: "Allow",
          kind: "request_tool_permission",
          payload: { toolUseId: block.id, toolName: block.name, toolInput: block.input },
        },
      ],
    };
  }

  // Verify / navigate to a free-form URL — "verify https://example.com",
  // "check https://...", "test http://localhost:3000", etc. We pull the
  // URL out of the message with a regex so the dispatcher can re-validate
  // it. Match the URL FIRST, before the open_target fallback below, so
  // a user who says "open https://x" or "verify https://x" always gets
  // the Playwright-driven verify_live_url — not a new tab.
  const urlMatch = text.match(/\bhttps?:\/\/[^\s,]+/i);
  if (urlMatch) {
    const rawUrl = urlMatch[0].replace(/[.,;!?)]+$/, "");
    const block: ToolUseBlock = {
      id: `tool-mock-${Math.random().toString(36).slice(2, 8)}`,
      name: "verify_live_url",
      input: { url: rawUrl },
    };
    toolUse.push(block);
    return {
      id: `msg-${Math.random().toString(36).slice(2, 8)}`,
      role: "assistant",
      content: `I'd like to navigate Playwright to ${rawUrl} and run the full verification suite. Allow?`,
      timestamp: new Date().toISOString(),
      toolUse: [block],
      actions: [
        {
          id: `perm-${block.id}`,
          label: "Allow",
          kind: "request_tool_permission",
          payload: { toolUseId: block.id, toolName: block.name, toolInput: block.input },
        },
      ],
    };
  }

  // Open a CONFIGURED target in a new browser tab. Pattern matches
  // Bengali / English variants. Skipped when the user pasted a URL (the
  // verify_live_url branch above handles that — opening a target in a
  // tab is only useful when the user names one of their configured
  // targets). The real `targetId` is filled in by the dispatcher when
  // the mock isn't running — when the live AI is configured, it picks
  // the id from the CURRENT STATE targets[] list.
  if (
    lower.includes("open") ||
    lower.includes("visit") ||
    lower.includes("show") ||
    lower.includes("browse") ||
    lower.includes("open the target") ||
    lower.includes("target open") ||
    lower.includes("target টা open") ||
    lower.includes("open করো")
  ) {
    const block: ToolUseBlock = {
      id: `tool-mock-${Math.random().toString(36).slice(2, 8)}`,
      name: "open_target_in_browser",
      input: { targetId: "" },
    };
    toolUse.push(block);
    return {
      id: `msg-${Math.random().toString(36).slice(2, 8)}`,
      role: "assistant",
      content: `I'd like to open one of your configured targets in a new browser tab. Allow?`,
      timestamp: new Date().toISOString(),
      toolUse: [block],
      actions: [
        {
          id: `perm-${block.id}`,
          label: "Allow",
          kind: "request_tool_permission",
          payload: { toolUseId: block.id, toolName: block.name, toolInput: block.input },
        },
      ],
    };
  }

  let content: string;
  if (lower.includes("critical")) {
    content = `Filter the list down to critical issues with the chip filter — or open any issue from the list to see its evidence.`;
    actions.push({
      id: "act-critical",
      label: "View Critical Issues",
      kind: "view_critical_issues",
    });
  } else if (lower.match(/verify\s+issue-[a-z0-9-]+/i)) {
    const match = text.match(/issue-[a-z0-9-]+/i);
    const issueId = match?.[0].toUpperCase();
    content = `Re-running verification for ${issueId ?? "the named issue"}.`;
    actions.push({
      id: "act-again",
      label: "Verify Again",
      kind: "verify_again",
      payload: { issueId },
    });
  } else if (lower.includes("changed") || lower.includes("last verification")) {
    content = `Open the Issue Tracker page to see the latest run summary and any new findings.`;
  } else if (
    lower.includes("how many") ||
    lower.includes("কয়টা") ||
    lower.includes("কত")
  ) {
    content = `Open the Issue Tracker page to see the latest run summary and any new findings.`;
  } else {
    // Honest offline notice — without this the canned fallback
    // impersonates a dim assistant and the user can't tell the AI
    // gateway is down (the bug behind "it can't answer me"). Framed as
    // an explicit "command mode" with the supported verb list, so the
    // user knows exactly what still works instead of guessing.
    content =
      `⚠️ The AI gateway isn't responding, so I'm in **command mode** — open questions are unavailable, but these still work:\n` +
      `• Start / stop a verification run\n` +
      `• Verify a URL (e.g. "verify https://example.com")\n` +
      `• Toggle a check (e.g. "enable the all_functionality check")\n` +
      `• Filter issues (e.g. "show critical issues")\n` +
      `Full answers return once the gateway is reachable.`;
  }

  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    role: "assistant",
    content,
    timestamp: new Date().toISOString(),
    actions: actions.length ? actions : undefined,
  };
}

// Detect intent like "uncheck forms", "Forms check off করো", "enable
// navigation". Returns the matching check id + the verb the mock should
// use in the bubble text. Returns null when no check intent matches —
// the caller falls through to the rest of the mock patterns. Exported
// because the permission card reuses it as a semantic guard: when the
// model proposes toggling a DIFFERENT check than the one the user just
// named, the card says so instead of rubber-stamping the mismatch.
export function matchCheckIntent(
  lower: string,
): { checkId: string; action: string } | null {
  // Map common synonyms to the canonical VerificationCheckId. Base
  // entries DERIVE from the check catalog (single source of truth) so a
  // newly added check can't silently go missing here — the exact drift
  // that once left "all functionality" unmatchable in command mode.
  // Shorthand aliases follow the derived full-label entries, so "auth"
  // only fires when "authentication" itself didn't match.
  const synonyms: Array<{ phrases: string[]; checkId: string }> = [
    ...verificationChecks.map((c) => ({
      phrases: [c.label.toLowerCase(), c.id],
      checkId: c.id,
    })),
    { phrases: ["nav link"], checkId: "navigation" },
    { phrases: ["auth"], checkId: "authentication" },
    { phrases: ["a11y"], checkId: "accessibility" },
    { phrases: ["perf"], checkId: "performance" },
    { phrases: ["deep walk", "deep-walk"], checkId: "all_functionality" },
  ];
  for (const { phrases, checkId } of synonyms) {
    if (!phrases.some((p) => lower.includes(p))) continue;
    // If user says "uncheck / off / disable / remove", action verb =
    // "disable". If "check / on / enable / add", verb = "enable".
    // Default to "toggle" when no verb is present.
    const wantsDisable =
      lower.includes("uncheck") ||
      lower.includes("off") ||
      lower.includes("disable") ||
      lower.includes("remove") ||
      lower.includes("বন্ধ") ||
      lower.includes("অফ") ||
      lower.includes("উঠাও");
    const wantsEnable =
      lower.includes("check") ||
      lower.includes("on") ||
      lower.includes("enable") ||
      lower.includes("add") ||
      lower.includes("চালু") ||
      lower.includes("অন") ||
      lower.includes("যোগ");
    const action = wantsDisable ? "disable" : wantsEnable ? "enable" : "toggle";
    return { checkId, action };
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
//  Helpers
// ────────────────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Stable run id (32 hex chars). Used as both the request id the MCP
// server expects and the evidence-file prefix.
function generateRunId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

// Build a short, human-readable summary when the assistant responds with
// tool_use blocks but no accompanying text. The permission card has the
// full proposal in `toolUse[]`; the bubble just needs a one-liner so
// the chat thread still reads naturally.
function toolUseSummary(blocks: ToolUseBlock[]): string {
  if (blocks.length === 1) {
    return `I'd like to ${describeTool(blocks[0]!)}. Allow?`;
  }
  return `I'd like to take ${blocks.length} actions. Allow?`;
}

function describeTool(t: ToolUseBlock): string {
  switch (t.name) {
    case "toggle_verification_check":
      return `toggle the "${String(t.input.checkId ?? "")}" verification check`;
    case "set_target_enabled":
      return `${t.input.enabled ? "enable" : "disable"} target ${String(t.input.targetId ?? "")}`;
    case "set_filters":
      return "update the issue filters";
    case "start_verification":
      return "start a verification run";
    case "update_issue_status":
      return `set ${String(t.input.issueId ?? "")} to "${String(t.input.status ?? "")}"`;
    default:
      return `run ${t.name}`;
  }
}

// Single seam between the API layer and the live backend. Every method
// that touches `/api/verify/*` calls this; it returns the upstream
// response when the flag is on, or runs the local fallback when the flag
// is off OR the live call fails (503 / network / parse).
//
// MCP cutover: when USE_REAL_VERIFY is true and we're ready to drop the
// in-browser mocks entirely, this helper is the single place to change.
// Replace the body with `return fetch(...)` and remove the fallback
// parameter — the diff stays localised and easy to review.
//
// `parse` may return `undefined` (e.g. for 204 No Content bodies);
// success is determined by `res.ok`, not by what parse returned.
async function gateVerify<T>(
  call: () => Promise<Response>,
  parse: (res: Response) => Promise<T>,
  fallback: () => Promise<T>,
): Promise<T> {
  if (!USE_REAL_VERIFY) return fallback();
  try {
    const res = await call();
    if (res.ok) {
      // `parse` is responsible for ignoring bodies it doesn't care
      // about (e.g. 204). We only fall through on upstream failure,
      // never on "successful empty response".
      return await parse(res);
    }
  } catch {
    // Network / parse / upstream failure → fall through.
  }
  return fallback();
}
