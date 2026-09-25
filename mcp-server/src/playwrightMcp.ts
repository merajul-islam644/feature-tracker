// Bridge to the OFFICIAL Playwright MCP server.
//
// This process is an MCP *client*: it spawns the official server as a child
// process over stdio and forwards tool calls to it. The chatbot's browser
// tools (browser_navigate, browser_click, …) are NOT defined anywhere in
// this repo — they are read live from the official server's tool catalog,
// so they always match whatever @playwright/mcp ships.
//
// The child is lazy (spawned on first use), singleton, and restarted
// automatically if it dies. Headed by default — the user sees the browser
// window the chatbot is driving, same philosophy as the verification agent.
//
// VERSION PIN: We pin @playwright/mcp@0.0.82 instead of `latest`. `latest`
// causes version drift across runs and during debug — a stale agent loop
// behaving differently because the underlying MCP server changed under it.
// 0.0.82 is the current stable release per the official package metadata.
// We also avoid `--shared-browser-context`: that flag is for multi-client
// HTTP setups, and we run one stdio MCP per bridge process anyway.
//
// TOOL SERIALIZATION: callPlaywrightTool queues every call behind a
// promise chain. The agent's model loop normally fires tools sequentially
// (render → user-allow → render again), so this is mostly defensive — but
// if two tool results ever arrive in the same tick (concurrent state
// observers, a permission card resolving mid-render), the queue keeps
// @playwright/mcp from seeing overlapping requests on the same browser.
//
// CONNECTION LIFECYCLE LOGGING: every connect / disconnect logs a single
// line. If about:blank snapshots ever come back while the agent thinks it
// is on /app/console, this log makes it obvious whether the MCP connection
// bounced mid-walkthrough (which would invalidate every cached snapshot).

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface PlaywrightToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// Pinned package — change here ONLY when intentionally upgrading the MCP
// server. `latest` is forbidden in this file.
const MCP_PACKAGE = "@playwright/mcp@0.0.82";

let client: Client | null = null;
let starting: Promise<Client> | null = null;
// Unique id per (re)connect. Surfaced in tool logs so a session that
// reconnects mid-walkthrough is unmistakable in the log trail.
let connectionId = 0;

// Promise-chain queue for `callPlaywrightTool`. Each new call awaits the
// previous one — @playwright/mcp itself is single-threaded, so this just
// guarantees our caller can't fan out two tool requests at once.
let toolQueue: Promise<unknown> = Promise.resolve();
function enqueueTool<T>(task: () => Promise<T>): Promise<T> {
  const next = toolQueue.then(task, task);
  // Swallow errors on the chain so one failed call doesn't poison every
  // subsequent queue position. The original error still rejects `next`,
  // which is what the caller awaits.
  toolQueue = next.catch(() => undefined);
  return next;
}

async function connect(): Promise<Client> {
  if (client) return client;
  if (starting) return starting;

  starting = (async () => {
    // Windows: npx is a .cmd — spawn through cmd /c. Everywhere else a
    // plain npx works. First run may download the package, so allow a
    // generous handshake timeout.
    const isWin = process.platform === "win32";
    const transport = new StdioClientTransport({
      command: isWin ? "cmd" : "npx",
      args: [...(isWin ? ["/c", "npx"] : []), MCP_PACKAGE],
      stderr: "pipe",
    });
    transport.stderr?.on("data", (c: Buffer) => {
      const s = c.toString().trim();
      if (s) process.stderr.write(`[playwright-mcp] ${s}\n`);
    });
    const c = new Client({ name: "feature-tracker-bridge", version: "0.1.0" });
    const myId = ++connectionId;
    process.stderr.write(`[playwright-mcp] starting connection id=${myId} package=${MCP_PACKAGE}\n`);
    await c.connect(transport, { timeout: 120_000 });
    process.stderr.write(`[playwright-mcp] connected id=${myId}\n`);
    // If the child dies (crash, npx cache purge), drop our handle so the
    // next call respawns it instead of writing into a dead pipe. Also
    // log the close — mid-walkthrough disconnects are a top suspect for
    // the "agent thinks /app/console, tool says about:blank" symptom.
    c.onclose = () => {
      process.stderr.write(`[playwright-mcp] connection id=${myId} closed\n`);
      if (client === c) client = null;
    };
    client = c;
    return c;
  })().finally(() => {
    starting = null;
  });

  return starting;
}

// Tool catalog straight from the official server — the single source of
// truth the chatbot's browser tools are built from.
export async function listPlaywrightTools(): Promise<PlaywrightToolInfo[]> {
  const c = await connect();
  const res = await c.listTools(undefined, { timeout: 60_000 });
  return (res.tools ?? []).map((t) => ({
    name: t.name,
    description: t.description ?? "",
    inputSchema: (t.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>,
  }));
}

// Forward one tool call. Returns the text parts of the result joined —
// image/audio blocks are summarised by type so the caller knows they
// existed without shipping binary through the chat. Every call is
// serialised through `enqueueTool` so two concurrent tool requests
// can't race on the same MCP connection.
export async function callPlaywrightTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  return enqueueTool(async () => {
    const c = await connect();
    const res = await c.callTool(
      { name, arguments: args },
      undefined,
      // Long budget — navigation waits for networkidle and can take a while;
      // progress notifications reset the timer.
      { timeout: 300_000, resetTimeoutOnProgress: true },
    );
    if (res.isError) {
      throw new Error(`playwright tool ${name} failed`);
    }
    const parts: string[] = [];
    let images = 0;
    // The SDK's declared content union is a tangle of annotated block shapes
    // that collapses to `{}` for direct iteration — narrow to the two fields
    // we actually read.
    const blocks = (res.content ?? []) as Array<{ type: string; text?: string }>;
    for (const block of blocks) {
      if (block.type === "text" && typeof block.text === "string") {
        parts.push(block.text);
      } else if (block.type === "image") {
        images++;
      }
    }
    if (images > 0) parts.push(`[${images} image${images > 1 ? "s" : ""} captured]`);
    return parts.join("\n").trim() || "(no output)";
  });
}
