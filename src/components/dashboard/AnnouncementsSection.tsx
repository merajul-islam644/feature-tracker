// Dashboard announcements — the manager's broadcast channel.
//
// A manager ("we are going to prod today") posts here; every invited
// member sees the same newest-first list on their Dashboard. The
// composer and the per-row delete button render for managers only;
// the mutation hooks re-check the role server-call-side as
// defense-in-depth (same pattern as the tester guards).

import { useMemo, useState } from "react";
import { Megaphone, Pencil, Trash2 } from "lucide-react";
import { useT, useLocale } from "@/lib/blocks/i18n";
import { useIsRole } from "@/hooks/useAuth";
import {
  useAnnouncements,
  useDeleteAnnouncement,
  usePostAnnouncement,
  useUpdateAnnouncement,
} from "@/lib/blocks/hooks";
import { ANNOUNCEMENT_TEMPLATES } from "@/data/announcementTemplates";
import { lookupUserById, useAllJoinedUsers } from "@/lib/blocks/users";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

export function AnnouncementsSection() {
  const t = useT();
  const { formatRelativeTime } = useLocale();
  const isManager = useIsRole("manager");

  const announcementsQuery = useAnnouncements();
  const post = usePostAnnouncement();
  const update = useUpdateAnnouncement();
  const remove = useDeleteAnnouncement();
  const announcements = announcementsQuery.data ?? [];

  const [draft, setDraft] = useState("");

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
    nameById.get(id) ?? lookupUserById(id)?.name ?? t("announcements.manager", "Manager");

  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed || post.isPending) return;
    post.mutate({ content: trimmed }, { onSuccess: () => setDraft("") });
  };

  return (
    <section aria-labelledby="announcements-heading">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle
            id="announcements-heading"
            className="flex items-center gap-2 text-base font-semibold"
          >
            <Megaphone className="h-4 w-4 text-primary" aria-hidden="true" />
            {t("announcements.title", "Announcements")}
          </CardTitle>
          {/* Total-count badge is a manager-only affordance — members
              just read the list, the tally is posting bookkeeping. */}
          {isManager && announcements.length > 0 && (
            <Badge variant="muted">{announcements.length}</Badge>
          )}
        </CardHeader>
        <Separator />

        {/* Composer + quick templates — managers only. */}
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
                {t("announcements.post", "Post")}
              </Button>
            </div>
          </div>
        )}

        <CardContent className="p-4">
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
            <ul className="space-y-3">
              {announcements.map((a) => {
                const editing = editingId === a.id;
                return (
                  // Banner-style announcement: soft primary tint + accent
                  // ring + megaphone badge, so the manager's broadcast
                  // reads as the loudest thing on the dashboard. Token-
                  // based colours keep it correct in light AND dark mode.
                  <li
                    key={a.id}
                    className="rounded-xl border border-primary/20 bg-primary/[0.05] p-4 ring-1 ring-inset ring-primary/5"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Megaphone className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        {editing ? (
                        <>
                          <textarea
                            value={editDraft}
                            onChange={(e) => setEditDraft(e.target.value)}
                            rows={3}
                            aria-label={t("announcements.edit", "Edit announcement")}
                            className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          />
                          <div className="mt-2 flex gap-2">
                            <Button
                              size="sm"
                              onClick={() =>
                                update.mutate(
                                  {
                                    id: a.id,
                                    authorId: a.authorId,
                                    content: editDraft.trim(),
                                  },
                                  { onSuccess: () => setEditingId(null) },
                                )
                              }
                              disabled={!editDraft.trim() || update.isPending}
                            >
                              {t("save", "Save")}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditingId(null)}
                            >
                              {t("cancel", "Cancel")}
                            </Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="whitespace-pre-wrap break-words text-base font-medium leading-relaxed text-foreground md:text-lg">
                            {a.content}
                          </p>
                          <div className="mt-2.5 flex items-center gap-2">
                            <UserAvatar userId={a.authorId} name={authorName(a.authorId)} size="sm" />
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
                      {isManager && !editing && (
                        <div className="flex shrink-0 gap-0.5">
                          <button
                            type="button"
                            aria-label={t("announcements.edit", "Edit announcement")}
                            title={t("announcements.edit", "Edit announcement")}
                            onClick={() => {
                              setEditingId(a.id);
                              setEditDraft(a.content);
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            aria-label={t("announcements.delete", "Delete announcement")}
                            title={t("announcements.delete", "Delete announcement")}
                            onClick={() => {
                              if (
                                window.confirm(
                                  t(
                                    "announcements.deleteConfirm",
                                    "Delete this announcement?",
                                  ),
                                )
                              ) {
                                remove.mutate(a.id);
                              }
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
