// Left pane of the member chat page — the WhatsApp/Messenger-style
// contact list. Each row is a tight 56-60px tall cell: avatar +
// name + last-message preview on the left, time + unread badge
// on the right. The active member gets a 2px primary left-bar +
// accent background so the selection reads at a glance — mirrors
// the apps-website ChatMockup reference UI, not the Members-page
// card pattern.
//
// Rows sort by most recent message, then alphabetically, so silent
// contacts don't crowd out live ones.

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Badge } from "@/components/ui/badge";
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

// Compute the roster preview line for one conversation. Branches on
// `messageType === "call_log"` so a call-log row renders the localized
// outcome string ("Voice call · 0:32", "Missed voice call") instead of
// the empty `content` fallback ("Image"). System rows are NOT prefixed
// with "You: " — they're conversation events, not one side speaking.
function previewLabel(
  last: DirectMessage,
  memberId: string,
  t: ReturnType<typeof useT>,
): string {
  if (last.messageType === "call_log" && last.callSummary) {
    return last.callSummary;
  }
  return `${
    last.senderId === memberId ? "" : `${t("chat.you", "You")}: `
  }${last.content || t("chat.attachPreview", "Image")}`;
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

// Cap the row at 64px. The previous version's `py-2.5` + multi-line
// preview meant long last-message text could blow the row out; capping
// at 64px plus `truncate` on every text node keeps the list scannable
// when many rows are visible at once.
const ROW_HEIGHT = "min-h-[3.5rem]";

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
      {/* Search header. h2 + search input — matches the
          "Direct messages" heading in the apps-website ChatMockup
          reference. Section heading helps orient anyone landing on
          the page cold (a bare list reads as ambiguous). */}
      <div className="border-b border-border p-3">
        <h2 className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wider text-foreground">
          {t("chat.directMessages", "Direct messages")}
        </h2>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("chat.searchPlaceholder", "Search members")}
            aria-label={t("chat.searchPlaceholder", "Search members")}
            className="h-8 w-full rounded-md border border-input bg-muted/40 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus-visible:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            {t("chat.loadingMembers", "Loading members…")}
          </p>
        ) : error ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            {t(
              "chat.membersError",
              "Couldn't load the member list. Please try again.",
            )}
          </p>
        ) : visible.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
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
                  {/* The row design matches the apps-website
                      ChatMockup reference:
                      • Avatar on the left (smaller than the Members
                        page card)
                      • Name + last-message preview stacked, both
                        truncating so the row height stays bounded
                      • Right column carries timestamp + unread
                        badge — vertical compactness lets the user
                        scan 4-5 rows without scrolling
                      • Active row gets the `border-l-2` accent bar
                        + tinted bg; inactive rows get a transparent
                        border of the same width so the row heights
                        stay aligned (no 2px shift on selection) */}
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => onSelect(member.id)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors",
                      // `border-l-2` on every row (transparent when
                      // inactive) keeps the inner content aligned
                      // across selected/unselected — otherwise the
                      // selected row's content shifts 2px right.
                      "border-l-2",
                      isSelected
                        ? "border-primary bg-accent"
                        : "border-transparent hover:bg-accent/60",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      ROW_HEIGHT,
                    )}
                  >
                    <UserAvatar
                      userId={member.id}
                      name={member.name}
                      size="sm"
                      className="h-8 w-8 text-[11px]"
                    />
                    <span className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p
                          className={cn(
                            "truncate text-xs",
                            unread > 0
                              ? "font-semibold text-foreground"
                              : "font-medium text-foreground",
                          )}
                        >
                          {member.name}
                        </p>
                        {last && (
                          <span
                            className={cn(
                              "shrink-0 text-[10px]",
                              unread > 0
                                ? "font-medium text-foreground"
                                : "text-muted-foreground",
                            )}
                          >
                            {previewTime(last.sentAt)}
                          </span>
                        )}
                      </div>
                      <p
                        className={cn(
                          "mt-0.5 truncate text-[11px]",
                          unread > 0
                            ? "font-medium text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {last
                          ? previewLabel(last, member.id, t)
                          : member.email}
                      </p>
                    </span>
                    {unread > 0 && (
                      <Badge
                        variant="default"
                        className="ml-auto h-4 min-w-4 shrink-0 justify-center rounded-full px-1.5 py-0 text-[10px] font-semibold"
                        aria-label={`${unread} unread`}
                      >
                        {unread}
                      </Badge>
                    )}
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
