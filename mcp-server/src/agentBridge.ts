// Local-agent bridge — bridges the cloud mcp-server to a long-running
// WebSocket connection from a local agent on the user's machine.
//
// Why this exists
// ────────────────
// The /panel workspace needs to read the user's local filesystem and
// run their `npm run dev` as a child process. In production the cloud
// mcp-server runs inside a Cloud Run container with no access to the
// user's D:\ drive, so all 15 /dev-server/* routes must be FORWARDED
// to a local mcp-server (spawned by `agent/agent.mjs`) that does have
// the access. This file owns that forwarding.
//
// Protocol (newline-delimited JSON over a single WebSocket)
// ──────────────────────────────────────────────────────────
// Cloud → agent:
//   { type: "hello_ack",      ok: true, version }
//   { type: "http_response_start", requestId, status, headers }
//   { type: "http_response_chunk", requestId, chunk }      // chunk is base64
//   { type: "http_response_end",   requestId }
//   { type: "http_response_error", requestId, message }
//   { type: "ping", ts }
//
// Agent → cloud:
//   { type: "hello",          token, version }
//   { type: "http_request",   requestId, method, path, headers, body, query }
//   { type: "pong", ts }
//
// The forwardToAgent helper implements the cloud side: it sends an
// http_request, awaits http_response_start/chunk/end (or error), and
// pipes the chunks into the Fastify reply. The body is base64 because
// the local mcp-server's response may be a binary stream (image
// bytes for `/evidence/:filename` even though `/dev-server/*` is all
// text/JSON today — base64 keeps the wire format uniform).
//
// Auth model
// ───────────
// MVP is single-tenant. The cloud mcp-server reads AGENT_BRIDGE_TOKEN
// from process.env; the agent passes it in the hello frame. A
// mismatch closes the socket with code 4401. Per-user routing (cookie
// → IAM userinfo → Map<userId, WebSocket>) is a follow-up.

import { randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";

// @fastify/websocket passes the bare ws WebSocket to the route
// handler; the SocketStream wrapper (which adds .socket etc.) is
// unwrapped by Fastify when you use { websocket: true } on a
// regular route, so the parameter type IS just WebSocket. The
// typedef below ensures any accidental drift surfaces at compile
// time.
type AgentSocket = WebSocket;

// ─────────────────────────────────────────────────────────────────────
//  Module state
// ─────────────────────────────────────────────────────────────────────

const AGENT_BRIDGE_ENABLED = process.env.AGENT_BRIDGE_ENABLED === "1";
const AGENT_BRIDGE_TOKEN = process.env.AGENT_BRIDGE_TOKEN ?? "";

// Single global socket — MVP is single-tenant. If a second agent
// connects, the first is closed (only one workspace per tenant for
// now). Per-user routing is a follow-up.
let agentSocket: WebSocket | null = null;
let agentConnectedAt: string | null = null;
let agentVersion: string | null = null;
let helloResolve: ((ok: boolean) => void) | null = null;

// Frame handlers keyed by requestId. While an HTTP request is in
// flight to the agent, its `start` arrives, kicks the response into
// streaming mode, and chunks are appended until `end` or `error`.
interface PendingRequest {
  resolve: () => void;
  reject: (err: Error) => void;
  // The reply's raw response. We write to it directly because
  // /dev-server/:wsId/:port/events streams indefinitely.
  raw: import("node:http").ServerResponse;
  started: boolean;
  timer: NodeJS.Timeout;
}

const pending = new Map<string, PendingRequest>();

// ─────────────────────────────────────────────────────────────────────
//  Status — polled by the SPA banner
// ─────────────────────────────────────────────────────────────────────

export function getAgentBridgeStatus(): {
  enabled: boolean;
  connected: boolean;
  connectedAt: string | null;
  version: string | null;
} {
  return {
    enabled: AGENT_BRIDGE_ENABLED,
    connected: agentSocket !== null,
    connectedAt: agentConnectedAt,
    version: agentVersion,
  };
}

// ─────────────────────────────────────────────────────────────────────
//  Wire installation — called once from index.ts
// ─────────────────────────────────────────────────────────────────────

export function installAgentBridgeHandlers(socket: WebSocket): void {
  // Reject a second concurrent connection. The first one stays — if
  // the user re-runs the agent on a different port, the old one
  // is presumably stale and the new one is the live one.
  if (agentSocket && agentSocket !== socket && agentSocket.readyState === 1 /* OPEN */) {
    try {
      agentSocket.close(4400, "replaced_by_new_connection");
    } catch {
      /* already closed */
    }
  }
  agentSocket = socket;
  agentConnectedAt = new Date().toISOString();
  agentVersion = null;

  socket.on("message", (raw) => {
    let frame: any;
    try {
      frame = JSON.parse(String(raw));
    } catch (err) {
      // Malformed frame — close so the agent re-handshakes.
      socket.close(4402, "bad_json");
      return;
    }
    handleFrame(socket, frame);
  });

  socket.on("close", (code, reason) => {
    if (agentSocket === socket) {
      agentSocket = null;
      agentConnectedAt = null;
      agentVersion = null;
    }
    // Reject any in-flight requests with a 502-equivalent.
    for (const [requestId, p] of pending) {
      try {
        if (!p.raw.writableEnded) {
          p.raw.statusCode = 502;
          p.raw.end(
            JSON.stringify({
              error: "agent_disconnected",
              message: `Agent closed (code=${code}, reason=${String(reason) || ""})`,
            }),
          );
        }
      } catch {
        /* raw already gone */
      }
      clearTimeout(p.timer);
      p.reject(new Error("agent_disconnected"));
      pending.delete(requestId);
    }
  });

  socket.on("error", (err) => {
    // The `close` event fires after `error`; cleanup happens there.
    // Just log.
    try {
      console.warn("[agent-bridge] socket error:", err.message);
    } catch {
      /* socket already gone */
    }
  });
}

function handleFrame(socket: WebSocket, frame: any): void {
  switch (frame?.type) {
    case "hello": {
      const token = typeof frame.token === "string" ? frame.token : "";
      if (!AGENT_BRIDGE_TOKEN || token !== AGENT_BRIDGE_TOKEN) {
        try {
          socket.send(JSON.stringify({ type: "hello_ack", ok: false, reason: "bad_token" }));
        } catch {
          /* */
        }
        socket.close(4401, "bad_token");
        return;
      }
      agentVersion = typeof frame.version === "string" ? frame.version : "unknown";
      try {
        socket.send(JSON.stringify({ type: "hello_ack", ok: true, version: agentVersion }));
      } catch {
        /* */
      }
      if (helloResolve) helloResolve(true);
      helloResolve = null;
      return;
    }
    case "http_response_start": {
      const p = pending.get(frame.requestId);
      if (!p) return;
      p.started = true;
      const status = Number(frame.status ?? 200);
      p.raw.statusCode = status;
      const headers = (frame.headers ?? {}) as Record<string, string>;
      for (const [k, v] of Object.entries(headers)) {
        // Node will reject setting hop-by-hop or invalid header names
        // silently. The agent is trusted to send back what the local
        // mcp-server sent it (minus hop-by-hop we strip there).
        try {
          p.raw.setHeader(k, v);
        } catch {
          /* ignore */
        }
      }
      p.raw.flushHeaders?.();
      return;
    }
    case "http_response_chunk": {
      const p = pending.get(frame.requestId);
      if (!p) return;
      const chunk = typeof frame.chunk === "string" ? frame.chunk : "";
      if (chunk) {
        try {
          p.raw.write(Buffer.from(chunk, "base64"));
        } catch {
          /* socket closed */
        }
      }
      return;
    }
    case "http_response_end": {
      const p = pending.get(frame.requestId);
      if (!p) return;
      try {
        p.raw.end();
      } catch {
        /* */
      }
      clearTimeout(p.timer);
      p.resolve();
      pending.delete(frame.requestId);
      return;
    }
    case "http_response_error": {
      const p = pending.get(frame.requestId);
      if (!p) return;
      const message = String(frame.message ?? "agent_error");
      try {
        if (!p.raw.headersSent) {
          p.raw.statusCode = 502;
          p.raw.setHeader("content-type", "application/json");
          p.raw.end(JSON.stringify({ error: "agent_error", message }));
        } else {
          p.raw.end();
        }
      } catch {
        /* */
      }
      clearTimeout(p.timer);
      p.reject(new Error(message));
      pending.delete(frame.requestId);
      return;
    }
    case "pong": {
      // Heartbeat reply — nothing to do, just reset the disconnect
      // watchdog if we had one. (We don't, currently — the WebSocket
      // protocol's own PING/PONG handles that.)
      return;
    }
    default:
      // Unknown frame — close so the agent re-handshakes from a clean
      // state. Better to fail loud than to silently mis-handle.
      try {
        socket.close(4402, `unknown_frame_type:${frame?.type}`);
      } catch {
        /* */
      }
  }
}

// ─────────────────────────────────────────────────────────────────────
//  Server-initiated heartbeat (currently disabled — @fastify/websocket
//  handles its own PING/PONG at the protocol level). Kept here as a
//  hook point in case we need application-level keepalives later.
// ─────────────────────────────────────────────────────────────────────

export function startAgentBridgeHeartbeat(_intervalMs: number): () => void {
  return () => {
    /* no-op */
  };
}

// ─────────────────────────────────────────────────────────────────────
//  The forwarder — called from a Fastify preHandler hook in index.ts.
//
//  Returns:
//    true  → the request has been (or will be) handled by the agent;
//            Fastify should skip the route handler.
//    false → the request is NOT going through the agent; the route
//            handler should run as normal (local execution).
//
//  When AGENT_BRIDGE_ENABLED is "1" but no agent is connected, we 503
//  with a structured error. The SPA banner shows the friendly state;
//  the 503 surfaces as a toast on any user-initiated call.
// ─────────────────────────────────────────────────────────────────────

export async function forwardToAgent(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  // Not in scope — let the route handler run.
  if (!AGENT_BRIDGE_ENABLED) return false;

  // No agent connected. Reply 503 and short-circuit.
  if (!agentSocket || agentSocket.readyState !== 1 /* OPEN */) {
    reply
      .code(503)
      .send({
        error: "agent_offline",
        message:
          "Local agent is not connected. Open a terminal and run `node agent/agent.mjs` to start it.",
      });
    return true;
  }

  // Hijack the reply so we can stream the response back as chunks
  // arrive. This is the same pattern the SSE handlers in index.ts
  // use (`reply.raw.setHeader(...)`).
  reply.hijack();
  const raw = reply.raw;
  // Fastify's requestTimeout is 90s by default; SSE / dev-server
  // output can stream much longer, so we explicitly disable it on
  // the raw response.
  raw.setTimeout(0);

  const requestId = randomUUID();

  // Build the envelope. We capture path + query + method + headers
  // + body verbatim — the local mcp-server speaks the exact same
  // wire shape as the cloud, so the agent just forwards.
  const url = req.raw.url ?? "/";
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!v) continue;
    // Strip hop-by-hop headers — the agent will set its own when
    // calling the local mcp-server. Host, connection, content-length
    // are caller-specific and would be wrong on a different host.
    if (k === "host" || k === "connection" || k === "content-length") continue;
    headers[k] = Array.isArray(v) ? v.join(", ") : String(v);
  }

  const envelope = {
    type: "http_request",
    requestId,
    method: req.method,
    path: url,
    headers,
    // Body may be a Buffer (uploaded by raw body parser) or already
    // an object (json parser). Stringify if it's an object so the
    // agent can reconstruct exactly what arrived.
    body: encodeBody(req.body),
  };

  return new Promise<boolean>((resolveTop) => {
    // 60-second cap on a single request — matches the prod-backend's
    // REQUEST_TIMEOUT_MS. SSE overrides this via setTimeout(0) above,
    // but the per-frame timeout still applies so a wedged agent
    // doesn't leak a slot in `pending` forever.
    const timer = setTimeout(() => {
      const p = pending.get(requestId);
      if (!p) return;
      try {
        if (!p.raw.headersSent) {
          p.raw.statusCode = 504;
          p.raw.end(
            JSON.stringify({ error: "agent_timeout", message: "Agent did not respond within 60s" }),
          );
        } else {
          p.raw.end();
        }
      } catch {
        /* */
      }
      pending.delete(requestId);
      p.reject(new Error("agent_timeout"));
    }, 60_000);

    pending.set(requestId, {
      raw,
      started: false,
      timer,
      resolve: () => resolveTop(true),
      reject: () => resolveTop(true),
    });

    try {
      agentSocket!.send(JSON.stringify(envelope));
    } catch (err) {
      clearTimeout(timer);
      pending.delete(requestId);
      try {
        if (!raw.headersSent) {
          raw.statusCode = 502;
          raw.end(
            JSON.stringify({ error: "agent_send_failed", message: (err as Error).message }),
          );
        } else {
          raw.end();
        }
      } catch {
        /* */
      }
      resolveTop(true);
    }
  });
}

function encodeBody(body: unknown): unknown {
  if (body == null) return null;
  if (Buffer.isBuffer(body)) return { __b64: body.toString("base64") };
  if (typeof body === "string") return body;
  return body; // JSON — passes through
}
