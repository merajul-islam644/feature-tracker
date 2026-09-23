// Floating chat launcher — the AI Assistant lives behind a chat-bubble
// icon (bottom-right) instead of a permanent left column, freeing the
// page for the configuration + issues stack. Clicking the icon toggles
// the same `ChatPanel` unchanged, just mounted in a fixed overlay.
//
// Layering: launcher + panel sit at z-40 — above page content and the
// Topbar (z-30), below the z-50 sheets/menus, so the ChatHistorySheet
// opened from the panel's own header and the IssueDetailsDrawer still
// stack on top of an open chat.

import { useEffect, useState, type ComponentProps } from "react";
import { MessageSquare, X } from "lucide-react";
import { ChatPanel } from "./ChatPanel";

// Everything the ChatPanel accepts, forwarded verbatim — the launcher
// adds only the open/close chrome, never a second copy of the prop list.
type ChatPanelProps = ComponentProps<typeof ChatPanel>;

export function ChatLauncher(props: ChatPanelProps) {
  const [open, setOpen] = useState(false);

  // Escape closes while open — matches the sheet/drawer convention
  // without yanking focus (the input keeps its own key handling).
  // Layers go first: when a Radix sheet (the history panel) or dropdown
  // is open on top of the chat, the same Escape that dismisses it must
  // NOT also collapse the chat underneath — one keypress, one layer.
  // The check runs at window level, after Radix's own document-level
  // dismissal, but the sheet's exit animation keeps its data-state
  // element in the DOM long enough for this to see it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const layerAbove = document.querySelector(
        '[role="dialog"][data-state], [data-radix-popper-content-wrapper]',
      );
      if (layerAbove) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {open && (
        <div
          role="dialog"
          aria-label="AI Assistant chat"
          // Nearly full-screen on phones; anchored card above the button
          // from sm up. The ChatPanel's own Card provides the border +
          // background — this box only positions and sizes it.
          className="fixed inset-x-3 bottom-24 top-16 z-40 animate-in fade-in-0 slide-in-from-bottom-4 duration-200 sm:inset-auto sm:bottom-24 sm:right-6 sm:h-[min(72vh,640px)] sm:w-[24rem] sm:rounded-lg sm:shadow-xl"
        >
          <ChatPanel {...props} />
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={open ? "Close AI Assistant chat" : "Open AI Assistant chat"}
        className="fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {open ? (
          <X className="h-5 w-5" aria-hidden="true" />
        ) : (
          <MessageSquare className="h-5 w-5" aria-hidden="true" />
        )}
        {/* Live-run marker — a closed chat shouldn't hide an in-flight
            verification. Pulses while the agent works. */}
        {props.runActive && !open && (
          <span
            className="absolute right-0.5 top-0.5 h-3 w-3 animate-pulse rounded-full bg-emerald-500 ring-2 ring-background"
            aria-hidden="true"
          />
        )}
      </button>
    </>
  );
}
