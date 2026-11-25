// Kanban board view for the Issues page — modeled on the GitHub
// Projects board viewer (user request 2026-11-25). One column per
// IssueStatus in lifecycle order; issue cards drag & drop between
// columns and the drop fires `updateIssueStatus`, so moving a card IS
// the status edit. Filters / search / the `?developer=` scoped view
// apply upstream (the page passes already-filtered issues), so the
// board always shows the same set the list view would.
//
// Column anatomy mirrors GitHub: header with title + count + collapse
// chevron, body of compact cards, muted "empty" hint. Collapsed
// columns shrink to a narrow vertical rail (title reads top-to-bottom)
// and spring back on click. Horizontal scroll carries the whole board;
// columns are fixed-width so cards keep a readable line length.

import { useMemo, useState } from "react";
import { BadgeCheck, ChevronRight, Clock3, FolderKanban, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useUsersByRole } from "@/lib/blocks/users";
import type { Issue, IssueStatus } from "@/types/issue-tracker";

interface Props {
  issues: Issue[];
  selectedIssueId: string | null;
  onSelect: (id: string) => void;
  /** Status change for a dropped card (store's updateIssueStatus). */
  onMoveStatus: (id: string, status: IssueStatus) => void;
}

// Lifecycle order — matches the status chip row in IssueFilters so the
// board columns read in the same order the user already knows.
const BOARD_COLUMNS: { status: IssueStatus; label: string }[] = [
  { status: "open", label: "Open" },
  { status: "investigating", label: "Investigating" },
  { status: "confirmed", label: "Confirmed" },
  { status: "fixed", label: "Fixed" },
  { status: "resolved", label: "Resolved" },
  { status: "wont_fix", label: "Won't fix" },
  { status: "ignored", label: "Ignored" },
  { status: "reopened", label: "Reopened" },
];

// Per-column header dot — echoes the statusTone vocabulary from
// IssueCard (open/confirmed destructive, investigating/reopened amber,
// fixed/resolved emerald, wont_fix/ignored muted) so the board and the
// chip row read as one system.
const columnDot: Record<IssueStatus, string> = {
  open: "bg-destructive",
  investigating: "bg-amber-500",
  confirmed: "bg-destructive",
  fixed: "bg-emerald-500",
  resolved: "bg-emerald-500",
  wont_fix: "bg-muted-foreground/40",
  ignored: "bg-muted-foreground/40",
  reopened: "bg-amber-500",
};

// GitHub-style label pill per severity — tinted fill + border in the
// severity hue (same vocabulary as IssueCard.severityTone) so the
// severity reads at card-scanning distance without a legend.
const severityPill: Record<Issue["severity"], string> = {
  critical: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  high: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  medium:
    "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-300/90",
  low: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
};

// Relative age for the card footer — GitHub boards show "updated 2h
// ago" style metadata; ours shows detection age. Days for anything
// older than a day keeps the line short.
function ageLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function IssueBoard({
  issues,
  selectedIssueId,
  onSelect,
  onMoveStatus,
}: Props) {
  // Collapse state is per-column, session-local (GitHub persists it to
  // the project view; we keep it in component state — the board
  // rebuilds fresh every visit, which matches how the rest of the
  // issue tracker treats view state).
  const [collapsed, setCollapsed] = useState<Record<IssueStatus, boolean>>(
    () => Object.fromEntries(BOARD_COLUMNS.map((c) => [c.status, false])) as Record<IssueStatus, boolean>,
  );
  // The column currently under a dragged card — highlights the drop
  // target so the user can see where the release will land.
  const [dragOverStatus, setDragOverStatus] = useState<IssueStatus | null>(
    null,
  );
  // The id being dragged — read back out of state on drop (dataTransfer
  // is wiped by the browser after drop on some stacks; state is the
  // reliable carrier).
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const columns = useMemo(() => {
    const byStatus = new Map<IssueStatus, Issue[]>();
    for (const col of BOARD_COLUMNS) byStatus.set(col.status, []);
    for (const issue of issues) {
      byStatus.get(issue.status)?.push(issue);
    }
    return byStatus;
  }, [issues]);

  // Developer roster — resolves assignee ids on cards into avatar
  // names. TanStack caches it per role, so the whole board shares one
  // read; an empty roster (still loading / 403 fallback) just hides
  // the avatar stack.
  const developers = useUsersByRole("developer").data ?? [];
  const developerName = (id: string) =>
    developers.find((d) => d.id === id)?.name;

  // Drop reads the id straight from the dataTransfer (set in
  // dragStart) — synchronous and reliable. The draggingId state is a
  // fallback only: reading state here would miss a same-tick
  // programmatic drag, where React hasn't flushed the dragstart
  // update before drop runs.
  const handleDrop = (e: React.DragEvent, status: IssueStatus) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain") || draggingId;
    setDragOverStatus(null);
    setDraggingId(null);
    if (!id) return;
    const issue = issues.find((i) => i.id === id);
    if (!issue || issue.status === status) return;
    onMoveStatus(id, status);
  };

  if (issues.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-6 py-10 text-center">
        <Inbox className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">
          No issues match your filters.
        </p>
        <p className="text-xs text-muted-foreground">
          Adjust the filters or run a new verification to discover issues.
        </p>
      </div>
    );
  }

  return (
    // Horizontal scroller — 8 columns at w-72 won't fit any viewport,
    // GitHub scrolls its board the same way. Columns stretch to the
    // board's full height (the page hands the remaining viewport here)
    // and each column's card stack scrolls VERTICALLY inside its own
    // column — per-column scrolling, per user request.
    <div className="issues-scrollbar -mx-1 flex h-full min-h-0 items-stretch gap-3 overflow-x-auto px-1 pb-1">
      {BOARD_COLUMNS.map((col) => {
        const list = columns.get(col.status) ?? [];
        const isCollapsed = collapsed[col.status];
        const isDropTarget = dragOverStatus === col.status;
        return isCollapsed ? (
          // Collapsed rail — vertical label + count; click re-expands.
          <button
            key={col.status}
            type="button"
            onClick={() =>
              setCollapsed((prev) => ({ ...prev, [col.status]: false }))
            }
            aria-label={`${col.label} — ${list.length} issues. Expand column`}
            className={cn(
              "flex w-11 shrink-0 flex-col items-center gap-2 rounded-lg border border-border bg-muted/40 px-1 py-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isDropTarget && "ring-2 ring-primary",
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverStatus(col.status);
            }}
            onDrop={(e) => handleDrop(e, col.status)}
          >
            <span
              className={cn("h-1.5 w-1.5 rounded-full", columnDot[col.status])}
              aria-hidden="true"
            />
            <span className="text-xs font-semibold tabular-nums text-foreground">
              {list.length}
            </span>
            <span
              className="mt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground [writing-mode:vertical-rl]"
              style={{ maxHeight: 220, overflow: "hidden" }}
            >
              {col.label}
            </span>
          </button>
        ) : (
          <section
            key={col.status}
            aria-label={`${col.label} column`}
            className={cn(
              "flex w-72 shrink-0 flex-col rounded-lg border border-border bg-muted/30",
              isDropTarget && "ring-2 ring-primary",
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverStatus(col.status);
            }}
            onDragLeave={(e) => {
              // Only clear when the pointer truly left the column —
              // child elements fire dragleave as the card travels over
              // them (relatedTarget still inside the section).
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setDragOverStatus(null);
              }
            }}
            onDrop={(e) => handleDrop(e, col.status)}
          >
            {/* Column header — dot + title + count + collapse chevron,
                the same anatomy as a GitHub project column header. */}
            <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5">
              <span
                className={cn("h-2 w-2 rounded-full", columnDot[col.status])}
                aria-hidden="true"
              />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
                {col.label}
              </h3>
              <span className="rounded-full bg-muted px-1.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
                {list.length}
              </span>
              <button
                type="button"
                onClick={() =>
                  setCollapsed((prev) => ({ ...prev, [col.status]: true }))
                }
                aria-label={`Collapse ${col.label} column`}
                title="Collapse column"
                className="ml-auto rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
            {/* Card stack — fills the column's remaining height and
                scrolls vertically INSIDE the column (min-h-0 lets the
                flex-1 body actually shrink to that bound), so a heavy
                column never stretches the board. */}
            <div className="issues-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
              {list.length === 0 ? (
                <p className="rounded-md border border-dashed border-border/60 px-2 py-4 text-center text-[11px] text-muted-foreground">
                  No issues
                </p>
              ) : (
                list.map((issue) => (
                  <article
                    key={issue.id}
                    draggable
                    onDragStart={(e) => {
                      setDraggingId(issue.id);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", issue.id);
                    }}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setDragOverStatus(null);
                    }}
                    onClick={() => onSelect(issue.id)}
                    aria-label={issue.title}
                    className={cn(
                      "group cursor-grab rounded-md border border-border bg-card p-2.5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing",
                      draggingId === issue.id && "opacity-50",
                      selectedIssueId === issue.id && "ring-2 ring-primary",
                    )}
                  >
                    {/* Label row — severity pill (tinted, GitHub-label
                        style) + category, with recurrence / approval
                        badges pushed right. */}
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "rounded-sm border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide",
                          severityPill[issue.severity],
                        )}
                      >
                        {issue.severity}
                      </span>
                      {issue.category !== "other" && (
                        <span className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          {issue.category}
                        </span>
                      )}
                      <span className="ml-auto flex shrink-0 items-center gap-1">
                        {(issue.occurrenceCount ?? 1) > 1 && (
                          <span
                            className="rounded bg-muted px-1 text-[10px] font-medium tabular-nums text-muted-foreground"
                            title={`Seen ${issue.occurrenceCount} times`}
                          >
                            ×{issue.occurrenceCount}
                          </span>
                        )}
                        {issue.approvedById && (
                          <BadgeCheck
                            className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
                            aria-label="Tester approved"
                          />
                        )}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs font-semibold leading-snug text-foreground">
                      {issue.title}
                    </p>
                    {issue.description && (
                      <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                        {issue.description.replace(/\s+/g, " ")}
                      </p>
                    )}
                    {/* Footer — application + age left, assignee
                        avatars right, above a hairline divider so the
                        card reads in two clear halves like a GitHub
                        card. */}
                    <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-border/50 pt-2">
                      <span className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
                        <FolderKanban
                          className="h-3 w-3 shrink-0"
                          aria-hidden="true"
                        />
                        <span className="truncate">
                          {issue.applicationName}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {(issue.assignedDeveloperIds ?? []).length > 0 && (
                          <span className="flex -space-x-1.5">
                            {(issue.assignedDeveloperIds ?? [])
                              .slice(0, 3)
                              .map((id) => (
                                <UserAvatar
                                  key={id}
                                  userId={id}
                                  name={developerName(id) ?? "?"}
                                  size="sm"
                                  className="h-5 w-5 border border-card text-[8px] ring-1 ring-card"
                                />
                              ))}
                          </span>
                        )}
                        <span className="flex items-center gap-0.5 tabular-nums">
                          <Clock3 className="h-3 w-3" aria-hidden="true" />
                          {ageLabel(issue.lastSeenAt ?? issue.detectedAt)}
                        </span>
                      </span>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        )
      })}
    </div>
  );
}
