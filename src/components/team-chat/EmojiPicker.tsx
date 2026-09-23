// Tiny emoji picker used by two surfaces in the chat thread:
//   1. The composer's Smile button — inserts the picked emoji into
//      the draft text at the current cursor position.
//   2. Each message bubble's reaction trigger — adds (or toggles) a
//      reaction on that specific message.
//
// Built as a controlled `Popover` so the parent owns open state.
// The emoji grid is a flat 8-col array of commonly-used chat
// reactions — small enough to feel focused, large enough that the
// user doesn't have to hunt. Skin-tone variants are intentionally
// skipped to keep the visual surface flat (the picker is a quick
// affordance, not a Unicode explorer).

import { useT } from "@/lib/blocks/i18n";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// Curated chat-reaction alphabet. Order is intentional: positive
// emotions first (👍 ❤️ 😂 🎉 🔥), neutral/curious next (👀 😮),
// empathy last (😢 🙏). Matches the ordering people tend to scan.
//
// The grid renders in 5 columns, so the total is rounded to a
// multiple of 5 (35 here) — keeps the layout flush without an
// orphaned partial row.
export const REACTION_EMOJIS = [
  // Positive
  "👍",
  "❤️",
  "😂",
  "🎉",
  "🔥",
  // Faces
  "😊",
  "😎",
  "🤔",
  "😮",
  "😢",
  // Gestures & symbols
  "🙏",
  "👏",
  "🙌",
  "💯",
  "✨",
  // Hearts & love
  "🥰",
  "😍",
  "🤗",
  "💪",
  "🤝",
  // Fun
  "🚀",
  "⭐",
  "🌟",
  "💡",
  "🎊",
  // Reactions
  "👀",
  "😅",
  "😬",
  "🤭",
  "😴",
  // Mood
  "🥺",
  "😡",
  "🤬",
  "😭",
  "🤯",
];

export interface EmojiPickerProps {
  /** The element the popover anchors to (composer's Smile button,
   *  the bubble's reaction + button). The trigger itself is
   *  rendered by the parent — the picker only handles the
   *  popover surface + selection. */
  trigger: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (emoji: string) => void;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
}

export function EmojiPicker({
  trigger,
  open,
  onOpenChange,
  onPick,
  align = "start",
  side = "top",
}: EmojiPickerProps) {
  const t = useT();
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        side={side}
        sideOffset={6}
        className="w-auto p-1.5"
        // Don't let the picker steal focus from the composer
        // input on open — the user keeps typing while the picker
        // is up and the input must remain the keyboard target.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div
          role="grid"
          aria-label={t("chat.emojiPicker", "Pick an emoji")}
          className="grid grid-cols-5 gap-0.5"
        >
          {REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              role="gridcell"
              aria-label={emoji}
              onClick={() => {
                onPick(emoji);
                onOpenChange(false);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-md text-lg transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
