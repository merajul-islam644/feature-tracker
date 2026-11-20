// Terminal tab strip — VS Code's `[+] [×]` row at the top of the
// terminal panel. Each tab is an independent PTY; the active tab
// is the one whose xterm is visible (others stay mounted but are
// `hidden`). This mirrors `EditorTabs` styling so the two tab strips
// look like siblings, but without the file-icon / pending-dot
// affordances — those are file-editor concerns only.
//
// We deliberately keep the close-button visibility asymmetric: the
// X on the active tab is always visible (so the user can dismiss it
// with one click), inactive tabs reveal their X on hover only —
// same convention as EditorTabs.

import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TerminalInstance } from "@/types/dev-server";

interface TerminalTabsProps {
  /** All tab instances. Order is the render order. */
  terminals: TerminalInstance[];
  /** Currently focused tab id. */
  activeId: string | null;
  onFocus: (id: string) => void;
  /** Add a new terminal tab. */
  onAdd: () => void;
  /** Close (kill PTY, remove from list) the tab with this id. */
  onClose: (id: string) => void;
}

export function TerminalTabs({
  terminals,
  activeId,
  onFocus,
  onAdd,
  onClose,
}: TerminalTabsProps) {
  // No tabs → don't render the strip. The parent renders a
  // single xterm or an empty placeholder when length is 0.
  if (terminals.length === 0) return null;
  return (
    // `shrink-0` — inside the maximized dock's flex column the tab
    // strip must keep its row height instead of flex-shrinking away.
    <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-muted/30 px-2">
      {terminals.map((term) => {
        const isActive = term.id === activeId;
        return (
          <div
            key={term.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onFocus(term.id)}
            onMouseDown={(e) => {
              // Middle-click closes the tab (VS Code behaviour).
              if (e.button === 1) {
                e.preventDefault();
                onClose(term.id);
              }
            }}
            onAuxClick={(e) => {
              // Belt-and-braces with mousedown.
              if (e.button === 1) {
                e.preventDefault();
                onClose(term.id);
              }
            }}
            className={cn(
              "group flex h-full shrink-0 cursor-pointer items-center gap-1.5 rounded-t border-b-2 px-3 text-xs",
              isActive
                ? "border-b-primary bg-card text-foreground"
                : "border-b-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <span className="font-mono">{term.label}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClose(term.id);
              }}
              className={cn(
                "ml-1 flex h-4 w-4 items-center justify-center rounded text-muted-foreground transition-opacity hover:bg-muted hover:text-foreground",
                isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100",
              )}
              aria-label={`Close ${term.label}`}
              title="Close terminal"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={onAdd}
        className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="New terminal"
        title="New terminal"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}