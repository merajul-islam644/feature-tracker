// The embedded AI panel (Copilot-chat style) — a workbench sidebar view
// wired to the OPEN workspace: editor-aware prompts (active file +
// selection), tools that act through the runner, and file edits that
// land as diff proposals instead of raw disk writes.
//
// STREAMING: real SSE token streaming — the proxy relays the gateway's
// event stream, and every text delta renders into the open bubble as it
// arrives (one bubble per model turn; no replay/typewriter pass).
//
// SESSIONS: every conversation persists per project (localStorage) —
// reload-safe, switchable, deletable. The panel restores the most
// recent session on mount, exactly like real AI chat panels.
//
// MEMORY: durable per-project facts (aiMemory.ts) injected into the
// system prompt every turn; the AI saves new ones via the memory_save
// tool or the user via /remember, and both can browse/delete in the
// Memory menu section.
//
// SKILLS: user-authored prompt packages (aiSkills.ts) — click to run,
// authored inline in the Skills menu section, alongside built-ins.
//
// PLAN MODE: tasks first produce a tool-less plan (guaranteed: no tool
// array is sent) shown with an Execute/Discard gate — real work starts
// only after an explicit user approval.
//
// UX: lightweight markdown rendering (fenced code blocks + inline code
// + bold), copy buttons on answers, live tool-activity lines, a
// three-dot menu (sessions / skills / memory / context toggle / export
// / settings / clear) and a proposal counter.

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bot,
  BrainCircuit,
  ChevronLeft,
  ClipboardList,
  Copy,
  Square,
  Download,
  Eraser,
  FilePlus2,
  History,
  MessageSquarePlus,
  MoreHorizontal,
  Paperclip,
  Play,
  Plus,
  Send,
  Settings,
  Sparkles,
  Trash2,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { useUserAiConfig } from "@/lib/blocks/hooks";
import { localFolder } from "../../../lib/workspace/localFolder";
import { getSelectionText } from "../lib/editorActions";
import { runWorkbenchAiTurn, type WorkbenchAiContext, type WorkbenchAiTurnResult } from "../lib/workbenchAi";
import { addMemory, loadMemory, memoryPromptBlock, removeMemory, type AiMemoryEntry } from "../lib/aiMemory";
import { addSkill, loadSkills, removeSkill, type AiSkill } from "../lib/aiSkills";
import { loadPlanState, savePlanState } from "../lib/aiPlanStore";
import type { AiProposal } from "../state/workbenchStore";
import {
  deleteSession,
  loadSessions,
  newSessionId,
  titleFromPrompt,
  upsertSession,
  type AiHistoryEntry,
  type AiSession,
  type ChatEntry,
} from "../lib/aiSessions";

const WELCOME =
  "I can read, search, edit (as reviewable diffs), run builds/tests and use git in your open folder. What should we work on?";

/** Preset "skills" — one-click prompts that exercise the AI's tools. */
const SKILLS: { label: string; prompt: string }[] = [
  { label: "Summarize this project", prompt: "Summarize this project — what it is, its stack and structure." },
  { label: "Run the typecheck", prompt: "Run the typecheck and summarize any errors with file locations." },
  { label: "Review my changes", prompt: "Review my uncommitted changes (git status + diff) and point out problems." },
  { label: "Explain the codebase structure", prompt: "Explain the codebase structure — main folders and how they fit together." },
  { label: "Find TODOs", prompt: "Find all TODO/FIXME comments in the workspace and list them." },
  { label: "Write a README intro", prompt: "Propose a short README intro paragraph for this project." },
];

function copyText(text: string): void {
  void navigator.clipboard?.writeText(text).catch(() => undefined);
}

/** Dependency-free rich rendering, block-aware: fenced code boxes
 *  (language label + copy button), markdown headings, bullet / numbered
 *  lists, `inline code`, **bold** and [links](url). Plain lines group
 *  into paragraphs. Built for narrow sidebars — compact margins. */
function renderRich(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let key = 0;
  const segments = text.split("```");
  segments.forEach((segment, segmentIndex) => {
    if (segmentIndex % 2 === 1) {
      // Fenced code — the first line may carry a language tag.
      const newline = segment.indexOf("\n");
      const lang = newline !== -1 ? segment.slice(0, newline).trim() : "";
      const body = newline !== -1 ? segment.slice(newline + 1) : segment;
      out.push(
        <div className="wb-ai-codebox" key={`code-${key++}`}>
          <div className="wb-ai-codebox-head">
            <span className="wb-ai-codebox-lang">{lang || "code"}</span>
            <button
              className="wb-ai-codebox-copy"
              onClick={() => copyText(body)}
              type="button"
            >
              Copy
            </button>
          </div>
          <pre className="wb-ai-code">
            <code>{body}</code>
          </pre>
        </div>,
      );
      return;
    }
    if (!segment) return;
    const lines = segment.split("\n");
    let paragraph: string[] = [];
    const flushParagraph = (): void => {
      if (paragraph.length === 0) return;
      out.push(
        <p className="wb-ai-msg-text" key={`p-${key++}`}>
          {renderInline(paragraph.join("\n"))}
        </p>,
      );
      paragraph = [];
    };
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const heading = /^(#{1,3})\s+(.*)$/.exec(line);
      const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
      const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
      const tableRow = /^\s*\|(.+)\|\s*$/.exec(line);
      if (heading) {
        flushParagraph();
        out.push(
          <p className={`wb-ai-h wb-ai-h${heading[1].length}`} key={`h-${key++}`}>
            {renderInline(heading[2])}
          </p>,
        );
        i += 1;
      } else if (tableRow) {
        flushParagraph();
        // Markdown table — gather the row run, drop the |---| separator
        // row, first remaining row becomes the header.
        const rows: string[][] = [];
        while (i < lines.length) {
          const row = /^\s*\|(.+)\|\s*$/.exec(lines[i]);
          if (!row) break;
          if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) {
            rows.push(row[1].split("|").map((cell) => cell.trim()));
          }
          i += 1;
        }
        if (rows.length > 0) {
          const [head, ...body] = rows;
          out.push(
            <table className="wb-ai-table" key={`t-${key++}`}>
              <thead>
                <tr>
                  {head.map((cell, cellIndex) => (
                    <th key={cellIndex}>{renderInline(cell)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex}>{renderInline(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>,
          );
        }
      } else if (bullet || numbered) {
        flushParagraph();
        const ordered = Boolean(numbered);
        const itemPattern = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*•]\s+(.*)$/;
        // Group the run of consecutive same-kind items into one list.
        const items: string[] = [];
        while (i < lines.length) {
          const item = itemPattern.exec(lines[i]);
          if (!item) break;
          items.push(item[1]);
          i += 1;
        }
        const ListTag = ordered ? "ol" : "ul";
        out.push(
          <ListTag className="wb-ai-list" key={`l-${key++}`}>
            {items.map((item, itemIndex) => (
              <li key={itemIndex}>{renderInline(item)}</li>
            ))}
          </ListTag>,
        );
      } else if (line.trim() === "") {
        flushParagraph();
        i += 1;
      } else {
        paragraph.push(line);
        i += 1;
      }
    }
    flushParagraph();
  });
  return out;
}

function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  // **bold** · `code` · [label](https://…) — links only ever open
  // http(s) URLs in a new tab.
  const pattern = /(\*\*[^*]+\*\*|`[^`\n]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) out.push(text.slice(lastIndex, match.index));
    const token = match[0];
    if (token.startsWith("**")) {
      out.push(<strong key={`b${key++}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      out.push(<code className="wb-ai-inline-code" key={`c${key++}`}>{token.slice(1, -1)}</code>);
    } else {
      const link = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/.exec(token);
      if (link) {
        out.push(
          <a
            className="wb-ai-link"
            href={link[2]}
            key={`a${key++}`}
            rel="noreferrer noopener"
            target="_blank"
          >
            {link[1]}
          </a>,
        );
      }
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) out.push(text.slice(lastIndex));
  return out;
}

export function AiPanel({ projectId, root, activePath, cursorLine, readCurrent, onProposeEdit, onExec, onOpenFile, onClose, proposals, onAcceptAll, onRejectAll, onReview, reviewing }: {
  /** Project id — sessions persist keyed by it. */
  projectId: string;
  /** Absolute workspace root (null = no folder open). */
  root: string | null;
  /** The file on screen — auto-attached as context. */
  activePath: string | null;
  /** 1-based cursor line on screen. */
  cursorLine: number;
  /** Load + return current content (proposal baselines). */
  readCurrent: (path: string) => Promise<string>;
  onProposeEdit: (path: string, content: string, summary: string) => void;
  /** Blocking exec — output mirrors into the Output panel. */
  onExec: (command: string) => Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    truncated: boolean;
  }>;
  onOpenFile: (path: string) => Promise<void>;
  onClose: () => void;
  /** The AI-proposed file changes awaiting review. */
  proposals: AiProposal[];
  /** Write + save every proposed file. */
  onAcceptAll: () => void;
  /** Discard every proposed file. */
  onRejectAll: () => void;
  /** Open the diff-review surface in the editor. */
  onReview: () => void;
  /** True while the review surface is open (hides the card's CTA). */
  reviewing: boolean;
}) {
  const [entries, setEntries] = useState<ChatEntry[]>([
    { role: "assistant", text: root ? WELCOME : "Open a folder first — then I can read, edit and run things in it." },
  ]);
  const [history, setHistory] = useState<AiHistoryEntry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  /** Polled — the editor's selection changes don't re-render this panel. */
  const [hasSelection, setHasSelection] = useState(false);
  /** Live progress while the AI works — seconds elapsed + current step,
   *  so "working" is visibly different from "stuck". */
  const [elapsed, setElapsed] = useState(0);
  const [currentStep, setCurrentStep] = useState("");
  /** "thinking" while the model call is in flight, "tools" while tools run. */
  const [phase, setPhase] = useState<"thinking" | "tools" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  /** Which menu section is expanded: "sessions" | "skills" | "memory" | null. */
  const [openSection, setOpenSection] = useState<"sessions" | "skills" | "memory" | null>(null);
  /** Saved sessions (localStorage, per project). */
  const [sessions, setSessions] = useState<AiSession[]>([]);
  const [sessionId, setSessionId] = useState<string>(() => newSessionId());
  const [createdAt, setCreatedAt] = useState(() => Date.now());
  /** Persistent project memory — injected into every turn's system prompt. */
  const [memory, setMemory] = useState<AiMemoryEntry[]>([]);
  /** User-authored skills (localStorage, per project). */
  const [skills, setSkills] = useState<AiSkill[]>([]);
  const [newSkillName, setNewSkillName] = useState("");
  const [newSkillPrompt, setNewSkillPrompt] = useState("");
  /** PLAN MODE — when on, the next task first produces a plan that the
   *  user approves before any tool runs. Both fields persist per
   *  project: a produced plan must survive a reload, because the
   *  approval card IS the user's pending decision. */
  const [planMode, setPlanMode] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);
  /** Memory page quick-add box. */
  const [newMemoryText, setNewMemoryText] = useState("");
  useEffect(() => {
    if (!projectId) return;
    savePlanState(projectId, { planMode, pendingPlan });
  }, [projectId, planMode, pendingPlan]);
  /** The session restored on mount — once true, saves start flowing. */
  const restoredRef = useRef(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /** Text files attached via the paperclip — their content joins the
   *  next message as fenced blocks (capped; binary files are refused). */
  const [attachments, setAttachments] = useState<{ name: string; content: string }[]>([]);
  /** Aborts the in-flight AI turn — the Stop control. */
  const abortRef = useRef<AbortController | null>(null);
  // The Settings-saved AI gateway config — attached to every model call.
  const aiConfigQuery = useUserAiConfig();
  const gatewayConfig = aiConfigQuery.data ?? undefined;
  /** Editor-aware context toggle (menu). On by default — Claude-like. */
  const [includeFileContext, setIncludeFileContext] = useState(true);

  // ── Session persistence ────────────────────────────────────────────
  // Restore the newest saved session on mount AND on project switch (a
  // stale conversation must never leak across projects); persist on
  // every turn completion. Restored entries have any half-streamed
  // bubble sealed — a mid-run unmount flush can persist the flag, and
  // an open bubble would swallow the NEXT turn's deltas.
  const sealEntries = (entries: ChatEntry[]): ChatEntry[] =>
    entries.map((entry) =>
      entry.role === "assistant" && entry.streaming
        ? { role: "assistant", text: entry.text }
        : entry,
    );
  useEffect(() => {
    if (!projectId) return;
    restoredRef.current = true;
    const saved = loadSessions(projectId);
    setSessions(saved);
    // Memory, skills and plan state are per-project too — a stale
    // project's facts must never leak into this one. The plan state is
    // LOADED (not reset): a produced plan survives reloads and view
    // switches, because the approval card is the user's pending decision.
    setMemory(loadMemory(projectId));
    setSkills(loadSkills(projectId));
    const plan = loadPlanState(projectId);
    setPlanMode(plan.planMode);
    setPendingPlan(plan.pendingPlan);
    if (saved.length > 0) {
      const last = saved[0];
      setSessionId(last.id);
      setEntries(sealEntries(last.entries));
      setHistory(last.history);
      setCreatedAt(last.createdAt || Date.now());
    } else {
      // Fresh project: a brand-new empty chat — never carry the previous
      // project's conversation across the switch.
      setEntries([
        { role: "assistant", text: root ? WELCOME : "Open a folder first — then I can read, edit and run things in it." },
      ]);
      setHistory([]);
      setSessionId(newSessionId());
      setCreatedAt(Date.now());
    }
  }, [projectId]);

  // Latest snapshot refs — the unmount flush reads these (view switch
  // mid-AI-run must never lose the conversation).
  const saveRef = useRef({
    sessionId,
    createdAt,
    entries,
    history,
    root,
  });
  saveRef.current = { sessionId, createdAt, entries, history, root };

  useEffect(() => {
    if (!projectId || !restoredRef.current) return;
    // NEVER persist a welcome-only session — that husk would hijack the
    // next restore (it carried the newest timestamp).
    if (!entries.some((entry) => entry.role === "user")) return;
    const title =
      entries.find((entry) => entry.role === "user")?.text ||
      titleFromPrompt("New chat");
    setSessions(
      upsertSession(projectId, {
        id: sessionId,
        title,
        createdAt,
        updatedAt: Date.now(),
        entries,
        history,
      }),
    );
  }, [projectId, entries, history, sessionId, createdAt]);

  // Flush on unmount (switching sidebar views / navigating mid-run) —
  // the refs carry the latest snapshot past the closure.
  const unmountRef = useRef({ projectId, sessionId, createdAt, entries, history, root });
  unmountRef.current = { projectId, sessionId, createdAt, entries, history, root };
  useEffect(
    () => () => {
      const snap = unmountRef.current;
      if (!snap.projectId || snap.entries.length <= 1) return;
      const title =
        snap.entries.find((entry) => entry.role === "user")?.text ||
        titleFromPrompt("New chat");
      upsertSession(snap.projectId, {
        id: snap.sessionId,
        title,
        createdAt: snap.createdAt,
        updatedAt: Date.now(),
        entries: snap.entries,
        history: snap.history,
      });
    },
    [],
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      setHasSelection(getSelectionText().length > 0);
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  // Working-time counter — resets per turn, ticks while busy.
  useEffect(() => {
    if (!busy) {
      setElapsed(0);
      setPhase(null);
      return;
    }
    const timer = window.setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [entries, busy]);

  function selection(): string {
    return getSelectionText().slice(0, 4_000);
  }

  function push(entry: ChatEntry): void {
    setEntries((prev) => [...prev, entry]);
  }

  /** Start a fresh conversation (the old one stays in Sessions). */
  function newChat(): void {
    setEntries([{ role: "assistant", text: root ? WELCOME : "Open a folder first — then I can read, edit and run things in it." }]);
    setHistory([]);
    setSessionId(newSessionId());
    setCreatedAt(Date.now());
    setOpenSection(null);
    setPendingPlan(null);
  }

  function restoreSession(session: AiSession): void {
    setSessionId(session.id);
    setEntries(sealEntries(session.entries));
    setHistory(session.history);
    setOpenSection(null);
  }

  function removeSession(id: string): void {
    setSessions(deleteSession(projectId, id));
    if (id === sessionId) newChat();
  }

  function clearChat(): void {
    setEntries([{ role: "assistant", text: root ? WELCOME : "Open a folder first — then I can read, edit and run things in it." }]);
    setHistory([]);
    setOpenSection(null);
  }

  function exportSession(): void {
    const lines = entries
      .filter((entry) => entry.role !== "activity")
      .map((entry) => `## ${entry.role === "user" ? "You" : "AI"}\n\n${entry.text}`)
      .join("\n\n");
    const blob = new Blob([`# Workspace AI chat\n\n${lines}\n`], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `workspace-ai-chat-${new Date().toISOString().slice(0, 10)}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function copyConversation(): void {
    const lines = entries
      .filter((entry) => entry.role !== "activity")
      .map((entry) => `${entry.role === "user" ? "You" : "AI"}: ${entry.text}`)
      .join("\n\n");
    void navigator.clipboard?.writeText(lines).catch(() => undefined);
  }

  function copyEntry(text: string): void {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  }

  /** Slash-command system — the AI system's control surface. Every
   *  manageable lever (sessions, skills, memory, context, dev server,
   *  Playwright MCP, export, settings) has a command; unknown names get
   *  /help. */
  async function handleSlashCommand(raw: string): Promise<void> {
    const [name, ...rest] = raw.slice(1).trim().split(/\s+/);
    const arg = rest.join(" ").trim().toLowerCase();
    switch (name) {
      case "help":
        push({ role: "assistant", text: "Commands: /help — this list | /new — new chat | /clear | /sessions — saved sessions | /skills — preset skills | /memory — project memory | /remember <fact> — save a memory | /plan — toggle plan mode | /export — download session | /context — toggle file context | /mcp — toggle Playwright tools | /git — git status | /settings — AI settings" });
        return;
      case "new":
        // No activity line here — the fresh-chat hero IS the "new" state;
        // an extra entry would break the fresh-chat rendering.
        newChat();
        return;
      case "clear":
        clearChat();
        return;
      case "sessions":
        setOpenSection("sessions");
        setMenuOpen(false);
        return;
      case "skills":
        setOpenSection("skills");
        setMenuOpen(false);
        return;
      case "memory":
        setOpenSection("memory");
        setMenuOpen(false);
        return;
      case "remember": {
        const fact = rest.join(" ").trim();
        if (!fact) {
          push({ role: "activity", text: "Usage: /remember <fact> — e.g. /remember CSS uses BEM naming" });
          return;
        }
        setMemory(addMemory(projectId, fact));
        push({ role: "activity", text: `Memory saved: ${fact}` });
        return;
      }
      case "plan": {
        setPlanMode((value) => !value);
        push({ role: "activity", text: `Plan mode ${planMode ? "OFF" : "ON"} — tasks will produce a plan for approval first.` });
        return;
      }
      case "export":
        exportSession();
        push({ role: "activity", text: "Session exported as markdown." });
        return;
      case "context":
        setIncludeFileContext((value) => !value);
        push({ role: "activity", text: `Active-file context ${includeFileContext ? "OFF" : "ON"}.` });
        return;
      case "mcp": {
        try {
          const status = await localFolder.playwrightStatus();
          const want = arg === "on" || arg === "off" ? arg : status.connected ? "off" : "on";
          if (want === "off") {
            const res = await localFolder.playwrightDisconnect();
            push({ role: "activity", text: res.disconnected ? "Playwright MCP disconnected." : "Playwright MCP was not connected." });
          } else {
            const tools = await localFolder.playwrightCall(" NOOP", {});
            void tools;
            const list = await fetch("/api/playwright/tools").then((r) => r.json() as Promise<{ tools?: { name: string }[] }>).catch(() => null);
            push({ role: "activity", text: list?.tools ? `Playwright MCP connected — ${list.tools.length} browser tools available (browser_navigate, browser_snapshot, browser_click…).` : "Playwright MCP failed to connect — is the runner running?" });
          }
        } catch (error) {
          push({ role: "activity", text: `Playwright MCP error: ${error instanceof Error ? error.message : String(error)}` });
        }
        return;
      }
      case "git": {
        if (!root) { push({ role: "activity", text: "Open a folder first." }); return; }
        push({ role: "activity", text: "Checking git status" });
        const res = await localFolder.runGit({ root, op: "status" });
        push({ role: "activity", text: clipGit(res.stdout || res.stderr) });
        return;
      }
      case "settings":
        window.location.href = "/settings";
        return;
      default:
        push({ role: "activity", text: `Unknown command "/${name}" — type /help for the list.` });
    }
  }

  function clipGit(text: string): string {
    return text.trim().slice(0, 600) || "(clean)";
  }

  /** Read the picked files and attach them to the next message. Text
   *  only — NUL bytes mean binary, and binary content would dump
   *  garbage into the model's context (refused with a readable line). */
  async function pickAttachments(files: File[]): Promise<void> {
    if (files.length === 0) return;
    const picked: { name: string; content: string }[] = [];
    for (const file of files) {
      if (file.size > 100_000) {
        push({ role: "activity", text: `Skipped ${file.name} — over 100 KB (attach smaller text files).` });
        continue;
      }
      const content = await file.text();
      if (content.includes("\u0000")) {
        push({ role: "activity", text: `Skipped ${file.name} — binary files can't be attached (text files only).` });
        continue;
      }
      picked.push({ name: file.name, content });
    }
    if (picked.length > 0) {
      setAttachments((prev) => [...prev, ...picked].slice(0, 5));
      setOpenSection(null);
    }
  }

  async function send(prompt: string, opts?: { executingPlan?: boolean }): Promise<void> {
    const text = prompt.trim();
    if (!text || busy) return;
    if (!root) {
      push({ role: "assistant", text: "Open a folder first (Explorer → Open Folder) — I work inside it." });
      return;
    }
    setInput("");
    setMenuOpen(false);
    if (text.startsWith("/")) {
      // Slash commands drive the UI themselves — no user bubble needed
      // (a /new bubble would be wiped by the reset anyway, and the old
      // code left the command text stuck in the input here).
      await handleSlashCommand(text);
      return;
    }
    const selected = includeFileContext ? selection() : "";
    // Attachments ride with THIS message only — captured, then cleared.
    const attached = attachments;
    if (attached.length > 0) setAttachments([]);
    const fence = "```";
    const attachBlock = attached
      .map((file) => `Attached file: ${file.name}\n${fence}\n${file.content}\n${fence}`)
      .join("\n\n");
    const fullPrompt = attachBlock ? `${text}\n\n${attachBlock}` : text;
    push({
      role: "user",
      text: opts?.executingPlan
        ? "▶ Plan approved — execute it"
        : selected
          ? `${text} (on the selected code)`
          : attached.length > 0
            ? `${text}\n📎 ${attached.map((file) => file.name).join(", ")}`
            : text,
    });
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    // PLAN MODE: the first call runs with planOnly — NO tools exist on
    // that wire, so the model can only return a plan. Execution is a
    // separate, user-gated send() (executingPlan: true) — never assumed.
    const planPhase = planMode && !opts?.executingPlan;
    // ── REAL SSE streaming ── deltas arrive from the proxy as the model
    // speaks (workbenchAi → onTextDelta). Each model turn narrates into
    // its OWN bubble: a bubble opens on the first delta and seals when
    // tools start / the turn ends, so interim plans and the final answer
    // stay visually separate. There is no replay pass — what streamed is
    // what stays.
    /** Live-append one delta to the open streaming bubble (or open one). */
    const appendDelta = (delta: string): void => {
      setEntries((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.role === "assistant" && last.streaming) {
          copy[copy.length - 1] = { role: "assistant", text: last.text + delta, streaming: true };
        } else {
          copy.push({ role: "assistant", text: delta, streaming: true });
        }
        return copy;
      });
    };
    /** Seal open streaming bubbles — their streamed text is final. */
    const sealStreaming = (): void => {
      setEntries((prev) =>
        prev.map((entry) =>
          entry.role === "assistant" && entry.streaming
            ? { role: "assistant", text: entry.text }
            : entry,
        ),
      );
    };
    /** Pin the authoritative final answer onto the last streaming bubble
     *  (or push one when the turn streamed nothing). */
    const finalize = (finalText: string): void => {
      setEntries((prev) => {
        const copy = [...prev];
        for (let i = copy.length - 1; i >= 0; i -= 1) {
          const entry = copy[i];
          if (entry.role === "assistant" && entry.streaming) {
            copy[i] = { role: "assistant", text: finalText };
            return copy;
          }
        }
        copy.push({ role: "assistant", text: finalText });
        return copy;
      });
    };
    try {
      const context: WorkbenchAiContext = includeFileContext
        ? { path: activePath, cursorLine, selection: selected }
        : { path: null, cursorLine: 0, selection: "" };
      // AUTO MODE: the AI keeps working across turn bounds — the loop
      // auto-continues until the task reports completion (bounded by a
      // continuation guard so a confused model can't spin forever).
      let turnPrompt = fullPrompt;
      let combinedHistory = history.slice(-40);
      let continuation = 0;
      const MAX_CONTINUATIONS = 8;
      let turnResult: WorkbenchAiTurnResult | null = null;
      for (;;) {
        const result = await runWorkbenchAiTurn({
          prompt: turnPrompt,
          history: combinedHistory,
          context,
          deps: {
            root,
            readCurrent: readCurrent,
            proposeEdit: onProposeEdit,
            exec: onExec,
            openFile: onOpenFile,
            saveMemory: (fact) => {
              setMemory(addMemory(projectId, fact));
              push({ role: "activity", text: `Memory saved: ${fact}` });
            },
          },
          // Project memory rides into the system prompt every turn.
          memory: memory.map((entry) => entry.text),
          planOnly: planPhase,
          gateway: gatewayConfig
            ? {
                provider: gatewayConfig.provider,
                url: gatewayConfig.gatewayUrl,
                model: gatewayConfig.model,
                token: gatewayConfig.token,
              }
            : undefined,
          onActivity: (line) => {
            // A model turn ended — seal its bubble before the tool
            // activity lands, so the next turn's narration opens fresh.
            sealStreaming();
            setCurrentStep(line);
            push({ role: "activity", text: line });
          },
          signal: controller.signal,
          streaming: true,
          onTextDelta: appendDelta,
          onPhase: (phase) => {
            // Fresh second count for EVERY thinking step (per model call).
            setElapsed(0);
            setPhase(phase === "thinking" ? "thinking" : "tools");
          },
        });
        combinedHistory = [...combinedHistory, ...result.history].slice(-40);
        turnResult = result;
        // Interim narration already streamed live into its own bubble —
        // result.thoughts is the same text; pushing it again would echo.
        const boundHit = /Stopped after \d+ tool turns/.test(result.text);
        if (boundHit && continuation < MAX_CONTINUATIONS && !controller.signal.aborted) {
          continuation += 1;
          turnPrompt = "Continue — finish ALL remaining steps, then give the final pass/fail report. Use tools.";
          sealStreaming();
          push({ role: "activity", text: `auto: continuing (${continuation}/${MAX_CONTINUATIONS})` });
          continue;
        }
        setHistory((prev) => [...prev, ...result.history].slice(-24));
        finalize(result.text || "(no response)");
        break;
      }
      if (planPhase) {
        // The plan streamed in as a normal bubble — hand it to the user
        // for an explicit Execute/Discard decision. Nothing runs until
        // the user clicks.
        setPendingPlan(turnResult?.text || "(no plan)");
        push({ role: "activity", text: "Plan ready — approve below to execute." });
      }
      if (proposals.length > 0) {
        push({ role: "activity", text: `${proposals.length} proposal(s) awaiting review — Accept/Reject below.` });
      }
    } catch (error) {
      // A half-streamed bubble never survives an error — seal it, then
      // surface the failure as its own message.
      sealStreaming();
      const message = error instanceof Error ? error.message : String(error);
      if (/abort/i.test(message)) {
        push({ role: "assistant", text: "Stopped." });
      } else {
        push({ role: "assistant", text: `Error: ${message}` });
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  /** USER-GATED plan execution — the only path from a produced plan to
   *  real work. The plan text goes verbatim into the follow-up prompt so
   *  the model executes exactly what was approved. */
  function executePlan(): void {
    const plan = pendingPlan;
    setPendingPlan(null);
    if (!plan || plan === "(no plan)") return;
    void send(
      `Execute this approved plan now, step by step, and verify each step as you go:\n\n${plan}`,
      { executingPlan: true },
    );
  }

  function discardPlan(): void {
    setPendingPlan(null);
    push({ role: "activity", text: "Plan discarded — nothing was executed." });
  }

  /** Fresh chat = only the welcome husk (or nothing at all) — the
   *  messages area then shows a centered hero instead of a first card. */
  const isFreshChat =
    !busy &&
    (entries.length === 0 ||
      (entries.length === 1 && entries[0].role === "assistant" && entries[0].text === WELCOME));
  const gatewayReady = Boolean(gatewayConfig?.token);

  return (
    <div className="wb-view wb-ai-panel">
      <div className="wb-view-head wb-ai-head">
        <span className="wb-view-title">AI</span>
        <span className="wb-view-actions">
          {proposals.length > 0 ? (
            <span className="wb-activity-badge" style={{ position: "static" }}>
              {proposals.length}
            </span>
          ) : null}
          <button
            aria-label="AI menu"
            className={`wb-icon-btn${menuOpen ? " active" : ""}`}
            onClick={() => setMenuOpen((open) => !open)}
            title="Sessions, skills and AI actions"
            type="button"
          >
            <MoreHorizontal size={14} />
          </button>
          <button
            aria-label="Clear chat"
            className="wb-icon-btn"
            disabled={busy || entries.length <= 1}
            onClick={clearChat}
            title="Clear this conversation"
            type="button"
          >
            <Eraser size={13} />
          </button>
          <button aria-label="Close AI panel" className="wb-icon-btn" onClick={onClose} title="Close" type="button">
            <X size={13} />
          </button>
        </span>
      </div>

      {menuOpen ? (
        <>
          <div
            aria-hidden="true"
            className="wb-ai-menu-shield"
            onClick={() => setMenuOpen(false)}
          />
          <div className="wb-ai-menu">
            {/* Connection status row — which gateway/model answers. */}
            <div className="wb-ai-menu-info">
              <span className={`health-dot ${gatewayReady ? "ok" : ""}`} />
              <span className="wb-ai-menu-model">
                {gatewayConfig?.model || "AI gateway not configured"}
              </span>
            </div>
            <div className="wb-ai-menu-sep" />
            <button className="wb-ai-menu-item" onClick={() => { newChat(); setMenuOpen(false); }} type="button">
              <MessageSquarePlus size={13} /> New chat
            </button>
            <button
              className={`wb-ai-menu-item${openSection === "sessions" ? " active" : ""}`}
              onClick={() => { setOpenSection("sessions"); setMenuOpen(false); }}
              type="button"
            >
              <History size={13} /> Sessions
            </button>
            <button
              className={`wb-ai-menu-item${openSection === "skills" ? " active" : ""}`}
              onClick={() => { setOpenSection("skills"); setMenuOpen(false); }}
              type="button"
            >
              <Zap size={13} /> Skills
            </button>
            <button
              className={`wb-ai-menu-item${openSection === "memory" ? " active" : ""}`}
              onClick={() => { setOpenSection("memory"); setMenuOpen(false); }}
              type="button"
            >
              <BrainCircuit size={13} /> Memory
              <span className={`wb-ai-menu-check${memory.length > 0 ? " on" : ""}`}>
                {memory.length > 0 ? String(memory.length) : ""}
              </span>
            </button>
            <button className="wb-ai-menu-item" onClick={() => setPlanMode((value) => !value)} type="button">
              <ClipboardList size={13} />
              Plan mode — plan first, execute on approval
              <span className={`wb-ai-menu-check${planMode ? " on" : ""}`}>
                {planMode ? "✓" : ""}
              </span>
            </button>
            <button
              className="wb-ai-menu-item"
              onClick={() => setIncludeFileContext((value) => !value)}
              type="button"
            >
              <Paperclip size={13} />
              Include active file
              <span className={`wb-ai-menu-check${includeFileContext ? " on" : ""}`}>
                {includeFileContext ? "✓" : ""}
              </span>
            </button>
            <div className="wb-ai-menu-sep" />
            <button className="wb-ai-menu-item" onClick={() => { copyConversation(); setMenuOpen(false); }} type="button">
              <Copy size={13} /> Copy conversation
            </button>
            <button className="wb-ai-menu-item" onClick={() => { exportSession(); setMenuOpen(false); }} type="button">
              <Download size={13} /> Export session (.md)
            </button>
            <button
              className="wb-ai-menu-item"
              onClick={() => {
                window.location.href = "/settings";
                setMenuOpen(false);
              }}
              type="button"
            >
              <Settings size={13} /> AI settings (gateway / key)
            </button>
            <div className="wb-ai-menu-sep" />
            <button
              className="wb-ai-menu-item"
              disabled={busy || entries.length <= 1}
              onClick={() => {
                clearChat();
                setMenuOpen(false);
              }}
              type="button"
            >
              <Trash2 size={13} /> Clear chat
            </button>
          </div>
        </>
      ) : null}

      {openSection ? (
        <div className="wb-ai-page">
          <div className="wb-ai-page-head">
            <button
              aria-label="Back to chat"
              className="wb-icon-btn"
              onClick={() => setOpenSection(null)}
              title="Back to chat"
              type="button"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="wb-ai-page-title">
              {openSection === "sessions" ? "Sessions" : openSection === "skills" ? "Skills" : "Memory"}
            </span>
            <span className="wb-ai-page-count">
              {openSection === "sessions"
                ? sessions.length
                : openSection === "skills"
                  ? skills.length
                  : memory.length}
            </span>
          </div>
          <div className="wb-ai-page-body">
            {openSection === "sessions" ? (
              sessions.length === 0 ? (
                <div className="wb-ai-page-empty">
                  <History size={20} aria-hidden="true" />
                  <p>No saved sessions yet — chats save automatically.</p>
                </div>
              ) : (
                <div className="wb-ai-card-list">
                  {sessions.map((session) => (
                    <div className={`wb-ai-item${session.id === sessionId ? " current" : ""}`} key={session.id}>
                      <button
                        className="wb-ai-item-main"
                        onClick={() => {
                          restoreSession(session);
                          setOpenSection(null);
                        }}
                        title={session.title}
                        type="button"
                      >
                        <span className="wb-ai-item-title">{session.title}</span>
                        <span className="wb-ai-item-meta">
                          {new Date(session.updatedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · {session.entries.length} messages
                        </span>
                      </button>
                      <button
                        aria-label={`Delete session: ${session.title}`}
                        className="wb-icon-btn"
                        onClick={() => removeSession(session.id)}
                        title="Delete this session"
                        type="button"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )
            ) : openSection === "memory" ? (
              <>
                <p className="wb-ai-page-note">
                  These facts are injected into every chat — the AI reads them before answering. Tell the AI
                  &quot;মনে রাখো: …&quot;, use /remember, or add one here.
                </p>
                {memory.length === 0 ? (
                  <div className="wb-ai-page-empty">
                    <BrainCircuit size={20} aria-hidden="true" />
                    <p>Memory is empty.</p>
                  </div>
                ) : (
                  <div className="wb-ai-card-list">
                    {memory.map((entry) => (
                      <div className="wb-ai-item" key={entry.id}>
                        <div className="wb-ai-item-main static">
                          <span className="wb-ai-item-text">{entry.text}</span>
                          <span className="wb-ai-item-meta">
                            {new Date(entry.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                          </span>
                        </div>
                        <button
                          aria-label="Forget this fact"
                          className="wb-icon-btn"
                          onClick={() => setMemory(removeMemory(projectId, entry.id))}
                          title="Forget this fact"
                          type="button"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <p className="wb-ai-group-label">Add a fact</p>
                <div className="wb-ai-form">
                  <textarea
                    aria-label="New memory fact"
                    className="wb-ai-form-input wb-ai-form-area"
                    onChange={(event) => setNewMemoryText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey && newMemoryText.trim()) {
                        event.preventDefault();
                        setMemory(addMemory(projectId, newMemoryText));
                        setNewMemoryText("");
                      }
                    }}
                    placeholder="e.g. Deploy target is Vercel"
                    rows={2}
                    value={newMemoryText}
                  />
                  <button
                    className="wb-ai-form-save"
                    disabled={!newMemoryText.trim()}
                    onClick={() => {
                      setMemory(addMemory(projectId, newMemoryText));
                      setNewMemoryText("");
                    }}
                    type="button"
                  >
                    <Plus size={13} /> Add to memory
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="wb-ai-group-label">Your skills — click to run</p>
                {skills.length === 0 ? (
                  <div className="wb-ai-page-empty">
                    <Zap size={20} aria-hidden="true" />
                    <p>No saved skills yet — create one below.</p>
                  </div>
                ) : (
                  <div className="wb-ai-card-list">
                    {skills.map((skill) => (
                      <div className="wb-ai-item" key={skill.id}>
                        <button
                          className="wb-ai-item-main"
                          onClick={() => {
                            setOpenSection(null);
                            void send(skill.prompt);
                          }}
                          title={skill.prompt}
                          type="button"
                        >
                          <span className="wb-ai-item-title">{skill.name}</span>
                          <span className="wb-ai-item-meta">
                            {skill.prompt.length > 90 ? `${skill.prompt.slice(0, 90)}…` : skill.prompt}
                          </span>
                        </button>
                        <button
                          aria-label={`Delete skill: ${skill.name}`}
                          className="wb-icon-btn"
                          onClick={() => setSkills(removeSkill(projectId, skill.id))}
                          title="Delete this skill"
                          type="button"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <p className="wb-ai-group-label">Create a skill</p>
                <div className="wb-ai-form">
                  <label className="wb-ai-form-label" htmlFor="wb-skill-name">
                    Name
                  </label>
                  <input
                    className="wb-ai-form-input"
                    id="wb-skill-name"
                    onChange={(event) => setNewSkillName(event.target.value)}
                    placeholder="e.g. Fix tests"
                    value={newSkillName}
                  />
                  <label className="wb-ai-form-label" htmlFor="wb-skill-prompt">
                    Prompt
                  </label>
                  <textarea
                    className="wb-ai-form-input wb-ai-form-area"
                    id="wb-skill-prompt"
                    onChange={(event) => setNewSkillPrompt(event.target.value)}
                    placeholder="What the AI should do when this skill runs…"
                    rows={4}
                    value={newSkillPrompt}
                  />
                  <button
                    className="wb-ai-form-save"
                    disabled={!newSkillName.trim() || !newSkillPrompt.trim()}
                    onClick={() => {
                      setSkills(addSkill(projectId, newSkillName, newSkillPrompt));
                      setNewSkillName("");
                      setNewSkillPrompt("");
                    }}
                    type="button"
                  >
                    <Plus size={13} /> Save skill
                  </button>
                </div>
                <p className="wb-ai-group-label">Built-in skills</p>
                <div className="wb-ai-card-list">
                  {SKILLS.map((skill) => (
                    <button
                      className="wb-ai-item"
                      key={skill.label}
                      onClick={() => {
                        setOpenSection(null);
                        void send(skill.prompt);
                      }}
                      type="button"
                    >
                      <span className="wb-ai-item-main">
                        <span className="wb-ai-item-title">{skill.label}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <>
        <div className="wb-ai-messages" ref={listRef}>
        {isFreshChat ? (
          <div className="wb-ai-welcome">
            <Sparkles aria-hidden="true" className="wb-ai-welcome-icon" size={24} />
            <p className="wb-ai-welcome-title">What should we work on?</p>
            <p className="wb-ai-welcome-sub">
              {root
                ? "I can read, edit, run and use git across your open folder — just ask in plain language."
                : "Open a folder first — then I can read, edit and run things in it."}
            </p>
          </div>
        ) : (
          entries.map((entry, index) =>
          entry.role === "thought" ? (
            // Legacy renderer — saved sessions from before real SSE
            // streaming may carry collapsible thought rows; new turns
            // narrate live into their own bubbles instead.
            <details className="wb-ai-thought" key={index}>
              <summary>
                <Sparkles size={11} aria-hidden="true" /> Thought {(entry as { seconds: number }).seconds}s
              </summary>
              <p className="wb-ai-thought-text">{entry.text}</p>
            </details>
          ) : entry.role === "activity" ? (
            <p className="wb-ai-activity" key={index}>
              <Wrench size={11} aria-hidden="true" /> {entry.text}
            </p>
          ) : (
            <div className={`wb-ai-msg ${entry.role}`} key={index}>
              {renderRich(entry.text)}
              {entry.role === "assistant" && entry.streaming ? (
                <span aria-hidden="true" className="wb-ai-caret" />
              ) : null}
              {(entry.role === "assistant" || entry.role === "user") && entry.text ? (
                <button
                  aria-label={entry.role === "user" ? "Copy your message" : "Copy answer"}
                  className="wb-icon-btn wb-ai-copy"
                  onClick={() => copyEntry(entry.text)}
                  title="Copy"
                  type="button"
                >
                  <Copy size={12} />
                </button>
              ) : null}
            </div>
          ),
          ))
        }
        {busy ? (
          <p className="wb-ai-activity muted">
            <Bot size={11} className="wb-spin" style={{ verticalAlign: -2 }} />
            {phase === "thinking" ? `Thinking… ${elapsed}s` : `Working… ${elapsed}s`}
            {currentStep ? ` — ${currentStep}` : ""}
          </p>
        ) : null}
      </div>

      {hasSelection && !busy ? (
        <div className="wb-ai-quick">
          <span className="wb-ai-quick-label">Selection:</span>
          <button className="wb-ai-quick-btn" onClick={() => send("Explain the selected code.")} type="button">Explain</button>
          <button className="wb-ai-quick-btn" onClick={() => send("Refactor the selected code — cleaner, same behavior. Propose the change.")} type="button">Refactor</button>
          <button className="wb-ai-quick-btn" onClick={() => send("Find and fix the problem in the selected code. Propose the fix.")} type="button">Fix</button>
        </div>
      ) : null}

      {/* Plan awaiting approval — plan mode's user gate. The plan text
          itself is the assistant bubble above; this card only decides. */}
      {pendingPlan && !busy ? (
        <div className="wb-ai-plan-card">
          <div className="wb-ai-plan-head">
            <ClipboardList size={13} aria-hidden="true" />
            <span>Plan ready</span>
            <span className="wb-ai-plan-hint">nothing runs without your approval</span>
          </div>
          <div className="wb-ai-plan-actions">
            <button className="wb-ai-plan-execute" onClick={executePlan} type="button">
              <Play size={12} aria-hidden="true" /> Execute plan
            </button>
            <button className="wb-ai-plan-discard" onClick={discardPlan} type="button">
              Discard
            </button>
          </div>
        </div>
      ) : null}

      {/* AI-proposed changes — ONE recommended action card (per-file
          accept/reject cards confused users; the summary card + optional
          diff review is the recommended system). */}
      {proposals.length > 0 && !reviewing ? (
        <div className="wb-ai-card">
          <p className="wb-ai-card-title">
            <Sparkles size={12} aria-hidden="true" />
            {proposals.length} change{proposals.length === 1 ? "" : "s"} proposed
          </p>
          <p className="wb-ai-card-files">
            {proposals.map((proposal) => proposal.path).join(", ")}
          </p>
          <div className="wb-ai-card-actions">
            <button className="wb-ai-card-accept" onClick={onAcceptAll} type="button">
              ✓ Accept all
            </button>
            <button className="wb-ai-card-review" onClick={onReview} type="button">
              🔍 Review diffs
            </button>
            <button className="wb-ai-card-reject" onClick={onRejectAll} type="button">
              ✕ Reject all
            </button>
          </div>
        </div>
      ) : null}

      {/* Composer — chat-only. Page views (sessions / skills / memory)
          replace the ENTIRE area below the header, composer included. */}
      {attachments.length > 0 ? (
        <div className="wb-ai-attachments">
          {attachments.map((file, index) => (
            <span className="wb-ai-attach-chip" key={`${file.name}-${index}`}>
              <Paperclip size={11} aria-hidden="true" />
              {file.name}
              <button
                aria-label={`Remove attachment: ${file.name}`}
                className="wb-icon-btn"
                onClick={() => setAttachments((prev) => prev.filter((_, entryIndex) => entryIndex !== index))}
                title="Remove this attachment"
                type="button"
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="wb-ai-input-row">
        <button
          aria-label="Attach a text file"
          className="wb-icon-btn wb-ai-attach"
          disabled={busy || !root}
          onClick={() => fileInputRef.current?.click()}
          title="Attach a text file — its content joins your message"
          type="button"
        >
          <Paperclip size={14} />
        </button>
        <textarea
          aria-label="Ask the AI"
          className="wb-ai-input wb-ai-input-area"
          disabled={busy || !root}
          onChange={(event) => {
            setInput(event.target.value);
            const el = event.target;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
          }}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter is a newline (chat convention).
            if (event.key === "Enter" && !event.shiftKey && input.trim()) {
              event.preventDefault();
              void send(input);
            }
          }}
          placeholder={root ? "Ask, edit, run — scoped to your open folder…" : "Open a folder to enable the AI…"}
          ref={inputRef}
          rows={2}
          value={input}
        />
        {busy ? (
          <button
            aria-label="Stop"
            className="wb-icon-btn wb-ai-send wb-ai-stop"
            onClick={() => abortRef.current?.abort()}
            title="Stop the current AI work"
            type="button"
          >
            <Square size={14} />
          </button>
        ) : (
          <button
            aria-label="Send"
            className="wb-icon-btn wb-ai-send"
            disabled={!input.trim()}
            onClick={() => void send(input)}
            title="Send"
            type="button"
          >
            <Send size={14} />
          </button>
        )}
      </div>
      <input
        aria-hidden="true"
        multiple
        onChange={(event) => {
          // Materialize the FileList FIRST — input.value = "" empties the
          // live list, and the async reader would get nothing.
          const pickedFiles = Array.from(event.target.files ?? []);
          event.target.value = "";
          void pickAttachments(pickedFiles);
        }}
        ref={fileInputRef}
        style={{ display: "none" }}
        type="file"
      />
        </>
      )}
    </div>
  );
}
