// Announcements panel — the inner content of the dashboard section
// (composer + list). Extracted from AnnouncementsSection so the same
// renderer can be mounted into:
//   * the dashboard's inline section (`AnnouncementsSection` wraps it
//     in a Card frame and shows "latest + collapse archive")
//   * a modal opened from the topbar speaker button (`AnnouncementsDialog`,
//     which always starts expanded so all history is visible at once)
//
// State, mutations, and per-row author resolution all live here so the
// two shells don't have to pass the same orchestration through props.

import { useMemo, useState } from "react";
import {
  ChevronDown,
  EyeOff,
  Megaphone,
  Pencil,
  Repeat,
} from "lucide-react";
import { useT, useLocale } from "@/lib/blocks/i18n";
import { useIsRole } from "@/hooks/useAuth";
import {
  useAnnouncements,
  usePostAnnouncement,
  useRepostAnnouncement,
  useUpdateAnnouncement,
} from "@/lib/blocks/hooks";
import {
  useHideAnnouncement,
  useHiddenAnnouncementIds,
} from "@/lib/blocks/hiddenAnnouncements";
import { ANNOUNCEMENT_TEMPLATES } from "@/data/announcementTemplates";
import { lookupUserById, useAllJoinedUsers } from "@/lib/blocks/users";
import { useToast } from "@/hooks/useToast";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Announcement } from "@/lib/blocks/data";

interface AnnouncementsPanelProps {
  /**
   * When `true` the archive rows are visible without "Show N more".
   * Use this from `AnnouncementsDialog` so opening the modal never
   * hides history. The dashboard section keeps it `false` (default)
   * so the broadcast stays compact at the top of the dashboard.
   */
  expandedByDefault?: boolean;
}

export function AnnouncementsPanel({
  expandedByDefault = false,
}: AnnouncementsPanelProps) {
  const t = useT();
  const { formatRelativeTime } = useLocale();
  const isManager = useIsRole("manager");
  // Toast handles success/error feedback for the manager's Repost and
  // Edit actions. Without it, Repost silently re-stamps LastUpdatedDate
  // (no new row, no row movement when already at the top) so the user
  // couldn't tell if the click had any effect. `useToast` is the
  // project-wide Sonner wrapper — see `useToast.ts`.
  const toast = useToast();

  const announcementsQuery = useAnnouncements();
  const post = usePostAnnouncement();
  const update = useUpdateAnnouncement();
  const repost = useRepostAnnouncement();
  // Per-user "hide" set — every member (manager and non-manager) gets
  // the same per-account "Hide from my dashboard" button. Each
  // member's panel reflects only what they personally chose to keep.
  // The set lives in localStorage; see `hiddenAnnouncements.ts` for the
  // storage-choice rationale. Manager-only Delete was removed because
  // it was a server-side mutation that took the row away from every
  // member — the opposite of "each member controls their own panel".
  const hiddenIds = useHiddenAnnouncementIds();
  const hideAnnouncement = useHideAnnouncement();
  const announcements = useMemo(
    // Filter first, then keep the original ordering. The auto-open
    // hook reads from the unfiltered list so it still detects new
    // arrivals correctly — only this view filters.
    () =>
      (announcementsQuery.data ?? []).filter((a) => !hiddenIds.has(a.id)),
    [announcementsQuery.data, hiddenIds],
  );

  const [draft, setDraft] = useState("");

  // Active broadcast hides history by default — the user can opt into
  // the full archive with the "Show N more" toggle. The modal flips
  // `expandedByDefault` so opening it always reveals everything.
  const [expanded, setExpanded] = useState(expandedByDefault);

  // Inline edit state: the row being edited + its working text. Only one
  // row edits at a time — starting another drops the first (no parallel
  // drafts to reconcile).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  // Author resolution: live roster first, hardcoded lookup second, a
  // neutral "Manager" label last so a deleted account never shows a
  // raw uuid on everyone's dashboard.
  const roster = useAllJoinedUsers().data ?? [];
  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of roster) map.set(m.id, m.name);
    return map;
  }, [roster]);
  const authorName = (id: string) =>
    nameById.get(id) ??
    lookupUserById(id)?.name ??
    t("announcements.manager", "Manager");

  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed || post.isPending) return;
    post.mutate(
      { content: trimmed },
      {
        // Toast mirrors what Repost / Delete already do — without
        // explicit feedback the composer felt silent (no list row
        // movement when a brand-new id lands at index 0, no diff in
        // the composer aside from clearing).
        onSuccess: () => {
          setDraft("");
          toast.success(
            t("announcements.posted", "Announcement posted."),
          );
        },
        onError: (err) =>
          toast.error(
            err instanceof Error
              ? err.message
              : t(
                  "announcements.postError",
                  "Could not post announcement.",
                ),
          ),
      },
    );
  };

  // Active broadcast = newest message. Archive = everything older.
  const latest = announcements[0];
  const archive = announcements.slice(1);

  // Translations passed down to the card so it doesn't have to call
  // useT/useLocale itself (it'd then have to come from this file's
  // closure which loses reactivity).
  const tEdit = t("announcements.edit", "Edit announcement");
  const tSave = t("save", "Save");
  const tCancel = t("cancel", "Cancel");
  // "Hide from my dashboard" is the per-account control every member
  // gets, regardless of role. The verb is "Hide" so users understand
  // the action is personal and reversible — the row stays on the
  // server and other members keep seeing it.
  const tHide = t("announcements.hide", "Hide from my dashboard");
  const tHideAria = t(
    "announcements.hideAria",
    "Hide this announcement from your dashboard",
  );
  const tRepost = t("announcements.repost", "Repost");
  const tRepostAria = t("announcements.repostAria", "Repost announcement");
  const tLatest = t("announcements.latest", "Latest");
  const tShowArchive = t(
    "announcements.showArchive",
    "Show {count} more",
    { count: archive.length },
  );
  const tHideArchive = t("announcements.hideArchive", "Hide archive");
  const tPost = t("announcements.post", "Post");

  return (
    <>
      {/* Composer + quick templates — managers only. Rendered inside
          the panel so both the inline section and the modal get it. */}
      {isManager && (
        <div className="border-b border-border p-4">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t(
              "announcements.postPlaceholder",
              "Post an announcement to the team…",
            )}
            aria-label={t(
              "announcements.postPlaceholder",
              "Post an announcement to the team…",
            )}
            rows={2}
            className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {/* Template chips pour their body into the composer — the
              text stays editable, so they're starting points. */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("announcements.templates", "Templates")}:
            </span>
            {ANNOUNCEMENT_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => setDraft(tpl.body)}
                title={tpl.body}
                className="rounded-full border border-input bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {tpl.title}
              </button>
            ))}
          </div>
          <div className="mt-2 flex justify-end">
            <Button
              size="sm"
              onClick={submit}
              disabled={!draft.trim() || post.isPending}
            >
              {tPost}
            </Button>
          </div>
        </div>
      )}

      <div className="p-4">
        {announcementsQuery.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        ) : announcements.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-muted-foreground">
            {isManager
              ? t(
                  "announcements.emptyManager",
                  "No announcements yet — post the first one for your team.",
                )
              : t("announcements.empty", "No announcements yet.")}
          </p>
        ) : (
          <div className="space-y-3">
            {/* Active broadcast — compact "Latest" presentation on the
                dashboard so the broadcast stays a tight top strip. In
                the modal (`expandedByDefault`), we drop the clamp and
                render full-detail instead, because the user actively
                chose to open the dialog to read — a 3-line preview
                would land as "the message isn't showing". Archive rows
                below already render full-detail whenever expanded, so
                the dialog becomes uniformly readable top-to-bottom. */}
            <AnnouncementCard
              announcement={latest!}
              compact={!expandedByDefault}
              isLatest
              editingId={editingId}
              editDraft={editDraft}
              onEditDraftChange={setEditDraft}
              onStartEdit={(a) => {
                setEditingId(a.id);
                setEditDraft(a.content);
              }}
              onCancelEdit={() => setEditingId(null)}
              onSaveEdit={(a) =>
                update.mutate(
                  {
                    id: a.id,
                    authorId: a.authorId,
                    content: editDraft.trim(),
                  },
                  { onSuccess: () => setEditingId(null) },
                )
              }
              // Per-account hide — every member (manager included)
              // suppresses the row on their own dashboard via
              // localStorage. The action is reversible and the row
              // stays on the server for everyone else.
              onHide={(a) => hideAnnouncement(a.id)}
              onRepost={(a) =>
                repost.mutate(a, {
                  onSuccess: () =>
                    toast.success(
                      t(
                        "announcements.reposted",
                        "Announcement bumped to the top.",
                      ),
                    ),
                  onError: (err) =>
                    toast.error(
                      err instanceof Error
                        ? err.message
                        : t(
                            "announcements.repostError",
                            "Could not repost announcement.",
                          ),
                    ),
                })
              }
              repostPending={repost.isPending}
              authorName={authorName}
              formatRelativeTime={formatRelativeTime}
              isManager={isManager}
              updatePending={update.isPending}
              tEdit={tEdit}
              tSave={tSave}
              tCancel={tCancel}
              tHide={tHide}
              tHideAria={tHideAria}
              tRepost={tRepost}
              tRepostAria={tRepostAria}
              tLatest={tLatest}
            />

            {/* Archive toggle — hidden when the panel was opened with
                `expandedByDefault` because every row is already on
                screen. */}
            {archive.length > 0 && !expandedByDefault && (
              <div className="flex justify-center pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setExpanded((e) => !e)}
                  aria-expanded={expanded}
                  className="gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  {expanded ? tHideArchive : tShowArchive}
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 transition-transform duration-200",
                      expanded && "rotate-180",
                    )}
                    aria-hidden="true"
                  />
                </Button>
              </div>
            )}

            {/* Archive rows render at full detail when expanded.
                The modal starts expanded so the toggle hides and
                every row is on screen. */}
            {(expanded || expandedByDefault) &&
              archive.map((a) => (
                <AnnouncementCard
                  key={a.id}
                  announcement={a}
                  compact={false}
                  editingId={editingId}
                  editDraft={editDraft}
                  onEditDraftChange={setEditDraft}
                  onStartEdit={(row) => {
                    setEditingId(row.id);
                    setEditDraft(row.content);
                  }}
                  onCancelEdit={() => setEditingId(null)}
                  onSaveEdit={(row) =>
                    update.mutate(
                      {
                        id: row.id,
                        authorId: row.authorId,
                        content: editDraft.trim(),
                      },
                      { onSuccess: () => setEditingId(null) },
                    )
                  }
                  onHide={(row) => hideAnnouncement(row.id)}
                  onRepost={(row) =>
                    repost.mutate(row, {
                      onSuccess: () =>
                        toast.success(
                          t(
                            "announcements.reposted",
                            "Announcement bumped to the top.",
                          ),
                        ),
                      onError: (err) =>
                        toast.error(
                          err instanceof Error
                            ? err.message
                            : t(
                                "announcements.repostError",
                                "Could not repost announcement.",
                              ),
                        ),
                    })
                  }
                  repostPending={repost.isPending}
                  authorName={authorName}
                  formatRelativeTime={formatRelativeTime}
                  isManager={isManager}
                  updatePending={update.isPending}
                  tEdit={tEdit}
                  tSave={tSave}
                  tCancel={tCancel}
                  tHide={tHide}
                  tHideAria={tHideAria}
                  tRepost={tRepost}
                  tRepostAria={tRepostAria}
                  tLatest={tLatest}
                />
              ))}
          </div>
        )}
      </div>
    </>
  );
}

/*
 * AnnouncementCard — renderable in two visual modes:
 *
 *   compact (the active broadcast, pinned at top):
 *     • icon h-9 w-9, padding p-3, content clamped to 3 lines so a
 *       long message doesn't push everything else off the first fold
 *     • a "Latest" pill in the top-right (only on the active
 *       broadcast; archive rows skip it)
 *
 *   full (the archive row):
 *     • icon h-10 w-10, padding p-4, content renders verbatim — same
 *       visual weight as before this redesign so archive readers don't
 *       feel a regression when they expand history.
 *
 * State (editing in flight, pending mutations, manager-only controls)
 * is driven by props so the parent (AnnouncementsPanel) owns all of it.
 */
interface AnnouncementCardProps {
  announcement: Announcement;
  compact: boolean;
  isLatest?: boolean;
  editingId: string | null;
  editDraft: string;
  onEditDraftChange: (next: string) => void;
  onStartEdit: (a: Announcement) => void;
  onCancelEdit: () => void;
  onSaveEdit: (a: Announcement) => void;
  /**
   * Per-account "hide from my dashboard" — every member (manager
   * included) gets the same EyeOff button. The action is reversible
   * and lives entirely in localStorage; the row stays on the server
   * for everyone else.
   */
  onHide: (a: Announcement) => void;
  onRepost: (a: Announcement) => void;
  repostPending: boolean;
  authorName: (id: string) => string;
  formatRelativeTime: (iso: string) => string;
  isManager: boolean;
  updatePending: boolean;
  tEdit: string;
  tSave: string;
  tCancel: string;
  tHide: string;
  tHideAria: string;
  tRepost: string;
  tRepostAria: string;
  tLatest: string;
}

function AnnouncementCard({
  announcement: a,
  compact,
  isLatest,
  editingId,
  editDraft,
  onEditDraftChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onHide,
  onRepost,
  repostPending,
  authorName,
  formatRelativeTime,
  isManager,
  updatePending,
  tEdit,
  tSave,
  tCancel,
  tHide,
  tHideAria,
  tRepost,
  tRepostAria,
  tLatest,
}: AnnouncementCardProps) {
  const editing = editingId === a.id;
  return (
    <div
      className={cn(
        // Banner-style announcement: soft primary tint + accent
        // ring + megaphone badge, so the manager's broadcast reads
        // as the loudest thing on the dashboard. Token-based colours
        // keep it correct in light AND dark mode.
        "rounded-xl border border-primary/20 bg-primary/[0.05] ring-1 ring-inset ring-primary/5",
        compact ? "p-3.5" : "p-4",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary",
            compact ? "h-9 w-9" : "h-10 w-10",
          )}
        >
          <Megaphone
            className={compact ? "h-4 w-4" : "h-5 w-5"}
            aria-hidden="true"
          />
        </div>
        <div className="min-w-0 flex-1">
          {editing ? (
            <>
              <textarea
                value={editDraft}
                onChange={(e) => onEditDraftChange(e.target.value)}
                rows={3}
                aria-label={tEdit}
                className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  onClick={() => onSaveEdit(a)}
                  disabled={!editDraft.trim() || updatePending}
                >
                  {tSave}
                </Button>
                <Button size="sm" variant="ghost" onClick={onCancelEdit}>
                  {tCancel}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p
                className={cn(
                  "whitespace-pre-wrap break-words font-medium leading-relaxed text-foreground",
                  compact
                    ? "line-clamp-3 text-sm md:text-base"
                    : "text-base md:text-lg",
                )}
                title={compact ? a.content : undefined}
              >
                {a.content}
              </p>
              <div
                className={cn(
                  "flex items-center gap-2",
                  compact ? "mt-2" : "mt-2.5",
                )}
              >
                <UserAvatar
                  userId={a.authorId}
                  name={authorName(a.authorId)}
                  size="sm"
                />
                <p className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground/80">
                    {authorName(a.authorId)}
                  </span>{" "}
                  · {formatRelativeTime(a.postedAt)}
                </p>
              </div>
            </>
          )}
        </div>
        <div className="flex shrink-0 items-start gap-2">
          {/* Latest pill — anchors the topmost row regardless of
              render mode. The dashboard shows it on the compact
              active broadcast; the dialog shows it on the full-
              detail latest row. Gating on `compact` would hide it
              inside the dialog and make a freshly-delivered
              announcement look indistinguishable from older archive
              rows below. */}
          {isLatest && (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              {tLatest}
            </span>
          )}
          {!editing && (
            <div className="flex gap-0.5">
              {isManager && (
                <>
                  <button
                    type="button"
                    aria-label={tRepostAria}
                    title={tRepostAria}
                    onClick={() => onRepost(a)}
                    disabled={repostPending}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Repeat className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={tEdit}
                    title={tEdit}
                    onClick={() => onStartEdit(a)}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </button>
                </>
              )}
              {/* Per-account Hide button — every member (manager
                  included) gets the same EyeOff control. The row
                  stays on the server for everyone else, and the user
                  can show it again from the same dropdown / settings
                  (see hiddenAnnouncements.ts). Previously managers
                  saw a destructive Delete button here that called
                  `useDeleteAnnouncement` and removed the row from the
                  global collection — i.e. for every member. */}
              <button
                type="button"
                aria-label={tHideAria}
                title={tHideAria}
                onClick={() => onHide(a)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
