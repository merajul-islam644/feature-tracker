// Chat composer — disabled while sending. Enter sends, Shift+Enter newlines.
// While the agent chain is active the send slot doubles as the Stop button:
// the input itself is disabled for the whole chain, so this slot is the only
// always-visible control the user can act on mid-run (observed live
// 2026-10-09: a runaway scaffold had no brake short of a page reload).
// Spec section 7.2.

import { useRef, useState, type KeyboardEvent } from "react";
import { Send, Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
  sending?: boolean;
  /** The agent chain is running — the send slot becomes Stop. */
  stoppable?: boolean;
  onStop?: () => void;
}

export function ChatInput({ onSend, disabled, sending, stoppable, onStop }: Props) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const text = value.trim();
    if (!text || sending) return;
    onSend(text);
    setValue("");
    textareaRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex items-end gap-2 border-t border-border bg-background p-3"
    >
      <label htmlFor="issue-tracker-chat-input" className="sr-only">
        Ask the AI verification assistant
      </label>
      <textarea
        id="issue-tracker-chat-input"
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        rows={1}
        placeholder="Ask anything about your application…"
        className={cn(
          "min-h-[40px] flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm",
          "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      />
      {stoppable && onStop ? (
        <Button
          type="button"
          size="icon"
          variant="destructive"
          onClick={onStop}
          title="Stop the agent"
        >
          <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
          <span className="sr-only">Stop the agent</span>
        </Button>
      ) : (
        <Button type="submit" size="icon" disabled={!value.trim() || sending}>
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-4 w-4" aria-hidden="true" />
          )}
          <span className="sr-only">Send message</span>
        </Button>
      )}
    </form>
  );
}
