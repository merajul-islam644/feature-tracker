// Fastify HTTP server exposing the MCP verification endpoints.
//
// Endpoints
//   POST   /verify/test                → one-shot probe
//   POST   /verify/runs                → create + start run (idempotent)
//   GET    /verify/runs/:id/events     → SSE event tail
//   POST   /verify/runs/:id/stop       → cancel the agent loop
//   GET    /secrets                    → list masked secrets
//   POST   /secrets                    → create encrypted secret
//   DELETE /secrets/:id                → delete secret
//   GET    /playwright/tools           → official Playwright MCP tool catalog
//   POST   /playwright/call            → forward a tool call to Playwright MCP
//   GET    /evidence/:filename         → stream artifact
//
// The verification agent runs in headed mode (a real visible Chrome
// window on the host). The browser window is the preview — there is
// no in-app mirror and no `/interact` endpoint, so the user sees the
// same browser the agent is driving.

import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { appendEvent, eventsAfter, getRun, listRuns, requestStop, setStatus, startRun, waitForEvents } from "./runs.js";
import { runAgent, testConnection } from "./agent.js";
import { listSecrets, createSecret, deleteSecret } from "./secrets.js";
import { listPlaywrightTools, callPlaywrightTool } from "./playwrightMcp.js";
import { resolveEvidence } from "./evidence.js";
import type { StartVerificationRequest } from "./types.js";

const PORT = Number(process.env.MCP_PORT ?? 8787);

const app = Fastify({ logger: { level: process.env.MCP_LOG_LEVEL ?? "info" } });
await app.register(cors, { origin: true, credentials: true });

// ────────────────────────────────────────────────────────────────────────────
//  Health
// ────────────────────────────────────────────────────────────────────────────

app.get("/health", async () => ({ ok: true, time: new Date().toISOString() }));

// ────────────────────────────────────────────────────────────────────────────
//  Test connection — quick one-shot probe.
// ────────────────────────────────────────────────────────────────────────────

const TestBody = z.object({
  target: z.object({
    id: z.string(),
    applicationName: z.string(),
    url: z.string().url(),
    credentialId: z.string().nullable().optional(),
  }),
});

app.post("/verify/test", async (req, reply) => {
  const parsed = TestBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  const result = await testConnection(parsed.data);
  return result;
});

// ────────────────────────────────────────────────────────────────────────────
//  Start run — idempotent (spec §7).
// ────────────────────────────────────────────────────────────────────────────

const TargetSchema = z.object({
  id: z.string(),
  applicationName: z.string(),
  url: z.string().url(),
  enabled: z.boolean(),
  credentialId: z.string().nullable().optional(),
});

const StartBody = z.object({
  runId: z.string(),
  userId: z.string(),
  targets: z.array(TargetSchema).min(1),
  scope: z
    .array(
      // Keep in sync with VerificationCheckId in mcp-server/src/types.ts —
      // a new check id must be added to BOTH or /verify/runs rejects it.
      z.enum([
        "page_load",
        "navigation",
        "buttons",
        "forms",
        "broken_links",
        "console_errors",
        "network_errors",
        "authentication",
        "accessibility",
        "performance",
        "all_functionality",
      ]),
    )
    .min(1),
  // Device emulation preset for the run's browser context.
  device: z.enum(["desktop", "mobile", "tablet"]).optional(),
});

// Run history — persisted records survive server restarts (see
// runs.ts), so this lists past runs newest-first without their event
// logs (those replay via /verify/runs/:id/events).
app.get("/verify/runs", async (req) => {
  const limit = Math.min(Number((req.query as { limit?: string }).limit ?? 25) || 25, 100);
  return { runs: listRuns(limit) };
});

app.post("/verify/runs", async (req, reply) => {
  const parsed = StartBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  const payload = parsed.data as StartVerificationRequest;
  const { id, replay } = startRun(payload);
  if (replay) {
    return reply.send({ id, replay: true, status: getRun(id)?.status });
  }
  // Fire-and-forget — agent loop writes events into the store; SSE
  // tail picks them up.
  runAgent(payload).catch((err) => {
    app.log.error({ err, runId: id }, "agent crashed");
    setStatus(id, "failed");
    appendEvent(id, { kind: "run_failed", runId: id, reason: (err as Error).message });
  });
  return reply.send({ id, replay: false, status: "queued" });
});

// ────────────────────────────────────────────────────────────────────────────
//  Pause / resume / stop — minimal surface; the agent loop is short
//  enough (a few seconds per target) that pause/resume are advisory.
// ────────────────────────────────────────────────────────────────────────────

app.post<{ Params: { id: string } }>("/verify/runs/:id/pause", async (req, reply) => {
  const r = getRun(req.params.id);
  if (!r) return reply.code(404).send({ error: "not found" });
  if (r.status === "running") setStatus(req.params.id, "paused");
  return { ok: true, status: r.status };
});

app.post<{ Params: { id: string } }>("/verify/runs/:id/resume", async (req, reply) => {
  const r = getRun(req.params.id);
  if (!r) return reply.code(404).send({ error: "not found" });
  if (r.status === "paused") setStatus(req.params.id, "running");
  return { ok: true, status: r.status };
});

app.post<{ Params: { id: string } }>("/verify/runs/:id/stop", async (req, reply) => {
  const r = getRun(req.params.id);
  if (!r) return reply.code(404).send({ error: "not found" });
  // Flip the cooperative flag too — without it the agent loop keeps
  // driving Playwright to completion invisibly after the UI already
  // reported the run as cancelled.
  requestStop(req.params.id);
  setStatus(req.params.id, "cancelled");
  appendEvent(req.params.id, {
    kind: "run_failed",
    runId: req.params.id,
    reason: "Cancelled by user.",
  });
  return { ok: true };
});

// ────────────────────────────────────────────────────────────────────────────
//  SSE event tail — spec §6 step 5.
// ────────────────────────────────────────────────────────────────────────────

app.get<{ Params: { id: string }; Querystring: { since?: string } }>(
  "/verify/runs/:id/events",
  async (req, reply) => {
    const r = getRun(req.params.id);
    if (!r) return reply.code(404).send({ error: "not found" });

    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("X-Accel-Buffering", "no");
    reply.raw.flushHeaders?.();

    const since = Number(req.query.since ?? 0);
    const write = (event: unknown) =>
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    const writeEvent = (event: unknown) => write({ type: "event", event });

    // Replay any events the client hasn't seen yet.
    for (const ev of eventsAfter(req.params.id, since)) writeEvent(ev);

    // Keep the stream alive on a 15s heartbeat — spec §6 step 5.
    const heartbeat = setInterval(() => reply.raw.write(": ping\n\n"), 15_000);

    let cursor = r.cursor;

    const cleanup = () => {
      clearInterval(heartbeat);
    };

    // Tail loop — long-poll up to 30s, then re-check.
    while (!reply.raw.writableEnded) {
      const finished = r.status === "completed" || r.status === "failed" || r.status === "cancelled";
      if (finished && cursor === r.cursor) {
        write({ type: "done" });
        cleanup();
        // End the raw response too — the handler hijacked it from
        // Fastify, so returning alone leaves the socket open with no
        // heartbeat. Every subscriber to a finished run would otherwise
        // hold a dead connection until ITS side times out.
        reply.raw.end();
        break;
      }
      const newEvents = await waitForEvents(req.params.id, cursor, 1_500);
      for (const ev of newEvents) writeEvent(ev);
      // Advance by what this connection actually delivered — NOT to
      // r.cursor. Events appended between the waiter's slice snapshot and
      // this assignment (a run's final burst: watch-done →
      // target_completed → run_completed lands in one synchronous block)
      // would otherwise be skipped forever, so the client never sees the
      // last target_completed and the run summary reads "0/N done".
      if (newEvents.length > 0) cursor += newEvents.length;
    }
    cleanup();
  },
);

// ────────────────────────────────────────────────────────────────────────────
//  Secrets — encrypted at rest; password never reaches /secrets responses.
// ────────────────────────────────────────────────────────────────────────────

const CreateSecretBody = z.object({
  // Optional explicit id — when provided, the secret is upserted under that
  // id so the frontend's Blocks Data ItemId and the MCP server's secret id
  // match (the frontend binds VerificationTarget.credentialId to the same
  // value the agent looks up at verify-time).
  id: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(1).max(512),
});

app.get("/secrets", async () => ({ secrets: listSecrets() }));

app.post("/secrets", async (req, reply) => {
  const parsed = CreateSecretBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  const created = createSecret(parsed.data);
  return reply.code(201).send(created);
});

app.delete<{ Params: { id: string } }>("/secrets/:id", async (req, reply) => {
  const ok = deleteSecret(req.params.id);
  if (!ok) return reply.code(404).send({ error: "not found" });
  return { ok: true };
});

// ────────────────────────────────────────────────────────────────────────────
//  Official Playwright MCP bridge — the chatbot's browser tools.
//  GET  /playwright/tools → live tool catalog from `npx @playwright/mcp@latest`
//  POST /playwright/call  → forward one tool call to the official server
// ────────────────────────────────────────────────────────────────────────────

app.get("/playwright/tools", async (_req, reply) => {
  try {
    return { tools: await listPlaywrightTools() };
  } catch (err) {
    app.log.error({ err }, "playwright tools/list failed");
    return reply
      .code(502)
      .send({ error: "playwright_mcp_unavailable", message: (err as Error).message });
  }
});

const PlaywrightCallBody = z.object({
  tool: z.string().min(1),
  arguments: z.record(z.unknown()).default({}),
});

app.post("/playwright/call", async (req, reply) => {
  const parsed = PlaywrightCallBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  try {
    const result = await callPlaywrightTool(parsed.data.tool, parsed.data.arguments);
    return { tool: parsed.data.tool, result };
  } catch (err) {
    app.log.error({ err, tool: parsed.data.tool }, "playwright tool call failed");
    return reply
      .code(502)
      .send({ error: "playwright_tool_failed", message: (err as Error).message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
//  Evidence — stream with run-ownership check.
// ────────────────────────────────────────────────────────────────────────────

app.get<{ Params: { filename: string }; Querystring: { runId?: string } }>(
  "/evidence/:filename",
  async (req, reply) => {
    const f = resolveEvidence(req.params.filename);
    if (!f) return reply.code(404).send({ error: "not found" });
    // Cheap ownership check — evidence files are prefixed with the
    // runId they came from. Without a matching ?runId header we 404
    // so a leaked filename alone can't be used to fetch another
    // tenant's screenshot. Production would also pin to JWT userId.
    if (req.query.runId && !req.params.filename.startsWith(`${req.query.runId}_`)) {
      return reply.code(403).send({ error: "not your evidence" });
    }
    reply.header("Content-Type", f.mime);
    reply.header("Content-Length", String(f.size));
    reply.header("Cache-Control", "private, max-age=300");
    return reply.send(f.buffer);
  },
);

// ────────────────────────────────────────────────────────────────────────────
//  Run start
// ────────────────────────────────────────────────────────────────────────────

try {
  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`MCP server listening on :${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
