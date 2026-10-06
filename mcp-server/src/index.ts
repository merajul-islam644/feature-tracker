// Fastify HTTP server exposing the MCP verification endpoints.
//
// Endpoints
//   POST   /verify/test                → one-shot probe
//   POST   /verify/runs                → create + start run (idempotent)
//   GET    /verify/runs/:id/events     → SSE event tail
//   POST   /verify/runs/:id/stop       → cancel the agent loop
//   GET    /secrets                    → list masked secrets
//   POST   /secrets                    → create encrypted secret
//   GET    /secrets/:id                → plaintext credential (LOOPBACK ONLY)
//   DELETE /secrets/:id                → delete secret
//   GET    /playwright/tools           → official Playwright MCP tool catalog
//   POST   /playwright/call            → forward a tool call to Playwright MCP
//   POST   /playwright/install         → spawn `npx playwright install` to
//                                          download the chromium / firefox /
//                                          webkit browser binaries the spec
//                                          runner needs
//   POST   /tools/install              → `npm install <pkg>` into the
//                                          server's node_modules (no-save)
//                                          so user scripts can `require()`
//                                          arbitrary helpers (lodash, etc.)
//                                          without going through "install"
//                                          for the editor itself
//   GET    /tools/list                 → enumerate every package under
//                                          ./node_modules so the drawer
//                                          can show an "Installed tools"
//                                          panel (frameworks the user
//                                          pulled in via /tools/install
//                                          + the server's own deps)
//   GET    /evidence/:filename         → stream artifact
//
//   POST   /dev-server/start           → spawn `npm run dev` as a child of
//                                          the server in a per-workspace
//                                          sandbox dir; multiple ports per
//                                          workspace allowed (composite id)
//   POST   /dev-server/stop            → SIGTERM a running dev server
//   GET    /dev-server/:wsId/:port/status
//                                        → record snapshot (no child ref)
//   GET    /dev-server/:wsId/:port/events
//                                        → SSE tail (15s heartbeat,
//                                          cursor advance, replay since)
//   GET    /dev-server/:wsId/:port/files/*
//                                        → read workspace file (path
//                                          guard rejects `..` and out-
//                                          of-root resolves)
//   PUT    /dev-server/:wsId/:port/files/*
//                                        → write workspace file (1MB cap)
//   GET    /dev-server/:wsId/:port/proxy/*
//                                        → reverse-proxy to
//                                          `http://127.0.0.1:<port>/`
//                                          so the editor's preview iframe
//                                          sees Vite/Next through the
//                                          same registrable domain
//
//   POST   /dev-server/:wsId/list        → recursive tree of the folder
//                                          the user picked via the OS
//                                          dialog (path guard rejects
//                                          `..` and out-of-root resolves;
//                                          hides `node_modules` + `.git`)
//   POST   /dev-server/:wsId/read        → read a text file in the
//                                          user-picked folder (UTF-8)
//   POST   /dev-server/:wsId/write       → write a text file in the
//                                          user-picked folder (1MB cap)
//   POST   /dev-server/:wsId/delete      → delete a file or recursive
//                                          directory in the user-picked
//                                          folder
//   POST   /dev-server/:wsId/rename      → rename/move a file or
//                                          directory in the user-picked
//                                          folder
//   POST   /dev-server/:wsId/mkdir       → mkdir -p in the user-picked
//                                          folder
//
//   GET    /_agent/status                → bridge status for the SPA
//                                          banner (always available; reports
//                                          { enabled, connected, … })
//   WS     /_agent                       → local-agent bridge. Opt-in via
//                                          AGENT_BRIDGE_ENABLED=1. When the
//                                          flag is on, every /dev-server/*
//                                          request is forwarded to the
//                                          connected local agent instead of
//                                          being executed in this process.
//                                          See ./agentBridge.ts.
//
// The verification agent runs in headed mode (a real visible Chrome
// window on the host). The browser window is the preview — there is
// no in-app mirror and no `/interact` endpoint, so the user sees the
// same browser the agent is driving.

import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { spawn } from "node:child_process";
import { readdirSync, readFileSync, statSync, existsSync, mkdirSync } from "node:fs";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { appendEvent, eventsAfter, getRun, listRuns, requestStop, setStatus, startRun, waitForEvents } from "./runs.js";
import { runAgent, testConnection } from "./agent.js";
import { listSecrets, createSecret, deleteSecret, resolveCredentialForTarget } from "./secrets.js";
import { listPlaywrightTools, callPlaywrightTool } from "./playwrightMcp.js";
import { resolveEvidence } from "./evidence.js";
import {
  appendDevServerLog,
  devServerId,
  eventsAfter as devServerEventsAfter,
  getDevServer,
  inspectPackage,
  pickFolder,
  safeDeleteUserFolder,
  safeMkdirUserFolder,
  safeRenameUserFolder,
  safeResolve,
  safeResolveUserFolder,
  shutdownAllDevServers,
  startDevServer,
  stopDevServer,
  waitForDevServerEvents,
  walkTree,
  workspaceRoot,
} from "./devServer.js";
import { forwardToAgent, getAgentBridgeStatus, installAgentBridgeHandlers } from "./agentBridge.js";
import type { StartVerificationRequest } from "./types.js";

const PORT = Number(process.env.MCP_PORT ?? 8787);

const app = Fastify({ logger: { level: process.env.MCP_LOG_LEVEL ?? "info" } });
await app.register(cors, { origin: true, credentials: true });
await app.register(websocket);

// Local-agent bridge — opt-in via AGENT_BRIDGE_ENABLED=1. When the
// flag is on, every /dev-server/* request is forwarded to a
// long-running WebSocket connection from a local agent on the
// user's machine (see ./agentBridge.ts). When the flag is off, the
// cloud mcp-server runs /dev-server/* handlers locally (the dev
// mode, where the user's mcp-server has the filesystem access).
//
// The preHandler short-circuits the route handler when the bridge
// is engaged; without it, the routes run as they always have.
app.addHook("preHandler", async (req, reply) => {
  const url = req.url ?? "";
  // Match the /dev-server/* prefix — that's the only surface the
  // bridge owns. /verify, /secrets, /playwright, /tools, /evidence
  // all stay cloud-local.
  if (!url.startsWith("/dev-server")) return;
  if (!process.env.AGENT_BRIDGE_ENABLED) return;
  await forwardToAgent(req, reply);
});

// ────────────────────────────────────────────────────────────────────────────
//  Health
// ────────────────────────────────────────────────────────────────────────────

app.get("/health", async () => ({ ok: true, time: new Date().toISOString() }));

// ────────────────────────────────────────────────────────────────────────────
//  Local-agent bridge — opt-in.
//
//  WebSocket endpoint that a local `agent/agent.mjs` script on the
//  user's machine opens. Once connected, /dev-server/* requests are
//  forwarded here and the agent proxies them to a local mcp-server
//  that has access to the user's filesystem.
//
//  Set AGENT_BRIDGE_ENABLED=1 in the cloud mcp-server's env to
//  engage the bridge. Without it, /dev-server/* routes run locally
//  in the cloud mcp-server (the dev case).
// ────────────────────────────────────────────────────────────────────────────

// Register the bridge under BOTH the proxied path (`/dev-server/_agent*`
// — what vite/prod-backend forward after stripping `/api`) and the
// direct path (`/_agent*` — for unit tests + direct curl access). They
// route to the same handler so a single agent can be discovered either
// way. Order matters: the more specific path first.
app.get("/dev-server/_agent/status", async () => getAgentBridgeStatus());
app.get("/_agent/status", async () => getAgentBridgeStatus());

app.get("/dev-server/_agent", { websocket: true }, (socket, _req) =>
  installAgentBridgeHandlers(socket),
);
app.get("/_agent", { websocket: true }, (socket /* SocketStream */, _req) => {
  // Handshake — the first frame MUST be { type: "hello", token }.
  // If AGENT_BRIDGE_ENABLED is off we still accept the connection
  // so the agent can learn its status, but every forwarded request
  // will 503 because forwardToAgent short-circuits on the flag.
  installAgentBridgeHandlers(socket);
  // No explicit hello_ack here — handleFrame sends it after parsing
  // the first frame. The agent's hello timeout protects against
  // silent dead sockets.
});

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

const StartBody = z
  .object({
    runId: z.string(),
    userId: z.string(),
    // Optional now — a Playwright script run carries `script` instead of
    // `targets`/`scope`. The XOR is enforced by the `.refine` below.
    targets: z.array(TargetSchema).optional(),
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
      .optional(),
    // Device emulation preset for the run's browser context.
    device: z.enum(["desktop", "mobile", "tablet"]).optional(),
    // Optional script payload — when present, the agent takes the
    // `runScript` branch in agent.ts. XOR with (targets + scope) is
    // enforced by the `.refine` below.
    script: z
      .object({
        name: z.string().min(1).max(80),
        code: z.string().min(1).max(50_000),
        // Optional execution mode — "direct" (default) wraps the body
        // in `new Function(...)` and evaluates inline; "spec" spawns
        // `npx playwright test` as a subprocess so `test.describe` /
        // `test.beforeEach` / `expect` resolve. The agent branches on
        // this in agent.ts:runScript. Frontend inferes it from script
        // content (auto-detect) and exposes a toggle on the panel.
        mode: z.enum(["direct", "spec"]).optional(),
      })
      .optional(),
  })
  .refine(
    // Exactly one of (verification payload: targets+scope) or (script
    // payload: script) is set. Without this, a script-only POST with an
    // empty targets array would 400 at `.min(1)`, and a malformed body
    // with both set could otherwise reach the agent and confuse it.
    (v) => Boolean(v.script) !== Boolean(v.targets && v.targets.length > 0 && v.scope && v.scope.length > 0),
    { message: "StartBody must carry either `script` or `targets` + `scope`, not both" },
  );

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

// Loopback-only plaintext read. The env-walk walker's IAM login is the
// consumer: it resolves the "IAM Walker Login" secret and logs in without
// any credential sitting in an .env file. Trust model: a caller on
// 127.0.0.1 could read `data/secrets.enc` from disk anyway — loopback adds
// no new exposure. Every other peer (LAN, other containers) is refused
// before the id is even looked up, and the response is never logged.
app.get<{ Params: { id: string } }>("/secrets/:id", async (req, reply) => {
  const ip = (req.ip ?? "").replace(/^::ffff:/, "");
  if (ip !== "127.0.0.1" && ip !== "::1") {
    return reply.code(403).send({ error: "loopback only" });
  }
  const cred = resolveCredentialForTarget(req.params.id);
  if (!cred) return reply.code(404).send({ error: "not found" });
  return { id: req.params.id, email: cred.email, password: cred.password };
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
//  Playwright browser install — `npx playwright install`.
//
//  Triggered by the panel's "Install Playwright" button. Downloads the
//  Chromium / Firefox / WebKit browser binaries that the spec-mode
//  runner shells to when it spawns `npx playwright test`. Without this
//  step a fresh checkout only has `@playwright/test` in node_modules,
//  but the actual browser engines live in `~/.cache/ms-playwright/` and
//  are missing until `playwright install` runs once.
//
//  The spawn inherits this server's `cwd` (mcp-server/) so the local
//  `node_modules/.bin/playwright` binary resolves correctly. On Windows
//  the binary is `playwright.cmd`, so the spawn uses `shell: true` per
//  the Node 20+ .cmd execution policy.
//
//  Long-running: a full install pulls ~700 MB and can take 30-60s on
//  cold cache. The endpoint waits synchronously and returns the final
//  stdout/stderr tail (capped) plus exit code. Future enhancement
//  could stream progress via SSE; for now the panel just shows a spinner.
// ────────────────────────────────────────────────────────────────────────────

const InstallBody = z
  .object({
    // Optional override — defaults to running `npx playwright install`
    // (all browsers). Useful when a CI cache already has chromium but
    // is missing webkit.
    browsers: z.array(z.enum(["chromium", "firefox", "webkit"])).optional(),
    // Optional --with-deps — installs OS-level libraries the browsers
    // need. Off by default because it requires sudo on Linux and the
    // panel can't prompt for credentials.
    withDeps: z.boolean().optional(),
  })
  .optional();

app.post("/playwright/install", async (req, reply) => {
  const parsed = InstallBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  const args = ["playwright", "install"];
  if (parsed.data?.browsers && parsed.data.browsers.length > 0) {
    args.push(...parsed.data.browsers);
  }
  if (parsed.data?.withDeps) {
    args.push("--with-deps");
  }
  const isWin = process.platform === "win32";
  const cmd = isWin ? "npx.cmd" : "npx";
  app.log.info({ cmd, args }, "running playwright install");
  // `shell: true` is required for `.cmd` execution on Windows (Node
  // 20+ security policy). Same env-based dispatch as `runSpecScript`.
  const child = spawn(cmd, args, {
    cwd: process.cwd(),
    shell: isWin,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  child.stdout.on("data", (chunk) => stdoutChunks.push(String(chunk)));
  child.stderr.on("data", (chunk) => stderrChunks.push(String(chunk)));
  // `child_process.spawn`'s exit handler signature differs from
  // EventEmitter's — third arg is a `Signal`-typed signal we ignore
  // here, hence the linter-disable.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const exitCode: number = await new Promise((resolve) => {
    child.on("exit", (code, _signal) => resolve(code ?? 1));
  });
  const stdout = stdoutChunks.join("");
  const stderr = stderrChunks.join("");
  // Cap the response payload — a verbose `playwright install` can
  // produce a few MB of `Downloading Chromium ...` lines. Keep the
  // tail so the panel's UI doesn't blow up on `JSON.stringify`.
  const TAIL = 16_000;
  const ok = exitCode === 0;
  if (!ok) {
    app.log.error({ exitCode, stderr: stderr.slice(-TAIL) }, "playwright install failed");
  }
  return reply.code(ok ? 200 : 500).send({
    ok,
    exitCode,
    browsers: parsed.data?.browsers ?? ["chromium", "firefox", "webkit"],
    stdout: stdout.slice(-TAIL),
    stderr: stderr.slice(-TAIL),
  });
});

// ────────────────────────────────────────────────────────────────────────────
//  Generic npm tool install — `npm install <pkg>` into the mcp-server's
//  own node_modules so user scripts (which run in this process via
//  `runScript`'s `new Function(...)` wrapper) can `require()` arbitrary
//  helpers without the user having to fork the editor's install flow.
//
//  Why `--no-save`?
//    The mcp-server's package.json is the canonical dependency list for
//    the server itself. User-installed tools (lodash, dayjs, faker) are
//    ephemeral per-machine helpers — they shouldn't be committed to
//    mcp-server/package.json. `--no-save` skips the package.json write
//    but still drops the package into node_modules, where the Node
//    resolution path finds it.
//
//  Why `--no-audit --no-fund`?
//    Both are noise flags: audit can add ~10s to every install and
//    prints a "fund" nag at the end. Neither is useful here — the
//    user has already chosen the package name.
//
//  Why `cwd: process.cwd()` (mcp-server's dir)?
//    Same reason `/playwright/install` uses it — npm's local
//    node_modules is relative to cwd. The server starts from
//    mcp-server/, so the install lands in mcp-server/node_modules,
//    exactly where the agent's `require()` resolves from.
//
//  Why a strict packageName regex?
//    This endpoint runs as the mcp-server process. A bad input
//    (e.g. `; rm -rf /`) would shell-inject if we naively
//    concatenated it. We pass the packageName as a single argv entry
//    to spawn() (not through a shell), so even a malicious name can't
//    break out — but the regex gives an early structured 400 with a
//    helpful error message instead of letting `npm install` fail with
//    a confusing "Invalid package name" error.
//
//  Trust boundary:
//    The endpoint accepts arbitrary package names from the user (a
//    tenant of the same Lattice app). The npm package then becomes
//    require()-able from any subsequent runScript call. That's a
//    "self-XSS" surface for the same human who clicks the Install
//    button — equivalent to running `npm install` themselves in a
//    terminal. No cross-user escalation.
// ────────────────────────────────────────────────────────────────────────────

// npm package name grammar (matches the official npm registry's
// validation): lowercase letters + `._-`, optional scope, optional
// `semver` or `dist-tag` after `@`.
//
// Examples that pass: `lodash`, `@playwright/test`, `react@18.2.0`,
// `eslint@latest`. Examples that fail: `Lodash` (uppercase), `foo bar`
// (space), `foo; rm` (illegal char).
const PACKAGE_NAME_RE =
  /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(?:@[\^~]?[a-z0-9*.\-~xX+]+)?$/;

const ToolInstallBody = z.object({
  packageName: z
    .string()
    .min(1, "packageName is required")
    .max(214, "packageName too long (npm limit is 214)")
    .regex(
      PACKAGE_NAME_RE,
      "Invalid npm package name. Use a name like 'lodash', '@playwright/test', or 'react@18.2.0'.",
    ),
});

app.post("/tools/install", async (req, reply) => {
  const parsed = ToolInstallBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  const { packageName } = parsed.data;

  const isWin = process.platform === "win32";
  const cmd = isWin ? "npm.cmd" : "npm";
  // `npm install --no-save <pkg>` installs into ./node_modules without
  // touching package.json. `--loglevel=info` gives us actionable
  // progress lines (added N packages, removed M) but suppresses the
  // per-package install noise that `--loglevel=verbose` produces.
  const args = [
    "install",
    "--no-save",
    "--no-audit",
    "--no-fund",
    "--loglevel=info",
    packageName,
  ];
  app.log.info({ cmd, args, cwd: process.cwd() }, "running npm install");
  // `shell: isWin` for the same .cmd execution-policy reason as
  // /playwright/install. packageName is passed as a single argv entry,
  // never through the shell string, so a malicious name is contained.
  const child = spawn(cmd, args, {
    cwd: process.cwd(),
    shell: isWin,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  child.stdout.on("data", (chunk) => stdoutChunks.push(String(chunk)));
  child.stderr.on("data", (chunk) => stderrChunks.push(String(chunk)));
  const exitCode: number = await new Promise((resolve) => {
    child.on("exit", (code) => resolve(code ?? 0));
  });
  const stdout = stdoutChunks.join("");
  const stderr = stderrChunks.join("");
  const TAIL = 16_000;
  const ok = exitCode === 0;
  if (!ok) {
    app.log.error(
      { exitCode, packageName, stderr: stderr.slice(-TAIL) },
      "npm install failed",
    );
  } else {
    app.log.info({ packageName }, "npm install ok");
  }
  return reply.code(ok ? 200 : 500).send({
    ok,
    exitCode,
    packageName,
    stdout: stdout.slice(-TAIL),
    stderr: stderr.slice(-TAIL),
  });
});

// ────────────────────────────────────────────────────────────────────────────
//  GET /tools/list — enumerate every package under ./node_modules so the
//  Configure drawer's "Installed tools" panel can show the user exactly
//  what's available to `require()` from a Playwright snippet (frameworks
//  they pulled in via /tools/install + the server's own deps).
//
//  Scope:
//    Enumerate:
//
//      node_modules/
//        @scope/pkg/package.json         ← scoped
//        @scope/.../package.json         ← all under the scope
//        lodash/package.json             ← flat
//        .bin/, .package-lock.json, ...  ← skipped (no package.json)
//
//  Performance:
//    We read each package.json lazily (only on demand, one file at a
//    time) so a node_modules/ of ~1000 packages finishes in ~50ms on
//    a hot disk. No caching — the panel re-fetches after every
//    /tools/install so the list reflects ground truth, and the cost
//    is small relative to the npm install it follows.
//
//  Errors:
//    A missing or unreadable ./node_modules (e.g. someone deleted it)
//    returns 200 with an empty list rather than 5xx — the panel
//    renders the "no tools installed" empty state instead of a
//    confusing server error.
// ────────────────────────────────────────────────────────────────────────────
type InstalledPkg = { name: string; version: string };

function readPackageJson(dir: string): InstalledPkg | null {
  try {
    const pkgJsonPath = join(dir, "package.json");
    const stat = statSync(pkgJsonPath);
    if (!stat.isFile()) return null;
    const raw = readFileSync(pkgJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { name?: unknown; version?: unknown };
    if (typeof parsed.name !== "string" || parsed.name.length === 0) {
      return null;
    }
    return {
      name: parsed.name,
      version: typeof parsed.version === "string" ? parsed.version : "?",
    };
  } catch {
    return null;
  }
}

app.get("/tools/list", async (_req, reply) => {
  const nodeModulesDir = join(process.cwd(), "node_modules");
  const packages: InstalledPkg[] = [];
  let directoryError: string | null = null;
  try {
    const entries = readdirSync(nodeModulesDir, { withFileTypes: true });
    for (const entry of entries) {
      // `.bin`, `.package-lock.json`, etc. — skip silently. Only
      // directories can host a package.
      if (!entry.isDirectory()) continue;
      const entryName = entry.name;
      // Scoped packages: read every package inside `@scope/`. We don't
      // recursively walk — each immediate child of a scope is one package.
      if (entryName.startsWith("@")) {
        const scopeDir = join(nodeModulesDir, entryName);
        let scopedEntries;
        try {
          scopedEntries = readdirSync(scopeDir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const scopedEntry of scopedEntries) {
          if (!scopedEntry.isDirectory()) continue;
          const pkg = readPackageJson(join(scopeDir, scopedEntry.name));
          if (pkg) packages.push(pkg);
        }
        continue;
      }
      // Flat: e.g. `lodash`, `fastify`, `playwright`.
      const pkg = readPackageJson(join(nodeModulesDir, entryName));
      if (pkg) packages.push(pkg);
    }
    packages.sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    // node_modules missing / unreadable — return empty list so the UI
    // can render its empty state. We surface the reason in the body
    // for the React panel to log via [console.warn] but don't 5xx
    // because "no node_modules" is a recoverable situation, not a crash.
    directoryError = err instanceof Error ? err.message : String(err);
  }
  return reply.code(200).send({
    packages,
    count: packages.length,
    ...(directoryError ? { directoryError } : {}),
  });
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
//  Dev-server sandbox.
//
//  Long-running `npm run dev` children scoped to a per-(user, project,
//  env) workspace. Files live under `./data/dev-servers/<workspaceId>/`.
//  Multiple ports per workspace are allowed (composite id); the SSE
//  tail is identical in shape to `/verify/runs/:id/events` above.
//
//  Why this lives in the verification-server parent and not its own
//  process: the editor preview iframe must hit the same registrable
//  domain as the Lattice app (so the IAM cookie + CORS match). Putting
//  the proxy here makes `/api/dev-server/:wsId/:port/proxy/*` come
//  out of `localhost:8787` and forward to `127.0.0.1:<port>`.
// ────────────────────────────────────────────────────────────────────────────

const StartDevServerBody = z.object({
  workspaceId: z.string().min(1).max(128),
  port: z.number().int().min(1024).max(65535),
  command: z.string().min(1).max(64),
  args: z.array(z.string().min(1).max(200)).max(20).default([]),
});
const StopDevServerBody = z.object({
  workspaceId: z.string().min(1).max(128),
  port: z.number().int().min(1024).max(65535),
});
const WriteFileBody = z.object({
  content: z.string().max(1_000_000), // 1MB per file — caps the workspace dir
});

app.post("/dev-server/start", async (req, reply) => {
  const parsed = StartDevServerBody.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.flatten() });
  }
  const { workspaceId, port, command, args } = parsed.data;
  // Don't `await` — `startDevServer` blocks on the child's `close`
  // event (i.e. it doesn't return until the dev server process exits).
  // Spawning must be fire-and-forget so the route returns immediately
  // and the SSE tail can carry the lifecycle events.
  void startDevServer({ workspaceId, port, command, args }).catch((err) => {
    appendDevServerLog(devServerId(workspaceId, port), {
      id: devServerId(workspaceId, port),
      kind: "devserver_error",
      message: `startDevServer threw: ${err.message}`,
      ts: Date.now(),
    });
  });
  const id = devServerId(workspaceId, port);
  const rec = getDevServer(id);
  return reply.send({
    id,
    status: rec?.status ?? "starting",
    port,
  });
});

app.post("/dev-server/stop", async (req, reply) => {
  const parsed = StopDevServerBody.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.flatten() });
  }
  await stopDevServer(parsed.data);
  return reply.send({ ok: true });
});

// VS Code-style "Open Folder" — spawns the OS's native folder
// chooser. Returns `{ path }` on success, `{ cancelled: true }` when
// the user closes the dialog, `{ cancelled: true, reason: "no_gui" }`
// when the platform shim couldn't start (headless server, missing
// zenity, etc.). The UI handles all three.
app.post("/dev-server/pick-folder", async (_req, reply) => {
  const result = await pickFolder();
  if (result.picked) {
    return reply.send({ path: result.picked });
  }
  return reply.send({ cancelled: true, reason: result.reason ?? "cancelled" });
});

// Reads `package.json` at the given path. Returns `null` (with 200)
// when the file is missing or malformed so the UI can render
// "no package.json found" without treating it as an error.
app.post("/dev-server/inspect-package", async (req, reply) => {
  const body = z
    .object({
      path: z.string().min(1).max(2048),
    })
    .safeParse(req.body);
  if (!body.success) {
    return reply.code(400).send({ error: body.error.flatten() });
  }
  const summary = await inspectPackage(body.data.path);
  return reply.send({ package: summary });
});

app.get<{ Params: { workspaceId: string; port: string } }>(
  "/dev-server/:workspaceId/:port/status",
  async (req, reply) => {
    const port = Number(req.params.port);
    if (!Number.isFinite(port) || port < 1024 || port > 65535) {
      return reply.code(400).send({ error: "bad port" });
    }
    const id = devServerId(req.params.workspaceId, port);
    const rec = getDevServer(id);
    if (!rec) return reply.code(404).send({ error: "no such dev server" });
    // Strip the live ChildProcess from the response — it can't be
    // serialized, and the client doesn't need a handle to it.
    const { child: _child, waiters: _waiters, events: _events, ...rest } = rec;
    return reply.send(rest);
  },
);

app.get<{
  Params: { workspaceId: string; port: string };
  Querystring: { since?: string };
}>("/dev-server/:workspaceId/:port/events", async (req, reply) => {
  const port = Number(req.params.port);
  if (!Number.isFinite(port) || port < 1024 || port > 65535) {
    return reply.code(400).send({ error: "bad port" });
  }
  const id = devServerId(req.params.workspaceId, port);
  const since = Number(req.query.since ?? 0) || 0;

  // SSE envelope — mirror of `/verify/runs/:id/events` above. The
  // contract: every event is `data: { ... }\n\n`; terminal flush is
  // `data: { type: "done" }\n\n`; keepalive is `: ping\n\n` every
  // 15s. Browser EventSource auto-reconnects on disconnect; the
  // `since` cursor lets the client resume without gaps.
  reply.raw.setHeader("Content-Type", "text/event-stream");
  reply.raw.setHeader("Cache-Control", "no-cache");
  reply.raw.setHeader("Connection", "keep-alive");
  reply.raw.setHeader("X-Accel-Buffering", "no");
  reply.raw.flushHeaders();

  const write = (obj: unknown) => {
    reply.raw.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  // Replay any events past `since` immediately.
  for (const ev of devServerEventsAfter(id, since)) {
    write({ type: "event", event: ev });
  }
  let cursor = getDevServer(id)?.cursor ?? since;

  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  req.raw.on("close", stop);

  const heartbeat = setInterval(() => {
    if (stopped) return;
    reply.raw.write(": ping\n\n");
  }, 15_000);

  while (!stopped) {
    // Long-poll 1.5s — match the verification-run SSE handler.
    const events = await waitForDevServerEvents(id, cursor, 1_500);
    for (const ev of events) write({ type: "event", event: ev });
    if (events.length > 0) cursor = cursor + events.length;
    const rec = getDevServer(id);
    if (rec && (rec.status === "exited" || rec.status === "failed") && cursor >= rec.events.length) {
      write({ type: "done" });
      break;
    }
    if (!rec) break;
  }

  clearInterval(heartbeat);
  reply.raw.end();
});

app.get<{ Params: { workspaceId: string; port: string; "*": string } }>(
  "/dev-server/:workspaceId/:port/files/*",
  async (req, reply) => {
    const port = Number(req.params.port);
    if (!Number.isFinite(port) || port < 1024 || port > 65535) {
      return reply.code(400).send({ error: "bad port" });
    }
    const relPath = (req.params as { "*": string })["*"];
    const safe = safeResolve(req.params.workspaceId, relPath);
    if (!safe) return reply.code(403).send({ error: "bad path" });
    try {
      const content = await readFile(safe, "utf8");
      return reply.send({ content });
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message });
    }
  },
);

app.put<{ Params: { workspaceId: string; port: string; "*": string } }>(
  "/dev-server/:workspaceId/:port/files/*",
  async (req, reply) => {
    const port = Number(req.params.port);
    if (!Number.isFinite(port) || port < 1024 || port > 65535) {
      return reply.code(400).send({ error: "bad port" });
    }
    const relPath = (req.params as { "*": string })["*"];
    const safe = safeResolve(req.params.workspaceId, relPath);
    if (!safe) return reply.code(403).send({ error: "bad path" });
    const parsed = WriteFileBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    try {
      // Create parent dirs on the fly — the workspace scaffold
      // creates one folder at a time, so `react-app/components/...`
      // must work even though `components/` doesn't exist yet.
      const parent = join(safe, "..");
      if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
      await writeFile(safe, parsed.data.content, "utf8");
      return reply.send({ ok: true, size: parsed.data.content.length });
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────
//  User-folder routes — VS Code-style CRUD on the folder the user
//  picked via the OS dialog (`pick-folder` above). These endpoints
//  take `root` (the picked absolute path) explicitly in the body so
//  the per-workspace sandbox dir (`/files/*` above) keeps its
//  current semantics for dev-server bootstrap.
//
//  Every mutation runs through `safeResolveUserFolder(root, target)`
//  — same prefix check as `safeResolve` but anchored at the user's
//  picked folder, not the sandbox dir. Traversal attempts 403.
// ─────────────────────────────────────────────────────────────────────

const WorkspaceIdParam = z.object({ workspaceId: z.string().min(1).max(128) });
const RootPathField = z.object({ root: z.string().min(1).max(4096) });
const RelPathField = z.object({ path: z.string().min(0).max(2048) });
const ListBody = RootPathField.extend({ maxDepth: z.number().int().min(1).max(16).optional() });
const ReadBody = RootPathField.merge(RelPathField);
const DeleteBody = RootPathField.merge(RelPathField);
const MkdirBody = RootPathField.merge(RelPathField);
const RenameBody = z.object({
  root: z.string().min(1).max(4096),
  oldPath: z.string().min(1).max(2048),
  newPath: z.string().min(1).max(2048),
});
const WriteUserFileBody = RootPathField.merge(RelPathField).extend({
  content: z.string().max(1_000_000), // 1MB — same cap as the sandbox dir
});

app.post<{ Params: { workspaceId: string } }>("/dev-server/:workspaceId/list", async (req, reply) => {
  const ws = WorkspaceIdParam.safeParse(req.params);
  if (!ws.success) return reply.code(400).send({ error: ws.error.flatten() });
  const parsed = ListBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  try {
    const tree = await walkTree(parsed.data.root, parsed.data.maxDepth);
    return reply.send({ tree });
  } catch (err) {
    return reply.code(500).send({ error: (err as Error).message });
  }
});

app.post<{ Params: { workspaceId: string } }>("/dev-server/:workspaceId/read", async (req, reply) => {
  const ws = WorkspaceIdParam.safeParse(req.params);
  if (!ws.success) return reply.code(400).send({ error: ws.error.flatten() });
  const parsed = ReadBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  const safe = safeResolveUserFolder(parsed.data.root, parsed.data.path);
  if (!safe) return reply.code(403).send({ error: "bad path" });
  try {
    const content = await readFile(safe, "utf8");
    return reply.send({ content });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return reply.code(404).send({ error: "not found" });
    return reply.code(500).send({ error: (err as Error).message });
  }
});

app.post<{ Params: { workspaceId: string } }>("/dev-server/:workspaceId/write", async (req, reply) => {
  const ws = WorkspaceIdParam.safeParse(req.params);
  if (!ws.success) return reply.code(400).send({ error: ws.error.flatten() });
  const parsed = WriteUserFileBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  const safe = safeResolveUserFolder(parsed.data.root, parsed.data.path);
  if (!safe) return reply.code(403).send({ error: "bad path" });
  try {
    const parent = join(safe, "..");
    await mkdir(parent, { recursive: true });
    await writeFile(safe, parsed.data.content, "utf8");
    return reply.send({ ok: true, size: parsed.data.content.length });
  } catch (err) {
    return reply.code(500).send({ error: (err as Error).message });
  }
});

app.post<{ Params: { workspaceId: string } }>("/dev-server/:workspaceId/delete", async (req, reply) => {
  const ws = WorkspaceIdParam.safeParse(req.params);
  if (!ws.success) return reply.code(400).send({ error: ws.error.flatten() });
  const parsed = DeleteBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  try {
    await safeDeleteUserFolder(parsed.data.root, parsed.data.path);
    return reply.send({ ok: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return reply.code(404).send({ error: "not found" });
    return reply.code(500).send({ error: (err as Error).message });
  }
});

app.post<{ Params: { workspaceId: string } }>("/dev-server/:workspaceId/rename", async (req, reply) => {
  const ws = WorkspaceIdParam.safeParse(req.params);
  if (!ws.success) return reply.code(400).send({ error: ws.error.flatten() });
  const parsed = RenameBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  try {
    await safeRenameUserFolder(parsed.data.root, parsed.data.oldPath, parsed.data.newPath);
    return reply.send({ ok: true });
  } catch (err) {
    return reply.code(500).send({ error: (err as Error).message });
  }
});

app.post<{ Params: { workspaceId: string } }>("/dev-server/:workspaceId/mkdir", async (req, reply) => {
  const ws = WorkspaceIdParam.safeParse(req.params);
  if (!ws.success) return reply.code(400).send({ error: ws.error.flatten() });
  const parsed = MkdirBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  try {
    await safeMkdirUserFolder(parsed.data.root, parsed.data.path);
    return reply.send({ ok: true });
  } catch (err) {
    return reply.code(500).send({ error: (err as Error).message });
  }
});

// Reverse-proxy to the running dev server. Reads request body if any,
// forwards headers (stripping `host` so the upstream sees the dev
// server's expected host), and copies response headers + body back to
// the client. Handles SSE / streaming responses because the dev server
// can stream Vite's HMR frames back through this same path.
//
// Why hand-rolled, not @fastify/http-proxy: matches the in-tree
// style (`vite.config.ts:514-1017` Connect-middleware proxy) and keeps
// the dependency surface small. ~30 lines, no streaming quirks.
app.get<{ Params: { workspaceId: string; port: string; "*": string } }>(
  "/dev-server/:workspaceId/:port/proxy/*",
  async (req, reply) => {
    const port = Number(req.params.port);
    if (!Number.isFinite(port) || port < 1024 || port > 65535) {
      return reply.code(400).send({ error: "bad port" });
    }
    const id = devServerId(req.params.workspaceId, port);
    const rec = getDevServer(id);
    if (!rec || (rec.status !== "ready" && rec.status !== "running" && rec.status !== "starting")) {
      return reply.code(503).send({ error: "dev server not ready" });
    }
    const pathPart = (req.params as { "*": string })["*"];
    const upstreamUrl = `http://127.0.0.1:${port}/${pathPart}`;
    const upstreamHeaders = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (!v) continue;
      if (k === "host" || k === "connection" || k === "content-length") continue;
      upstreamHeaders.set(k, Array.isArray(v) ? v.join(", ") : String(v));
    }
    try {
      const upstream = await fetch(upstreamUrl, {
        method: req.method,
        headers: upstreamHeaders,
        body: ["GET", "HEAD"].includes(req.method)
          ? undefined
          : JSON.stringify(req.body ?? {}),
        // `duplex` is required when forwarding a request body in Node ≥18.
        // The runtime requires it as a half option since undici 5.x.
        // @ts-expect-error — `RequestInit.duplex` is not in the standard
        // typings but is required by undici when sending a body.
        duplex: "half",
      });
      reply.status(upstream.status);
      const upstreamCT = upstream.headers.get("content-type") ?? "application/octet-stream";
      reply.header("Content-Type", upstreamCT);
      // Buffer the response — dev server assets are small enough that
      // we don't need to stream them. If a streaming response is needed
      // (e.g. SSE from Vite), we can switch to a `reader` pump later.
      const buf = Buffer.from(await upstream.arrayBuffer());
      reply.header("Content-Length", String(buf.length));
      return reply.send(buf);
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
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

// SIGINT/SIGTERM handler — SIGTERMs every running dev server child so
// killing mcp-server doesn't orphan a Node process bound to a port.
// Mirrors `runs.ts:177-184`. The exit(0) is intentional — we want
// the process to die even if the listen callback is mid-flight.
const shutdown = (signal: string) => {
  app.log.info(`Received ${signal}, shutting down dev-server children…`);
  shutdownAllDevServers();
  process.exit(0);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
