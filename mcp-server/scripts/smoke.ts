// MCP server smoke test — boots the server, hits /health, makes a
// secret, fetches /secrets, then deletes the secret. Doesn't drive
// Playwright (that requires `npx playwright install chromium` first).
//
// Usage:  npm --prefix mcp-server run smoke
//
// Exits 0 on success, 1 on any failure. Intended for CI gating.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const PORT = Number(process.env.SMOKE_PORT ?? 8799);
const BASE = `http://127.0.0.1:${PORT}`;

async function start(): Promise<ChildProcessWithoutNullStreams> {
  const child = spawn("node", ["--import", "tsx", "src/index.ts"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, MCP_PORT: String(PORT), MCP_LOG_LEVEL: "warn" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => process.stdout.write(`[srv] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[srv] ${chunk}`));
  return child;
}

async function waitForHealth(): Promise<boolean> {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) {
        const body = (await res.json()) as { ok: boolean };
        return body.ok === true;
      }
    } catch {
      // not up yet
    }
    await delay(500);
  }
  return false;
}

async function main() {
  const child = await start();
  try {
    if (!(await waitForHealth())) {
      throw new Error("Server did not become healthy in 15s");
    }
    console.log("✓ /health responds");

    const create = await fetch(`${BASE}/secrets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Smoke Test",
        email: "smoke@example.com",
        password: "Z9vQ!test2026",
      }),
    });
    if (!create.ok) throw new Error(`create returned ${create.status}`);
    const created = (await create.json()) as { id: string };
    if (!created.id.startsWith("sec_")) throw new Error("secret id missing");
    if (JSON.stringify(created).includes("Z9vQ!")) {
      throw new Error("Password leaked in API response!");
    }
    console.log("✓ secret created, password NOT in response");

    const list = await fetch(`${BASE}/secrets`).then((r) => r.json() as Promise<{ secrets: { id: string }[] }>);
    if (!list.secrets.some((s) => s.id === created.id)) throw new Error("newly created secret not in list");
    console.log("✓ secret listed");

    const del = await fetch(`${BASE}/secrets/${created.id}`, { method: "DELETE" });
    if (!del.ok) throw new Error(`delete returned ${del.status}`);
    console.log("✓ secret deleted");
    console.log("\nSMOKE TEST PASSED ✅");
  } finally {
    child.kill("SIGTERM");
  }
}

main().catch((err) => {
  console.error("\nSMOKE TEST FAILED ❌");
  console.error(err);
  process.exit(1);
});
