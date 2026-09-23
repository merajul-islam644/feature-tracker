// Issues list grouped by verification date, then application (spec
// section 24): date ▸ application ▸ issues. Every day a verification
// sees issues gets its own collapsible row named after that date, so a
// run tomorrow automatically appears under tomorrow's date while older
// days stay as history above/below it.

import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Bug, Inbox } from "lucide-react";
import { IssueCard } from "./IssueCard";
import { IssueGroup, type MemberOption } from "./IssueGroup";
import { useUsersByRole } from "@/lib/blocks/users";
import { groupByApplication } from "@/hooks/useIssueTracker";
import type { Issue } from "@/types/issue-tracker";

interface Props {
  issues: Issue[];
  selectedIssueId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  /** Adds/removes a member on a batch of issues (useIssueTracker). */
  onToggleDeveloper?: (
    issues: Pick<Issue, "id" | "assignedDeveloperIds">[],
    developerId: string,
    assigned: boolean,
  ) => Promise<boolean>;
  /** True when the signed-in user holds the tester role — gates the
   *  per-card Approve button (manual re-test flow). */
  canApprove?: boolean;
  /** Approve as the signed-in tester (useIssueTracker.approveIssue). */
  onApprove?: (id: string) => Promise<boolean>;
}

// A group's ticked members: those assigned to EVERY issue in the group.
// A member on only some issues shows unticked — the tick reflects the
// group as a whole, and toggling re-aligns every issue in it.
function groupAssignees(list: Issue[]): string[] | undefined {
  const first = list[0]?.assignedDeveloperIds;
  if (!first || first.length === 0) return undefined;
  const shared = first.filter((id) =>
    list.every((i) => (i.assignedDeveloperIds ?? []).includes(id)),
  );
  return shared.length > 0 ? shared : undefined;
}

// One date row: the calendar day, its display label, the total issue
// count across applications, and the per-application groups inside.
interface DateBucket {
  key: string;
  label: string;
  count: number;
  groups: Map<string, Issue[]>;
}

// The day an issue belongs to: the LAST day a verification saw it
// (`lastSeenAt`, bumped on fingerprint dedup), falling back to when it
// was first detected. That makes each date row a snapshot of what that
// day's run found — a re-detected issue moves to the newest day, an
// untouched one keeps its original date.
function dayKeyOf(issue: Issue): { key: string; date: Date } {
  const date = new Date(issue.lastSeenAt ?? issue.detectedAt);
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { key, date };
}

function bucketByDate(issues: Issue[]): DateBucket[] {
  const byDay = new Map<string, Issue[]>();
  for (const issue of issues) {
    const { key } = dayKeyOf(issue);
    const list = byDay.get(key);
    if (list) list.push(issue);
    else byDay.set(key, [issue]);
  }
  // Newest date first — today's (or the most recent) verification sits
  // on top, older days read as history below. yyyy-mm-dd keys sort
  // chronologically as plain strings.
  return Array.from(byDay.entries())
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([key, list]) => ({
      key,
      label: dayKeyOf(list[0]!).date.toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
      count: list.length,
      groups: groupByApplication(list),
    }));
}

export function IssueList({
  issues,
  selectedIssueId,
  onSelect,
  loading,
  onToggleDeveloper,
  canApprove = false,
  onApprove,
}: Props) {
  const navigate = useNavigate();
  const totalCount = useMemo(() => issues.length, [issues]);
  // Member roster for the per-group header dropdown: developers AND
  // testers, each tagged with their role so same-named members stay
  // distinguishable. Fetched here once (TanStack caches per role across
  // the session) so every group shares two calls; `[]` while loading
  // just hides the dropdown trigger.
  const developers = useUsersByRole("developer").data ?? [];
  const testers = useUsersByRole("tester").data ?? [];
  const members = useMemo<MemberOption[]>(
    () => [
      ...developers.map((d) => ({ ...d, role: "developer" })),
      ...testers.map((t) => ({ ...t, role: "tester" })),
    ],
    [developers, testers],
  );

  // Ticking a member on a group adds them to that group's issues;
  // unticking removes them. Navigation is NOT done here — the menu stays
  // open so several members can be ticked, and the scoped view opens on
  // menu close (last member ticked) via handleNavigateDeveloper. Ticks
  // land when the (invalidated) issues query refetches.
  const handleToggleDeveloper = (
    list: Issue[],
    member: MemberOption,
    assigned: boolean,
  ) => onToggleDeveloper?.(list, member.id, assigned);

  const handleNavigateDeveloper = (member: MemberOption) => {
    navigate(`/issue-tracker?developer=${encodeURIComponent(member.id)}`);
  };

  // date ▸ application ▸ issues. Each verification day gets its own
  // collapsible row; applications group inside it as before.
  const dateBuckets = useMemo(() => bucketByDate(issues), [issues]);

  if (loading && issues.length === 0) {
    return (
      <div
        className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-6 py-10 text-center"
        role="status"
      >
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Loading issues…</p>
      </div>
    );
  }

  if (totalCount === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-6 py-10 text-center">
        <Inbox className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">No issues match your filters.</p>
        <p className="text-xs text-muted-foreground">
          Adjust the filters or run a new verification to discover issues.
        </p>
      </div>
    );
  }

  // One collapsible row per verification date (chevron + date + count —
  // the same header idiom as the application groups), applications
  // nested inside. Only the most recent day starts expanded: it's what
  // the user just ran; older days read as folded history. No members
  // dropdown on date rows — assignment stays a per-application action.
  return (
    <div className="space-y-3">
      {dateBuckets.map((day, dayIndex) => (
        <IssueGroup
          key={day.key}
          title={day.label}
          count={day.count}
          defaultOpen={dayIndex === 0}
        >
          {Array.from(day.groups.entries()).map(([appName, list]) => (
            <li key={appName}>
              <IssueGroup
                title={appName}
                count={list.length}
                members={members}
                assignedDeveloperIds={groupAssignees(list)}
                onToggleDeveloper={(member, assigned) =>
                  void handleToggleDeveloper(list, member, assigned)
                }
                onNavigateDeveloper={handleNavigateDeveloper}
              >
                {list.map((issue) => (
                  <li key={issue.id}>
                    <IssueCard
                      issue={issue}
                      onOpen={onSelect}
                      selected={selectedIssueId === issue.id}
                      canApprove={canApprove}
                      onApprove={
                        onApprove ? (id) => void onApprove(id) : undefined
                      }
                    />
                  </li>
                ))}
              </IssueGroup>
            </li>
          ))}
        </IssueGroup>
      ))}
    </div>
  );
}

// Used by the page-level summary tile and filters.
export function IssueListIcon() {
  return <Bug className="h-4 w-4 text-muted-foreground" aria-hidden="true" />;
}
