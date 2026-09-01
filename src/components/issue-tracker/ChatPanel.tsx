// Chat surface combining messages + input + suggested prompts.
// Spec section 7.

import { useEffect, useRef } from "react";
import { Bot } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { SuggestedPrompts } from "./SuggestedPrompts";
import type { ChatMessage as ChatMessageT } from "@/types/issue-tracker";

interface Props {
  messages: ChatMessageT[];
  sending: boolean;
  onSend: (text: string) => void;
  onAction?: (action: NonNullable<ChatMessageT["actions"]>[number]) => void;
}

export function ChatPanel({ messages, sending, onSend, onAction }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the newest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const isEmpty = messages.length <= 1; // just the greeting

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-3">
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
    </Card>
  );
}
