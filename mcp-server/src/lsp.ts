// Language Server Protocol bridge — Phase 1 (TypeScript).
//
// Spawns `typescript-language-server --stdio` per workspace folder
// and exposes it to the panel as plain HTTP:
//
//   POST /dev-server/:wsId/lsp/request   {root, method, params, doc?}
//   GET  /dev-server/:wsId/lsp/diagnostics?root=…&since=N   (SSE)
//   POST /dev-server/:wsId/lsp/stop      {root?}
//
// Why HTTP+SSE instead of a WebSocket: the agent bridge forwards
// only HTTP `/dev-server/*` requests, so an SSE channel works both
// against a local mcp-server AND through the prod agent bridge with
// zero bridge-protocol changes (the terminal WS, by contrast, is
// local-only today — see terminal.ts:47-54). The reconnectable
// `since` cursor is the same pattern as the watcher SSE in
// fileIndex.ts, so a 60s bridge timer cutting a stream is invisible
// to the client — it replays what it missed.
//
// Lifecycle mirrors terminal.ts's persistent-shell registry: one
// server per workspace folder, lazily started, kept across page
// refreshes, SIGTERM'd on mcp-server shutdown, and reaped after 10
// idle minutes so a forgotten workspace can't leak a tsserver.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { basename, relative, sep } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { safeResolveUserFolder } from "./devServer.js";

// ─────────────────────────────────────────────────────────────────────
//  Session registry
// ─────────────────────────────────────────────────────────────────────

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export interface LspDiagnostic {
  /** Relative path (forward slashes) or an absolute path if the
   *  diagnostic landed outside the workspace root. */
  path: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  message: string;
  /** LSP severity: 1=Error 2=Warning 3=Information 4=Hint. */
  severity: number;
  code?: string | number;
  source?: string;
}

export interface LspEvent {
  kind: "snapshot" | "publish";
  /** For publish: the single file that changed. */
  path?: string;
  diagnostics?: LspDiagnostic[];
  /** For snapshot: every file's current diagnostics. */
  files?: Record<string, LspDiagnostic[]>;
  ts: number;
}

interface LspSession {
  id: string;
  root: string;
  child: ChildProcessWithoutNullStreams;
  /** Resolved after the LSP `initialize` round-trip. */
  ready: Promise<void>;
  nextId: number;
  pending: Map<number, PendingRequest>;
  /** Relative path → open document version (didOpen/didChange sync). */
  openDocs: Map<string, number>;
  /** Latest diagnostics per relative path (what a fresh SSE client
   *  gets as its snapshot). */
  latest: Map<string, LspDiagnostic[]>;
  events: LspEvent[];
  cursor: number;
  waiters: Array<() => void>;
  lastUsed: number;
  /**stdout buffer for the Content-Length framer. */
  frameBuf: Buffer;
  dead: boolean;
  idleTimer: NodeJS.Timeout | undefined;
}

const sessions = new Map<string, LspSession>();

const IDLE_REAP_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 20_000;

// Global 60s sweeper — reaps sessions the panel walked away from.
// One interval for all sessions, cleared iff none exist (cheap
// enough to just leave running, but tidy is tidy).
let sweeper: NodeJS.Timeout | undefined;
function ensureSweeper() {
  if (sweeper) return;
  sweeper = setInterval(() => {
    for (const [id, s] of sessions) {
      if (Date.now() - s.lastUsed > IDLE_REAP_MS) {
        console.warn(`[lsp] reaping idle session ${id} (root: ${s.root})`);
        void killSession(id, "idle timeout");
      }
    }
    if (sessions.size === 0 && sweeper) {
      clearInterval(sweeper);
      sweeper = undefined;
    }
  }, 60_000);
  sweeper.unref();
}

// ─────────────────────────────────────────────────────────────────────
//  Binary resolution — never spawn `.cmd` shims on Windows
// ─────────────────────────────────────────────────────────────────────

// typescript-language-server ships a `.bin/tsserver`-style shim that
// on Windows is a `.cmd` file. `shell: true` around a `.cmd` means
// SIGTERM kills cmd.exe and ORPHANS the real child (the same trap
// agent.mjs documents for its own spawn). Instead we resolve the
// package's real JS entry and run it under `process.execPath`.
let cachedServerJs: string | null | undefined;
function resolveTlsEntry(): string | null {
  if (cachedServerJs !== undefined) return cachedServerJs;
  try {
    const req = createRequire(import.meta.url);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedServerJs = req.resolve("typescript-language-server/lib/cli.mjs");
  } catch {
    cachedServerJs = null;
  }
  return cachedServerJs;
}

// ─────────────────────────────────────────────────────────────────────
//  Session lifecycle
// ─────────────────────────────────────────────────────────────────────

function sessionId(workspaceId: string): string {
  // One server per workspace folder — the workspace id is enough;
  // if the user picks a different root for the same workspace the
  // session is recycled below.
  return workspaceId;
}

export function getLspSession(workspaceId: string): LspSession | undefined {
  return sessions.get(sessionId(workspaceId));
}

export async function ensureLspSession(
  workspaceId: string,
  root: string,
): Promise<LspSession> {
  const id = sessionId(workspaceId);
  const existing = sessions.get(id);
  if (existing) {
    existing.lastUsed = Date.now();
    if (existing.root !== root) {
      // Same workspace, different folder — recycle.
      await killSession(id, "root changed");
    } else {
      await existing.ready;
      return existing;
    }
  }

  const serverJs = resolveTlsEntry();
  if (!serverJs) {
    throw new Error(
      "typescript-language-server is not installed in mcp-server",
    );
  }
  // tls ≥4 resolves tsserver itself: it looks in the workspace's
  // node_modules first (so the project's own TypeScript version
  // wins) and falls back to the copy reachable from this module.
  // There is deliberately no --tsserver-path here — tls 6 removed
  // the flag.
  const args = [serverJs, "--stdio"];

  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: "pipe",
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  });

  const session: LspSession = {
    id,
    root,
    child,
    ready: Promise.resolve(),
    nextId: 1,
    pending: new Map(),
    openDocs: new Map(),
    latest: new Map(),
    events: [],
    cursor: 0,
    waiters: [],
    lastUsed: Date.now(),
    frameBuf: Buffer.alloc(0),
    dead: false,
    idleTimer: undefined,
  };
  session.ready = initializeSession(session);
  sessions.set(id, session);
  ensureSweeper();

  child.on("exit", (code) => {
    if (session.dead) return;
    session.dead = true;
    console.warn(`[lsp] tsserver exited unexpectedly (code ${code})`);
    // Fail every in-flight request so callers get a clean error
    // instead of hanging to the timeout.
    for (const p of session.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("language server exited"));
    }
    session.pending.clear();
    sessions.delete(id);
  });
  child.stderr.on("data", (buf: Buffer) => {
    // tls logs verbosely at debug levels; keep the console usable.
    const text = buf.toString("utf8").trim();
    if (text) console.warn(`[lsp] ${text.split("\n").slice(0, 4).join(" | ")}`);
  });

  await session.ready;
  return session;
}

export async function killSession(
  workspaceId: string,
  reason: string,
): Promise<void> {
  const id = sessionId(workspaceId);
  const s = sessions.get(id);
  if (!s) return;
  s.dead = true;
  if (s.idleTimer) clearTimeout(s.idleTimer);
  sessions.delete(id);
  for (const p of s.pending.values()) {
    clearTimeout(p.timer);
    p.reject(new Error(`language server stopped (${reason})`));
  }
  s.pending.clear();
  // LSP shutdown handshake is advisory here — the process is going
  // away either way. SIGTERM is sufficient and faster.
  try {
    s.child.kill();
  } catch {
    /* already gone */
  }
}

export async function shutdownAllLspSessions(): Promise<void> {
  const all = Array.from(sessions.keys());
  sessions.clear();
  await Promise.allSettled(all.map((id) => killSession(id, "mcp-server shutdown")));
}

// ─────────────────────────────────────────────────────────────────────
//  JSON-RPC over stdio (Content-Length framing)
// ─────────────────────────────────────────────────────────────────────

function attachStdio(session: LspSession): void {
  session.child.stdout.on("data", (chunk: Buffer) => {
    session.frameBuf = session.frameBuf.length
      ? Buffer.concat([session.frameBuf, chunk])
      : chunk;
    // Drain as many complete frames as the buffer holds.
    for (;;) {
      const headerEnd = session.frameBuf.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = session.frameBuf.subarray(0, headerEnd).toString("utf8");
      const m = /content-length:\s*(\d+)/i.exec(header);
      if (!m) {
        // Malformed header — drop through the separator and hope the
        // stream resyncs. tls never does this in practice.
        session.frameBuf = session.frameBuf.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(m[1]);
      const total = headerEnd + 4 + length;
      if (session.frameBuf.length < total) return; // wait for the rest
      const body = session.frameBuf
        .subarray(headerEnd + 4, total)
        .toString("utf8");
      session.frameBuf = session.frameBuf.subarray(total);
      try {
        handleServerMessage(session, JSON.parse(body));
      } catch (err) {
        console.warn("[lsp] bad JSON-RPC payload:", (err as Error).message);
      }
    }
  });
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function sendMessage(session: LspSession, msg: JsonRpcMessage): void {
  const body = Buffer.from(JSON.stringify(msg), "utf8");
  session.child.stdin.write(
    `Content-Length: ${body.length}\r\n\r\n`,
    () => {
      /* header flushed */
    },
  );
  session.child.stdin.write(body);
}

function request(
  session: LspSession,
  method: string,
  params: unknown,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = session.nextId++;
    const timer = setTimeout(() => {
      session.pending.delete(id);
      reject(new Error(`lsp request timed out: ${method}`));
    }, timeoutMs);
    session.pending.set(id, {
      resolve: (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
      timer,
    });
    sendMessage(session, { jsonrpc: "2.0", id, method, params });
  });
}

function notify(
  session: LspSession,
  method: string,
  params: unknown,
): void {
  sendMessage(session, { jsonrpc: "2.0", method, params });
}

function handleServerMessage(session: LspSession, msg: JsonRpcMessage): void {
  // A response to one of our requests.
  if (msg.id !== undefined && msg.id !== null && msg.method === undefined) {
    const pending = session.pending.get(Number(msg.id));
    if (!pending) return;
    session.pending.delete(Number(msg.id));
    if (msg.error) {
      pending.reject(new Error(`lsp: ${msg.error.message}`));
    } else {
      pending.resolve(msg.result);
    }
    return;
  }

  // Server → client request: tls asks for configuration / capability
  // registration / progress windows. We answer everything with a
  // permissive default so the server never stalls waiting on us.
  if (msg.method !== undefined && msg.id !== undefined && msg.id !== null) {
    if (msg.method === "workspace/configuration") {
      // params: { items: [{section}…] } → one config object per item.
      // We accept defaults for every section.
      const count = Array.isArray((msg.params as { items?: unknown[] })?.items)
        ? (msg.params as { items: unknown[] }).items.length
        : 1;
      sendMessage(session, {
        jsonrpc: "2.0",
        id: msg.id,
        result: Array.from({ length: count }, () => ({})),
      });
      return;
    }
    // registerCapability/unregistration/workDoneProgress/applyEdit —
    // an empty ack is valid for all of them for our purposes.
    sendMessage(session, {
      jsonrpc: "2.0",
      id: msg.id,
      result: msg.method === "workspace/applyEdit" ? { applied: false } : null,
    });
    return;
  }

  // Notifications we care about.
  if (msg.method === "textDocument/publishDiagnostics") {
    const p = msg.params as {
      uri: string;
      diagnostics?: Array<{
        range: LspDiagnostic["range"];
        message: string;
        severity?: number;
        code?: string | number;
        source?: string;
      }>;
    };
    const rel = uriToRelPath(session.root, p.uri);
    const diags: LspDiagnostic[] = (p.diagnostics ?? []).map((d) => ({
      path: rel,
      range: d.range,
      message: d.message,
      severity: d.severity ?? 1,
      code: d.code,
      source: d.source,
    }));
    session.latest.set(rel, diags);
    pushEvent(session, { kind: "publish", path: rel, diagnostics: diags, ts: Date.now() });
    return;
  }
  // window/logMessage, $/progress, telemetry — ignore.
}

async function initializeSession(session: LspSession): Promise<void> {
  attachStdio(session);
  const rootUri = pathToFileURL(session.root).href;
  await request(session, "initialize", {
    processId: process.pid,
    rootUri,
    workspaceFolders: [{ uri: rootUri, name: basename(session.root) }],
    capabilities: {
      textDocument: {
        publishDiagnostics: {
          versionSupport: true,
          tagSupport: { valueSet: [1, 2] },
        },
        // Phase 2 feature negotiation. Whatever we don't declare, tls
        // won't offer — hover/definition/references come back as
        // plain Locations (no linkSupport), documentSymbol as the
        // hierarchical shape, rename with the prepare step enabled so
        // the panel can probe before opening its input.
        hover: { contentFormat: ["markdown", "plaintext"] },
        definition: {},
        references: {},
        documentSymbol: { hierarchicalDocumentSymbolSupport: true },
        rename: { prepareSupport: true },
      },
      workspace: {
        configuration: true,
        workspaceFolders: true,
      },
    },
    initializationOptions: {
      hostInfo: "lattice-mcp-server",
      preferences: {
        // tls defaults this to true, which makes a rename at an
        // import/use site produce a local `foo as newName` alias and
        // leave the declaration untouched — surprising for a VS
        // Code-style F2. With it off, rename always targets the
        // declaration and patches import specifiers plainly.
        providePrefixAndSuffixTextForRename: false,
      },
    },
  });
  notify(session, "initialized", {});
}

// ─────────────────────────────────────────────────────────────────────
//  Path / URI helpers
// ─────────────────────────────────────────────────────────────────────

const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript", tsx: "typescriptreact",
  js: "javascript", jsx: "javascriptreact", mjs: "javascript", cjs: "javascript",
  json: "json", md: "markdown", css: "css", html: "html", py: "python",
  yaml: "yaml", yml: "yaml",
};

function relToUri(root: string, rel: string): string | null {
  const abs = safeResolveUserFolder(root, rel);
  return abs ? pathToFileURL(abs).href : null;
}

function uriToRelPath(root: string, uri: string): string {
  try {
    const abs = fileURLToPath(uri);
    const rel = relative(root, abs).split(sep).join("/");
    return rel.startsWith("..") || rel === "" ? abs : rel;
  } catch {
    return uri;
  }
}

// ─────────────────────────────────────────────────────────────────────
//  Document sync — keep the server's view current with the editor
// ─────────────────────────────────────────────────────────────────────

export interface LspDocSync {
  /** Path relative to root. */
  path: string;
  /** Current editor content. Omitted → the file is read from disk
   *  (used when the caller hasn't got the file open). */
  content?: string;
}

async function syncDoc(
  session: LspSession,
  doc: LspDocSync | undefined,
): Promise<void> {
  if (!doc) return;
  const uri = relToUri(session.root, doc.path);
  if (!uri) throw new Error("bad path");
  const ext = doc.path.split(".").pop()?.toLowerCase() ?? "";
  const languageId = LANG_BY_EXT[ext] ?? "plaintext";

  let text = doc.content;
  if (text === undefined) {
    const abs = safeResolveUserFolder(session.root, doc.path);
    if (!abs) throw new Error("bad path");
    const fs = await import("node:fs/promises");
    text = await fs.readFile(abs, "utf8");
  }

  const version = session.openDocs.get(doc.path);
  if (version === undefined) {
    session.openDocs.set(doc.path, 1);
    notify(session, "textDocument/didOpen", {
      textDocument: { uri, languageId, version: 1, text },
    });
  } else {
    const next = version + 1;
    session.openDocs.set(doc.path, next);
    notify(session, "textDocument/didChange", {
      textDocument: { uri, version: next },
      contentChanges: [{ text }],
    });
  }
}

// ─────────────────────────────────────────────────────────────────────
//  Public request entry — called from the POST route in index.ts
// ─────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────
//  Result normalization
//
//  LSP responses speak absolute file:// URIs; every other panel API
//  (diagnostics, watcher, search) speaks root-relative forward-slash
//  paths. Rewrite the URI-bearing feature responses here so the
//  client never parses URLs (Windows file:///D:/… quirks included).
// ─────────────────────────────────────────────────────────────────────

interface LspRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

const ZERO_RANGE: LspRange = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 0 },
};

/** Location | LocationLink → { path, range }. For links the
 *  selection range wins (it's what go-to-definition highlights). */
function normalizeLocation(
  root: string,
  loc: unknown,
): { path: string; range: LspRange } | null {
  if (!loc || typeof loc !== "object") return null;
  const l = loc as {
    uri?: unknown;
    range?: LspRange;
    targetUri?: unknown;
    targetRange?: LspRange;
    targetSelectionRange?: LspRange;
  };
  if (typeof l.targetUri === "string") {
    return {
      path: uriToRelPath(root, l.targetUri),
      range: l.targetSelectionRange ?? l.targetRange ?? ZERO_RANGE,
    };
  }
  if (typeof l.uri === "string" && l.range) {
    return { path: uriToRelPath(root, l.uri), range: l.range };
  }
  return null;
}

function normalizeLocations(root: string, result: unknown): unknown {
  const list = Array.isArray(result) ? result : [result];
  return list
    .map((l) => normalizeLocation(root, l))
    .filter((l): l is { path: string; range: LspRange } => l !== null);
}

interface RawTextEdit {
  range: LspRange;
  newText: string;
}

interface RawWorkspaceEdit {
  changes?: Record<string, RawTextEdit[]>;
  documentChanges?: Array<{
    textDocument?: { uri?: string };
    edits?: RawTextEdit[];
  }>;
}

/** WorkspaceEdit → { changes: Record<relPath, TextEdit[]> }, merging
 *  the keyed `changes` map and the ordered `documentChanges` form
 *  (tls uses the former, but the spec allows both). */
function normalizeWorkspaceEdit(
  root: string,
  edit: RawWorkspaceEdit,
): { changes: Record<string, RawTextEdit[]> } {
  const changes: Record<string, RawTextEdit[]> = {};
  for (const [uri, edits] of Object.entries(edit.changes ?? {})) {
    changes[uriToRelPath(root, uri)] = edits;
  }
  for (const dc of edit.documentChanges ?? []) {
    if (!dc.textDocument?.uri) continue;
    const rel = uriToRelPath(root, dc.textDocument.uri);
    changes[rel] = [...(changes[rel] ?? []), ...(dc.edits ?? [])];
  }
  return { changes };
}

function normalizeLspResult(
  root: string,
  method: string,
  result: unknown,
): unknown {
  if (result === null || result === undefined) return result;
  switch (method) {
    case "textDocument/definition":
    case "textDocument/declaration":
    case "textDocument/typeDefinition":
    case "textDocument/implementation":
      return normalizeLocations(root, result);
    case "textDocument/references":
      return Array.isArray(result) ? normalizeLocations(root, result) : [];
    case "textDocument/rename":
      return normalizeWorkspaceEdit(root, result as RawWorkspaceEdit);
    case "textDocument/documentSymbol": {
      // Hierarchical DocumentSymbol[] carries no URIs and passes
      // through untouched; flat SymbolInformation[] entries do carry
      // location.uri — rewrite just that field.
      if (!Array.isArray(result)) return result;
      return result.map((sym) => {
        const s = sym as { location?: { uri?: string; range?: LspRange } };
        if (s.location?.uri) {
          return {
            ...s,
            location: {
              path: uriToRelPath(root, s.location.uri),
              range: s.location.range ?? ZERO_RANGE,
            },
          };
        }
        return sym;
      });
    }
    default:
      return result;
  }
}

const RESERVED_METHODS = new Set(["initialize", "initialized", "shutdown", "exit"]);
export async function lspRequest(
  workspaceId: string,
  root: string,
  method: string,
  params: unknown,
  doc?: LspDocSync,
): Promise<unknown> {
  if (RESERVED_METHODS.has(method)) {
    throw new Error(`method is reserved: ${method}`);
  }
  const session = await ensureLspSession(workspaceId, root);
  await syncDoc(session, doc);

  // textDocument/* params carry a `textDocument.uri` built from the
  // caller's relative path — rewrite it if the caller passed `path`.
  if (
    params &&
    typeof params === "object" &&
    "path" in params &&
    !(params as Record<string, unknown>).textDocument
  ) {
    const uri = relToUri(root, String((params as Record<string, unknown>).path));
    if (uri) {
      params = {
        ...(params as Record<string, unknown>),
        textDocument: { uri },
      };
    }
  }

  // Rename redirection: tsserver renames only the LOCAL import binding
  // when the request position sits on an import specifier or one of
  // its uses — the declaration (and every other importer) is left
  // untouched, which silently under-renames. Resolve the definition
  // first; when it lives in another file, didOpen that file (tls only
  // renames documents it has open) and re-target both the uri and the
  // position at the declaration. A same-file definition is a plain
  // local rename, which tsserver already handles completely.
  if (method === "textDocument/rename") {
    const p = params as { textDocument?: { uri?: string }; position?: { line: number; character: number } };
    if (p.textDocument?.uri && p.position) {
      try {
        const origUri = p.textDocument.uri;
        const origRel = uriToRelPath(root, origUri);
        const start = { line: p.position.line, character: p.position.character };
        const target = { uri: origUri, line: start.line, character: start.character };
        // vscode-languageserver re-encodes URIs its own way (lowercase
        // drive letter, %3A for the colon), so raw uri strings never
        // compare equal to what we sent. Compare root-relative paths.
        const relOf = (u: string): string | null => uriToRelPath(root, u);
        const targetRel = (): string | null => relOf(target.uri) ?? origRel;

        // One definition chain: a use of an imported symbol resolves
        // first to its import specifier, which resolves again to the
        // declaration. Stops when a position defines itself.
        const chainOnce = async (): Promise<void> => {
          for (let hop = 0; hop < 4; hop++) {
            const defs = (await request(session, "textDocument/definition", {
              textDocument: { uri: target.uri },
              position: { line: target.line, character: target.character },
            })) as
              | { uri?: string; range?: LspRange; targetUri?: string; targetRange?: LspRange; targetSelectionRange?: LspRange }
              | Array<Record<string, unknown>>
              | null;
            const first = Array.isArray(defs) ? defs[0] : defs;
            const uri = first
              ? ((first as { targetUri?: string }).targetUri ?? (first as { uri?: string }).uri)
              : undefined;
            const range = first
              ? ((first as { targetSelectionRange?: LspRange }).targetSelectionRange ??
                (first as { targetRange?: LspRange }).targetRange ??
                (first as { range?: LspRange }).range)
              : undefined;
            if (!uri || !range) return;
            const rel = relOf(uri);
            if (!rel) return;
            if (rel === targetRel() && range.start.line === target.line && range.start.character === target.character) {
              return; // settled — this position is the declaration
            }
            target.uri = uri;
            target.line = range.start.line;
            target.character = range.start.character;
            if (rel !== origRel) return; // crossed files — done
          }
        };

        await chainOnce();

        // Cold project: until tsserver finishes loading, a definition
        // on an import specifier resolves to itself. If the chain
        // landed on an `import …` line, the symbol is provably an
        // import — give the project a few rounds to warm up and
        // re-resolve. A genuine same-file declaration never sits on an
        // import line, so local renames skip the wait entirely.
        const landedOnImportLine = async (): Promise<boolean> => {
          const rel = targetRel();
          if (!rel || rel !== origRel) return false;
          try {
            const abs = safeResolveUserFolder(root, rel);
            if (!abs) return false;
            const fs = await import("node:fs/promises");
            const text = await fs.readFile(abs, "utf8");
            const lineText = text.split("\n")[target.line] ?? "";
            return /^\s*import\b/.test(lineText);
          } catch {
            return false;
          }
        };
        for (let round = 0; round < 5 && (await landedOnImportLine()); round++) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          await chainOnce();
        }

        const finalRel = targetRel();
        if (finalRel && finalRel !== origRel) {
          // tls's rename handler only processes documents it has open
          // (toOpenDocument). didOpen the declaration file from disk
          // via syncDoc so its openDocs bookkeeping stays consistent.
          const defUri = relToUri(root, finalRel);
          if (defUri) {
            await syncDoc(session, { path: finalRel });
            params = {
              ...(params as Record<string, unknown>),
              textDocument: { uri: defUri },
              position: { line: target.line, character: target.character },
            };
          }
        }
      } catch {
        // Definition failed — proceed with the original position; the
        // rename itself will surface whatever error applies.
      }
    }
  }

  const result = await request(session, method, params);
  return normalizeLspResult(root, method, result);
}

// ─────────────────────────────────────────────────────────────────────
//  Diagnostics channel — snapshot + incremental, cursor-replayable
// ─────────────────────────────────────────────────────────────────────

function pushEvent(session: LspSession, ev: LspEvent): void {
  session.events.push(ev);
  if (session.events.length > 2_000) {
    session.events.splice(0, session.events.length - 2_000);
  }
  session.cursor = session.events.length;
  for (const w of session.waiters.splice(0)) w();
}

/** First event a new SSE consumer receives: the full current map.
 *  Always pushed as event 0 so `since=0` replays it. */
export function lspSnapshotEvent(workspaceId: string): LspEvent | null {
  const s = getLspSession(workspaceId);
  if (!s) return null;
  const files: Record<string, LspDiagnostic[]> = {};
  for (const [path, diags] of s.latest) {
    if (diags.length > 0) files[path] = diags;
  }
  return { kind: "snapshot", files, ts: Date.now() };
}

export function lspEventsAfter(workspaceId: string, since: number): LspEvent[] {
  const s = getLspSession(workspaceId);
  if (!s) return [];
  return s.events.slice(Math.max(0, since));
}

export function waitForLspEvents(
  workspaceId: string,
  since: number,
  timeoutMs = 1_500,
): Promise<LspEvent[]> {
  return new Promise((resolve) => {
    const s = getLspSession(workspaceId);
    if (!s || s.dead) return resolve([]);
    if (s.cursor > since) return resolve(s.events.slice(since));
    const w = () => {
      clearTimeout(t);
      const cur = getLspSession(workspaceId);
      resolve(cur ? cur.events.slice(since) : []);
    };
    const t = setTimeout(() => {
      const idx = s.waiters.indexOf(w);
      if (idx >= 0) s.waiters.splice(idx, 1);
      resolve(lspEventsAfter(workspaceId, since));
    }, timeoutMs);
    s.waiters.push(w);
  });
}
