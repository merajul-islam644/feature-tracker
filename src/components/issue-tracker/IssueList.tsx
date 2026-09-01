// Issues list grouped by application (spec section 24).

import { useMemo } from "react";
import { Bug, Inbox } from "lucide-react";
import { IssueCard } from "./IssueCard";
import { IssueGroup } from "./IssueGroup";
import type { Issue } from "@/types/issue-tracker";

interface Props {
  issues: Issue[];
  groupedIssues: Map<string, Issue[]>;
  selectedIssueId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
}

export function IssueList({
  issues,
  groupedIssues,
  selectedIssueId,
  onSelect,
  loading,
}: Props) {
  const totalCount = useMemo(() => issues.length, [issues]);
  const groupEntries = useMemo(
    () => Array.from(groupedIssues.entries()),
    [groupedIssues],
  );

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

  if (groupEntries.length === 1) {
    const [appName, list] = groupEntries[0]!;
    return (
      <div className="space-y-2">
        <IssueGroup title={appName} count={list.length}>
          {list.map((issue) => (
            <li key={issue.id}>
              <IssueCard
                issue={issue}
                onOpen={onSelect}
                selected={selectedIssueId === issue.id}
              />
            </li>
          ))}
        </IssueGroup>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {groupEntries.map(([appName, list]) => (
        <IssueGroup key={appName} title={appName} count={list.length}>
          {list.map((issue) => (
            <li key={issue.id}>
              <IssueCard
                issue={issue}
                onOpen={onSelect}
                selected={selectedIssueId === issue.id}
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
