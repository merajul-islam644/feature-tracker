#!/usr/bin/env node
// Lattice local agent — bridges a remote mcp-server (in the cloud
// prod container) to a local mcp-server (on the user's machine) so
// the /panel workspace can read the user's filesystem and run their
// `npm run dev` children.
//
// Usage:
//   node agent/agent.mjs --token <AGENT_BRIDGE_TOKEN>
//   node agent/agent.mjs --token <TOKEN> --remote wss://dbeegi.slsblx.com
//   node agent/agent.mjs --help
//
// What it does:
//   1. Spawns a local mcp-server on $AGENT_LOCAL_PORT (default 8787)
//      using the same Windows-spawn pattern as prod-backend.mjs (no
//      .cmd shim, no shell: true).
//   2. Polls /health on the local mcp-server until it's up.
//   3. Opens a WebSocket to $REMOTE_URL/api/dev-server/_agent and
//      sends { type: "hello", token, version }.
//   4. Bridges HTTP requests:
//        cloud → agent: { type: "http_request", requestId, method,
//                         path, headers, body }
//        agent → cloud: { type: "http_response_start", requestId,
//                         status, headers }
//                { type: "http_response_chunk", requestId, chunk }
//                { type: "http_response_end",   requestId }
//   5. Auto-reconnects with exponential backoff if the WS drops.
//   6. Forwards SIGINT/SIGTERM to the local mcp-server child.
//
// Why no `npm install` in agent/
//   The user's Node (v22+) has a built-in `WebSocket` global, so the
//   agent needs no runtime deps. The local mcp-server is reused as a
//   library (spawned as a child of this process) — its source lives
//   at $REPO_ROOT/mcp-server/.

import { spawn } from "node:child_process";
import { request as httpRequest } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────
//  CLI parsing
// ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    token: process.env.AGENT_BRIDGE_TOKEN ?? "",
    remote: process.env.AGENT_REMOTE_URL ?? "wss://dbeegi.slsblx.com",
    localPort: Number(process.env.AGENT_LOCAL_PORT ?? 8787),
    mcpCwd: process.env.AGENT_MCP_CWD ?? pathResolve(__dirname, "..", "mcp-server"),
    mcpEntry: process.env.AGENT_MCP_ENTRY ?? pathResolve(
      __dirname,
      "..",
      "mcp-server",
      "src",
      "index.ts",
    ),
    tsxLoader: process.env.AGENT_TSX_LOADER ?? null, // auto-detect
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--token") args.token = argv[++i] ?? "";
    else if (a === "--remote") args.remote = argv[++i] ?? "";
    else if (a === "--port") args.localPort = Number(argv[++i] ?? 8787);
    else if (a === "--mcp-cwd") args.mcpCwd = argv[++i] ?? args.mcpCwd;
    else if (a === "--mcp-entry") args.mcpEntry = argv[++i] ?? args.mcpEntry;
    else if (a === "--help" || a === "-h") {
      console.log(`Lattice local agent

Usage: node agent/agent.mjs [options]

Options:
  --token <token>      AGENT_BRIDGE_TOKEN shared with the cloud mcp-server.
                        Falls back to env AGENT_BRIDGE_TOKEN.
  --remote <wss-url>   Cloud WebSocket origin (default: wss://dbeegi.slsblx.com).
                        Use ws://localhost:8080 for local prod-backend dev.
                        Falls back to env AGENT_REMOTE_URL.
  --port <port>        Local mcp-server port to spawn (default 8787).
  --mcp-cwd <dir>      Override mcp-server cwd (default: ../mcp-server).
  --mcp-entry <path>   Override mcp-server entry (default: ../mcp-server/src/index.ts).
  --help, -h           Show this help.

The agent spawns a local mcp-server on --port and bridges its HTTP
traffic to the cloud over a single WebSocket. No npm install needed
in agent/ — uses Node's built-in WebSocket (Node 22+).
`);
      process.exit(0);
    }
  }
  return args;
}

const ARGS = parseArgs(process.argv.slice(2));

if (!ARGS.token) {
  console.error(
    "[lattice-agent] FATAL: --token is required. Pass the same AGENT_BRIDGE_TOKEN the cloud mcp-server has set.\n" +
      "Tip: the cloud /panel banner shows the token in the setup instructions. Or set it via env: AGENT_BRIDGE_TOKEN=...",
  );
  process.exit(2);
}

// ─────────────────────────────────────────────────────────────────────
//  Find tsx loader — auto-detect from mcp-server/node_modules
// ─────────────────────────────────────────────────────────────────────

function findTsxLoader(mcpCwd) {
  if (ARGS.tsxLoader) return ARGS.tsxLoader;
  const candidates = [
    join(mcpCwd, "node_modules", "tsx", "dist", "cli.mjs"),
    join(__dirname, "..", "mcp-server", "node_modules", "tsx", "dist", "cli.mjs"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

const TSX_LOADER = findTsxLoader(ARGS.mcpCwd);

// ─────────────────────────────────────────────────────────────────────
//  Local mcp-server lifecycle
// ─────────────────────────────────────────────────────────────────────

let mcpProc = null;
let mcpReady = false;

function startLocalMcp() {
  if (!TSX_LOADER) {
    console.error(
      "[lattice-agent] FATAL: cannot find tsx loader. Run `npm install` in mcp-server/ first, " +
        "or pass --tsx-loader <path> pointing at tsx/dist/cli.mjs.",
    );
    process.exit(2);
  }
  console.log(
    `[lattice-agent] spawning local mcp-server (cwd=${ARGS.mcpCwd} port=${ARGS.localPort})`,
  );
  // Use process.execPath directly with the .mjs entry to avoid the
  // Windows .cmd shim trap (see windows-cmd-shim-spawn-sigterm-orphan).
  mcpProc = spawn(
    process.execPath,
    [TSX_LOADER, ARGS.mcpEntry],
    {
      cwd: ARGS.mcpCwd,
      stdio: ["ignore", "inherit", "inherit"],
      env: {
        ...process.env,
        MCP_PORT: String(ARGS.localPort),
        // Important: the LOCAL mcp-server must NOT have the bridge
        // flag set — it runs the routes directly, including the
        // /dev-server/* ones. The CLOUD mcp-server is the one with
        // the bridge flag on.
        AGENT_BRIDGE_ENABLED: "",
      },
    },
  );
  mcpProc.on("exit", (code, signal) => {
    console.log(
      `[lattice-agent] local mcp-server exited code=${code} signal=${signal}`,
    );
    mcpReady = false;
    // If the child dies, kill the agent too so the user notices
    // and can re-run. Auto-restarting silently would mask real
    // failures.
    process.exit(code ?? 1);
  });
}

async function waitForLocalMcp(timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (mcpProc && mcpProc.exitCode !== null) {
      throw new Error(`local mcp-server died before becoming ready (exitCode=${mcpProc.exitCode})`);
    }
    try {
      await probeHealth();
      mcpReady = true;
      return;
    } catch {
      /* not ready yet */
    }
    await delay(250);
  }
  throw new Error(`local mcp-server did not become ready within ${timeoutMs}ms`);
}

function probeHealth() {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: ARGS.localPort,
        path: "/health",
        method: "GET",
        timeout: 1000,
      },
      (res) => {
        // Drain + resolve on 2xx; reject otherwise.
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(new Error(`status ${res.statusCode}`));
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────
//  WebSocket bridge
// ─────────────────────────────────────────────────────────────────────

let ws = null;
let backoffMs = 1000;
const MAX_BACKOFF_MS = 30_000;
let intentionalClose = false;

function wsUrl() {
  // `/api/dev-server/_agent` on the cloud prod-backend. The prod
  // proxy strips the `/api/dev-server` prefix when forwarding the
  // HTTP upgrade, and mcp-server's WS route is mounted at `/_agent`.
  //
  // `--remote` is normally a bare origin like `wss://dbeegi.slsblx.com`
  // and we append the bridge path. If the user already gave a full
  // URL (ends with `/_agent`), use it verbatim — useful for testing
  // the mcp-server directly without going through prod-backend.
  const base = ARGS.remote.replace(/\/+$/, "");
  if (base.endsWith("_agent")) return base;
  return `${base}/api/dev-server/_agent`;
}

async function connectLoop() {
  await startLocalMcp();
  await waitForLocalMcp();

  while (!intentionalClose) {
    try {
      await runOnce();
    } catch (err) {
      const msg = err?.message ?? String(err);
      console.warn(`[lattice-agent] WS error: ${msg} — reconnecting in ${backoffMs}ms`);
      await delay(backoffMs);
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    }
  }
}

function runOnce() {
  return new Promise((resolve, reject) => {
    const url = wsUrl();
    console.log(`[lattice-agent] connecting to ${url}`);
    // Node 22+ has globalThis.WebSocket. Use it; no npm deps needed.
    const sock = new globalThis.WebSocket(url);
    ws = sock;

    const onOpen = () => {
      backoffMs = 1000; // reset on success
      sock.send(
        JSON.stringify({
          type: "hello",
          token: ARGS.token,
          version: "0.1.0",
        }),
      );
    };
    const onMessage = async (ev) => {
      let frame;
      try {
        frame = JSON.parse(ev.data);
      } catch {
        console.warn("[lattice-agent] received non-JSON frame, closing");
        sock.close();
        return;
      }
      try {
        await handleFrame(frame);
      } catch (err) {
        console.error(`[lattice-agent] handler error: ${err?.message ?? err}`);
      }
    };
    const onClose = (ev) => {
      sock.removeEventListener("open", onOpen);
      sock.removeEventListener("message", onMessage);
      sock.removeEventListener("close", onClose);
      sock.removeEventListener("error", onError);
      ws = null;
      if (intentionalClose) {
        resolve();
      } else {
        // Will be picked up by the connectLoop's catch; the close
        // Event itself is not a "throw" in the await sense.
        reject(new Error(`WS closed code=${ev.code} reason=${ev.reason}`));
      }
    };
    const onError = (ev) => {
      // The 'close' fires right after — let it handle the reject.
      // Just log here.
      try {
        console.warn(`[lattice-agent] WS error: ${ev?.message ?? "(unknown)"}`);
      } catch {
        /* */
      }
    };

    sock.addEventListener("open", onOpen);
    sock.addEventListener("message", onMessage);
    sock.addEventListener("close", onClose);
    sock.addEventListener("error", onError);
  });
}

async function handleFrame(frame) {
  if (frame?.type === "hello_ack") {
    if (frame.ok) {
      console.log(
        `[lattice-agent] hello accepted (version=${frame.version ?? "?"}) — ready to bridge /dev-server/*`,
      );
    } else {
      console.error(
        `[lattice-agent] hello rejected: ${frame.reason ?? "unknown"} — closing`,
      );
      intentionalClose = true;
      ws?.close();
      process.exit(3);
    }
    return;
  }
  if (frame?.type === "http_request") {
    await forwardHttp(frame);
    return;
  }
  // ping / pong / anything else — ignore. @fastify/websocket handles
  // protocol-level keepalive; application-level pings are unused.
}

// ─────────────────────────────────────────────────────────────────────
//  HTTP forwarder — sends an http_request to the local mcp-server and
//  pipes the response back as http_response_start/chunk/end frames.
// ─────────────────────────────────────────────────────────────────────

async function forwardHttp(frame) {
  const { requestId, method, path, headers, body } = frame;
  // Decode the body envelope — see agentBridge.encodeBody. Object
  // means JSON, { __b64: "..." } means raw buffer, string means
  // pre-serialized body, null means no body.
  let bodyOut = null;
  if (body == null) {
    bodyOut = null;
  } else if (typeof body === "string") {
    bodyOut = body;
  } else if (typeof body === "object" && typeof body.__b64 === "string") {
    bodyOut = Buffer.from(body.__b64, "base64");
  } else {
    // JSON object — stringify so the local mcp-server's body
    // parser sees the same content-type signal.
    bodyOut = JSON.stringify(body);
  }

  const url = `http://127.0.0.1:${ARGS.localPort}${path}`;

  let resp;
  try {
    resp = await fetch(url, {
      method,
      headers: stripHopByHop(headers ?? {}),
      body: method === "GET" || method === "HEAD" ? undefined : bodyOut,
    });
  } catch (err) {
    safeSend({
      type: "http_response_error",
      requestId,
      message: `local_fetch_failed: ${err?.message ?? String(err)}`,
    });
    return;
  }

  // Headers → frame (skip hop-by-hop).
  const outHeaders = {};
  resp.headers.forEach((v, k) => {
    if (k === "connection" || k === "transfer-encoding" || k === "content-length") return;
    outHeaders[k] = v;
  });

  safeSend({
    type: "http_response_start",
    requestId,
    status: resp.status,
    headers: outHeaders,
  });

  // Stream the body as base64 chunks. The cloud mcp-server pipes
  // each chunk into the Fastify raw response, so the browser sees
  // them as a normal HTTP response.
  try {
    if (resp.body) {
      const reader = resp.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // Buffer → base64 string. We don't split value into smaller
        // chunks because the local mcp-server's SSE pump pushes
        // already-line-bounded packets.
        safeSend({
          type: "http_response_chunk",
          requestId,
          chunk: Buffer.from(value).toString("base64"),
        });
      }
    }
    safeSend({ type: "http_response_end", requestId });
  } catch (err) {
    safeSend({
      type: "http_response_error",
      requestId,
      message: `stream_failed: ${err?.message ?? String(err)}`,
    });
  }
}

function stripHopByHop(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (lower === "host" || lower === "connection" || lower === "content-length") continue;
    out[k] = v;
  }
  return out;
}

function safeSend(obj) {
  try {
    if (ws && ws.readyState === 1 /* OPEN */) {
      ws.send(JSON.stringify(obj));
    }
  } catch {
    /* socket gone */
  }
}

// ─────────────────────────────────────────────────────────────────────
//  Signal handling
// ─────────────────────────────────────────────────────────────────────

function shutdown(signal) {
  console.log(`[lattice-agent] ${signal} — shutting down`);
  intentionalClose = true;
  try {
    if (ws && ws.readyState <= 1) ws.close(1000, "shutdown");
  } catch {
    /* */
  }
  if (mcpProc && mcpProc.exitCode === null) {
    try {
      mcpProc.kill("SIGTERM");
    } catch {
      /* */
    }
    // Hard kill fallback after 5s in case the child ignores SIGTERM.
    setTimeout(() => {
      if (mcpProc && mcpProc.exitCode === null) {
        try {
          mcpProc.kill("SIGKILL");
        } catch {
          /* */
        }
      }
    }, 5_000).unref();
  }
  // Give the WS close frame a chance to flush before exit.
  setTimeout(() => process.exit(0), 250).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ─────────────────────────────────────────────────────────────────────
//  Boot
// ─────────────────────────────────────────────────────────────────────

console.log(`[lattice-agent] starting — local port ${ARGS.localPort}, remote ${ARGS.remote}`);
connectLoop().catch((err) => {
  console.error(`[lattice-agent] fatal: ${err?.message ?? err}`);
  process.exit(1);
});
