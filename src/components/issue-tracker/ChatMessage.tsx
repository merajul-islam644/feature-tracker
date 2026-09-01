// Single chat message — user or assistant (with optional inline actions).
// Spec section 7.

import { Bot, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChatMessage as ChatMessageT } from "@/types/issue-tracker";

interface Props {
  message: ChatMessageT;
  onAction?: (action: NonNullable<ChatMessageT["actions"]>[number]) => void;
}

export function ChatMessage({ message, onAction }: Props) {
  const isUser = message.role === "user";
  return (
    <div
      className={cn(
        "flex w-full gap-2",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      {!isUser && (
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
          aria-hidden="true"
        >
          <Bot className="h-4 w-4" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[85%] rounded-lg border px-3 py-2 text-sm leading-relaxed shadow-sm",
          isUser
            ? "border-primary/30 bg-primary text-primary-foreground"
            : "border-border bg-card text-foreground",
        )}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
        {message.actions && message.actions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {message.actions.map((a) => (
              <Button
                key={a.id}
                size="sm"
                variant={isUser ? "secondary" : "default"}
                onClick={() => onAction?.(a)}
              >
                {a.label}
              </Button>
            ))}
          </div>
        )}
      </div>
      {isUser && (
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
          aria-hidden="true"
        >
          <UserIcon className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}
