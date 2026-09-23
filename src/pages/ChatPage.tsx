// Member chat page — Messenger/WhatsApp-style direct messaging between
// workspace members. Left pane: the roster (searchable, unread badges,
// last-message previews). Right pane: the conversation thread with
// bubbles, day separators, read ticks, and a composer.
//
// Data lives in the DirectMessage Blocks Data collection (see
// blocks/data/schemas/DirectMessage.json): the sender writes a row, the
// recipient reads it back via the `recipientId` filter, and a 5s poll
// keeps both sides fresh (no push channel exists for Blocks Data).

import { useEffect, useMemo, useState } from "react";
import { MessageSquare } from "lucide-react";
import { useT } from "@/lib/blocks/i18n";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card } from "@/components/ui/card";
import { useAllJoinedUsers, type JoinedMember } from "@/lib/blocks/users";
import {
  useDirectMessages,
  useMarkDirectMessagesRead,
  useSendChatAttachment,
  useSendDirectMessage,
} from "@/lib/blocks/hooks";
import { useToast } from "@/hooks/useToast";
import type { DirectMessage } from "@/lib/blocks/data";
import { ChatMemberList } from "@/components/team-chat/ChatMemberList";
import { ChatThread } from "@/components/team-chat/ChatThread";
import { cn } from "@/lib/utils";

export type ChatMember = JoinedMember;

export function ChatPage() {
  const t = useT();
  const { currentUser } = useAuth();
  const me = currentUser?.id ?? "";

  // Roster: EVERY user who joined the workspace, straight from IAM —
  // no role filter, no hardcoded fallback. My own entry drops out; the
  // page never shows a self-chat.
  const joinedQuery = useAllJoinedUsers();
  const members = useMemo<ChatMember[]>(
    () => (joinedQuery.data ?? []).filter((m) => m.id !== me),
    [joinedQuery.data, me],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const messagesQuery = useDirectMessages();
  const send = useSendDirectMessage();
  const sendAttachment = useSendChatAttachment();
  const markRead = useMarkDirectMessagesRead();
  const messages = messagesQuery.data ?? [];
  const toast = useToast();
  const tAttachError = (message: string) =>
    t("chat.attachError", "Couldn't send attachment: {message}", { message });

  // Group by conversation counterpart. `counterpart` flips the row to the
  // "other side" of the exchange — senderId when I received it,
  // recipientId when I sent it.
  const counterpart = (m: DirectMessage) =>
    m.senderId === me ? m.recipientId : m.senderId;
  const { byMember, lastByMember, unreadByMember } = useMemo(() => {
    const byMember = new Map<string, DirectMessage[]>();
    const lastByMember = new Map<string, DirectMessage>();
    const unreadByMember = new Map<string, number>();
    for (const m of messages) {
      const key = counterpart(m);
      const list = byMember.get(key) ?? [];
      list.push(m);
      byMember.set(key, list);
      lastByMember.set(key, m); // `messages` arrives sorted asc by sentAt
      if (m.recipientId === me && !m.readAt) {
        unreadByMember.set(key, (unreadByMember.get(key) ?? 0) + 1);
      }
    }
    return { byMember, lastByMember, unreadByMember };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, me]);

  const selectedMember = members.find((m) => m.id === selectedId) ?? null;
  const selectedMessages = selectedId ? (byMember.get(selectedId) ?? []) : [];

  // Opening (or receiving into) a conversation clears its unread state:
  // every received-and-unread row gets `readAt` stamped. The mutation
  // invalidates the poll query; the refetched rows then have `readAt`
  // set, so the effect settles instead of looping. `isPending` keeps a
  // slow stamp from stacking duplicate updates.
  useEffect(() => {
    if (!selectedId || markRead.isPending) return;
    const unread = (byMember.get(selectedId) ?? []).filter(
      (m) => m.recipientId === me && !m.readAt,
    );
    if (unread.length > 0) markRead.mutate(unread);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, messages, me, markRead.isPending]);

  const totalUnread = [...unreadByMember.values()].reduce((a, b) => a + b, 0);

  // Messenger-style auto-open on desktop: the most recent conversation
  // (or the first roster entry for a fresh account) is selected the
  // moment the page loads, so the composer is ALWAYS visible — no
  // "select a member first" dead end. Mobile keeps the list-first flow
  // (the back button leads there), matching WhatsApp's phone UX.
  useEffect(() => {
    if (selectedId !== null || members.length === 0) return;
    if (!window.matchMedia("(min-width: 768px)").matches) return;
    const recent = [...lastByMember.entries()]
      .sort((a, b) => b[1].sentAt.localeCompare(a[1].sentAt))
      .find(([id]) => members.some((m) => m.id === id))?.[0];
    setSelectedId(recent ?? members[0]!.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, members, lastByMember]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" aria-hidden="true" />
            {t("chat.title", "Chat")}
          </span>
        }
        subtitle={t(
          "chat.description",
          "Direct messages between workspace members.",
        )}
      />

      <Card className="overflow-hidden">
        {/* Underscores in the calc = CSS spaces around the minus — without
            them the whole declaration is invalid and silently drops
            (fixed the composer falling below the fold on short screens). */}
        <div className="flex h-[calc(100dvh_-_15rem)] min-h-[22rem]">
          {/* Roster pane — hidden on phones once a thread is open (the
              thread takes the full width, with a back button). */}
          <div
            className={cn(
              "w-full flex-col border-r border-border md:flex md:w-80 md:shrink-0",
              selectedId ? "hidden" : "flex",
            )}
          >
            <ChatMemberList
              members={members}
              lastByMember={lastByMember}
              unreadByMember={unreadByMember}
              selectedId={selectedId}
              onSelect={setSelectedId}
              loading={joinedQuery.isLoading}
              error={joinedQuery.isError}
            />
          </div>

          {/* Thread pane — placeholder until a member is picked. */}
          <div
            className={cn(
              "min-w-0 flex-1 flex-col",
              selectedId ? "flex" : "hidden md:flex",
            )}
          >
            {selectedMember ? (
              <ChatThread
                member={selectedMember}
                messages={selectedMessages}
                me={me}
                sending={send.isPending || sendAttachment.isPending}
                onSend={(content) => {
                  if (selectedMember) {
                    send.mutate({
                      recipientId: selectedMember.id,
                      content,
                    });
                  }
                }}
                onSendAttachment={(content, file) => {
                  if (!selectedMember) return;
                  sendAttachment.mutate(
                    { recipientId: selectedMember.id, content, file },
                    {
                      onError: (err) => {
                        toast.error(tAttachError(err.message));
                      },
                    },
                  );
                }}
                onBack={() => setSelectedId(null)}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                <MessageSquare
                  className="h-10 w-10 text-muted-foreground/50"
                  aria-hidden="true"
                />
                <p className="text-sm text-muted-foreground">
                  {t(
                    "chat.selectMember",
                    "Select a member to start chatting.",
                  )}
                </p>
                {totalUnread > 0 && (
                  <p className="text-xs font-medium text-primary">
                    {t("chat.unreadHint", "{count} unread message(s)", {
                      count: totalUnread,
                    })}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
