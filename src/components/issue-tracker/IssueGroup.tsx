// Per-application group header (spec section 24).
//
// Two render modes:
//   - count > 0  → toggleable button header with chevron + count badge,
//                  and a list of children when open. The header row also
//                  carries a "members" dropdown listing the IAM users
//                  holding the developer or tester role (name + email +
//                  role tag) — passed in by IssueList, which fetches the
//                  rosters once.
//   - count === 0 → muted, non-interactive header (no chevron, no toggle)
//                   with an inline "No issues" muted line and no list.

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/UserAvatar";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { UserOption } from "@/lib/blocks/users";

// A dropdown entry: a developer- OR tester-role user. `role` tags the row
// so two same-named members (the roster has several "Meraj Zoarder") stay
// distinguishable at a glance beyond the email line.
export type MemberOption = UserOption & { role: string };

interface Props {
  title: string;
  count: number;
  defaultOpen?: boolean;
  /** Developer- and tester-role users to surface in the header dropdown. */
  members?: MemberOption[];
  /** Subs assigned to every issue in the group — these render ticked. */
  assignedDeveloperIds?: string[];
  /** Toggling a member adds/removes them on this group's issues. */
  onToggleDeveloper?: (member: MemberOption, assigned: boolean) => void;
  /** Fired on menu close when a member was ticked in that session —
   *  navigation is deferred so several members can be selected first. */
  onNavigateDeveloper?: (member: MemberOption) => void;
  children: ReactNode;
}

// Groups render collapsed by default — the count badge already tells the
// user what's inside, and a dense list reads better than a wall of rows.
// Callers can opt back in with defaultOpen.
export function IssueGroup({
  title,
  count,
  defaultOpen = false,
  members = [],
  assignedDeveloperIds,
  onToggleDeveloper,
  onNavigateDeveloper,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const isEmpty = count === 0;

  if (isEmpty) {
    return (
      <div className="overflow-hidden rounded-lg border border-dashed border-border bg-card">
        <div
          aria-label={`${title} (empty)`}
          className="flex w-full items-center justify-between gap-2 bg-muted/20 px-4 py-2 text-left text-sm font-medium text-muted-foreground"
        >
          <span className="flex items-center gap-2">{title}</span>
          <span className="rounded-full bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
            0
          </span>
        </div>
        <p className="px-4 py-3 text-xs text-muted-foreground">No issues.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {/* Header row = two siblings so the dropdown trigger isn't nested
          inside the toggle <button> (invalid HTML, and a click would
          both open the menu and fold the group). */}
      <div className="flex items-stretch bg-muted/40">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center justify-between gap-2 py-2 pl-4 pr-2 text-left text-sm font-semibold text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <span className="flex min-w-0 items-center gap-2">
            {open ? (
              <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            <span className="truncate">{title}</span>
          </span>
          <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {count}
          </span>
        </button>
        <MembersDropdown
          members={members}
          assignedDeveloperIds={assignedDeveloperIds}
          onToggle={onToggleDeveloper}
          onNavigate={onNavigateDeveloper}
        />
      </div>
      {open && <ul className="space-y-2 p-3">{children}</ul>}
    </div>
  );
}

// Users-icon trigger at the right end of the group header; opens the
// member roster — developers AND testers (name + email + role tag).
// Items are checkboxes: ticking a member adds them to every issue in the
// group, unticking removes them. The menu stays open across picks so
// several members can be selected in one go; navigating to the scoped
// view is deferred to menu close (targeting the last member ticked) so
// the jump doesn't cut a multi-select short. Rendered only when the
// caller passed a non-empty list — an empty dropdown is noise, and the
// empty-group mode shouldn't grow a trigger.
function MembersDropdown({
  members,
  assignedDeveloperIds,
  onToggle,
  onNavigate,
}: {
  members: MemberOption[];
  assignedDeveloperIds?: string[];
  onToggle?: (member: MemberOption, assigned: boolean) => void;
  onNavigate?: (member: MemberOption) => void;
}) {
  // The member to open the scoped view for when the menu closes, or
  // null when nothing was ticked this session (then closing is a no-op).
  // Reset every time the menu opens. Unticking the tracked member
  // drops the navigation intent entirely.
  const [lastTicked, setLastTicked] = useState<string | null>(null);
  if (members.length === 0) return null;
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) {
          setLastTicked(null);
        } else if (lastTicked) {
          const member = members.find((m) => m.id === lastTicked);
          if (member) onNavigate?.(member);
          setLastTicked(null);
        }
      }}
    >
      <DropdownMenuTrigger
        className="flex shrink-0 items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-label={`Members (${members.length})`}
        title="Assign / view members"
      >
        <Users className="h-4 w-4" aria-hidden="true" />
        {members.length}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Members · {members.length}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {members.map((member) => (
          <DropdownMenuCheckboxItem
            key={member.id}
            checked={assignedDeveloperIds?.includes(member.id) ?? false}
            onCheckedChange={(checked) => {
              setLastTicked(checked ? member.id : null);
              onToggle?.(member, checked);
            }}
            // Keep the menu open so multiple members can be ticked in
            // one pass; closing after each pick would be multi-trip.
            onSelect={(e) => e.preventDefault()}
            className="flex items-center gap-2.5"
          >
            <UserAvatar userId={member.id} name={member.name} size="sm" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm text-foreground">{member.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {member.email}
              </span>
            </span>
            {/* Role tag — the roster carries same-named members, so the
                developer/tester distinction can't live in the name alone. */}
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                member.role === "tester"
                  ? "bg-sky-500/10 text-sky-600 dark:text-sky-400"
                  : "bg-violet-500/10 text-violet-600 dark:text-violet-400",
              )}
            >
              {member.role}
            </span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
