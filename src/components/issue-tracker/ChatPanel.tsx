// Chat surface combining messages + input + suggested prompts.
// Spec section 7.

import { useEffect, useRef } from "react";
import {
  Bot,
  CheckCircle2,
  History as HistoryIcon,
  Loader2,
  MessageSquarePlus,
  MoreVertical,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  /** Transient gateway-retry status — replaces silent dead air with
   *  "retrying… 2/3" while sendChatMessage backs off a flapping 502. */
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
  // Live verification feed — one line per run event, streamed while the
  // agent works so the conversation shows what it's doing (same spirit as
  // an assistant's tool-use rows) instead of a static "started" message.
  activityLog?: RunActivityLine[];
  runActive?: boolean;
  // Targets feeding the in-chat verify-target picker — when the user
  // asks to verify without naming a URL, the assistant reply renders a
  // dropdown of these plus a free-text URL box (see VerifyTargetPicker).
  targets?: VerificationTarget[];
}

// Tone → text colour for a feed line. Kept subtle: the feed is ambient
// context, not the message thread.
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
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Most recent thing the user asked for. The permission card uses it as a
  // semantic guard: if the model proposes toggling a DIFFERENT check than
  // the one named here, the card warns instead of rubber-stamping the
  // mismatch. Computed per render (cheap reverse find) so it always
  // reflects the thread, including after a session switch.
  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")
    ?.content;

  // Auto-scroll to the newest message. The activity feed updates far more
  // often than messages while a run is going, so its length drives the
  // scroll too; `sending` catches the typing indicator appearing.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, activityLog.length, sending]);

  const isEmpty = messages.length <= 1; // just the greeting

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary"
            aria-hidden="true"
          >
            <Bot className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">AI Assistant</h2>
            <p className="text-xs text-muted-foreground">
              Verify, configure, or review — knows your current targets and scope.
            </p>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              aria-label="Chat options"
            >
              <MoreVertical className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              onSelect={() => onHistoryOpenChange?.(true)}
              disabled={!onHistoryOpenChange || !onSelectSession}
            >
              <HistoryIcon className="h-4 w-4" aria-hidden="true" />
              History
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => onNewSession?.()}
              disabled={!onNewSession}
            >
              <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
              New Session
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto p-4"
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
        {/* Typing indicator — after a send (especially the quick-verify
            submit) the gateway can take 10–30s to answer; without this
            the thread goes dead silent between the user's bubble and the
            assistant's first narration line. Same bubble idiom as the
            assistant messages, so it reads as the next turn arriving. */}
        {sending && (
          <div className="flex w-full items-end gap-2" aria-live="polite">
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
              aria-hidden="true"
            >
              <Bot className="h-4 w-4" />
            </div>
            <div
              className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2.5 shadow-sm"
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
          <div className="rounded-md border border-border bg-muted/30 p-3">
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
            {/* Last 10 lines — a long watch loop shouldn't push the feed
                beyond the panel. Newest at the bottom, auto-scrolled. */}
            <ul className="mt-2 space-y-1" aria-live="polite">
              {activityLog.slice(-10).map((line) => (
                <li key={line.id} className={`text-xs leading-relaxed ${toneClass[line.tone]}`}>
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
