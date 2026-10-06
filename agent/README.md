# Lattice local agent

Bridges the cloud mcp-server (in the Lattice prod container) to a local
mcp-server on your machine so the `/panel` workspace can read your
local files and run your `npm run dev` children.

## Install

No `npm install` is required — the agent uses Node 22+'s built-in
`WebSocket` global. All other deps (`ws`, `tsx`) come from
`mcp-server/node_modules/`.

You do need a working Node 22+ and the Lattice repo cloned locally
(this is the same checkout the cloud mcp-server is built from).

## Run

```sh
node agent/agent.mjs --token <AGENT_BRIDGE_TOKEN>
```

Defaults:

- `--remote wss://dbeegi.slsblx.com` — the cloud prod origin
- `--port 8787` — local mcp-server port
- `--mcp-cwd ../mcp-server` — local mcp-server directory
- `--mcp-entry ../mcp-server/src/index.ts` — local mcp-server entry

For local dev against the prod-backend (Vite proxy or the in-tree
prod-backend.mjs):

```sh
node agent/agent.mjs --token test123 --remote ws://localhost:8080
```

For the local Vite dev server (port 5173):

```sh
node agent/agent.mjs --token test123 --remote ws://localhost:5173
```

## How it works

1. The agent spawns a local mcp-server on `--port` (default 8787).
   This is the same `mcp-server/src/index.ts` the cloud runs — no
   code duplication. The local mcp-server has `AGENT_BRIDGE_ENABLED`
   cleared so it runs `/dev-server/*` locally.
2. It opens a WebSocket to `${remote}/api/dev-server/_agent`.
3. On the first frame, it sends `{ type: "hello", token, version }`.
4. When the cloud accepts, the agent logs
   `[lattice-agent] hello accepted — ready to bridge /dev-server/*`
5. For every `/dev-server/*` call the cloud receives, the agent:
   - Receives `{ type: "http_request", requestId, method, path, body }`
   - Calls `fetch(http://127.0.0.1:8787${path})` with the same
     method/headers/body
   - Sends back `{ type: "http_response_start", requestId, status,
     headers }` + zero-or-more `{ type: "http_response_chunk", ... }`
     + `{ type: "http_response_end", requestId }`
6. The cloud mcp-server pipes those chunks into the Fastify reply —
   the browser sees a normal HTTP response (including SSE for the
   dev-server event tail).

## Tokens

The cloud mcp-server has `AGENT_BRIDGE_TOKEN` set as an env var. The
agent's `--token` must match. If the cloud has the env unset, the
bridge is OFF and the cloud runs `/dev-server/*` locally (the
default in dev). Setting `AGENT_BRIDGE_ENABLED=1` on the cloud turns
the bridge on.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `hello rejected: bad_token` | Cloud has a different `AGENT_BRIDGE_TOKEN` | Re-copy the token from the cloud portal, paste into the `--token` arg |
| `FATAL: cannot find tsx loader` | `mcp-server/node_modules/tsx` is missing | Run `cd mcp-server && npm ci` |
| `local mcp-server died before becoming ready` | The local mcp-server crashed at startup (look at the inherited stdio) | Check the error in the agent's terminal; usually a port conflict or a missing dep |
| `WS error: …` then reconnect loop | The cloud bridge is off (`AGENT_BRIDGE_ENABLED` not set) or the cloud prod-backend can't reach the mcp-server | Check the cloud logs; if you see "MCP server listening" but the agent can't connect, the WS upgrade forwarder in prod-backend is the suspect |
| `/panel` shows "no package.json found" + empty tree | The agent is connected but the local mcp-server's working directory is wrong | Inspect: the local mcp-server runs from `mcp-server/` and resolves paths against `process.cwd()`. The agent doesn't change its own CWD; the path in the request is absolute. |
| Banner never turns green | The cloud mcp-server's `/api/dev-server/_agent` route is not registered | This is the deployment gap — make sure the cloud build picked up `mcp-server/src/agentBridge.ts` and the new `/_agent` route in `index.ts` |

## Limits

- Single agent per cloud instance. A second agent that connects
  displaces the first. Multi-tenant routing is a follow-up.
- The agent's local mcp-server is a child of the agent process. If
  you `Ctrl+C` the agent, the local mcp-server gets SIGTERM and
  exits (no orphan). All in-flight `/dev-server/*` requests 502.
- The bridge uses `process.execPath` + `tsx/dist/cli.mjs` directly
  to spawn the local mcp-server — no `.cmd` shim, no `shell: true`,
  so SIGTERM propagates correctly on Windows.
