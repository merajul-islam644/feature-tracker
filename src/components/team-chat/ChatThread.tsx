// Right pane of the member chat page — redesigned around the
// apps-website ChatMockup reference. Three sections:
//
// 1. Compact thread header (~48px): avatar + name + "Active now"
//    status on the left, action icons (Search / MoreHorizontal) on
//    the right. Header height is bounded so the message stream is
//    the dominant real-estate on every screen, including laptops.
//
// 2. Message stream: bubbles stack the avatars next to the
//    bubble (left for theirs, right for mine) — distinguishes
//    speaker when several members have similar initials and
//    matches the reference's compact 260px-max bubble width.
//    Consecutive messages from the same sender collapse the avatar
//    + tighten the row spacing so bursts read as one flow, not
//    four disconnected bubbles (Telegram/WhatsApp pattern).
//    Mine: filled accent (bg-primary, white text). Theirs: white
//    card with hairline border. Footer line carries the timestamp
//    + read-ticks for mine.
//
// 3. Composer: single rounded-2xl pill that hosts paperclip +
//    emoji + text input + send button — mirrors the reference's
//    Gmail/Slack-style "one big pill" composer and visually
//    unifies the footer surface.
//
// Image attachments: messages carry an optional `attachmentFileId`
// (Blocks Data Storage file id). The bubble renders an inline
// thumb below the text; click → lightbox dialog with the full-
// resolution image via the shared `useFileDownloadUrl` query.
//
// Roster previews + unread counts live in the parent ChatPage
// (`ChatMemberList` reads them back via `lastByMember` /
// `unreadByMember`) — this component does NOT surface them, so the
// roster and the thread agree on the same derived state.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCheck,
  Copy,
  Image as ImageIcon,
  MessageSquareText,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Phone,
  PhoneMissed,
  PhoneOff,
  Search,
  Send,
  Smile,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { UserAvatar } from "@/components/ui/UserAvatar";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/lib/blocks/i18n";
import { useFileDownloadUrl } from "@/lib/blocks/hooks";
import {
  useDeleteDirectMessage,
  useEditDirectMessage,
  useLogCallOutcome,
  useToggleDirectMessageReaction,
} from "@/lib/blocks/hooks";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import type { DirectMessage } from "@/lib/blocks/data";
import type { ChatMember } from "@/pages/ChatPage";
import { EmojiPicker } from "./EmojiPicker";
import { CallDialog, type CallKind } from "./CallDialog";

function timeOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dayOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay
    ? ""
    : d.toLocaleDateString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
}

// Pick the icon for a call-log pill by inspecting the localized
// summary prefix. The renderer doesn't carry the structured outcome
// (just the human-readable string the writer built), so we infer from
// the label — `formatCallSummary` produces strings whose prefix is
// unique to each outcome. This keeps the pill renderer agnostic to
// the data shape and avoids leaking the wire tuple to the UI layer.
function CallLogIcon({ summary }: { summary: string }) {
  if (summary.startsWith("Missed ")) {
    return <PhoneMissed className="h-3 w-3" aria-hidden="true" />;
  }
  if (summary.startsWith("Declined ")) {
    return <PhoneOff className="h-3 w-3" aria-hidden="true" />;
  }
  if (summary.startsWith("Call failed")) {
    return <AlertTriangle className="h-3 w-3" aria-hidden="true" />;
  }
  // Default: a normal ended call — phone with line-through via the
  // dedicated icon so the pill reads "ended" at a glance.
  return <PhoneOff className="h-3 w-3" aria-hidden="true" />;
}

// "Active now" / "Last seen 5m ago" under the thread header. Driven
// by the most recent incoming message in the conversation — when
// the counterpart sent something in the last 5 minutes we treat
// them as active. Past 24h drops to a date stamp.
function presenceLabel(lastIso: string | undefined, t: ReturnType<typeof useT>): string {
  if (!lastIso) return t("chat.presenceNew", "No messages yet");
  const d = new Date(lastIso);
  if (Number.isNaN(d.getTime())) return t("chat.presenceNew", "No messages yet");
  const ageMin = (Date.now() - d.getTime()) / 60_000;
  if (ageMin < 5) return t("chat.presenceActive", "Active now");
  if (ageMin < 60)
    return t("chat.presenceMinutes", "Last seen {minutes}m ago", {
      minutes: Math.round(ageMin),
    });
  if (ageMin < 60 * 24)
    return t("chat.presenceHours", "Last seen {hours}h ago", {
      hours: Math.round(ageMin / 60),
    });
  return t("chat.presenceDays", "Last seen {days}d ago", {
    days: Math.round(ageMin / (60 * 24)),
  });
}

// Inline highlight for a substring inside a message bubble. Renders
// the match wrapped in a <mark> so the user sees WHERE inside the
// bubble the search hit. Splits on a case-insensitive regex; the
// original casing is preserved so the bubble still reads naturally.
function HighlightedText({
  text,
  query,
  isActive,
}: {
  text: string;
  query: string;
  isActive: boolean;
}) {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < text.length) {
    const idx = lower.indexOf(q, i);
    if (idx === -1) {
      out.push(<span key={key++}>{text.slice(i)}</span>);
      break;
    }
    if (idx > i) out.push(<span key={key++}>{text.slice(i, idx)}</span>);
    out.push(
      <mark
        key={key++}
        className={cn(
          "rounded-sm px-0.5",
          isActive
            ? "bg-primary text-primary-foreground"
            : "bg-primary/25 text-foreground",
        )}
      >
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    i = idx + q.length;
  }
  return <>{out}</>;
}

// Group a message's reactions by emoji. The bubble renders one pill
// per emoji with the count, so identical emojis collapse into a
// single pill. The toggle mutation dedupes (userId, emoji) on write,
// so each userId appears at most once per emoji.
function groupReactions(
  reactions: { userId: string; emoji: string }[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of reactions) {
    (out[r.emoji] ??= []).push(r.userId);
  }
  return out;
}

interface ChatThreadProps {
  member: ChatMember;
  messages: DirectMessage[];
  me: string;
  sending: boolean;
  onSend: (content: string) => void;
  /**
   * Send the staged text + image. The composer only fires this when
   * `attachedFile` is non-null; text-only sends go through `onSend` so
   * the two flows keep their independent pending state.
   */
  onSendAttachment: (content: string, file: File) => void;
  onBack: () => void;
}

// How close (in minutes) two messages from the same sender must be to
// collapse the avatar + tighten the gap. Anything beyond this gap
// starts a new "burst" and shows the avatar again — matches the
// Telegram/WhatsApp visual rhythm.
const SAME_SENDER_WINDOW_MIN = 5;

// Inline thumbnail for an attached image. Mirrors the `<UserAvatar>`
// `fileId → url` resolution chain via the shared TanStack cache so every
// bubble for the same file always shares one signed download URL. While
// the URL is in flight (poll cadence + presign roundtrip), a pulse
// skeleton keeps the bubble height stable so the thread doesn't jump.
function AttachmentThumb({
  fileId,
  alt,
  onOpen,
}: {
  fileId: string;
  alt: string;
  onOpen: () => void;
}) {
  const url = useFileDownloadUrl(fileId);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={alt}
      className="mt-1.5 block overflow-hidden rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {url.isPending || !url.data ? (
        <div className="h-32 w-48 animate-pulse rounded-md bg-current/10" />
      ) : (
        <img
          src={url.data}
          alt={alt}
          className="max-h-56 w-auto rounded-md object-cover"
          loading="lazy"
        />
      )}
    </button>
  );
}

// Full-resolution viewer. Uses the existing dialog primitive (matches the
// project-card + project-info modals) — closing on backdrop click or
// Escape comes for free. Re-fetches the URL on open so a stale 5min
// cache can never surface an expired SAS.
function ImageLightbox({
  fileId,
  alt,
  open,
  onClose,
}: {
  fileId: string | null;
  alt: string;
  open: boolean;
  onClose: () => void;
}) {
  const url = useFileDownloadUrl(open ? fileId : null);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl border-none bg-transparent p-0 shadow-none">
        <DialogTitle className="sr-only">{alt}</DialogTitle>
        {url.data ? (
          <img
            src={url.data}
            alt={alt}
            className="mx-auto max-h-[85vh] w-auto rounded-md object-contain"
          />
        ) : (
          <div className="mx-auto h-64 w-96 animate-pulse rounded-md bg-current/10" />
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ChatThread({
  member,
  messages,
  me,
  sending,
  onSend,
  onSendAttachment,
  onBack,
}: ChatThreadProps) {
  const t = useT();
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [lightboxFileId, setLightboxFileId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  // Inline edit state — when `editingId` is non-null, that message's
  // bubble swaps to a textarea bound to `editDraft`. Submitting
  // commits via useEditDirectMessage; cancel/Esc drops back to
  // read-only. Only the sender can edit (the bubble only shows the
  // edit trigger on the user's own messages).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  // Delete confirmation — the destructive confirm dialog only mounts
  // when this state is non-null so we don't render an invisible
  // modal on every render.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  // Voice / Video call state. `null` = closed. Opening fires the
  // real WebRTC CallDialog (callSignals-collection signaling + public
  // STUN). `callPermissionDenied` flips on when the OS rejects
  // getUserMedia so the header buttons reflect "you can't call until
  // you re-grant permission in site settings" instead of silently
  // popping an error toast every click.
  const [activeCall, setActiveCall] = useState<CallKind | null>(null);
  const [callPermissionDenied, setCallPermissionDenied] = useState(false);
  // Composer emoji picker open state — only one picker at a time.
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  // Reaction picker open state — tracks which row triggered it so
  // only one row's popover is open at a time.
  const [reactionPickerId, setReactionPickerId] = useState<string | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Per-message mutations — invalidated by their own onSuccess
  // invalidation; the parent thread re-renders with the fresh data
  // when each one settles.
  const editMutation = useEditDirectMessage();
  const deleteMutation = useDeleteDirectMessage();
  const reactMutation = useToggleDirectMessageReaction();
  // Call-log system-message writer — fired from CallDialog.onEnded so
  // the thread carries a permanent record of every call outcome
  // (voice call · 0:32 / Missed voice call / Declined voice call /
  // Call failed to connect). The mutation invalidates the
  // directMessages query so the next poll surfaces the new pill.
  const logCallOutcome = useLogCallOutcome();

  // Keep the newest message in view — on mount, on new messages, and on
  // poll refreshes (the 5s query tick can append incoming messages).
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, member.id]);

  const submit = () => {
    const trimmed = draft.trim();
    if (sending) return;
    if (attachedFile) {
      // Empty text is fine — the user can send an image-only message.
      onSendAttachment(trimmed, attachedFile);
      setAttachedFile(null);
      setDraft("");
      // Reset the native picker so picking the same file again still fires
      // `onChange` — the same trick ProfilePictureUpload uses.
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (!trimmed) return;
    onSend(trimmed);
    setDraft("");
  };

  // Open the OS file picker through the hidden <input>. The input is
  // hidden visually but kept in the DOM so its `accept` and `files` API
  // stay accessible to screen readers and assistive tooling.
  const openPicker = () => {
    fileInputRef.current?.click();
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Mirror ProfilePictureUpload's client-side guards. The mutation hook
    // re-validates, but rejecting here means we never stage a file the
    // hook would reject — the user gets an immediate toast and a clean
    // chip reset instead of a stalled preview.
    if (!file.type.startsWith("image/")) {
      window.alert(t("chat.attachInvalid", "Please pick an image file."));
      e.target.value = "";
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      window.alert(t("chat.attachTooLarge", "Image must be 4 MB or smaller."));
      e.target.value = "";
      return;
    }
    setAttachedFile(file);
    e.target.value = "";
  };

  const removeAttachment = () => {
    setAttachedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ---- Header action handlers (every icon does something real) ----
  //
  // Search opens an inline filter bar inside the thread (functional:
  // matches are highlighted, X of Y counter, prev/next cycling, Esc
  // to close). The Phone / Video icons open the real WebRTC
  // CallDialog — caller-side flow that signals via the CallSignal
  // Blocks Data collection and pairs with the global
  // IncomingCallDialog on the recipient's tab. The MoreHorizontal
  // menu holds the same Voice/Video items plus the fully-functional
  // "Copy email" and "Clear local view" actions.
  const openSearch = () => {
    setSearchOpen(true);
    setActiveMatchIndex(0);
  };
  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery("");
    setActiveMatchIndex(0);
  };
  const onVoiceCallClick = () => {
    setCallPermissionDenied(false);
    setActiveCall("voice");
  };
  const onVideoCallClick = () => {
    setCallPermissionDenied(false);
    setActiveCall("video");
  };
  const onCopyEmail = async () => {
    if (!member.email) return;
    try {
      await navigator.clipboard.writeText(member.email);
      toast.success(
        t("chat.emailCopied", `Copied ${member.email} to the clipboard.`),
      );
    } catch {
      toast.error(
        t(
          "chat.emailCopyFailed",
          "Couldn't copy the email — clipboard access was denied.",
        ),
      );
    }
  };
  const onClearLocalView = () => {
    // Local-only clear: scrolls back to the bottom, drops any
    // staged attachment, and clears the composer draft. Server-
    // side messages stay untouched — this is purely a "reset my
    // view of this conversation" affordance, not a destructive
    // delete of the actual chat history.
    setDraft("");
    setAttachedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    toast.success(t("chat.cleared", "Cleared the local view of this chat."));
  };

  // ---- Per-message handlers (edit / delete / react) ----
  //
  // Edit only available on the user's own messages, soft-deletes
  // only available on the user's own messages. Reactions are open
  // to both sender and recipient — anyone in the conversation can
  // pick a reaction; the toggle logic dedupes by (userId, emoji)
  // so picking the same emoji twice removes it.
  const beginEdit = (message: DirectMessage) => {
    setEditingId(message.id);
    setEditDraft(message.content);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft("");
  };
  const commitEdit = (message: DirectMessage) => {
    const trimmed = editDraft.trim();
    if (!trimmed || trimmed === message.content) {
      cancelEdit();
      return;
    }
    editMutation.mutate(
      {
        id: message.id,
        senderId: message.senderId,
        recipientId: message.recipientId,
        content: trimmed,
      },
      {
        onSuccess: () => {
          cancelEdit();
          toast.success(t("chat.edited", "Message updated."));
        },
        onError: (err) =>
          toast.error(
            t("chat.editError", "Couldn't edit the message: {error}", {
              error: err.message,
            }),
          ),
      },
    );
  };
  const confirmDelete = (message: DirectMessage) => {
    deleteMutation.mutate(
      {
        id: message.id,
        senderId: message.senderId,
        recipientId: message.recipientId,
      },
      {
        onSuccess: () => {
          setPendingDeleteId(null);
          toast.success(t("chat.deleted", "Message deleted."));
        },
        onError: (err) =>
          toast.error(
            t("chat.deleteError", "Couldn't delete the message: {error}", {
              error: err.message,
            }),
          ),
      },
    );
  };
  const toggleReaction = (
    message: DirectMessage,
    emoji: string,
  ) => {
    const mine = message.senderId === me;
    // Permission check — only parties to the conversation can react.
    // (Not strictly required because the collection is workspace-
    // readable, but a guard keeps the UI honest.)
    if (!mine && message.recipientId !== me) return;
    const has = message.reactions.some(
      (r) => r.userId === me && r.emoji === emoji,
    );
    const next = has
      ? message.reactions.filter(
          (r) => !(r.userId === me && r.emoji === emoji),
        )
      : [...message.reactions, { userId: me, emoji }];
    reactMutation.mutate({
      id: message.id,
      senderId: message.senderId,
      recipientId: message.recipientId,
      reactions: next,
    });
  };
  // Insert an emoji into the composer draft at the current cursor
  // position. Falls back to appending when the input isn't focused
  // (e.g. the user typed something, the picker opened via the
  // bubble's reaction button instead).
  const insertEmojiIntoDraft = (emoji: string) => {
    const el = composerRef.current;
    if (!el) {
      setDraft((d) => d + emoji);
      return;
    }
    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + emoji + draft.slice(end);
    setDraft(next);
    // Restore cursor right after the inserted emoji.
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  };

  // Precompute day separators: rendered above any message whose day
  // differs from the previous one's. Today renders as "" (no separator).
  const withSeparators = useMemo(
    () =>
      messages.map((m, i) => {
        const day = dayOf(m.sentAt);
        const prevDay = i > 0 ? dayOf(messages[i - 1]!.sentAt) : null;
        return {
          message: m,
          dayLabel: day,
          showDay: Boolean(day) && day !== prevDay,
        };
      }),
    [messages],
  );

  // For each message, decide whether to render the avatar. The user's
  // "profile pic on the top-left of every message" requirement means
  // every row shows the sender's pic — no burst collapsing. The
  // `isLastInBurst` + `showAvatar` derivation is kept for the existing
  // footer behavior (timestamp + read-tick only on the last row of a
  // burst), so the burst-window math still drives footer rendering
  // even though the avatar now always shows.
  const rows = useMemo(() => {
    return withSeparators.map(({ message, dayLabel, showDay }, i) => {
      const mine = message.senderId === me;
      const prev = i > 0 ? withSeparators[i - 1]! : null;
      const prevMine = prev ? prev.message.senderId === me : null;
      const prevTime = prev ? new Date(prev.message.sentAt).getTime() : null;
      const myTime = new Date(message.sentAt).getTime();
      const closeEnough =
        prev !== null &&
        prevMine === mine &&
        prevTime !== null &&
        Math.abs(myTime - prevTime) < SAME_SENDER_WINDOW_MIN * 60_000;
      return {
        message,
        dayLabel,
        showDay,
        mine,
        // Always show the pic — the user asked for the profile pic
        // on the top-left of every message, so the burst-collapsing
        // we used to do for visual rhythm is removed.
        showAvatar: true,
        isLastInBurst:
          i === withSeparators.length - 1 ||
          withSeparators[i + 1]!.message.senderId !== message.senderId ||
          Math.abs(
            new Date(withSeparators[i + 1]!.message.sentAt).getTime() - myTime,
          ) >= SAME_SENDER_WINDOW_MIN * 60_000,
      };
    });
  }, [withSeparators, me]);

  // Active-now label for the header subtitle. Driven by the most recent
  // incoming message in the conversation — not a real presence system,
  // but a cheap visual cue that makes the header feel alive.
  const lastIncoming = useMemo(
    () =>
      [...messages]
        .reverse()
        .find((m) => m.senderId === member.id)?.sentAt ??
      messages[messages.length - 1]?.sentAt,
    [messages, member.id],
  );

  // ---- Search: client-side filter over the current thread ----
  //
  // Walks every message's text and tags the ones containing
  // `searchQuery` (case-insensitive). Each bubble receives a
  // `searchMatch` flag so the renderer can dim non-matching
  // messages and the matched text inside the bubbles gets wrapped
  // in <mark> via `HighlightedText`. The active match gets the
  // brighter accent + auto-scrolls into view; the rest of the
  // matches keep a softer highlight so the user can scan ahead.
  const searchLower = searchQuery.trim().toLowerCase();
  const matchingRows = useMemo(() => {
    if (!searchLower) return [] as number[];
    const idxs: number[] = [];
    rows.forEach((row, i) => {
      if (row.message.content?.toLowerCase().includes(searchLower)) {
        idxs.push(i);
      }
    });
    return idxs;
  }, [rows, searchLower]);
  // Clamp the active index when the match set shrinks (typing
  // shorter query, deleting chars).
  useEffect(() => {
    if (matchingRows.length === 0) {
      setActiveMatchIndex(0);
      return;
    }
    if (activeMatchIndex >= matchingRows.length) {
      setActiveMatchIndex(matchingRows.length - 1);
    }
  }, [matchingRows.length, activeMatchIndex]);
  const gotoNextMatch = () => {
    if (matchingRows.length === 0) return;
    setActiveMatchIndex((i) => (i + 1) % matchingRows.length);
  };
  const gotoPrevMatch = () => {
    if (matchingRows.length === 0) return;
    setActiveMatchIndex(
      (i) => (i - 1 + matchingRows.length) % matchingRows.length,
    );
  };
  // Auto-scroll the active match into view whenever it changes.
  useEffect(() => {
    if (!searchLower || matchingRows.length === 0) return;
    const el = document.querySelector<HTMLElement>(
      `[data-search-match-index="${matchingRows[activeMatchIndex]}"]`,
    );
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeMatchIndex, matchingRows, searchLower]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Thread header.
          Compact single bar (h-12) matching the apps-website
          ChatMockup reference. Mobile keeps a back button so the
          roster pane (full-width) can be navigated back to from
          thread (also full-width on phones). Action icons on the
          right are decorative chat affordances — they render at
          the same muted color so they don't look broken or
          disabled (matches the reference's slate-500 styling). */}
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-3 md:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={onBack}
            aria-label={t("chat.back", "Back to members")}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <UserAvatar
            userId={member.id}
            name={member.name}
            className="h-8 w-8 text-xs"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {member.name}
            </p>
            <p
              className={cn(
                "truncate text-[10px] font-medium tracking-wide",
                // Active (< 5m) wears the success token so the green
                // dot under the name reads as a real status — older
                // sessions drop back to the muted gray.
                isActive(lastIncoming)
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-muted-foreground",
              )}
            >
              {presenceLabel(lastIncoming, t)}
            </p>
          </div>
        </div>
        {/* Action affordances — every icon does something real:
            • Phone → real WebRTC voice call (STUN; see caveat in title)
            • Video → real WebRTC video call (same caveat)
            • Search → opens the inline search bar (fully functional)
            • MoreHorizontal → DropdownMenu with Copy email (real),
              Clear local view (real), Voice/Video call so the menu
              mirrors the header affordances. The NAT caveat on the
              title attributes is duplicated here so the user gets the
              warning from every entry point. */}
        <div className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
          <button
            type="button"
            onClick={onVoiceCallClick}
            disabled={callPermissionDenied}
            title={
              callPermissionDenied
                ? t(
                    "chat.callPermissionFix",
                    "Allow access from the site settings to enable calls.",
                  )
                : `${t("chat.voiceCall", "Voice call")} — ${t(
                    "chat.callNatCaveat",
                    "calls may fail on strict NAT networks",
                  )}`
            }
            aria-label={t("chat.voiceCall", "Voice call")}
            className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <Phone className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onVideoCallClick}
            disabled={callPermissionDenied}
            title={
              callPermissionDenied
                ? t(
                    "chat.callPermissionFix",
                    "Allow access from the site settings to enable calls.",
                  )
                : `${t("chat.videoCall", "Video call")} — ${t(
                    "chat.callNatCaveat",
                    "calls may fail on strict NAT networks",
                  )}`
            }
            aria-label={t("chat.videoCall", "Video call")}
            className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <Video className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={openSearch}
            title={t("chat.searchInConversation", "Search in conversation")}
            aria-label={t("chat.searchInConversation", "Search in conversation")}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              searchOpen && "bg-accent text-foreground",
            )}
          >
            <Search className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title={t("chat.moreActions", "Conversation options")}
                aria-label={t("chat.moreActions", "Conversation options")}
                className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={onCopyEmail} disabled={!member.email}>
                <Copy className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                {t("chat.copyEmail", "Copy email")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onClearLocalView}>
                <Trash2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                {t("chat.clearLocalView", "Clear local view")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={onVoiceCallClick}
                disabled={callPermissionDenied}
              >
                <Phone className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                {t("chat.voiceCallMenu", "Voice call")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={onVideoCallClick}
                disabled={callPermissionDenied}
              >
                <Video className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                {t("chat.videoCallMenu", "Video call")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Messages — bubble style mirrors the reference. Bubble max
          width is capped at `max-w-[260px]` so a long message still
          leaves room on the side for the avatar + footer text;
          wider viewports just keep the bubbles at the same width
          (more white space around them). Consecutive messages from
          the same sender collapse the avatar (Telegram-style) so
          bursts read as a single flow rather than four disjoint
          bubbles. */}
      {searchOpen && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-background px-3 py-2">
          <Search
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                closeSearch();
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey) gotoPrevMatch();
                else gotoNextMatch();
              }
            }}
            placeholder={t("chat.searchInputPlaceholder", "Search messages…")}
            aria-label={t("chat.searchInputPlaceholder", "Search messages…")}
            className="h-7 min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
          />
          {searchLower && (
            <span className="shrink-0 text-[10px] font-medium text-muted-foreground tabular-nums">
              {matchingRows.length === 0
                ? t("chat.searchNoMatches", "0 of 0")
                : t("chat.searchMatchCount", "{active} of {total}", {
                    active: activeMatchIndex + 1,
                    total: matchingRows.length,
                  })}
            </span>
          )}
          <button
            type="button"
            onClick={gotoPrevMatch}
            disabled={matchingRows.length === 0}
            aria-label={t("chat.searchPrev", "Previous match")}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m18 15-6-6-6 6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={gotoNextMatch}
            disabled={matchingRows.length === 0}
            aria-label={t("chat.searchNext", "Next match")}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={closeSearch}
            aria-label={t("chat.searchClose", "Close search")}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto bg-gradient-to-b from-muted/30 via-muted/20 to-muted/30 px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="relative">
              {/* Soft gradient halo behind the icon — adds visual
                  weight without committing to an illustration that
                  would need theming for every brand surface. */}
              <div className="absolute inset-0 -m-3 rounded-full bg-gradient-to-br from-primary/15 via-primary/5 to-transparent blur-xl" />
              <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 ring-1 ring-primary/15">
                <MessageSquareText
                  className="h-6 w-6 text-primary/70"
                  aria-hidden="true"
                />
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                {t("chat.emptyThreadTitle", `Start the conversation with ${member.name}`)}
              </p>
              <p className="text-xs text-muted-foreground">
                {t(
                  "chat.emptyThreadHint",
                  "Send a message, an image, or a quick hello — it all goes here.",
                )}
              </p>
            </div>
          </div>
        ) : (
          rows.map(({ message, dayLabel, showDay, mine, showAvatar, isLastInBurst }, rowIndex) => {
            // Search state for this row: which matching index in the
            // overall match list does this row represent, and is it
            // the one the user has navigated to. Drives the dim +
            // mark styling below.
            const matchIndexInList = searchLower
              ? matchingRows.indexOf(rowIndex)
              : -1;
            const isMatch = matchIndexInList !== -1;
            const isActiveMatch =
              isMatch && matchIndexInList === activeMatchIndex;
            const dimmed = searchLower && !isMatch;
            // ---- Call-log system pill branch ----
            // System rows (messageType === "call_log") render a centered
            // pill matching the day-separator visual tokens, with the
            // outcome label from `callSummary`. No avatar, no
            // mine/theirs alignment, no hover actions, no reactions —
            // the pill IS the whole row. The outcome string encodes
            // enough info that the same renderer handles all four
            // outcomes ("Voice call · 0:32" / "Missed voice call" /
            // "Declined voice call" / "Call failed to connect").
            if (message.messageType === "call_log" && message.callSummary) {
              return (
                <div
                  key={message.id}
                  data-search-match-index={isMatch ? rowIndex : undefined}
                  className={cn(
                    "my-3 flex justify-center transition-opacity",
                    dimmed && "opacity-30",
                    isActiveMatch && "rounded-md ring-2 ring-primary/60",
                  )}
                >
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-background px-3 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-border">
                    <CallLogIcon summary={message.callSummary} />
                    {message.callSummary}
                  </span>
                </div>
              );
            }
            return (
            <div
              key={message.id}
              data-search-match-index={isMatch ? rowIndex : undefined}
              className={cn(
                "transition-opacity",
                dimmed && "opacity-30",
                isActiveMatch && "rounded-md ring-2 ring-primary/60",
              )}
            >
              {showDay && dayLabel && (
                <div className="my-3 flex justify-center">
                  <span className="rounded-full bg-background px-3 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-border">
                    {dayLabel}
                  </span>
                </div>
              )}
              <div
                className={cn(
                  // The avatar sits at the TOP-LEFT of every message
                  // (mine + theirs), per the user's layout request.
                  // `items-start` aligns the pic column to the top so
                  // a tall bubble doesn't push the pic down to the
                  // bottom edge. `justify-end` keeps the
                  // [pic | bubble] cluster pinned to the right edge
                  // for mine; `justify-start` pins it to the left for
                  // theirs.
                  "flex items-start gap-2 transition-[margin]",
                  mine ? "justify-end" : "justify-start",
                  // mt-0.5 for all rows now — the avatar always
                  // shows, so there's no burst-collapse rhythm to
                  // preserve. The mt-0.5 keeps consecutive rows tight.
                  "mt-0.5",
                )}
              >
                {/* Avatar slot — the sender's profile pic at the
                    top-left of EVERY message. Always visible (no
                    burst collapsing) so each row clearly shows who
                    sent it. */}
                <div className="flex w-6 shrink-0 justify-center pt-0.5">
                  {showAvatar && (
                    <UserAvatar
                      userId={mine ? me : member.id}
                      name={mine ? t("chat.you", "You") : member.name}
                      className="h-6 w-6 text-[10px]"
                    />
                  )}
                </div>
                <div
                  className={cn(
                    "group relative flex max-w-[260px] flex-col",
                    mine ? "items-end" : "items-start",
                  )}
                >
                  {/* Hover actions — sit on the outside edge of the
                      bubble row so they don't overlap the bubble
                      content. Edit + Delete only on the sender's own
                      non-deleted messages; React on every live
                      message (sender or recipient). */}
                  {!message.deletedAt && (
                    <div
                      className={cn(
                        "absolute -top-3 z-10 flex items-center gap-0.5 rounded-full border border-border bg-background px-1 py-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-within:opacity-100",
                        mine ? "left-2" : "right-2",
                      )}
                    >
                      <EmojiPicker
                        open={reactionPickerId === message.id}
                        onOpenChange={(open) =>
                          setReactionPickerId(open ? message.id : null)
                        }
                        onPick={(emoji) => {
                          toggleReaction(message, emoji);
                          setReactionPickerId(null);
                        }}
                        align={mine ? "end" : "start"}
                        side="top"
                        trigger={
                          <button
                            type="button"
                            aria-label={t("chat.addReaction", "Add reaction")}
                            className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <Smile className="h-3 w-3" aria-hidden="true" />
                          </button>
                        }
                      />
                      {mine && editingId !== message.id && (
                        <button
                          type="button"
                          onClick={() => beginEdit(message)}
                          aria-label={t("chat.editMessage", "Edit message")}
                          className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Pencil className="h-3 w-3" aria-hidden="true" />
                        </button>
                      )}
                      {mine && (
                        <button
                          type="button"
                          onClick={() => setPendingDeleteId(message.id)}
                          aria-label={t("chat.deleteMessage", "Delete message")}
                          className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  )}
                  {message.deletedAt ? (
                    // Tombstone — soft-deleted messages render an
                    // italic placeholder instead of the original
                    // content / attachment. Footer is hidden so the
                    // timestamp doesn't imply a still-live message.
                    <div
                      className={cn(
                        "rounded-2xl border border-dashed border-border/60 bg-muted/40 px-3 py-1.5 text-xs italic text-muted-foreground",
                        mine ? "rounded-br-md" : "rounded-bl-md",
                      )}
                    >
                      {t("chat.tombstone", "This message was deleted")}
                    </div>
                  ) : editingId === message.id ? (
                    // Edit mode — bubble swaps to a textarea + Save
                    // / Cancel. Same width as the bubble so the row
                    // doesn't jump. Enter commits, Esc cancels.
                    <div className="flex w-full flex-col gap-1">
                      <textarea
                        autoFocus
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            commitEdit(message);
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            cancelEdit();
                          }
                        }}
                        rows={Math.min(6, Math.max(1, editDraft.split("\n").length))}
                        className={cn(
                          "min-h-[2.5rem] w-full resize-none rounded-2xl border border-input bg-background px-3 py-1.5 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          mine ? "rounded-br-md" : "rounded-bl-md",
                        )}
                      />
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={editMutation.isPending}
                          className="rounded-md px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                        >
                          {t("common.cancel", "Cancel")}
                        </button>
                        <button
                          type="button"
                          onClick={() => commitEdit(message)}
                          disabled={
                            editMutation.isPending || !editDraft.trim()
                          }
                          className="rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {t("common.save", "Save")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className={cn(
                        "rounded-2xl px-3 py-1.5 text-xs leading-relaxed shadow-sm transition-shadow",
                        "hover:shadow-md",
                        mine
                          ? "rounded-br-md bg-primary text-primary-foreground"
                          : "rounded-bl-md border border-border bg-background text-foreground",
                      )}
                    >
                      {message.content && (
                        <p className="whitespace-pre-wrap break-words">
                          <HighlightedText
                            text={message.content}
                            query={isMatch ? searchLower : ""}
                            isActive={isActiveMatch}
                          />
                        </p>
                      )}
                      {message.attachmentFileId && (
                        <AttachmentThumb
                          fileId={message.attachmentFileId}
                          alt={t("chat.attachOpen", "Open image")}
                          onOpen={() =>
                            setLightboxFileId(message.attachmentFileId)
                          }
                        />
                      )}
                    </div>
                  )}
                  {/* Reactions row — appears below the bubble when
                      there's at least one reaction. Each emoji is a
                      pill; clicking the same pill toggles your
                      reaction off. */}
                  {!message.deletedAt && message.reactions.length > 0 && (
                    <div
                      className={cn(
                        "mt-1 flex flex-wrap gap-1 px-1",
                        mine ? "justify-end" : "justify-start",
                      )}
                    >
                      {Object.entries(groupReactions(message.reactions)).map(
                        ([emoji, userIds]) => {
                          const mineReacted = userIds.includes(me);
                          return (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => toggleReaction(message, emoji)}
                              aria-pressed={mineReacted}
                              aria-label={`${emoji} ${userIds.length}`}
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                mineReacted
                                  ? "border-primary/40 bg-primary/10 text-foreground"
                                  : "border-border bg-background text-muted-foreground",
                              )}
                            >
                              <span className="text-xs leading-none">
                                {emoji}
                              </span>
                              <span className="font-medium tabular-nums">
                                {userIds.length}
                              </span>
                            </button>
                          );
                        },
                      )}
                    </div>
                  )}
                  {/* Footer below the bubble carries the
                      timestamp + (edited) marker + read-ticks for
                      mine — only shown on the last bubble of a burst
                      so the time doesn't repeat four times for one
                      typing spree. Sits flush under the bubble so it
                      doesn't wrap onto multiple lines on narrow
                      widths. */}
                  {isLastInBurst && !message.deletedAt && (
                    <span className="mt-1 flex items-center gap-1 px-1 text-[10px] text-muted-foreground">
                      <span>{timeOf(message.sentAt)}</span>
                      {message.editedAt && (
                        <span
                          className="italic"
                          title={t(
                            "chat.editedAt",
                            "Edited {when}",
                            {
                              when: new Date(message.editedAt).toLocaleString(),
                            },
                          )}
                        >
                          {t("chat.editedMarker", "(edited)")}
                        </span>
                      )}
                      {mine &&
                        (message.readAt ? (
                          <CheckCheck
                            className="h-3 w-3 text-primary"
                            aria-label={t("chat.read", "Read")}
                          />
                        ) : (
                          <Check
                            className="h-3 w-3"
                            aria-hidden="true"
                          />
                        ))}
                    </span>
                  )}
                </div>
              </div>
            </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer — single rounded-2xl pill matching the
          apps-website reference. The pill hosts paperclip + emoji
          affordances + the text input + the send button so the
          whole input zone reads as one "send a message" surface
          instead of four disjoint buttons. Hover/focus lifts on
          the send button (matches the reference's filled-circle
          send). */}
      <div className="border-t border-border p-3">
        {attachedFile && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5 text-xs shadow-sm">
            <ImageIcon
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate text-foreground">
              {attachedFile.name}
            </span>
            <button
              type="button"
              onClick={removeAttachment}
              disabled={sending}
              aria-label={t("chat.attachRemove", "Remove")}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex items-center gap-1 rounded-2xl border border-input bg-muted/40 px-2.5 py-1.5 transition-colors focus-within:border-ring focus-within:bg-background focus-within:ring-2 focus-within:ring-ring"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={onPick}
            className="sr-only"
            aria-hidden="true"
            tabIndex={-1}
          />
          <button
            type="button"
            onClick={openPicker}
            disabled={sending}
            aria-label={t("chat.attachButtonLabel", "Attach an image")}
            title={t("chat.attachButton", "Attach image")}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <EmojiPicker
            open={emojiPickerOpen}
            onOpenChange={setEmojiPickerOpen}
            onPick={insertEmojiIntoDraft}
            align="start"
            side="top"
            trigger={
              <button
                type="button"
                disabled={sending}
                aria-label={t("chat.emojiLabel", "Emoji")}
                title={t("chat.emojiLabel", "Emoji")}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Smile className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            }
          />
          <input
            ref={composerRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("chat.placeholder", `Message ${member.name}…`)}
            aria-label={t("chat.placeholder", "Type a message…")}
            className="h-8 min-w-0 flex-1 bg-transparent px-1 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
          />
          <button
            type="submit"
            disabled={(!draft.trim() && !attachedFile) || sending}
            aria-label={t("chat.send", "Send")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sending ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        </form>
      </div>

      <ImageLightbox
        fileId={lightboxFileId}
        alt={t("chat.attachOpen", "Open image")}
        open={lightboxFileId !== null}
        onClose={() => setLightboxFileId(null)}
      />

      {/* Delete confirmation dialog. Soft-delete is irreversible
          from the recipient's side (the row's content/attachment is
          blanked), so confirm before mutating. */}
      <Dialog
        open={pendingDeleteId !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDeleteId(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogTitle className="text-base font-semibold text-foreground">
            {t("chat.deleteConfirmTitle", "Delete this message?")}
          </DialogTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            {t(
              "chat.deleteConfirmBody",
              "The message will be removed from this conversation. This can't be undone.",
            )}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPendingDeleteId(null)}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("common.cancel", "Cancel")}
            </button>
            <button
              type="button"
              onClick={() => {
                const m = messages.find((x) => x.id === pendingDeleteId);
                if (m) confirmDelete(m);
              }}
              disabled={deleteMutation.isPending}
              className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deleteMutation.isPending
                ? t("common.deleting", "Deleting…")
                : t("chat.deleteAction", "Delete")}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Real WebRTC call dialog — opened by the header's Phone / Video
          icons (or the matching items in the menu). One dialog per call
          direction; the caller side drives this dialog, while the
          recipient gets IncomingCallDialog + the answerer variant
          (handled globally in AppLayout). */}
      {activeCall && (
        <CallDialog
          member={member}
          kind={activeCall}
          role="caller"
          open={true}
          onClose={() => setActiveCall(null)}
          onEnded={(kind, durationSec, reason, peerId, signalId) => {
            // Localized closing toast keyed off `reason` so a declined
            // call shows "Call declined" instead of "Voice call ended
            // after 0s." — the same pattern the mock used for the
            // duration counter.
            if (reason === "declined") {
              toast.info(t("chat.callDeclinedToast", "Call declined."));
            } else if (reason === "missed") {
              toast.info(t("chat.callMissed", "No answer."));
            } else if (reason === "error") {
              // STUN-failure toast already fired from onConnectionStateChange.
              // Don't double-toast.
            } else if (durationSec > 0) {
              toast.info(
                kind === "voice"
                  ? t(
                      "chat.voiceCallEnded",
                      "Voice call ended after {seconds}s.",
                      { seconds: durationSec },
                    )
                  : t(
                      "chat.videoCallEnded",
                      "Video call ended after {seconds}s.",
                      { seconds: durationSec },
                    ),
              );
            }
            // Persist a system-message pill in the thread so the call
            // outcome is part of the conversation history. The
            // "who writes the row" rule is "the side whose user action
            // ended the call" — caller side fires for
            // hangup/missed/error, recipient side fires for declined
            // (from IncomingCallDialog). Skip `declined` here because
            // the recipient's IncomingCallDialog already wrote the
            // row in that case; logging it again would render a
            // duplicate pill in both threads.
            //
            // Map the CallDialog reason → DirectMessage outcome:
            //   hangup → "ended" (with durationSec)
            //   missed → "missed" (no duration, call never connected)
            //   error → "error" (no duration)
            //   declined → skip (already logged by recipient)
            if (peerId && reason !== "declined") {
              const outcome: "ended" | "missed" | "error" =
                reason === "hangup"
                  ? "ended"
                  : reason === "missed"
                    ? "missed"
                    : "error";
              logCallOutcome.mutate({
                recipientId: peerId,
                kind,
                outcome,
                durationSec: outcome === "ended" ? durationSec : undefined,
                endedAtIso: new Date().toISOString(),
              });
            }
            // `signalId` is forwarded from CallDialog for the rare
            // double-fire dedupe; v1 trusts the caller/recipient
            // asymmetry so we don't read it back here.
            void signalId;
          }}
          onPermissionDenied={() => {
            setCallPermissionDenied(true);
            setActiveCall(null);
          }}
        />
      )}
    </div>
  );
}

// Presence helper — pulled out so the `useMemo` for the rows above
// and the `isActive` call below both share the same threshold check.
// Anything inside the 5-minute window counts as "active".
function isActive(iso: string | undefined): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < 5 * 60_000;
}
