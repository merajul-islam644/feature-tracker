// Chat surface — see DESIGN-APP-v1.md §6.7 + §9.
// Header: AI mark + "AI Assistant" + session name; History / New / Collapse
// controls. Messages: user / assistant / tool / activity variants per §9.3.
// Action chips + suggested prompts grid + input bar per §9.4–§9.6.

import { useEffect, useRef } from "react";
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  History as HistoryIcon,
  Loader2,
  MessageSquarePlus,
  Minus,
  Pencil,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { SuggestedPrompts } from "./SuggestedPrompts";
import { ChatHistorySheet } from "./ChatHistorySheet";
import type {
  ChatMessage as ChatMessageT,
  ChatSessionSummary,
  RunActivityLine,
  VerificationTarget,
} from "@/types/issue-tracker";

interface Props {
  messages: ChatMessageT[];
  sending: boolean;
  retryStatus?: string | null;
  onSend: (text: string) => void;
  onAction?: (action: NonNullable<ChatMessageT["actions"]>[number]) => void;
  onNewSession?: () => void;
  onSelectSession?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onRenameSession?: (sessionId: string, newTitle: string) => void;
  sessions?: ChatSessionSummary[];
  currentSessionId?: string;
  sessionsLoading?: boolean;
  historyOpen?: boolean;
  onHistoryOpenChange?: (open: boolean) => void;
  activityLog?: RunActivityLine[];
  runActive?: boolean;
  targets?: VerificationTarget[];
  onCollapse?: () => void;
}

// Tone → text colour for the live feed.
const toneClass: Record<RunActivityLine["tone"], string> = {
  info: "text-muted-foreground",
  success: "text-emerald-600 dark:text-emerald-400",
  issue: "text-amber-600 dark:text-amber-400",
  error: "text-red-600 dark:text-red-400",
};

export function ChatPanel({
  messages,
  sending,
  retryStatus = null,
  onSend,
  onAction,
  onNewSession,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
  sessions = [],
  currentSessionId,
  sessionsLoading,
  historyOpen = false,
  onHistoryOpenChange,
  activityLog = [],
  runActive = false,
  targets = [],
  onCollapse,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")
    ?.content;

  // Auto-scroll to the newest message / activity line.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, activityLog.length, sending]);

  const isEmpty = messages.length <= 1; // just the greeting

  const currentSessionName =
    sessions.find((s) => s.sessionId === currentSessionId)?.title ??
    "New session";

  return (
    <Card className="flex h-full flex-col overflow-hidden border-0 bg-card shadow-none">
      {/* Header — 56px height per §9.1 */}
      <header className="flex h-14 items-center justify-between gap-2 border-b border-border bg-card px-4">
        <div className="flex min-w-0 items-center gap-2">
          {/* AI mark — 28×28 rounded-lg indigo→violet gradient per §9.1 */}
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-ai"
            aria-hidden="true"
          >
            <Bot className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold leading-tight text-foreground">
              AI Assistant
            </h2>
            <p className="truncate text-[11px] leading-tight text-muted-foreground">
              {currentSessionName}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onHistoryOpenChange?.(true)}
            disabled={!onHistoryOpenChange || !onSelectSession}
            aria-label="Open chat history"
            className="text-muted-foreground hover:text-foreground"
          >
            <HistoryIcon className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onNewSession?.()}
            disabled={!onNewSession}
            aria-label="Start new chat session"
            className="text-muted-foreground hover:text-foreground"
          >
            <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
          </Button>
          {onCollapse && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onCollapse}
              aria-label="Collapse AI Assistant"
              className="text-muted-foreground hover:text-foreground"
            >
              <Minus className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto bg-muted/20 p-4"
        aria-live="polite"
        aria-relevant="additions"
      >
        {messages.map((m) => (
          <ChatMessage
            key={m.id}
            message={m}
            onAction={onAction}
            lastUserMessage={lastUserMessage}
            pickerTargets={targets}
            onSend={onSend}
            pickerDisabled={sending}
          />
        ))}
        {sending && (
          <div className="flex w-full items-end gap-2" aria-live="polite">
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
              aria-hidden="true"
            >
              <Bot className="h-3.5 w-3.5" />
            </div>
            <div
              className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-border bg-card px-3.5 py-2.5"
              aria-label="Assistant is thinking"
            >
              {[0, 150, 300].map((delay) => (
                <span
                  key={delay}
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60"
                  style={{ animationDelay: `${delay}ms` }}
                />
              ))}
            </div>
          </div>
        )}
        {activityLog.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              {runActive ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  Assistant is working…
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                  Run finished
                </>
              )}
            </p>
            <ul className="mt-2 space-y-1" aria-live="polite">
              {activityLog.slice(-10).map((line) => (
                <li
                  key={line.id}
                  className={cn(
                    "font-mono text-[11px] leading-relaxed",
                    toneClass[line.tone],
                  )}
                >
                  {line.text}
                </li>
              ))}
            </ul>
          </div>
        )}
        {isEmpty && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Suggested
            </p>
            <SuggestedPrompts onPick={onSend} disabled={sending} />
          </div>
        )}
      </div>

      {sending && retryStatus && (
        <p className="flex items-center gap-1.5 px-4 pb-1 text-xs text-amber-600 dark:text-amber-400">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          {retryStatus}
        </p>
      )}

      <ChatInput onSend={onSend} disabled={sending} sending={sending} />

      <ChatHistorySheet
        open={historyOpen}
        onOpenChange={(o) => onHistoryOpenChange?.(o)}
        sessions={sessions}
        currentSessionId={currentSessionId ?? ""}
        loading={sessionsLoading}
        onSelectSession={onSelectSession ?? (() => {})}
        onDeleteSession={onDeleteSession}
        onRenameSession={onRenameSession}
      />
    </Card>
  );
}

// Suppress unused-Pencil import warning if not used downstream.
void Pencil;
void ChevronDown;
