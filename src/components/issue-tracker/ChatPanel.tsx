// Chat surface combining messages + input + suggested prompts.
// Spec section 7.

import { useEffect, useRef } from "react";
import { Bot, History as HistoryIcon, MessageSquarePlus, MoreVertical } from "lucide-react";
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
import type { ChatMessage as ChatMessageT, ChatSessionSummary } from "@/types/issue-tracker";

interface Props {
  messages: ChatMessageT[];
  sending: boolean;
  onSend: (text: string) => void;
  onAction?: (action: NonNullable<ChatMessageT["actions"]>[number]) => void;
  onNewSession?: () => void;
  onSelectSession?: (sessionId: string) => void;
  sessions?: ChatSessionSummary[];
  currentSessionId?: string;
  sessionsLoading?: boolean;
  historyOpen?: boolean;
  onHistoryOpenChange?: (open: boolean) => void;
}

export function ChatPanel({
  messages,
  sending,
  onSend,
  onAction,
  onNewSession,
  onSelectSession,
  sessions = [],
  currentSessionId,
  sessionsLoading,
  historyOpen = false,
  onHistoryOpenChange,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the newest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

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
              Verify, configure, or review — using mock responses in this phase.
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
          <ChatMessage key={m.id} message={m} onAction={onAction} />
        ))}
        {isEmpty && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Suggested
            </p>
            <SuggestedPrompts onPick={onSend} disabled={sending} />
          </div>
        )}
      </div>

      <ChatInput onSend={onSend} disabled={sending} sending={sending} />

      <ChatHistorySheet
        open={historyOpen}
        onOpenChange={(o) => onHistoryOpenChange?.(o)}
        sessions={sessions}
        currentSessionId={currentSessionId ?? ""}
        loading={sessionsLoading}
        onSelectSession={onSelectSession ?? (() => {})}
      />
    </Card>
  );
}
