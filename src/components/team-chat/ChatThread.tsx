// Right pane of the member chat page — the WhatsApp/Messenger-style
// conversation. Bubbles: mine right-aligned in the accent colour, theirs
// left-aligned muted. Day separators appear wherever the calendar day
// flips between messages. My bubbles carry a tick pair once the other
// side's client has stamped `readAt` (single tick = delivered, WhatsApp
// convention loosely applied).
//
// Image attachments: messages can carry an optional `attachmentFileId`
// (Blocks Data Storage file id). The bubble renders an inline thumb below
// the text; click → lightbox dialog with the full-resolution image via
// the shared `useFileDownloadUrl` query (TanStack-cached per file id).
//
// Roster previews are handled in `ChatMemberList.tsx` — this component
// does NOT surface unread counts; those live in the parent page so the
// roster and the thread agree on the same derived state.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  Image as ImageIcon,
  Paperclip,
  Send,
  X,
} from "lucide-react";
import { UserAvatar } from "@/components/ui/UserAvatar";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/lib/blocks/i18n";
import { useFileDownloadUrl } from "@/lib/blocks/hooks";
import { cn } from "@/lib/utils";
import type { DirectMessage } from "@/lib/blocks/data";
import type { ChatMember } from "@/pages/ChatPage";

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
  const [draft, setDraft] = useState("");
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [lightboxFileId, setLightboxFileId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Thread header — back button (mobile), avatar, name + role. */}
      <div className="flex items-center gap-3 border-b border-border px-3 py-2.5 md:px-4">
        <button
          type="button"
          onClick={onBack}
          aria-label={t("chat.back", "Back to members")}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <UserAvatar userId={member.id} name={member.name} size="md" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            {member.name}
          </p>
          <p className="truncate text-xs capitalize text-muted-foreground">
            {member.role}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-4 md:px-4">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">
              {t("chat.emptyThread", "No messages yet — say hello!")}
            </p>
          </div>
        ) : (
          withSeparators.map(({ message, dayLabel, showDay }) => {
            const mine = message.senderId === me;
            return (
              <div key={message.id}>
                {showDay && dayLabel && (
                  <div className="my-3 flex justify-center">
                    <span className="rounded-full bg-muted px-3 py-1 text-[11px] font-medium text-muted-foreground">
                      {dayLabel}
                    </span>
                  </div>
                )}
                <div
                  className={cn("flex", mine ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[75%] rounded-2xl px-3 py-2 text-sm leading-relaxed",
                      mine
                        ? "rounded-br-sm bg-primary text-primary-foreground"
                        : "rounded-bl-sm bg-muted text-foreground",
                    )}
                  >
                    {message.content && (
                      <p className="whitespace-pre-wrap break-words">
                        {message.content}
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
                    <span
                      className={cn(
                        "mt-1 flex items-center justify-end gap-1 text-[10px]",
                        mine
                          ? "text-primary-foreground/70"
                          : "text-muted-foreground",
                      )}
                    >
                      {timeOf(message.sentAt)}
                      {/* Read ticks on my messages only: double once the
                          recipient's client stamped readAt. */}
                      {mine &&
                        (message.readAt ? (
                          <CheckCheck
                            className="h-3 w-3"
                            aria-label={t("chat.read", "Read")}
                          />
                        ) : (
                          <Check className="h-3 w-3" aria-hidden="true" />
                        ))}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="border-t border-border p-3">
        {attachedFile && (
          <div className="mb-2 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs">
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
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
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
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Paperclip className="h-4 w-4" aria-hidden="true" />
          </button>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              attachedFile
                ? t("chat.placeholder", "Type a message…")
                : t("chat.placeholder", "Type a message…")
            }
            aria-label={t("chat.placeholder", "Type a message…")}
            className="h-10 flex-1 rounded-full border border-input bg-background px-4 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button
            type="submit"
            disabled={(!draft.trim() && !attachedFile) || sending}
            aria-label={t("chat.send", "Send")}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sending ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
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
    </div>
  );
}
