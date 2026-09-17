// Comments modal for a flow row.
//
// Layout (the three scroll/fixed regions keep the action buttons
// reachable even on short viewports):
//
//   ┌──────────────────────────────────────────┐
//   │ Header: title "Comments" + flow name    ×│
//   ├──────────────────────────────────────────┤
//   │ Body (scrollable):                       │
//   │   • Empty state OR                       │
//   │   • List of comments + their replies    │
//   │       (avatar · name (email) · time ·   │
//   │        body · [Reply])                   │
//   │       Replies render indented with a     │
//   │       cyan left border. Clicking Reply   │
//   │       reveals an inline form.            │
//   ├──────────────────────────────────────────┤
//   │ Form (fixed): "Add a comment" + counter  │
//   ├──────────────────────────────────────────┤
//   │ Footer: [Cancel] [Save]                  │
//   └──────────────────────────────────────────┘
//
// Comments live in the parent (FlowItem) state — persisted to
// localStorage so "Save" actually persists across reloads. Each
// top-level comment can have a flat list of replies; replies don't
// themselves have replies to keep the UI simple.

import { useEffect, useRef, useState } from "react";
import { MessageCircle, Reply } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLocale, useT } from "@/lib/blocks/i18n";
import { cn } from "@/lib/utils";

export interface FlowCommentReply {
  id: string;
  authorName: string;
  authorEmail: string;
  authorAvatar?: string;
  content: string;
  createdAt: string;
}

export interface FlowComment {
  id: string;
  authorName: string;
  authorEmail: string;
  authorAvatar?: string;
  content: string;
  createdAt: string;
  /** Flat list of replies (one level only). */
  replies: FlowCommentReply[];
}

interface CommentsModalProps {
  open: boolean;
  onClose: () => void;
  /** Flow name shown in the modal subtitle. */
  flowName: string;
  /** All comments on this flow, oldest first. */
  comments: FlowComment[];
  /** Append a new top-level comment. */
  onAddComment: (content: string) => void;
  /** Append a reply under the comment with the given id. */
  onAddReply: (parentId: string, content: string) => void;
  /** Display name of the current user — used for new comments. */
  currentUserName: string;
  /** Email of the current user — shown alongside the name. */
  currentUserEmail: string;
  /** Optional avatar URL of the current user. */
  currentUserAvatar?: string;
}

const MAX_LENGTH = 500;

export function CommentsModal({
  open,
  onClose,
  flowName,
  comments,
  onAddComment,
  onAddReply,
  currentUserName,
  currentUserEmail,
  currentUserAvatar,
}: CommentsModalProps) {
  const t = useT();
  const { formatRelativeTime } = useLocale();

  // Top-level comment draft.
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reply state — only one reply form is open at a time. `replyingTo`
  // is the parent comment id; `replyDraft` is the textarea content.
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);
  const replyTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset the top-level draft + focus its textarea each time the modal
  // opens. Errors clear so a previous failed submit doesn't bleed into
  // the new session. Reply state is always reset on open too — the user
  // shouldn't see a half-typed reply when they reopen the modal.
  useEffect(() => {
    if (open) {
      setDraft("");
      setError(null);
      setReplyingTo(null);
      setReplyDraft("");
      setReplyError(null);
      // Defer focus until after the dialog's open animation has
      // mounted the content — focusing too early hits a stale ref.
      const id = window.setTimeout(() => textareaRef.current?.focus(), 50);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  const handleOpenChange = (next: boolean) => {
    if (next) return;
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) {
      setError(t("flowComments.required", "Comment cannot be empty."));
      return;
    }
    if (trimmed.length > MAX_LENGTH) {
      setError(t("flowComments.tooLong", "Comment is too long."));
      return;
    }
    onAddComment(trimmed);
    setDraft("");
    setError(null);
  };

  const startReply = (parentId: string) => {
    setReplyingTo(parentId);
    setReplyDraft("");
    setReplyError(null);
    // Focus the reply textarea after the dialog has time to render
    // the new form row. Matches the top-level textarea's defer.
    window.setTimeout(() => replyTextareaRef.current?.focus(), 50);
  };

  const cancelReply = () => {
    setReplyingTo(null);
    setReplyDraft("");
    setReplyError(null);
  };

  const submitReply = (parentId: string) => (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = replyDraft.trim();
    if (!trimmed) {
      setReplyError(t("flowComments.required", "Comment cannot be empty."));
      return;
    }
    if (trimmed.length > MAX_LENGTH) {
      setReplyError(t("flowComments.tooLong", "Comment is too long."));
      return;
    }
    onAddReply(parentId, trimmed);
    setReplyingTo(null);
    setReplyDraft("");
    setReplyError(null);
  };

  const remaining = MAX_LENGTH - draft.length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/*
        Grid-template-rows keeps the three regions (header / body /
        form / footer) properly bounded: header + footer take their
        natural height, body fills the rest with its own scroll. Without
        this, a long thread would push the action buttons off-screen.
        min-h-0 on the body row is what lets overflow-y-auto actually
        take effect inside a grid track.
      */}
      <DialogContent
        size="md"
        className="max-h-[85vh] grid-rows-[auto_minmax(0,1fr)_auto_auto]"
      >
        <DialogCloseButton />
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-cyan-700" aria-hidden="true" />
            {t("flowComments.title", "Comments")}
          </DialogTitle>
          <DialogDescription>{flowName}</DialogDescription>
        </DialogHeader>

        {/* Scrollable comments region. min-h-0 is required to make
            overflow work inside a grid track. */}
        <DialogBody className="space-y-2 overflow-y-auto min-h-0">
          {comments.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-4 py-10 text-center">
              <MessageCircle
                className="h-7 w-7 text-muted-foreground/60"
                aria-hidden="true"
              />
              <p className="text-sm font-medium text-foreground">
                {t("flowComments.empty", "No comments yet")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t(
                  "flowComments.emptyHint",
                  "Start the conversation by adding one below.",
                )}
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {comments.map((c) => (
                <CommentItem
                  key={c.id}
                  comment={c}
                  formatRelativeTime={formatRelativeTime}
                  isReplying={replyingTo === c.id}
                  replyDraft={replyDraft}
                  replyError={replyError}
                  replyTextareaRef={replyTextareaRef}
                  onStartReply={() => startReply(c.id)}
                  onCancelReply={cancelReply}
                  onChangeReplyDraft={(v) => {
                    setReplyDraft(v);
                    if (replyError) setReplyError(null);
                  }}
                  onSubmitReply={submitReply(c.id)}
                />
              ))}
            </ul>
          )}
        </DialogBody>

        {/* Fixed "add a comment" form. Stays visible above the
            scrolling comments region so the user always sees the
            input they're typing into. */}
        <div className="border-t border-border px-5 py-3">
          <form
            id="add-comment-form"
            onSubmit={handleSubmit}
            noValidate
            className="space-y-2"
          >
            <label
              htmlFor="new-comment"
              className="text-sm font-medium text-foreground"
            >
              {t("flowComments.addLabel", "Add a comment")}
            </label>
            <textarea
              id="new-comment"
              ref={textareaRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (error) setError(null);
              }}
              maxLength={MAX_LENGTH}
              rows={2}
              placeholder={t("flowComments.placeholder", "Write a comment…")}
              className={cn(
                "flex w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                error && "border-destructive focus-visible:ring-destructive",
              )}
            />
            <p
              className={cn(
                "text-xs",
                error ? "text-destructive" : "text-muted-foreground",
              )}
              role={error ? "alert" : undefined}
            >
              {error ??
                t("flowComments.charCount", "{remaining} characters left", {
                  remaining,
                })}
            </p>
          </form>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} type="button">
            {t("cancel", "Cancel")}
          </Button>
          <Button
            type="submit"
            form="add-comment-form"
            disabled={!draft.trim()}
          >
            {t("flowComments.save", "Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// One top-level comment + its reply thread. Extracted so the parent
// JSX stays readable. Each comment is its own card; replies sit indented
// underneath with a cyan left border so the visual relationship reads.
function CommentItem({
  comment,
  formatRelativeTime,
  isReplying,
  replyDraft,
  replyError,
  replyTextareaRef,
  onStartReply,
  onCancelReply,
  onChangeReplyDraft,
  onSubmitReply,
}: {
  comment: FlowComment;
  formatRelativeTime: (iso: string) => string;
  isReplying: boolean;
  replyDraft: string;
  replyError: string | null;
  replyTextareaRef: React.RefObject<HTMLTextAreaElement>;
  onStartReply: () => void;
  onCancelReply: () => void;
  onChangeReplyDraft: (v: string) => void;
  onSubmitReply: (e: React.FormEvent) => void;
}) {
  const t = useT();
  return (
    <li className="rounded-md border border-border bg-card p-3">
      <div className="flex gap-3">
        <Avatar
          name={comment.authorName}
          avatarUrl={comment.authorAvatar}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-sm font-medium text-foreground">
              {comment.authorName}
            </span>
            {comment.authorEmail && (
              <span className="text-xs text-muted-foreground">
                ({comment.authorEmail})
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              · {formatRelativeTime(comment.createdAt)}
            </span>
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">
            {comment.content}
          </p>
          <button
            type="button"
            onClick={onStartReply}
            className="mt-2 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-cyan-700 transition-colors hover:bg-cyan-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          >
            <Reply className="h-3 w-3" aria-hidden="true" />
            {t("flowComments.reply", "Reply")}
          </button>
        </div>
      </div>

      {/* Replies — indented under the parent with a cyan left border
          so the thread relationship is obvious at a glance. */}
      {comment.replies.length > 0 && (
        <ul className="mt-3 space-y-2 border-l-2 border-cyan-200 pl-3 ml-11">
          {comment.replies.map((r) => (
            <li key={r.id} className="flex gap-3 rounded-md bg-muted/30 p-2">
              <Avatar name={r.authorName} avatarUrl={r.authorAvatar} small />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-sm font-medium text-foreground">
                    {r.authorName}
                  </span>
                  {r.authorEmail && (
                    <span className="text-xs text-muted-foreground">
                      ({r.authorEmail})
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    · {formatRelativeTime(r.createdAt)}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">
                  {r.content}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Inline reply form. Renders in place of (well, below) the
          replies list when this comment is the active reply target.
          The submit button text changes from "Save" to "Reply" so the
          action matches the user's intent. */}
      {isReplying && (
        <div className="mt-3 ml-11">
          <form
            onSubmit={onSubmitReply}
            noValidate
            className="space-y-2"
          >
            <textarea
              ref={replyTextareaRef}
              value={replyDraft}
              onChange={(e) => onChangeReplyDraft(e.target.value)}
              maxLength={MAX_LENGTH}
              rows={2}
              placeholder={t(
                "flowComments.replyPlaceholder",
                "Write a reply…",
              )}
              className={cn(
                "flex w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                replyError && "border-destructive focus-visible:ring-destructive",
              )}
            />
            {replyError && (
              <p className="text-xs text-destructive" role="alert">
                {replyError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={onCancelReply}
              >
                {t("cancel", "Cancel")}
              </Button>
              <Button
                size="sm"
                type="submit"
                disabled={!replyDraft.trim()}
              >
                {t("flowComments.reply", "Reply")}
              </Button>
            </div>
          </form>
        </div>
      )}
    </li>
  );
}

// Small avatar circle. Uses the user's picture when available,
// otherwise a colored initial. Cyan chosen to match the comments
// theme (rather than the gray used elsewhere) so the comments
// region reads as a distinct module.
function Avatar({
  name,
  avatarUrl,
  small = false,
}: {
  name: string;
  avatarUrl?: string;
  small?: boolean;
}) {
  const size = small ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs";
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className={cn(
          "shrink-0 rounded-full object-cover",
          size,
        )}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-cyan-100 font-semibold uppercase text-cyan-700",
        size,
      )}
    >
      {name.charAt(0) || "?"}
    </div>
  );
}
