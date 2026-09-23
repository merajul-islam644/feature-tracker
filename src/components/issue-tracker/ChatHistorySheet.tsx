// History sheet — lists every chat session the user has stored messages
// under. Picking a row calls `onSelectSession`, which the parent uses to
// switch the active session in `useIssueTracker` and close the sheet.
// Each row carries a kebab (3-dot) menu exposing **Edit** (rename) and
// **Delete** actions. Renaming is committed on Enter / blur; cancelling
// is via Escape.

import { useEffect, useRef, useState } from "react";
import {
  History as HistoryIcon,
  MessageSquare,
  MoreVertical,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ChatSessionSummary } from "@/types/issue-tracker";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: ChatSessionSummary[];
  currentSessionId: string;
  loading?: boolean;
  onSelectSession: (sessionId: string) => void;
  // Optional — when omitted the kebab menu hides so a read-only consumer
  // (storybook, etc.) still renders cleanly.
  onDeleteSession?: (sessionId: string) => void;
  onRenameSession?: (sessionId: string, newTitle: string) => void;
}

export function ChatHistorySheet({
  open,
  onOpenChange,
  sessions,
  currentSessionId,
  loading,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
}: Props) {
  // Which row (if any) has its rename input open. Radix listens for
  // Escape on the document BEFORE the input's own keydown handler can
  // claim it, so without the `onEscapeKeyDown` guard below, pressing
  // Escape to cancel a rename would dismiss the entire sheet (and lose
  // the draft) instead of just closing the input.
  const [editingId, setEditingId] = useState<string | null>(null);

  // Rows unmount with the sheet, so their editing flag can't fire a
  // final onEditingChange(false) — clear the stale id here instead, or
  // the next open would start with Escape still guarded.
  useEffect(() => {
    if (!open) setEditingId(null);
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex flex-col gap-0 sm:max-w-md"
        onEscapeKeyDown={(e) => {
          if (editingId) e.preventDefault();
        }}
      >
        <SheetHeader className="border-b border-border pb-4">
          <SheetTitle className="flex items-center gap-2 text-base">
            <HistoryIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Chat History
          </SheetTitle>
          <SheetDescription>
            Past conversations stored under your account. Pick one to resume.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <p className="p-4 text-center text-sm text-muted-foreground">
              Loading sessions…
            </p>
          ) : sessions.length === 0 ? (
            <p className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              No previous conversations yet. Start a new session to begin.
            </p>
          ) : (
            <ul className="space-y-2">
              {sessions.map((s) => (
                <SessionRow
                  key={s.sessionId}
                  session={s}
                  isActive={s.sessionId === currentSessionId}
                  onSelect={() => onSelectSession(s.sessionId)}
                  onDelete={onDeleteSession}
                  onRename={onRenameSession}
                  onEditingChange={(editing) =>
                    setEditingId(editing ? s.sessionId : null)
                  }
                />
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// Single row in the history list — split out so the rename-input state
// doesn't leak between rows (each row owns its editing flag).
function SessionRow({
  session,
  isActive,
  onSelect,
  onDelete,
  onRename,
  onEditingChange,
}: {
  session: ChatSessionSummary;
  isActive: boolean;
  onSelect: () => void;
  onDelete?: (sessionId: string) => void;
  onRename?: (sessionId: string, newTitle: string) => void;
  onEditingChange: (editing: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the input whenever rename mode opens so the user can
  // start typing immediately without an extra click.
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  // The kebab menu lives inside the row, but the row itself is a button.
  // The dropdown trigger is its own button and stops click/keydown
  // propagation so opening the menu doesn't also select the session.
  // Menu-item clicks are covered by the containment guard on the row's
  // handlers above (portal + React-tree bubbling).
  //
  // Both actions are DEFERRED one frame: the DropdownMenu (and its
  // trigger, hidden by `!editing`) must finish closing and return focus
  // to the trigger BEFORE `editing`/delete unmounts it. Flipping state
  // synchronously would rip the open menu out of the DOM mid-close and
  // drop focus to <body>. One frame later the swap is safe; the rename
  // input mounts focused inside the sheet.
  const startEdit = () => {
    requestAnimationFrame(() => {
      setEditing(true);
      onEditingChange(true);
    });
  };

  const handleDelete = () => {
    requestAnimationFrame(() => onDelete?.(session.sessionId));
  };

  const commitRename = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== session.title) {
      onRename?.(session.sessionId, trimmed);
    } else {
      setDraft(session.title);
    }
    setEditing(false);
    onEditingChange(false);
  };

  const cancelRename = () => {
    setDraft(session.title);
    setEditing(false);
    onEditingChange(false);
  };

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        // Portal-leak guard (click AND keydown): DropdownMenuContent
        // portals to <body>, but React synthetic events bubble through
        // the REACT tree — so clicking a portaled menu item still fires
        // this row's onClick with the menu item as e.target. Without the
        // DOM-containment check below, picking "Edit" also ran onSelect
        // (switch session + close sheet), which is exactly the bug where
        // the whole history panel closed the moment Edit was picked.
        // Only events physically inside this row's own DOM select it.
        onClick={
          editing
            ? undefined
            : (e) => {
                if (!e.currentTarget.contains(e.target as Node)) return;
                onSelect();
              }
        }
        onKeyDown={
          editing
            ? undefined
            : (e) => {
                if (!e.currentTarget.contains(e.target as Node)) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect();
                }
              }
        }
        aria-current={isActive ? "true" : undefined}
        className={cn(
          "group flex w-full flex-col gap-2 rounded-md border border-border bg-card p-3 text-left transition-colors",
          !editing &&
            "cursor-pointer hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isActive && "border-primary bg-accent/40",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitRename();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelRename();
                }
              }}
              onBlur={commitRename}
              aria-label={`Rename conversation "${session.title}"`}
              className="flex-1 rounded border border-input bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          ) : (
            <p className="line-clamp-2 text-sm font-medium text-foreground">
              {session.title}
            </p>
          )}
          <div className="flex shrink-0 items-center gap-1">
            {isActive && !editing && (
              <Badge variant="muted">Active</Badge>
            )}
            {(onDelete || onRename) && !editing && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label={`Options for "${session.title}"`}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <MoreVertical className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem onSelect={startEdit} disabled={!onRename}>
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={handleDelete}
                    disabled={!onDelete}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span aria-hidden="true" className="flex items-center gap-1">
            <MessageSquare className="h-3 w-3" />
            {session.messageCount}
          </span>
          <span aria-hidden="true">•</span>
          <span>{formatRelativeTime(session.lastActivity)}</span>
        </div>
      </div>
    </li>
  );
}

// Compact "5m ago" / "2h ago" / "Yesterday" / "Mar 5" label. Mirrors the
// `lastCompletedRun` helper in `useIssueTracker.ts` — kept local to avoid a
// shared util file for two small callers in this phase.
function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diffMs)) return "";
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
