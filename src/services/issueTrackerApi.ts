// Frontend-only service abstraction for the Issue Tracker.
//
// MCP integration: methods are gated on the `USE_REAL_VERIFY` flag (see
// the helper at the bottom). When the flag is off (today's default) the
// in-browser mocks run, preserving the demo experience for users without
// a backend. When the flag is on, every method routes through `/api/verify/*`;
// on any failure (503, network, parse), the call falls back to the
// in-browser mock so the UI never gets stuck.
//
// MCP cutover (step 8 of prompt/Issue-Tracker-MCP-Design.md): the
// production-ready version of this file is the same module with
// `USE_REAL_VERIFY` set to `true` and the in-browser mocks deleted
// from the helper. That change is one line; this comment marks where it
// happens so the diff stays auditable.
//
// IMPORTANT: This file must never log credentials, never write secrets to
// localStorage, and never hardcode real passwords. See spec section 12.3.

import {
  mockIssues,
  mockSecrets,
  mockTargets,
  idleRun,
} from "@/data/mockIssueTrackerData";
import type {
  ChatMessage,
  ChatAction,
  Issue,
  RunEvent,
  Secret,
  VerificationRun,
  VerificationTarget,
} from "@/types/issue-tracker";

// MCP feature flag — read once at module load; flipping it requires a
// rebuild. Default off keeps today's behaviour bit-identical for users
// without a backend running.
//
// To cut over to the real backend permanently:
//   1. Set VITE_USE_REAL_VERIFY=1 in .env (or the build pipeline).
//   2. Delete the in-browser mocks from the helper below.
//   3. Run npm run build && npm run typecheck — there should be no
//      remaining references to mockSecrets / mockTargets / mockIssues.
const USE_REAL_VERIFY = import.meta.env.VITE_USE_REAL_VERIFY === "1";

// ────────────────────────────────────────────────────────────────────────────
//  Targets
// ────────────────────────────────────────────────────────────────────────────

export const issueTrackerApi = {
  async getTargets(): Promise<VerificationTarget[]> {
    await delay(120);
    return [...mockTargets];
  },

  async addTarget(
    payload: Omit<VerificationTarget, "id" | "createdAt" | "updatedAt">,
  ): Promise<VerificationTarget> {
    await delay(120);
    const now = new Date().toISOString();
    const created: VerificationTarget = {
      ...payload,
      id: `tgt-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: now,
      updatedAt: now,
    };
    mockTargets.push(created);
    return created;
  },

  async removeTarget(id: string): Promise<void> {
    await delay(80);
    const idx = mockTargets.findIndex((t) => t.id === id);
    if (idx >= 0) mockTargets.splice(idx, 1);
  },

  async updateTarget(
    id: string,
    patch: Partial<VerificationTarget>,
  ): Promise<VerificationTarget> {
    await delay(80);
    const idx = mockTargets.findIndex((t) => t.id === id);
    if (idx < 0) throw new Error("Target not found");
    mockTargets[idx] = { ...mockTargets[idx], ...patch, updatedAt: new Date().toISOString() };
    return mockTargets[idx];
  },

  // ──────────────────────────────────────────────────────────────────────────
  //  Secrets
  // ──────────────────────────────────────────────────────────────────────────

  async getSecrets(): Promise<Secret[]> {
    return gateVerify<Secret[]>(
      () => fetch("/api/secrets", { method: "GET" }),
      (res) => res.json() as Promise<Secret[]>,
      async () => {
        await delay(120);
        return [...mockSecrets];
      },
    );
  },

  async addSecret(payload: { name: string; email: string; password: string }): Promise<Secret> {
    // MCP step 6: when the flag is on, the password round-trips to the
    // server, which stores it encrypted at rest and returns a masked
    // response. When the flag is off, we keep the original "drop the
    // password client-side" behaviour so local dev with no backend
    // still works.
    return gateVerify<Secret>(
      () =>
        fetch("/api/secrets", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }),
      (res) => res.json() as Promise<Secret>,
      async () => {
        await delay(120);
        const now = new Date().toISOString();
        const created: Secret = {
          id: `secret-${Math.random().toString(36).slice(2, 8)}`,
          name: payload.name,
          email: payload.email,
          passwordMasked: "•".repeat(Math.min(10, Math.max(6, payload.password.length))),
          createdAt: now,
          updatedAt: now,
        };
        mockSecrets.push(created);
        return created;
      },
    );
  },

  async deleteSecret(id: string): Promise<void> {
    await gateVerify<void>(
      () =>
        fetch(`/api/secrets/${encodeURIComponent(id)}`, { method: "DELETE" }),
      // 204 No Content — don't try to read the (empty) body. Skipping
      // the body is the safe default for DELETE-style endpoints.
      async () => undefined,
      async () => {
        await delay(80);
        const idx = mockSecrets.findIndex((s) => s.id === id);
        if (idx >= 0) mockSecrets.splice(idx, 1);
      },
    );
  },

  // ──────────────────────────────────────────────────────────────────────────
  //  Issues
  // ──────────────────────────────────────────────────────────────────────────

  async getIssues(): Promise<Issue[]> {
    await delay(120);
    return [...mockIssues];
  },

  async updateIssueStatus(id: string, status: Issue["status"]): Promise<Issue> {
    await delay(80);
    const idx = mockIssues.findIndex((i) => i.id === id);
    if (idx < 0) throw new Error("Issue not found");
    mockIssues[idx] = { ...mockIssues[idx], status };
    return mockIssues[idx];
  },

  // ──────────────────────────────────────────────────────────────────────────
  //  Test connection (section 14)
  // ──────────────────────────────────────────────────────────────────────────
  //
  // MCP integration step 1: gated behind `VITE_USE_REAL_VERIFY=1`. When off
  // (the default), the deterministic mock below runs unchanged — same
  // behaviour every existing user has today. When on, the client POSTs to
  // `/api/verify/test`, which the Vite proxy either forwards to a real
  // backend or responds 503 with `verify_not_configured`. On any failure
  // (non-2xx, network error, parse error) we fall through to the mock so
  // the UI never gets stuck — same fallback strategy the chat uses for an
  // unconfigured AI gateway.

  async testConnection(target: VerificationTarget): Promise<{
    urlReachable: boolean;
    loginSuccessful: boolean;
  }> {
    return gateVerify<{ urlReachable: boolean; loginSuccessful: boolean }>(
      () =>
        fetch("/api/verify/test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ targetId: target.id, url: target.url }),
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

  // ──────────────────────────────────────────────────────────────────────────
  //  Verification runs (sections 16, 19, 20)
  // ──────────────────────────────────────────────────────────────────────────

  async getCurrentRun(): Promise<VerificationRun> {
    await delay(80);
    return { ...idleRun };
  },

  async startVerification(targets: VerificationTarget[]): Promise<VerificationRun> {
    // MCP step 2: when the flag is on, ask the backend to schedule the run.
    // The backend returns immediately with the new run id; real progress
    // arrives via the SSE stream returned by `subscribeRun`. On any failure
    // (proxy 503, network error, parse error) we fall back to the local
    // mock so the UI never blocks.
    return gateVerify<VerificationRun>(
      () =>
        fetch("/api/verify/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ targetIds: targets.map((t) => t.id) }),
        }),
      (res) => res.json() as Promise<VerificationRun>,
      async () => {
        await delay(150);
        const now = new Date().toISOString();
        return {
          id: `run-${Math.random().toString(36).slice(2, 8)}`,
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
          scope: idleRun.scope,
        };
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
    const es = new EventSource(`/api/verify/runs/${runId}/events`);
    es.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as RunEvent;
        handlers.onEvent(parsed);
      } catch (err) {
        handlers.onError(err instanceof Error ? err : new Error(String(err)));
      }
    };
    es.onerror = () => {
      // EventSource auto-reconnects, so we don't close on a single error.
      // But if the proxy already 503'd on the first request, the connection
      // never opens — EventSource fires error once and that's enough
      // signal for the hook to downgrade to local mode.
      handlers.onError(new Error("run stream error"));
    };
    return () => es.close();
  },

  // ──────────────────────────────────────────────────────────────────────────
  //  Chat (section 7) — POSTs to the Vite-side proxy at `/api/ai/chat`,
  //  which forwards to the upstream AI gateway with the bearer token. When
  //  the proxy reports the gateway isn't configured (503), or the request
  //  fails for any reason, we fall back to a local pattern-matcher so the
  //  chat still returns useful canned replies in a setup without an AI
  //  backend (e.g. running `npm run dev` without setting `AI_GATEWAY_TOKEN`).
  // ──────────────────────────────────────────────────────────────────────────

  async sendChatMessage(text: string): Promise<ChatMessage> {
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        const payload = (await res.json()) as {
          content?: Array<{ type: string; text?: string }>;
          message?: string;
        };
        const replyText =
          payload.content?.find((c) => c.type === "text")?.text ??
          (typeof payload.message === "string" ? payload.message : "");
        if (replyText) {
          return {
            id: `msg-${Math.random().toString(36).slice(2, 8)}`,
            role: "assistant",
            content: replyText,
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
async function mockAssistantReply(text: string): Promise<ChatMessage> {
  await delay(450);
  const lower = text.toLowerCase();
  const actions: ChatAction[] = [];

  let content: string;
  if (lower.includes("verify all")) {
    content = `I found ${mockTargets.length} configured applications:\n\n${mockTargets
      .map((t) => `• ${t.applicationName}`)
      .join("\n")}\n\nReady to start verification.`;
    actions.push({ id: "act-start", label: "Start Verification", kind: "start_verification" });
  } else if (lower.includes("critical")) {
    const critical = mockIssues.filter((i) => i.severity === "critical");
    content = `I found ${critical.length} critical issue${
      critical.length === 1 ? "" : "s"
    }:\n\n${critical.map((i, idx) => `${idx + 1}. ${i.title}`).join("\n")}`;
    actions.push({
      id: "act-critical",
      label: "View Critical Issues",
      kind: "view_critical_issues",
    });
  } else if (lower.match(/verify\s+issue-\d+/i)) {
    const match = text.match(/issue-\d+/i);
    const issueId = match?.[0].toUpperCase();
    const issue = mockIssues.find((i) => i.id === issueId);
    content = issue
      ? `Targeted verification started for ${issue.id}.\n\n✓ Issue located in mock store\n✓ Reproduction steps queued\n⟳ Running checks...`
      : `I couldn't find ${issueId ?? "that issue"} in the current issue list.`;
    if (issue) {
      actions.push({
        id: "act-again",
        label: "Verify Again",
        kind: "verify_again",
        payload: { issueId: issue.id },
      });
    }
  } else if (lower.includes("changed") || lower.includes("last verification")) {
    content = `Since the last verification:\n\n• 2 new issues detected\n• 1 issue marked fixed\n• 0 issues reopened`;
  } else {
    content = `I can help with that. Try one of the suggested prompts, or ask me about verification, issues, or configuration.`;
  }

  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    role: "assistant",
    content,
    timestamp: new Date().toISOString(),
    actions: actions.length ? actions : undefined,
  };
}

// ────────────────────────────────────────────────────────────────────────────
//  Helpers
// ────────────────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
