// Playwright MCP bridge — a hand-rolled MCP stdio client to the
// OFFICIAL @playwright/mcp server (pinned). Migrated from
// mcp-server/src/playwrightMcp.ts when that server was retired: same
// behavior, no MCP SDK dependency — the stdio wire is the same
// Content-Length framing the LSP bridge already speaks.
//
//   • lazy singleton child, restarted automatically if it dies
//   • every tool call serialized through a promise chain
//   • VERSION PIN: @playwright/mcp@0.0.82 — `latest` is forbidden here
//     (version drift changed tool behavior mid-walkthrough once).
//   • headed by default — the user SEES the browser the chat drives.

import { spawn } from "node:child_process";

const MCP_PACKAGE = "@playwright/mcp@0.0.82";
const MCP_PROTOCOL_VERSION = "2024-11-05";

let child = null;
let starting = null;
let ready = false;
let nextId = 1;
const pending = new Map();
let toolQueue = Promise.resolve();

// MCP stdio wire = NEWLINE-DELIMITED JSON (not the Content-Length
// framing LSP uses) — one JSON object per line, both directions.
function frameMessage(message) {
  return Buffer.from(JSON.stringify(message) + "\n", "utf8");
}

function createLineParser(onMessage) {
  let buffer = "";
  return function feed(chunk) {
    buffer += chunk.toString("utf8");
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        onMessage(JSON.parse(line));
      } catch {
        /* a malformed line never kills the bridge */
      }
    }
  };
}

function ensureChild() {
  if (child && child.exitCode === null) return child;
  const isWin = process.platform === "win32";
  const next = spawn(
    isWin ? "cmd" : "npx",
    [...(isWin ? ["/d", "/s", "/c", "npx"] : []), MCP_PACKAGE],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  );
  child = next;
  const feed = createLineParser((message) => {
    if (message.id !== undefined && pending.has(message.id)) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message ?? "MCP error"));
      else waiter.resolve(message.result);
    }
  });
  next.stdout.on("data", (chunk) => feed(chunk));
  next.stderr.on("data", () => {
    /* npx download progress / server logs — swallowed */
  });
  next.on("exit", () => {
    // Any in-flight requests reject; the next call respawns fresh.
    for (const waiter of pending.values()) waiter.reject(new Error("Playwright MCP child exited"));
    pending.clear();
    ready = false;
    if (child === next) child = null;
  });
  return next;
}

function request(method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    const c = ensureChild();
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`MCP ${method} timed out`));
    }, timeoutMs);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    try {
      c.stdin.write(frameMessage({ jsonrpc: "2.0", id, method, params }));
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      reject(error);
    }
  });
}

async function ensureReady() {
  if (ready) return;
  if (starting) return starting;
  starting = (async () => {
    const c = ensureChild();
    try {
      await request("initialize", {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "lattice-runner-bridge", version: "0.1.0" },
      }, 120_000);
      c.stdin.write(frameMessage({ jsonrpc: "2.0", method: "notifications/initialized" }));
      ready = true;
    } catch (error) {
      // A failed initialize poisons the child (a second initialize on the
      // same connection is a protocol error) — kill it so the next call
      // respawns clean. Classic case: npx downloading the package past
      // the timeout on first ever use.
      try {
        c.kill();
      } catch {
        /* already gone */
      }
      if (child === c) child = null;
      ready = false;
      throw error;
    }
  })().finally(() => {
    starting = null;
  });
  return starting;
}

function enqueueTool(task) {
  const next = toolQueue.then(task, task);
  toolQueue = next.catch(() => undefined);
  return next;
}

/** Live tool catalog from the official server. */
export async function listPlaywrightTools() {
  await ensureReady();
  const res = await request("tools/list", {}, 60_000);
  return (res?.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
  }));
}

/** Forward one browser tool call; text parts joined, images counted. */
export async function callPlaywrightTool(name, args) {
  return enqueueTool(async () => {
    await ensureReady();
    const res = await request(
      "tools/call",
      { name, arguments: args ?? {} },
      300_000,
    );
    if (res?.isError) throw new Error(`playwright tool ${name} failed`);
    const parts = [];
    let images = 0;
    for (const block of res?.content ?? []) {
      if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
      else if (block.type === "image") images += 1;
    }
    if (images > 0) parts.push(`[${images} image${images > 1 ? "s" : ""} captured]`);
    return parts.join("\n").trim() || "(no output)";
  });
}
