// Bridge to the OFFICIAL Playwright MCP server (`npx @playwright/mcp@latest`).
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

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface PlaywrightToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

let client: Client | null = null;
let starting: Promise<Client> | null = null;

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
      args: [...(isWin ? ["/c", "npx"] : []), "@playwright/mcp@latest"],
      stderr: "pipe",
    });
    transport.stderr?.on("data", (c: Buffer) => {
      const s = c.toString().trim();
      if (s) process.stderr.write(`[playwright-mcp] ${s}\n`);
    });
    const c = new Client({ name: "feature-tracker-bridge", version: "0.1.0" });
    await c.connect(transport, { timeout: 120_000 });
    // If the child dies (crash, npx cache purge), drop our handle so the
    // next call respawns it instead of writing into a dead pipe.
    c.onclose = () => {
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
// existed without shipping binary through the chat.
export async function callPlaywrightTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
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
}
