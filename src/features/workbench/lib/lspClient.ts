// Python LSP client + Monaco integration — the language-support layer
// for non-TS/JS files (TS/JS keeps Monaco's built-in intelligence).
//
// Transport: WebSocket to the runner's /lsp bridge, which pipes JSON-RPC
// both ways into `pyright-langserver --stdio`. Hand-rolled client, no
// monaco-languageclient dependency — only three LSP features are wired:
//
//   • publishDiagnostics → Monaco markers (squiggles + the Problems feed)
//   • textDocument/hover → Monaco hover provider
//   • textDocument/definition → jump to the defining file + line
//
// Full-text sync (didChange carries the whole document) — pyright is
// fast enough and it removes all incremental-sync bookkeeping. Change
// pushes are debounced 400 ms.

import { runnerUrl } from "../../../lib/runner/client";

export type LspRange = {
  start: { line: number; character: number };
  end: { line: number; character: number };
};

export type LspDiagnostic = {
  message: string;
  range: LspRange;
  /** LSP severity: 1 error, 2 warning, 3 info, 4 hint. */
  severity: number;
  source?: string;
};

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

const OPEN_TIMEOUT = 15_000;

export class PythonLspClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private diagnosticsByUri = new Map<string, LspDiagnostic[]>();
  private opened = new Set<string>();
  private versionByUri = new Map<string, number>();
  /** Fires on every publishDiagnostics for files under this root. */
  onDiagnostics: ((path: string, diagnostics: LspDiagnostic[]) => void) | null = null;
  ready: Promise<void>;

  constructor(private root: string) {
    this.ready = this.connect();
  }

  /** workspace-relative path → LSP uri (file:///D:/root/path.py). */
  private toUri(path: string): string {
    const absolute = `${this.root}/${path}`.replace(/\\/g, "/").replace(/(^|\/)\/+/g, "$1");
    return `file:///${absolute.replace(/^\/+/, "")}`;
  }

  private fromUri(uri: string): string {
    let value = uri.replace(/^file:\/\/\//, "").replace(/^file:\/\//, "");
    if (this.root) {
      const rootNorm = `${this.root.replace(/\\/g, "/")}/`;
      if (value.toLowerCase().startsWith(rootNorm.toLowerCase())) {
        value = value.slice(rootNorm.length);
      }
    }
    return decodeURIComponent(value);
  }

  private async connect(): Promise<void> {
    // Pairing code first (the runner gates /lsp the same way it gates
    // the terminal WebSocket).
    const pair = await fetch(`${runnerUrl()}/pair`, { signal: AbortSignal.timeout(5_000) })
      .then((response) => response.json() as Promise<{ code?: string }>)
      .catch(() => ({}) as { code?: string });
    const wsBase = runnerUrl().replace(/^http/, "ws");
    const ws = new WebSocket(`${wsBase}/lsp?lang=python&code=${encodeURIComponent(pair.code ?? "")}`);
    this.ws = ws;

    const opened = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("LSP socket timed out")), OPEN_TIMEOUT);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("LSP socket failed — is the runner running?"));
      };
      ws.onclose = (event) => {
        clearTimeout(timer);
        if (ws.readyState !== 1) reject(new Error(`LSP socket closed (${event.code})`));
      };
    });

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as {
          id?: number;
          method?: string;
          error?: { message?: string };
          result?: unknown;
          params?: { uri?: string; diagnostics?: LspDiagnostic[] };
        };
        if (message.id !== undefined && this.pending.has(message.id)) {
          const pending = this.pending.get(message.id) as Pending;
          this.pending.delete(message.id);
          if (message.error) pending.reject(new Error(message.error.message ?? "LSP error"));
          else pending.resolve(message.result);
          return;
        }
        if (message.method === "textDocument/publishDiagnostics" && message.params?.uri) {
          const path = this.fromUri(message.params.uri);
          const diagnostics = message.params.diagnostics ?? [];
          this.diagnosticsByUri.set(path, diagnostics);
          this.onDiagnostics?.(path, diagnostics);
        }
      } catch {
        /* a malformed frame never kills the client */
      }
    };

    await opened;
    await this.request("initialize", {
      processId: null,
      rootUri: this.toUri(""),
      capabilities: {},
    });
    this.notify("initialized", {});
  }

  private send(message: Record<string, unknown>): void {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(message));
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`LSP ${method} timed out`));
        }
      }, 30_000);
    });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  async openFile(path: string, text: string): Promise<void> {
    await this.ready;
    const uri = this.toUri(path);
    if (this.opened.has(uri)) return;
    this.opened.add(uri);
    this.versionByUri.set(uri, 1);
    this.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: "python", version: 1, text },
    });
  }

  changeFile(path: string, text: string): void {
    const uri = this.toUri(path);
    if (!this.opened.has(uri)) return;
    const version = (this.versionByUri.get(uri) ?? 1) + 1;
    this.versionByUri.set(uri, version);
    this.notify("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
  }

  closeFile(path: string): void {
    const uri = this.toUri(path);
    if (!this.opened.has(uri)) return;
    this.opened.delete(uri);
    this.notify("textDocument/didClose", { textDocument: { uri } });
  }

  diagnosticsFor(path: string): LspDiagnostic[] {
    return this.diagnosticsByUri.get(this.toUri(path)) ?? [];
  }

  async hover(path: string, line: number, character: number): Promise<{ contents: string } | null> {
    await this.ready;
    const result = (await this.request("textDocument/hover", {
      textDocument: { uri: this.toUri(path) },
      position: { line, character },
    })) as { contents?: unknown } | null;
    if (!result?.contents) return null;
    // MarkupContent {value,kind} | MarkedString[] | string → one string.
    const contents = result.contents;
    if (typeof contents === "string") return { contents };
    if (Array.isArray(contents)) {
      const parts = contents.map((entry) =>
        typeof entry === "string" ? entry : (entry as { value: string }).value,
      );
      return { contents: parts.join("\n\n") };
    }
    const markup = contents as { value?: string };
    return { contents: markup.value ?? "" };
  }

  /** Resolved locations, as workspace-relative paths. */
  async definition(
    path: string,
    line: number,
    character: number,
  ): Promise<{ path: string; range: LspRange }[]> {
    await this.ready;
    const result = (await this.request("textDocument/definition", {
      textDocument: { uri: this.toUri(path) },
      position: { line, character },
    })) as
      | { uri: string; range?: LspRange }
      | { uri: string; range?: LspRange }[]
      | null;
    if (!result) return [];
    const list = Array.isArray(result) ? result : [result];
    return list
      .filter((entry) => Boolean(entry?.uri))
      .map((entry) => ({
        path: this.fromUri(entry.uri),
        range:
          entry.range ?? {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
      }));
  }

  dispose(): void {
    this.notify("shutdown", {});
    this.notify("exit", {});
    try {
      this.ws?.close();
    } catch {
      /* */
    }
    this.ws = null;
  }
}

// ── Manager: one client per root, Monaco providers, marker plumbing ──

type MonacoLike = {
  editor: {
    setModelMarkers: (
      model: unknown,
      owner: string,
      markers: {
        message: string;
        severity: number;
        startLineNumber: number;
        startColumn: number;
        endLineNumber: number;
        endColumn: number;
      }[],
    ) => void;
  };
  languages: {
    registerHoverProvider: (language: string, provider: unknown) => void;
    registerDefinitionProvider: (language: string, provider: unknown) => void;
  };
};

type MonacoModel = {
  getValue: () => string;
  uri: { toString: () => string };
};

let client: PythonLspClient | null = null;
let clientRoot = "";
let providersRegistered = false;
/** The .py file currently on screen: markers + hover/def target. */
let activePath: string | null = null;
let activeModel: MonacoModel | null = null;
let monacoRef: MonacoLike | null = null;
/** Pending definition jump — wired by EditorHost to the tab-open flow. */
let definitionJump: ((path: string, line: number, character: number) => void) | null = null;
const changeTimers = new Map<string, number>();

function applyMarkers(path: string): void {
  if (!client || !monacoRef || !activeModel || activePath !== path) return;
  const diagnostics = client.diagnosticsFor(path);
  const markers = diagnostics.map((diagnostic) => ({
    message: `${diagnostic.source ? `${diagnostic.source}: ` : ""}${diagnostic.message}`,
    severity: diagnostic.severity === 1 ? 8 : diagnostic.severity === 2 ? 4 : 2,
    startLineNumber: diagnostic.range.start.line + 1,
    startColumn: diagnostic.range.start.character + 1,
    endLineNumber: diagnostic.range.end.line + 1,
    endColumn: diagnostic.range.end.character + 1,
  }));
  monacoRef.editor.setModelMarkers(activeModel as never, "pyright", markers as never);
}

function toMonacoPosition(lspLine: number, lspCharacter: number): {
  lineNumber: number;
  column: number;
} {
  return { lineNumber: lspLine + 1, column: lspCharacter + 1 };
}

function registerProviders(): void {
  if (providersRegistered || !monacoRef) return;
  providersRegistered = true;
  monacoRef.languages.registerHoverProvider("python", {
    async provideHover(model: MonacoModel, position: { lineNumber: number; column: number }) {
      if (!client || !activePath) return null;
      try {
        const hover = await client.hover(
          activePath,
          position.lineNumber - 1,
          position.column - 1,
        );
        if (!hover?.contents) return null;
        return {
          contents: [{ value: hover.contents }],
          range: {
            startLineNumber: position.lineNumber,
            startColumn: position.column,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          },
        };
      } catch {
        return null;
      }
    },
  });
  monacoRef.languages.registerDefinitionProvider("python", {
    async provideDefinition(model: MonacoModel, position: { lineNumber: number; column: number }) {
      if (!client || !activePath) return null;
      try {
        const locations = await client.definition(
          activePath,
          position.lineNumber - 1,
          position.column - 1,
        );
        if (locations.length === 0) return null;
        const first = locations[0];
        const position_ = toMonacoPosition(first.range.start.line, first.range.start.character);
        // Same-file definitions jump in-editor; cross-file ones hand the
        // tab-open flow (EditorHost wires definitionJump) and return null
        // so Monaco doesn't try to resolve a foreign uri itself.
        if (first.path === activePath) {
          const jump = toMonacoPosition(first.range.start.line, first.range.start.character);
          setTimeout(() => jumpActiveForDefinition(first.path, jump.lineNumber, jump.column), 0);
        } else {
          setTimeout(
            () => definitionJump?.(first.path, position_.lineNumber, position_.column),
            0,
          );
        }
        return null;
      } catch {
        return null;
      }
    },
  });
}

let jumpActiveForDefinition: (path: string, line: number, column: number) => void = () => {};

/** Wire the cross-file definition jump (the workbench's open-tab flow). */
export function setLspDefinitionJump(
  jump: (path: string, line: number, column: number) => void,
): void {
  definitionJump = jump;
}

/** Ensure a client exists for this root and remember the active model. */
export async function attachPythonFile(
  monaco: MonacoLike,
  model: MonacoModel,
  root: string,
  path: string,
): Promise<void> {
  monacoRef = monaco;
  activeModel = model;
  activePath = path;
  registerProviders();
  if (!client || clientRoot !== root) {
    client?.dispose();
    client = new PythonLspClient(root);
    clientRoot = root;
    client.onDiagnostics = (diagnosticsPath) => applyMarkers(diagnosticsPath);
  }
  try {
    await client.openFile(path, model.getValue());
    applyMarkers(path);
  } catch {
    /* offline runner → no markers; the Problems view explains */
  }
}

/** Push the current text (debounced) — called from the editor's change
 *  flow for .py files. */
export function pythonDidChange(path: string, text: string): void {
  if (!client) return;
  const existing = changeTimers.get(path);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    changeTimers.delete(path);
    client?.changeFile(path, text);
  }, 400) as unknown as number;
  changeTimers.set(path, timer);
}
