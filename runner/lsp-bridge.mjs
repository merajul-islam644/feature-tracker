// LSP bridge — WebSocket ⇄ language-server stdio, one child per
// connection. Python first: `pyright-langserver --stdio` (npm global
// `pyright`). The wire on BOTH sides is LSP JSON-RPC:
//   • client ⇄ runner: plain WebSocket messages, one JSON object each
//   • runner ⇄ server: the LSP base protocol (Content-Length framing)
// The runner never interprets the payloads — it is a pure pipe with a
// framer on the stdio side, so adding languages is a spawn-table row.

import { spawn } from "node:child_process";
import { WebSocketServer } from "ws";

/** Incremental LSP base-protocol frame parser: feed it every stdout
 *  chunk, it emits complete JSON bodies. Exported — the Playwright MCP
 *  bridge reuses it (MCP stdio uses the same base protocol). */
export function createFramer(onMessage) {
  let buffer = Buffer.alloc(0);
  return function feed(chunk) {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = buffer.slice(0, headerEnd).toString("utf8");
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!lengthMatch) {
        // Unframed garbage on stdout — drop the buffer, keep the child.
        buffer = Buffer.alloc(0);
        return;
      }
      const bodyStart = headerEnd + 4;
      const bodyLength = Number(lengthMatch[1]);
      if (buffer.length < bodyStart + bodyLength) return;
      const body = buffer.slice(bodyStart, bodyStart + bodyLength).toString("utf8");
      buffer = buffer.slice(bodyStart + bodyLength);
      try {
        onMessage(JSON.parse(body));
      } catch {
        /* a malformed frame never kills the bridge */
      }
    }
  };
}

function frameMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8"), body]);
}

/** Servers the bridge knows how to spawn. `spawnArgs` is the full argv
 *  after the command; shell=true on Windows because npm-global bins are
 *  .cmd shims that plain spawn cannot execute. */
const LANGUAGES = {
  python: { command: "pyright-langserver", args: ["--stdio"] },
};

export function registerLsp(app, server, opts = {}) {
  const { pairCode = "" } = opts;
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "", "http://localhost");
    if (url.pathname !== "/lsp") return;
    // Same door as the terminal WebSocket — the pairing code gates the
    // open-ws-to-any-website hole.
    if (pairCode && url.searchParams.get("code") !== pairCode) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const lang = (url.searchParams.get("lang") || "python").toLowerCase();
    const server_ = LANGUAGES[lang];
    if (!server_) {
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      let child;
      try {
        child = spawn(server_.command, server_.args, {
          shell: process.platform === "win32",
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (error) {
        try {
          ws.close(1011, `spawn_failed: ${String(error?.message || error).slice(0, 120)}`);
        } catch {
          /* */
        }
        return;
      }
      const send = (message) => {
        if (ws.readyState === 1) ws.send(JSON.stringify(message));
      };
      // server → client: frame, parse, relay verbatim.
      const feed = createFramer(send);
      child.stdout.on("data", (chunk) => feed(chunk));
      // Pyright logs startup noise on stderr — swallowed; crashes still
      // surface through the exit handler below.
      child.stderr.on("data", () => {});

      // client → server: one JSON object per WS message, framed out.
      ws.on("message", (data) => {
        try {
          const message = JSON.parse(data.toString("utf8"));
          child.stdin.write(frameMessage(message));
        } catch {
          /* a malformed client frame never kills the bridge */
        }
      });

      const cleanup = () => {
        try {
          if (child.exitCode === null) child.kill();
        } catch {
          /* already gone */
        }
      };
      ws.on("close", cleanup);
      ws.on("error", cleanup);
      child.on("exit", () => {
        try {
          if (ws.readyState === 1) ws.close(1000, "langserver-exited");
        } catch {
          /* */
        }
      });
      child.on("error", (error) => {
        send({
          jsonrpc: "2.0",
          id: 0,
          error: { code: -32603, message: `langserver spawn failed: ${String(error?.message || error).slice(0, 200)}` },
        });
      });
    });
  });
}
