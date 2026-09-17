// History sheet — lists every chat session the user has stored messages
// under. Picking a row calls `onSelectSession`, which the parent uses to
// switch the active session in `useIssueTracker` and close the sheet.

import { History as HistoryIcon, MessageSquare } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ChatSessionSummary } from "@/types/issue-tracker";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: ChatSessionSummary[];
  currentSessionId: string;
  loading?: boolean;
  onSelectSession: (sessionId: string) => void;
}

export function ChatHistorySheet({
  open,
  onOpenChange,
  sessions,
  currentSessionId,
  loading,
  onSelectSession,
}: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col gap-0 sm:max-w-md">
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
              {sessions.map((s) => {
                const isActive = s.sessionId === currentSessionId;
                return (
                  <li key={s.sessionId}>
                    <button
                      type="button"
                      onClick={() => onSelectSession(s.sessionId)}
                      aria-current={isActive ? "true" : undefined}
                      className={cn(
                        "flex w-full flex-col gap-2 rounded-md border border-border bg-card p-3 text-left transition-colors",
                        "hover:border-primary/40 hover:bg-accent/30",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        isActive && "border-primary bg-accent/40",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="line-clamp-2 text-sm font-medium text-foreground">
                          {s.title}
                        </p>
                        {isActive && (
                          <Badge variant="muted" className="shrink-0">
                            Active
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span aria-hidden="true" className="flex items-center gap-1">
                          <MessageSquare className="h-3 w-3" />
                          {s.messageCount}
                        </span>
                        <span aria-hidden="true">•</span>
                        <span>{formatRelativeTime(s.lastActivity)}</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
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
