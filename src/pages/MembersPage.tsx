// Workspace-wide member directory.
//
// Source of truth: IAM. We list every user who joined the workspace
// via `useAllJoinedUsers()` (live IAM, no safety-net mock) so the
// grid auto-reflects invitations and removals without a code change.
//
// `useAllJoinedUsers()` is live-only by design (no fallback to the
// hardcoded roster in `src/lib/blocks/users.ts`) — the chat page
// relies on the same hook and would otherwise list mock users that
// can't be messaged. If the IAM call fails, we surface an empty
// grid with an inline retry instead of faking a roster.
//
// Per-member project assignment lives in the MemberProject schema
// (one row per user, JSON-encoded `projectIdsJson`). Manager-only
// writes via `useSetMemberProjectAssignments`; everyone reads. The
// card shows the assigned projects as a bounded read-only list (max
// 3 names visible, then "+N more"); the editor lives in a small
// popover triggered from an `Edit` button next to the section
// heading. Separating display from edit fixes the prior layout bug
// where the `MultiSelect`'s chip row grew vertically and pushed
// neighbouring cards out of alignment.

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Check, Copy, Pencil, RefreshCw, Search, Users } from "lucide-react";
import { useT } from "@/lib/blocks/i18n";
import {
  useAllJoinedUsers,
  type JoinedMember,
} from "@/lib/blocks/users";
import { useAuth } from "@/hooks/useAuth";
import {
  useMemberProjectAssignments,
  useSetMemberProjectAssignments,
  useProjects,
} from "@/lib/blocks/hooks";
import { PageHeader } from "@/shared/ui/PageHeader";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";

// Visible cap on the in-card project list. The card height is set
// with a fixed minimum so neighbouring cards stay aligned; the
// bounded list keeps the actual rendered height predictable even
// when a member belongs to many projects (the popover editor still
// shows the full list for assigning).
const MAX_VISIBLE_PROJECT_NAMES = 3;

export function MembersPage() {
  const t = useT();
  const { currentUser } = useAuth();
  // Manager role carries the only edit permission; other roles render
  // the dropdown disabled (chips visible, popover never opens).
  // `currentUser` can briefly be `undefined` while AuthProvider hydrates
  // — the `?? false` keeps the role gate conservative.
  const isManager = currentUser?.roles?.includes("manager") ?? false;

  const membersQuery = useAllJoinedUsers();
  const members = membersQuery.data ?? [];

  // Active + archived projects are both listed — managers assign to
  // any regardless of status, and archived assignments still render so
  // a member's historical projects don't silently disappear when the
  // project moves to archive.
  const projectsQuery = useProjects();
  const projectOptions = useMemo(
    () =>
      (projectsQuery.data ?? [])
        .slice()
        // Stable alphabetical order so the drop-down doesn't reshuffle
        // between renders when the underlying page is re-sorted by
        // `LastUpdatedDate`. The id is the only thing the mutation
        // needs; the label is purely for the chip / popover row text.
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ value: p.id, label: p.name })),
    [projectsQuery.data],
  );

  const assignmentsQuery = useMemberProjectAssignments();
  // Map keyed by IAM id so each card reads assignments in O(1) instead
  // of re-scanning the array per card.
  const assignmentsByUserId = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of assignmentsQuery.data ?? []) {
      m.set(a.userId, a.projectIds);
    }
    return m;
  }, [assignmentsQuery.data]);

  const setAssignments = useSetMemberProjectAssignments();

  // Self first. The roster ships alphabetically from the hook — for
  // every signed-in member we hoist their own card to the top-left of
  // the grid and slap a `ME` badge in the top-right of that one card
  // (mirrors the convention the issue-tracker uses for the assignee
  // row). When the auth session hasn't resolved yet (`currentUser`
  // undefined) or the local IAM list doesn't include the signed-in id
  // (impossible in practice, defensive), we fall through to the
  // hook's alphabetical order so no other card gets unexpectedly
  // promoted.
  const sortedMembers = useMemo(() => {
    const selfId = currentUser?.id;
    if (!selfId) return members;
    const self = members.find((m) => m.id === selfId);
    if (!self) return members;
    const rest = members.filter((m) => m.id !== selfId);
    return [self, ...rest];
  }, [members, currentUser?.id]);

  // Roster filter — page-level input at the top-right of the header.
  // Substring match on the fields the card actually shows (name,
  // email, role) so a query like "qa" or "@yopmail" surfaces the
  // relevant cards. Case-insensitive, no fuzzy matching — keeps it
  // predictable for the small roster sizes this app has. The filter
  // runs AFTER the self-first sort so the signed-in user's card is
  // always the topmost match when their own row satisfies the
  // query — if it doesn't, they drop out cleanly alongside the rest.
  const [searchQuery, setSearchQuery] = useState("");
  const visibleMembers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sortedMembers;
    return sortedMembers.filter((m) => {
      const haystacks = [m.displayName, m.name, m.email, m.role];
      return haystacks.some(
        (h) => typeof h === "string" && h.toLowerCase().includes(q),
      );
    });
  }, [sortedMembers, searchQuery]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Users className="h-5 w-5" aria-hidden="true" />
            {t("members.title", "Members")}
          </span>
        }
        subtitle={t(
          "members.description",
          "Everyone who has joined this workspace.",
        )}
        actions={
          // Roster filter. Lives in the page header's right-side
          // actions slot so it doesn't crowd the grid below. Width
          // capped at 18rem so the input doesn't dominate the row on
          // wide viewports — keeps the header proportions.
          <div className="relative w-full sm:w-72">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("members.filterPlaceholder", "Filter members…")}
              aria-label={t(
                "members.filterAriaLabel",
                "Filter members by name, email, or role",
              )}
              className="pl-9"
            />
          </div>
        }
      />

      <section aria-label={t("members.title", "Members")}>
        {membersQuery.isLoading ? (
          // Skeleton grid matches the real layout so the swap-in
          // doesn't reflow the page once data lands.
          <div
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            aria-busy="true"
          >
            {Array.from({ length: 8 }).map((_, i) => (
              <Card key={i} className="overflow-hidden">
                <CardContent className="flex flex-col items-center gap-3 p-6">
                  <Skeleton className="h-24 w-24 rounded-full" />
                  <div className="space-y-1.5 text-center">
                    <Skeleton className="mx-auto h-4 w-32" />
                    <Skeleton className="mx-auto h-3 w-16" />
                  </div>
                  <Skeleton className="h-3 w-40" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : membersQuery.isError ? (
          // IAM call failed. We deliberately do NOT fall back to the
          // hardcoded roster — see the file header for the chat-page
          // reason this matters. Surface the error + a retry so the
          // operator can recover without a hard refresh.
          <div
            role="alert"
            className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-muted/40 px-6 py-10 text-center"
          >
            <p className="text-sm font-medium text-foreground">
              {t(
                "members.loadError",
                "Couldn't load the workspace roster.",
              )}
            </p>
            <button
              type="button"
              onClick={() => membersQuery.refetch()}
              className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              {t("common.retry", "Retry")}
            </button>
          </div>
        ) : sortedMembers.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            {t("members.empty", "No one has joined this workspace yet.")}
          </p>
        ) : (
          <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {sortedMembers.map((m) => (
              <MemberCard
                key={m.id}
                member={m}
                isSelf={m.id === currentUser?.id}
                projectOptions={projectOptions}
                initialProjectIds={assignmentsByUserId.get(m.id) ?? []}
                isManager={isManager}
                onChange={(projectIds) =>
                  setAssignments.mutate({
                    userId: m.id,
                    projectIds,
                  })
                }
                t={t}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// Per-card state. Pulled into a sibling component so each card has its
// own `useState` for the in-flight selection (clicking chip-A on
// member-1 shouldn't leak into member-2's draft).
interface MemberCardProps {
  member: JoinedMember;
  isSelf: boolean;
  projectOptions: { value: string; label: string }[];
  initialProjectIds: string[];
  isManager: boolean;
  onChange: (projectIds: string[]) => void;
  t: (key: string, fallback: string) => string;
}

function MemberCard({
  member,
  isSelf,
  projectOptions,
  initialProjectIds,
  isManager,
  onChange,
  t,
}: MemberCardProps) {
  // Local draft so the UI updates instantly on checkbox toggle; the
  // mutation fires in parallel. Reading `initialProjectIds` again on
  // re-render is fine — managers get their own writes back through the
  // cache invalidation, non-managers see whatever the manager's last
  // write produced. Without this draft layer, every checkbox click
  // would synchronously flip the trigger through the round-trip
  // latency, which looks broken even when the network is healthy.
  const [draft, setDraft] = useState<string[]>(initialProjectIds);
  // Pin the displayed value to `draft` for managers (their in-flight
  // edit wins) and to `initialProjectIds` for non-managers (they
  // can't edit, so the prop IS the truth).
  const value = isManager ? draft : initialProjectIds;

  // Per-card popover open state. Local because each card's editor
  // surface is independent — opening one card's edit popover must
  // not open another's. Closing follows Radix's standard
  // onOpenChange (Escape, click outside, focus loss).
  const [editOpen, setEditOpen] = useState(false);
  // Look up the human-readable label for a project id so the
  // bullet-list renders the project name rather than the raw id.
  // Falls back to the id when the option list doesn't know about
  // it (stale assignment pointing at a deleted project) so the
  // row stays informative rather than vanishing.
  const projectLabelFor = (projectId: string) =>
    projectOptions.find((o) => o.value === projectId)?.label ?? projectId;
  // Toggle handler for the editor popover checkboxes. Mirrors the
  // same local-draft pattern the trigger-based multi-select used:
  // optimistic UI flip + fire the mutation. Guarded by `isManager`
  // so a stray render path can't accidentally write.
  const handleToggleProject = (projectId: string) => {
    if (!isManager) return;
    const next = draft.includes(projectId)
      ? draft.filter((v) => v !== projectId)
      : [...draft, projectId];
    setDraft(next);
    onChange(next);
  };

  // Per-card "just copied" flag — flips the trailing icon from
  // `Copy` to `Check` for ~1.5s after a successful clipboard write.
  // Local state, no need to coordinate across cards.
  const [emailCopied, setEmailCopied] = useState(false);
  // Click handler for the email button. Wrapped in `useMemo` would be
  // overkill for one card; the closure is created each render but
  // the only capture is `member.email`, which doesn't change.
  const handleCopyEmail = async () => {
    if (!member.email) return;
    try {
      await navigator.clipboard.writeText(member.email);
      setEmailCopied(true);
      toast.success(
        t("members.emailCopied", "Email copied to clipboard"),
      );
      window.setTimeout(() => setEmailCopied(false), 1500);
    } catch {
      // Clipboard API can fail (permissions denied, non-secure
      // context, ancient browser). Surface the failure — a silent
      // no-op would leave the user wondering why their click did
      // nothing.
      toast.error(
        t(
          "members.emailCopyFailed",
          "Couldn't copy email to clipboard",
        ),
      );
    }
  };

  return (
    // `relative` anchors the absolute-positioned `ME` badge in the
    // top-right corner of this card. `flex h-full flex-col` makes the
    // card fill its grid cell (paired with `auto-rows-fr` on the
    // parent grid) so all cards in the same row are the same height.
    // `min-h-` keeps the card from collapsing when the project list
    // at the bottom is empty — a tall card with "No projects
    // assigned" reads as intentional whitespace, not an under-
    // filled cell.
    <Card className="relative flex h-full min-h-[22rem] flex-col overflow-hidden">
      {/* Self-card marker. Sits in the top-right corner so it doesn't
          crowd the avatar / name cluster in the center. The badge
          uses the same `Badge` primitive as the project chips in the
          multi-select so it reads as part of the same visual
          vocabulary. */}
      {isSelf && (
        <Badge
          aria-label={t("members.meLabel", "ME")}
          className="absolute right-3 top-3 select-none px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
          variant="default"
        >
          {t("members.meLabel", "ME")}
        </Badge>
      )}
      <CardContent
        className={cn(
          // `flex-1` so the content fills the card height, with the
          // project dropdown anchored to the bottom via `mt-auto`
          // below. The self-card gets extra top padding so the `ME`
          // badge in the top-right corner doesn't crowd the centered
          // avatar.
          "flex flex-1 flex-col items-stretch gap-3 p-6",
          isSelf && "pt-10",
        )}
      >
        {/* Avatar — sized up via className. Initials fallback (driven by
            `name`) renders for everyone until they upload a picture;
            `UserAvatar` resolves the picture via the shared
            `useProfilePics` map keyed by IAM `sub`. */}
        <div className="flex flex-col items-center gap-2 text-center">
          <UserAvatar
            userId={member.id}
            name={member.name}
            className="h-24 w-24 text-2xl"
          />
          <div>
            <h3 className="text-base font-semibold text-foreground">
              {/* "I am" prefix reads as a self-introduction
                  ("I am Meraj Zoarder"). Rendered muted + regular
                  weight so the member's name still owns the
                  heading visually — the prefix is context, not
                  primary content. First + last name only — drops
                  the `(meraz-zoarder13)`-style email-handle
                  parenthetical `toUserOption` adds to
                  `displayName` for roster disambiguation (see
                  users.ts:117). Cards accept the collision here:
                  the role badge + email below are enough for
                  visual disambiguation, and the email
                  parenthesising read as
                  "Meraj Zoarder (merajzoarder6)" overlapped with
                  the signed-in display chip on the topbar anyway. */}
              <span className="font-normal text-muted-foreground">
                {t("members.iAmPrefix", "I am")}{" "}
              </span>
              {member.name}
            </h3>
            {member.role && (
              <p className="mt-0.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {member.role}
                {/* "of the Selise Group" suffix reads as the role's
                    organisational scope. Normal case + regular
                    weight so the role label (e.g. "DEVELOPER")
                    stays the primary read; the suffix is
                    attribution, not a status badge. */}
                <span className="font-normal normal-case tracking-normal">
                  {" "}
                  {t(
                    "members.seliseGroupSuffix",
                    "of the Selise Group",
                  )}
                </span>
              </p>
            )}
          </div>
        </div>
        {/* Email occupies the curated-bio slot in the source-of-truth-
            IAM view — see file header. Hidden when the IAM record has
            none. The whole row is a button so click-to-copy works on
            the email text itself, not just on the trailing icon —
            covers both the user who sees the icon and the one who
            just clicks the email. The trailing `Copy` icon is
            dimmed at rest (matches the muted-foreground tone) and
            brightens on hover / focus so it stays discoverable
            without crowding the email text. */}
        {member.email && (
          <button
            type="button"
            onClick={handleCopyEmail}
            aria-label={t(
              "members.copyEmailAria",
              "Copy email to clipboard",
            )}
            // `group` lets the inner icon read hover / focus state
            // off the button. `mx-auto` centers the inline-flex row
            // inside the `items-stretch` parent (the email block
            // spans the card width to keep alignment with the
            // heading above).
            className="group mx-auto inline-flex max-w-full items-center gap-1.5 rounded text-xs leading-relaxed text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          >
            <span className="break-all">{member.email}</span>
            {emailCopied ? (
              <Check
                className="h-3 w-3 shrink-0 text-emerald-600"
                aria-hidden="true"
              />
            ) : (
              <Copy
                className="h-3 w-3 shrink-0 opacity-50 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                aria-hidden="true"
              />
            )}
          </button>
        )}
        {/* Project assignment block.
            Rendered as a bounded read-only list with an `Edit` button
            that opens a popover for changes (manager-only). Separating
            display from edit fixes the prior layout bug where the
            multi-select's chip row grew vertically and pushed
            neighbouring cards out of alignment: the visible list caps
            at `MAX_VISIBLE_PROJECT_NAMES` entries plus a `+N more`
            hint, so the card height stays predictable. `mt-auto`
            anchors the whole block to the bottom of the card so the
            avatar / name cluster stays glued to the top regardless
            of how many projects a member has. */}
        <div className="mt-auto space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t(
                "members.currentlyWorkingLabel",
                "Currently Working On",
              )}
            </p>
            {/* Edit trigger. Wrapped in `Popover` rather than the
                inline `MultiSelect` so the popover floats over the
                grid (no card-height reflow when the list opens).
                Hidden when there are no projects to pick from —
                nothing to assign. */}
            {isManager && projectOptions.length > 0 && (
              <Popover open={editOpen} onOpenChange={setEditOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label={t(
                      "members.editProjectsAria",
                      "Edit project assignments",
                    )}
                    className="inline-flex items-center gap-1 rounded text-xs font-medium text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                  >
                    <Pencil className="h-3 w-3" aria-hidden="true" />
                    {t("members.editProjects", "Edit")}
                  </button>
                </PopoverTrigger>
                {/* `side="top"` + `align="end"` keeps the editor
                    above the card on tall viewports (the trigger is
                    already at the bottom of the card). `sideOffset`
                    nudges it off the card edge so the border
                    doesn't touch the popover border. */}
                <PopoverContent
                  align="end"
                  side="top"
                  sideOffset={6}
                  className="w-64 p-2"
                >
                  <p className="px-2 pb-2 text-xs font-medium text-muted-foreground">
                    {t(
                      "members.assignProjectsLabel",
                      "Assign projects",
                    )}
                  </p>
                  {/* Scrollable checkbox list — caps at 16rem so a
                      large project roster doesn't push the popover
                      past the viewport. Keys off the project's
                      stable id so toggling an item doesn't re-mount
                      its row. */}
                  <ul
                    role="listbox"
                    aria-multiselectable
                    className="max-h-64 space-y-1 overflow-y-auto"
                  >
                    {projectOptions.map((opt) => {
                      const isSelected = value.includes(opt.value);
                      return (
                        <li key={opt.value}>
                          <label
                            className={cn(
                              "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                              "hover:bg-accent hover:text-accent-foreground",
                              isSelected && "bg-accent/40",
                            )}
                          >
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() =>
                                handleToggleProject(opt.value)
                              }
                              aria-label={opt.label}
                            />
                            <span className="truncate">{opt.label}</span>
                            {isSelected && (
                              <Check
                                className="ml-auto h-3.5 w-3.5 text-primary"
                                aria-hidden="true"
                              />
                            )}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </PopoverContent>
              </Popover>
            )}
          </div>
          {/* Bounded read-only list. Bullet markers + project name;
              `truncate` on the span keeps a single long project name
              from wrapping and forcing a height change. Surfaces a
              muted helper when nothing is assigned so the section
              isn't visually empty (an empty-looking footer on a tall
              card reads as a layout glitch). */}
          {value.length === 0 ? (
            <p className="text-xs italic text-muted-foreground">
              {t(
                "members.noProjects",
                projectOptions.length === 0
                  ? "No projects yet"
                  : "No projects assigned",
              )}
            </p>
          ) : (
            <ul className="space-y-1">
              {value
                .slice(0, MAX_VISIBLE_PROJECT_NAMES)
                .map((projectId) => (
                  <li
                    key={projectId}
                    className="flex items-center gap-1.5 text-xs text-foreground"
                  >
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                      aria-hidden="true"
                    />
                    <span className="truncate">
                      {projectLabelFor(projectId)}
                    </span>
                  </li>
                ))}
              {value.length > MAX_VISIBLE_PROJECT_NAMES && (
                <li className="text-xs text-muted-foreground">
                  +{value.length - MAX_VISIBLE_PROJECT_NAMES}{" "}
                  {t("members.moreProjects", "more")}
                </li>
              )}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
