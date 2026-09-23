// Quick-pick prompt chips shown when the chat is empty (section 7.3).

import { Sparkles } from "lucide-react";
import { suggestedPrompts } from "@/data/issueTrackerConstants";
import { cn } from "@/lib/utils";

interface Props {
  onPick: (prompt: string) => void;
  disabled?: boolean;
}

export function SuggestedPrompts({ onPick, disabled }: Props) {
  return (
    <div className="flex flex-wrap gap-2" role="list">
      {suggestedPrompts.map((p) => (
        <button
          key={p}
          type="button"
          role="listitem"
          disabled={disabled}
          onClick={() => onPick(p)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground shadow-sm transition-colors",
            "hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <Sparkles className="h-3 w-3 text-primary" aria-hidden="true" />
          {p}
        </button>
      ))}
    </div>
  );
}
