// Left pane of the member chat page — the WhatsApp-style contact list.
// Each row shows the member's avatar, name, the last message exchanged
// (with a "You: " prefix when I sent it), a timestamp, and an unread
// badge fed from the polling query. Rows sort by most recent message,
// then alphabetically, so silent contacts don't crowd out live ones.

import { useMemo, useState } from "react";
import { Image as ImageIcon, Search } from "lucide-react";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useT } from "@/lib/blocks/i18n";
import { cn } from "@/lib/utils";
import type { DirectMessage } from "@/lib/blocks/data";
import type { ChatMember } from "@/pages/ChatPage";

function previewTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

interface ChatMemberListProps {
  members: ChatMember[];
  lastByMember: Map<string, DirectMessage>;
  unreadByMember: Map<string, number>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  error: boolean;
}

export function ChatMemberList({
  members,
  lastByMember,
  unreadByMember,
  selectedId,
  onSelect,
  loading,
  error,
}: ChatMemberListProps) {
  const t = useT();
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? members.filter(
          (m) =>
            m.name.toLowerCase().includes(q) ||
            m.email.toLowerCase().includes(q),
        )
      : members;
    // Most recent conversation floats to the top; members without any
    // history keep their roster (alphabetical) order below them.
    return [...filtered].sort((a, b) => {
      const ta = lastByMember.get(a.id)?.sentAt ?? "";
      const tb = lastByMember.get(b.id)?.sentAt ?? "";
      if (ta !== tb) return tb.localeCompare(ta);
      return a.name.localeCompare(b.name);
    });
  }, [members, query, lastByMember]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border p-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("chat.searchPlaceholder", "Search members")}
            aria-label={t("chat.searchPlaceholder", "Search members")}
            className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            {t("chat.loadingMembers", "Loading members…")}
          </p>
        ) : error ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            {t(
              "chat.membersError",
              "Couldn't load the member list. Please try again.",
            )}
          </p>
        ) : visible.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            {t("chat.noMatches", "No members match your search.")}
          </p>
        ) : (
          <ul role="listbox" aria-label={t("chat.title", "Chat")}>
            {visible.map((member) => {
              const last = lastByMember.get(member.id);
              const unread = unreadByMember.get(member.id) ?? 0;
              const isSelected = member.id === selectedId;
              return (
                <li key={member.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => onSelect(member.id)}
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
                      "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      isSelected && "bg-accent",
                    )}
                  >
                    <UserAvatar userId={member.id} name={member.name} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span
                          className={cn(
                            "truncate text-sm text-foreground",
                            unread > 0 ? "font-semibold" : "font-medium",
                          )}
                        >
                          {member.name}
                        </span>
                        {last && (
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {previewTime(last.sentAt)}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "flex min-w-0 items-center gap-1 text-xs",
                            unread > 0
                              ? "font-medium text-foreground"
                              : "text-muted-foreground",
                          )}
                        >
                          {last?.attachmentFileId && (
                            <ImageIcon
                              className="h-3 w-3 shrink-0"
                              aria-label={t("chat.attachPreview", "Image")}
                            />
                          )}
                          <span className="truncate">
                            {last
                              ? `${
                                  last.senderId === member.id ? "" : `${t("chat.you", "You")}: `
                                }${last.content || t("chat.attachPreview", "Image")}`
                              : member.email}
                          </span>
                        </span>
                        {unread > 0 && (
                          <span
                            className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground"
                            aria-label={`${unread} unread`}
                          >
                            {unread}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
