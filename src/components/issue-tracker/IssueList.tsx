// Issues list grouped by verification date only (user request
// 2026-11-24 — the application parent rows AND the group-level user
// picker are gone): every day a verification sees issues gets its own
// collapsible row named after that date, with the issue cards directly
// inside it. The application layer used to sit between the two (date ▸
// application ▸ issues), but issues are already project-scoped, so the
// app-name rows repeated the scope the user is sitting in. Assignment
// still exists per-issue through the details drawer — the batch picker
// that lived on the group headers was removed by the same request.

import { useMemo } from "react";
import { Bug, Inbox } from "lucide-react";
import { IssueCard } from "./IssueCard";
import { IssueGroup } from "./IssueGroup";
import type { Issue } from "@/types/issue-tracker";

interface Props {
  issues: Issue[];
  selectedIssueId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  /** True when the signed-in user holds the tester role — gates the
   *  per-card Approve button (manual re-test flow). */
  canApprove?: boolean;
  /** Approve as the signed-in tester (useIssueTracker.approveIssue). */
  onApprove?: (id: string) => Promise<boolean>;
}

// One date row: the calendar day, its display label, and the issues
// that belong to it.
interface DateBucket {
  key: string;
  label: string;
  count: number;
  issues: Issue[];
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
      issues: list,
    }));
}

export function IssueList({
  issues,
  selectedIssueId,
  onSelect,
  loading,
  canApprove = false,
  onApprove,
}: Props) {
  const totalCount = useMemo(() => issues.length, [issues]);

  // date ▸ issues — one collapsible row per verification day, cards
  // directly inside (no application layer, no group user picker).
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

  // One collapsible row per verification date (chevron + date + count),
  // issue cards nested directly. Only the most recent day starts
  // expanded: it's what the user just ran; older days read as folded
  // history.
  return (
    <div className="space-y-3">
      {dateBuckets.map((day, dayIndex) => (
        <IssueGroup
          key={day.key}
          title={day.label}
          count={day.count}
          defaultOpen={dayIndex === 0}
        >
          {day.issues.map((issue) => (
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
      ))}
    </div>
  );
}

// Used by the page-level summary tile and filters.
export function IssueListIcon() {
  return <Bug className="h-4 w-4 text-muted-foreground" aria-hidden="true" />;
}
