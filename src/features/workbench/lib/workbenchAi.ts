// The Workspace editor's embedded AI engine (the "Claude extension"
// layer). A compact tool loop over the /api/ai/chat proxy:
//
//   user prompt → model turn (text and/or tool_use blocks) → tools
//   execute through the runner → results become the next turn's text →
//   repeat (bounded) → final text answer.
//
// DESIGN RULES:
//   • File WRITE/EDIT tools never touch disk — they create PROPOSALS
//     (full proposed content) that the editor renders as diffs for the
//     user to Accept or Reject. The model is told this and reports
//     "proposed", never "modified".
//   • History is a TEXT ledger ({role, content:string} entries — the
//     proxy's contract): each tool call and its result are summarized
//     into the ledger, same pattern the global chat uses.
//   • Every tool failure returns a readable message so the model can
//     self-correct on the next turn.

import { localFolder, type FolderNode } from "../../../lib/workspace/localFolder";
import { runnerUrl } from "../../../lib/runner/client";

export type WorkbenchAiToolDef = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type WorkbenchAiDeps = {
  /** Absolute workspace root. */
  root: string;
  /** Load + return the CURRENT content of a workspace file. */
  readCurrent: (path: string) => Promise<string>;
  /** Queue an AI-proposed file change (diff review, not a disk write). */
  proposeEdit: (path: string, content: string, summary: string) => void;
  /** Blocking exec at the workspace root (output mirrored to the panel). */
  exec: (command: string) => Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    truncated: boolean;
  }>;
  /** Open a file in the editor (AI can point the user at it). */
  openFile: (path: string) => Promise<void>;
  /** Persist one durable fact to project memory. */
  saveMemory: (text: string) => void;
};

const FILE_CAP = 24_000;
const RESULT_CAP = 6_000;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n… (truncated)` : text;
}

export const WORKBENCH_TOOLS: WorkbenchAiToolDef[] = [
  {
    name: "workspace_list_files",
    description: "List the workspace tree (files and folders, 3 levels deep).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "workspace_read_file",
    description: "Read one text file from the workspace.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "Workspace-relative path" } },
      required: ["path"],
    },
  },
  {
    name: "workspace_write_file",
    description:
      "Propose the FULL new content of a file. This is a PROPOSAL — the user reviews it as a diff and accepts or rejects. Never claim the file was modified; say you proposed the change.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative path" },
        content: { type: "string", description: "Complete new file content" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "workspace_edit_file",
    description:
      "Propose a targeted edit: replace oldStr with newStr in an existing file (read it first!). PROPOSAL — the user reviews the diff. Include enough surrounding context in oldStr to be unambiguous.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        oldStr: { type: "string" },
        newStr: { type: "string" },
        replaceAll: { type: "boolean" },
      },
      required: ["path", "oldStr", "newStr"],
    },
  },
  {
    name: "workspace_create_folder",
    description: "Create a folder (parents created automatically).",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "workspace_delete_path",
    description: "Permanently delete a file or folder. Requires the user's explicit request — never call on a guess.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "workspace_rename_path",
    description: "Rename or move a file/folder.",
    input_schema: {
      type: "object",
      properties: { oldPath: { type: "string" }, newPath: { type: "string" } },
      required: ["oldPath", "newPath"],
    },
  },
  {
    name: "workspace_search",
    description: "Search text across the workspace (case-insensitive).",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "workspace_exec_command",
    description:
      "Run a shell command at the workspace root (builds, tests, git — 5 min cap). Long-lived dev servers are REFUSED. Output also appears in the user's Output panel.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeoutMs: { type: "number" },
      },
      required: ["command"],
    },
  },
  {
    name: "workspace_dev_server",
    description:
      "Start or stop the project's long-lived dev server (the exec tool refuses those). action=start spawns the command (default npm run dev) DETACHED on the given port, waits for HTTP readiness and returns the URL. action=stop kills it.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["start", "stop"] },
        command: { type: "string", description: "npm script command for start (default npm run dev)" },
        port: { type: "number", description: "Port for start (default 5174)" },
      },
    },
  },
  {
    name: "browser",
    description:
      "Run an official Playwright browser tool. EXACT argument shapes (schema-verified): browser_navigate {url}, browser_snapshot {} (returns yaml with [ref=eN] ids), browser_click {element: string, target: string} where target is the [ref=eN] id from the snapshot, browser_type {element: string, target: string, text: string, slowly?: boolean} — type REQUIRES target (NOT ref) and fails if the field is non-empty (clear it first with browser_press or fill via JavaScript) — browser_fill_form {fields: [{name, type, value}]}, browser_console_messages {}. Workflow: navigate → snapshot (get eN refs) → click/type with those refs.",
    input_schema: {
      type: "object",
      properties: {
        tool: { type: "string", description: "Official Playwright MCP tool name" },
        arguments: { type: "object", description: "Tool arguments matching the shapes above EXACTLY" },
      },
      required: ["tool", "arguments"],
    },
  },
  {
    name: "workspace_git_status",
    description: "git status of the workspace (branch, changed files).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "memory_save",
    description:
      "Save ONE durable fact to persistent project memory (survives across sessions). Use when the user says 'remember …' / 'মনে রাখো …', or when you learn a stable project convention or user preference worth carrying forward. One fact per call, one sentence. Do NOT save transient task state.",
    input_schema: {
      type: "object",
      properties: { text: { type: "string", description: "The fact, one sentence" } },
      required: ["text"],
    },
  },
];

/** Browser tools discovered live from the runner's Playwright catalog —
 *  fetched lazily, cached per session. Empty when the runner is offline. */
let browserCatalog: WorkbenchAiToolDef[] | null = null;
async function getBrowserTools(): Promise<WorkbenchAiToolDef[]> {
  if (browserCatalog) return browserCatalog;
  try {
    const res = await fetch(`${runnerUrl()}/playwright/tools`, { signal: AbortSignal.timeout(30_000) });
    const data = (await res.json()) as { tools?: { name: string; description?: string; inputSchema?: Record<string, unknown> }[] };
    browserCatalog = (data.tools ?? []).map((t) => ({
      name: `pw_${t.name}`,
      description: t.description ?? t.name,
      input_schema: t.inputSchema ?? { type: "object", properties: {} },
    }));
  } catch {
    browserCatalog = [];
  }
  return browserCatalog;
}

const SYSTEM_PROMPT = `You are the Workspace AI inside the Lattice code editor — an expert software engineer working directly in the user's open project folder.

LANGUAGE: The user usually writes in romanized Bengali ("Banglish", e.g. "agula koro", "dekho ki hoyeche", "file ta fix koro") mixed with English, sometimes in proper Bengali script. ALWAYS treat that as intentional and understand it — never ask to repeat, never switch the task to English "because it's easier". Reply in the user's language: Banglish/Bengali input → reply in proper Bengali script (বাংলা লিপি), NEVER romanized Bengali; English input → reply in English. Code, file paths, commands, commit messages and technical terms always stay in English.

Rules:
- Use the tools to do real work (read files, search, run builds/tests, git). Read before editing.
- workspace_write_file / workspace_edit_file create PROPOSALS: the user reviews each as a diff and accepts or rejects. NEVER say a file "was modified" — say "I proposed this change; review the diff".
- Full-file writes need the ENTIRE new content. Targeted edits: include enough of oldStr to be unambiguous.
- Long-lived dev servers (npm run dev) are refused by exec — use the workspace_dev_server tool to start/stop them (it waits for readiness and returns the URL).
- Keep answers concise and concrete. Reference files by path and lines when useful.
- FORMAT FOR READABILITY: structure every non-trivial answer — short intro line, then "##" sections, bullet lists for enumerations, fenced code blocks WITH a language tag for code, and inline code spans for paths/commands. Keep paragraphs to 1–3 sentences. Never dump long prose or raw logs without a code fence.
- NEVER repeat a tool call you already made — act on the results you already have and push FORWARD to completion. A task ends with a final report, not with re-reading the same files.
- THINK FIRST: before your first tool call, output a short numbered plan (2-5 steps). Adapt the plan as you learn. Before declaring success, VERIFY the result (read the file back / take a browser snapshot) — never report success unverified.
- Finish what you start: keep executing your plan across turns until every step is done and verified, then give one final pass/fail summary.

SCAFFOLDING KNOWLEDGE — when the user asks to build an app with a stated stack, do NOT ask clarifying questions about structure or files. You KNOW the standard scaffolding for the common stacks; propose the complete file set immediately:

- React + Vite (JS or TS as requested): package.json (react, react-dom, vite, @vitejs/plugin-react; scripts dev/build/preview), vite.config.js (plugin), index.html (root div + /src/main.jsx), src/main.jsx (createRoot), src/App.jsx, src/index.css. Run order: npm install → npm run dev.
- Next.js (app router): package.json (next, react, react-dom), next.config.js, app/layout.jsx, app/page.jsx. Run: npm install → npm run dev.
- Node + Express API: package.json (express; scripts start/dev with node --watch), server.js/index.js, routes as needed. Run: npm install → npm start.
- Static HTML/JS/CSS site: index.html + styles.css + script.js — no install needed; serve with the dev server tool or open directly.
- Python script/tool: plain .py files. Note: python may be a Windows Store alias — prefer "py" if "python" fails.

General building rules:
- Propose EVERY file in ONE go (multiple workspace_write_file calls in the same turn) — never one file per turn, never ask the user what the structure should be.
- Include everything needed for "npm install && npm run dev" to work.
- Prefer framework-idiomatic file layouts so the result looks hand-professional.
- After the user accepts the files, offer the natural next step: install dependencies, start the dev server, and verify in the browser.`;

export type WorkbenchAiGateway = {
  provider?: string;
  url?: string;
  model?: string;
  token?: string;
};

export type WorkbenchAiTurnResult = {
  /** Final assistant text (or the error text). */
  text: string;
  /** Ledger entries to merge into the panel's history. */
  history: { role: "user" | "assistant"; content: string }[];
  /** Number of tool calls executed. */
  toolCalls: number;
  /** The model's interim plan/thinking text per tool turn. */
  thoughts: string[];
};

/** Execute one tool call against the workspace. Returns the ledger text
 *  for the tool result. */
async function executeTool(
  name: string,
  input: Record<string, unknown>,
  deps: WorkbenchAiDeps,
): Promise<string> {
  const str = (key: string): string =>
    typeof input[key] === "string" ? (input[key] as string) : "";
  // Playwright browser tools (pw_ prefix) → the runner's MCP bridge.
  if (name.startsWith("pw_")) {
    const result = await localFolder.playwrightCall(name.slice(3), input);
    return clip(result.result, RESULT_CAP);
  }
  try {
    switch (name) {
      case "workspace_list_files": {
        const { tree } = await localFolder.listTree({ root: deps.root, maxDepth: 3 });
        const lines: string[] = [];
        const walk = (nodes: { name: string; kind: string; children?: { name: string; kind: string; children?: unknown }[] }[], depth: number) => {
          for (const node of nodes) {
            lines.push(`${"  ".repeat(depth)}${node.kind === "dir" ? "▸ " : "  "}${node.name}`);
            if (node.kind === "dir" && Array.isArray(node.children) && lines.length < 150) {
              walk(node.children as never, depth + 1);
            }
          }
        };
        walk(tree as never, 0);
        return clip(lines.join("\n") || "(empty workspace)", RESULT_CAP);
      }
      case "workspace_read_file": {
        const path = str("path");
        if (!path) return "Error: missing path.";
        const content = await deps.readCurrent(path);
        return content === null
          ? `Error: "${path}" does not exist.`
          : clip(`Content of ${path}:\n${content}`, FILE_CAP);
      }
      case "workspace_write_file": {
        const path = str("path");
        const content = typeof input.content === "string" ? input.content : "";
        if (!path || !content.trim()) return "Error: path and non-empty content are required.";
        deps.proposeEdit(path, content, `Write ${path}`);
        return `PROPOSED full rewrite of ${path} (${content.length} chars). The user will review the diff and accept or reject — do NOT assume it was applied.`;
      }
      case "workspace_edit_file": {
        const path = str("path");
        const oldStr = str("oldStr");
        const newStr = str("newStr");
        if (!path || !oldStr) return "Error: path and oldStr are required.";
        const current = await deps.readCurrent(path);
        if (current === null) return `Error: "${path}" does not exist.`;
        const occurrences = current.split(oldStr).length - 1;
        if (occurrences === 0) return "Error: oldStr not found in the file — re-read it and match exactly.";
        if (occurrences > 1 && input.replaceAll !== true) {
          return `Error: oldStr matches ${occurrences} places — include more context or set replaceAll.`;
        }
        const nextContent =
          occurrences > 1
            ? current.split(oldStr).join(newStr)
            : current.replace(oldStr, newStr);
        deps.proposeEdit(path, nextContent, `Edit ${path}`);
        return `PROPOSED targeted edit of ${path} (${occurrences} replacement${occurrences === 1 ? "" : "s"}). The user reviews the diff — do NOT assume it was applied.`;
      }
      case "workspace_create_folder": {
        const path = str("path");
        if (!path) return "Error: missing path.";
        await localFolder.mkdirUserPath({ root: deps.root, path });
        return `Created folder ${path}.`;
      }
      case "workspace_delete_path": {
        const path = str("path");
        if (!path) return "Error: missing path.";
        await localFolder.deleteUserPath({ root: deps.root, path });
        return `Deleted ${path}.`;
      }
      case "workspace_rename_path": {
        const oldPath = str("oldPath");
        const newPath = str("newPath");
        if (!oldPath || !newPath) return "Error: oldPath and newPath are required.";
        await localFolder.renameUserPath({ root: deps.root, oldPath, newPath });
        return `Renamed ${oldPath} → ${newPath}.`;
      }
      case "workspace_search": {
        const query = str("query");
        if (!query) return "Error: missing query.";
        const res = await localFolder.search({ root: deps.root, query });
        if (res.results.length === 0) return "No matches.";
        const lines = res.results
          .slice(0, 30)
          .flatMap((group) =>
            group.lines.slice(0, 6).map((l) => `${group.path}:${l.number}: ${l.text.trim()}`),
          );
        return clip(`${res.results.length} file(s) matched:\n${lines.join("\n")}`, RESULT_CAP);
      }
      case "workspace_exec_command": {
        const command = str("command");
        if (!command) return "Error: missing command.";
        const result = await deps.exec(command);
        const tail = [result.stdout, result.stderr].filter(Boolean).join("\n");
        return clip(
          `Exit ${result.code ?? "?"}${result.timedOut ? " (TIMED OUT)" : ""}:\n${tail || "(no output)"}`,
          RESULT_CAP,
        );
      }
      case "workspace_dev_server": {
        const action = str("action") || "start";
        const port = Number(input.port) || 5174;
        if (action === "stop") {
          const r = await localFolder.devServerStop(port);
          return r.stopped ? `Stopped the dev server on port ${port}.` : `Nothing was running on port ${port}.`;
        }
        const command = str("command") || "npm run dev";
        const r = await localFolder.devServerStart({ root: deps.root, command, port });
        return `Dev server ${r.reused ? "already running" : "started and ready"} — ${r.url}. Verify it with the browser tool (browser_navigate).`;
      }
      case "browser": {
        const tool = str("tool");
        if (!tool) return "Error: missing tool name.";
        const args = (input.arguments ?? {}) as Record<string, unknown>;
        const r = await localFolder.playwrightCall(tool, args);
        return clip(r.result, RESULT_CAP);
      }
      case "workspace_git_status": {
        const res = await localFolder.runGit({ root: deps.root, op: "status" });
        return clip(
          res.code === 0
            ? `git status:\n${res.stdout}`
            : `Not a git repo (${(res.stderr || res.stdout).trim().slice(0, 120)})`,
          RESULT_CAP,
        );
      }
      case "memory_save": {
        const text = str("text");
        if (!text.trim()) return "Error: missing text.";
        deps.saveMemory(text);
        return "Saved to project memory. It will be available in every future session — do not re-save it.";
      }
      default:
        return `Error: unknown tool "${name}".`;
    }
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export type WorkbenchAiContext = {
  path: string | null;
  cursorLine: number;
  selection: string;
};

/** Caller signal + wall-clock cap combined — the panel's Stop button and
 *  the per-call timeout abort the same fetch. Falls back to manual wiring
 *  on runtimes without AbortSignal.any. */
function abortWithTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  const anySignal = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof anySignal === "function") return anySignal([signal, timeout]);
  const combined = new AbortController();
  const abortCombined = (): void => combined.abort();
  if (signal.aborted) abortCombined();
  else signal.addEventListener("abort", abortCombined, { once: true });
  timeout.addEventListener("abort", abortCombined, { once: true });
  return combined.signal;
}

/** Streaming model call: POSTs with stream:true, parses the Anthropic
 *  SSE event stream (text deltas fire onDelta live; tool_use blocks
 *  accumulate from input_json_delta) and returns the standard content
 *  array. Throws with a readable message on transport/gateway errors. */
async function streamAnthropicResponse(
  route: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  onTextDelta?: (delta: string) => void,
  signal?: AbortSignal,
): Promise<{
  content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
}> {
  const response = await fetch(route, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: abortWithTimeout(signal, 600_000),
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    let message = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string };
      message = parsed.error?.message ?? parsed.message ?? message;
    } catch {
      /* keep raw text */
    }
    if (response.status === 503) {
      throw new Error("AI gateway is not configured — open Settings and fill in the AI form (URL, model, token).");
    }
    throw new Error(message || `AI request failed (${response.status})`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }> = [];
  const toolPartials = new Map<number, { id: string; name: string; json: string }>();
  // Streamed tool inputs arrive as raw JSON fragments. Parsing happens
  // ONCE at the end — per-fragment parse attempts of a half-built JSON
  // always fail, and (the old bug) merging fragments into the previous
  // PARSED object produced "[object Object]{…}", so every streaming
  // tool call silently executed with input {}.
  const finalizeToolInputs = (): void => {
    for (const partial of toolPartials.values()) {
      const block = content.find((b) => b.type === "tool_use" && b.id === partial.id);
      if (block) block.input = parseJsonObject(partial.json);
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline === -1) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith("data:")) continue;
      const dataStr = line.slice(5).trim();
      if (!dataStr) continue;
      let ev: {
        type?: string;
        index?: number;
        content_block?: { type?: string; id?: string; name?: string };
        delta?: { type?: string; text?: string; partial_json?: string };
        error?: { message?: string };
      };
      try {
        ev = JSON.parse(dataStr);
      } catch {
        continue;
      }
      if (ev.type === "error") {
        throw new Error(ev.error?.message ?? "stream error");
      }
      if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use") {
        const index = ev.index ?? content.length;
        toolPartials.set(index, { id: ev.content_block.id ?? "", name: ev.content_block.name ?? "", json: "" });
        content.push({ type: "tool_use", id: ev.content_block.id ?? "", name: ev.content_block.name ?? "", input: {} });
        continue;
      }
      if (ev.type === "content_block_delta") {
        if (ev.delta?.type === "text_delta" && ev.delta.text) {
          const textBlock = content.find((b) => b.type === "text");
          if (textBlock) textBlock.text = (textBlock.text ?? "") + ev.delta.text;
          else content.push({ type: "text", text: ev.delta.text });
          onTextDelta?.(ev.delta.text);
        } else if (ev.delta?.type === "input_json_delta") {
          // Dispatch by STREAM index via toolPartials. NEVER look up
          // `content[ev.index]` here: stream indexes count every block
          // (thinking, text, …) while `content` only holds the blocks we
          // push, so positions drift apart — that mismatch silently
          // dropped every fragment and all tool inputs arrived as {}.
          const partial = toolPartials.get(ev.index ?? -1);
          if (partial) partial.json += ev.delta.partial_json ?? "";
        }
      }
      if (ev.type === "message_stop") {
        finalizeToolInputs();
        return { content };
      }
    }
  }
  finalizeToolInputs();
  return { content };
}

/** Parse a COMPLETE streamed tool-input JSON string (never a fragment). */
function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // Truncated / invalid tool JSON → empty input; the tool returns a
    // readable "missing X" error the model can self-correct on.
    return {};
  }
}

/** Human-readable activity line for one tool call — WHAT is being done
 *  and on WHAT, with the real arguments. Raw identifiers
 *  ("workspace_read_file") mean nothing to the user; "Reading
 *  src/App.jsx" does. */
function describeToolCall(name: string, input: Record<string, unknown>): string {
  const str = (key: string): string =>
    typeof input[key] === "string" ? (input[key] as string) : "";
  switch (name) {
    case "workspace_list_files":
      return "Browsing the workspace tree";
    case "workspace_read_file":
      return `Reading ${str("path") || "a file"}`;
    case "workspace_write_file":
      return `Writing ${str("path") || "a file"}`;
    case "workspace_edit_file":
      return `Editing ${str("path") || "a file"}`;
    case "workspace_create_folder":
      return `Creating folder ${str("path")}`;
    case "workspace_delete_path":
      return `Deleting ${str("path")}`;
    case "workspace_rename_path":
      return `Renaming ${str("oldPath")} → ${str("newPath")}`;
    case "workspace_search":
      return `Searching "${str("query")}"`;
    case "workspace_exec_command":
      return `Running "${str("command") || "command"}"`;
    case "workspace_dev_server":
      return str("action") === "stop"
        ? "Stopping the dev server"
        : "Starting the dev server";
    case "workspace_git_status":
      return "Checking git status";
    case "browser":
      return `Browser — ${str("tool") || "tool"}`;
    default:
      // Playwright MCP tools ride in as pw_browser_navigate etc.
      if (name.startsWith("pw_")) {
        return `Browser — ${name.slice(3).replace(/_/g, " ")}`;
      }
      return name.replace(/_/g, " ");
  }
}

/** One full AI exchange: prompt → (tool loop) → final text. Returns the
 *  answer plus ledger entries the panel merges into its history. */
export async function runWorkbenchAiTurn({
  prompt,
  history,
  context,
  deps,
  gateway,
  onActivity,
  onPhase,
  streaming,
  onTextDelta,
  signal,
  memory,
  planOnly = false,
  maxTurns = 24,
}: {
  prompt: string;
  history: { role: "user" | "assistant"; content: string }[];
  context: WorkbenchAiContext;
  deps: WorkbenchAiDeps;
  /** The user's saved Settings AI config — attached as gateway headers
   *  (the proxy 503s "ai_not_configured" without them). */
  gateway?: WorkbenchAiGateway;
  /** Live activity line per tool call — the panel renders it while the
   *  loop runs. */
  onActivity?: (line: string) => void;
  /** "thinking" while a model call is in flight, "idle" after. */
  onPhase?: (phase: "thinking" | "idle") => void;
  /** Live text deltas while the model streams its answer. */
  onTextDelta?: (delta: string) => void;
  /** True → ask the gateway for SSE streaming. */
  streaming?: boolean;
  /** Abort the whole loop (the panel's Stop button). */
  signal?: AbortSignal;
  /** Persistent project memory — injected into the system prompt. */
  memory?: string[];
  /** PLAN MODE: send NO tools and demand a plan-only answer. The model
   *  then CANNOT call tools (none exist on the wire) — the plan it
   *  returns is mechanically guaranteed to be tool-free, no prompt
   *  wishful thinking involved. */
  planOnly?: boolean;
  maxTurns?: number;
}): Promise<WorkbenchAiTurnResult> {
  const ledger = [...history];
  let contextHeader = "";
  if (context.path) {
    contextHeader += `Active file: ${context.path}`;
    if (context.cursorLine > 0) contextHeader += `, cursor at line ${context.cursorLine}`;
    contextHeader += "\n";
  }
  if (context.selection) {
    contextHeader += `Selected text:\n${clip(context.selection, 4_000)}\n`;
  }

  let toolCalls = 0;
  const thoughts: string[] = [];
  let lastText = "";
  const newLedger: { role: "user" | "assistant"; content: string }[] = [];
  // Every produced entry goes into BOTH arrays: `ledger` is what the
  // NEXT turn's request sends as history (without it the model saw a
  // clean slate every continuation turn — the observed infinite
  // greet→list_files→read_file loop), `newLedger` is what the panel
  // keeps for the following user prompt.
  const record = (entry: { role: "user" | "assistant"; content: string }): void => {
    ledger.push(entry);
    newLedger.push(entry);
  };

  for (let turn = 0; turn < maxTurns; turn += 1) {
    // Stop button pressed between turns — end the loop immediately with
    // the panel's standard "Stopped." text instead of firing another
    // model call.
    if (signal?.aborted) {
      onPhase?.("idle");
      return { text: "Stopped.", history: newLedger, toolCalls, thoughts };
    }
    const turnText =
      turn === 0
        ? `${contextHeader}${contextHeader ? "---\n\n" : ""}${prompt}`
        : "Act on the tool results above to advance the task. Call the next tools you need — or, if the task is fully complete and verified, reply with ONLY the final summary and no tool call. The summary is shown to the USER: write it as natural speech in the user's language, and never echo bookkeeping notation (\"[tool results]\", \"[workspace_read_file] …\", \"(tool call turn)\") from the transcript.";
    // The ORIGINAL prompt enters the ledger on the first turn — without
    // this, turn 2+ sees only "[tool results]" and the model loses the
    // task entirely (observed live: it asked "what should I build?" on a
    // full app-spec prompt).
    if (turn === 0) ledger.push({ role: "user", content: turnText });
    onPhase?.("thinking");
    const systemPrompt = [
      SYSTEM_PROMPT,
      // Project memory — durable facts this session must respect.
      memory && memory.length > 0
        ? `PROJECT MEMORY — durable facts about this project and the user. Obey them; never contradict them without asking:\n${memory.join("\n")}`
        : "",
      planOnly
        ? "PLAN MODE: The user wants a PLAN before any work happens. Reply with ONLY a numbered step-by-step plan (files to touch, commands to run, how you will VERIFY each step). Do NOT start executing. Keep it tight — max ~10 steps."
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const requestBody = {
      text: turnText,
      system: systemPrompt,
      // Plan mode sends NO tool array at all — the model physically
      // cannot emit a tool_use block against a tool-less request.
      ...(planOnly ? {} : { tools: [...WORKBENCH_TOOLS, ...(await getBrowserTools())] }),
      // `ledger` carries the prompt + every prior turn's tool results —
      // the model continues WITH its context, never from scratch.
      history: ledger,
      ...(streaming ? { stream: true } : {}),
    };
    const requestHeaders = {
      "content-type": "application/json",
      // The Settings-saved gateway config rides as headers — without
      // these the proxy 503s with ai_not_configured.
      ...(gateway?.provider ? { "x-ai-chat-provider": gateway.provider } : {}),
      ...(gateway?.url ? { "x-ai-gateway-url": gateway.url } : {}),
      ...(gateway?.model ? { "x-ai-gateway-model": gateway.model } : {}),
      ...(gateway?.token ? { "x-ai-gateway-token": gateway.token } : {}),
    };
    // SSE mode: the proxy pipes the gateway's event stream through and
    // the client parses Anthropic SSE events (text deltas fire live).
    let payload: {
      content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
    };
    try {
      payload = streaming
        ? await streamAnthropicResponse(
            "/api/ai/chat",
            requestHeaders,
            { ...requestBody, stream: true },
            onTextDelta,
            signal,
          )
        : await (async () => {
            const response = await fetch("/api/ai/chat", {
              method: "POST",
              signal: abortWithTimeout(signal, 180_000),
              headers: requestHeaders,
              body: JSON.stringify(requestBody),
            });
            if (!response.ok) {
              const err = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
              const message = err.message ?? err.error ?? `AI request failed (${response.status})`;
              if (response.status === 503) {
                throw new Error("AI gateway is not configured — open Settings and fill in the AI form (URL, model, token).");
              }
              throw new Error(message);
            }
            return (await response.json()) as {
              content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
            };
          })();
    } catch (error) {
      // Stop pressed mid-fetch → the panel's standard text, not an error.
      if (signal?.aborted) {
        onPhase?.("idle");
        return { text: "Stopped.", history: newLedger, toolCalls, thoughts };
      }
      const message = error instanceof Error ? error.message : String(error);
      return { text: message, history: newLedger, toolCalls, thoughts };
    }
    const content = payload.content ?? [];
    const textBlocks = content.filter((c) => c.type === "text").map((c) => c.text ?? "");
    const toolUses = content.filter(
      (c): c is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } =>
        c.type === "tool_use" && typeof c.id === "string" && typeof c.name === "string",
    );
    lastText = textBlocks.join("\n").trim();

    if (toolUses.length === 0) {
      // Pure text turn — the conversation is done.
      return { text: lastText || "(no response)", history: newLedger, toolCalls, thoughts };
    }
    if (lastText) thoughts.push(lastText);

    // Ledger: what the assistant did + what came back. The assistant
    // entry carries ONLY the model's own narration — NO tool-call
    // bookkeeping suffix. Small models copy whatever notation they see
    // in their own past entries, so a "(called tools: …)" marker here
    // came straight back out as the "final answer"; the tool names are
    // already visible in the result lines below, nothing is lost.
    record({
      role: "assistant",
      content: clip(lastText || "(tool call turn)", 2_000),
    });
    const results: string[] = [];
    for (const tool of toolUses) {
      toolCalls += 1;
      onActivity?.(describeToolCall(tool.name, tool.input ?? {}));
      const outcome = await executeTool(tool.name, tool.input ?? {}, deps);
      results.push(`[${tool.name}] ${outcome}`);
    }
    const resultsText = clip(results.join("\n\n"), 2_000);
    record({ role: "user", content: `[tool results]\n${resultsText}` });
  }

  onPhase?.("idle");
  return {
    text: `${lastText}\n\n(Stopped after ${maxTurns} tool turns — continue with a follow-up prompt if more is needed.)`.trim(),
    history: newLedger,
    toolCalls,
    thoughts,
  };
}
