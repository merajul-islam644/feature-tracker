// Run History — the persisted list of past verification runs (survives
// backend restarts; the store is file-backed on the server). Compact rows:
// status dot, when it started, how long it took, scope size. The event log
// itself isn't loaded here — a row's detail is what the Verification Panel
// already shows for the latest run.

import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { issueTrackerApi } from "@/services/issueTrackerApi";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<string, string> = {
  completed: "bg-emerald-500",
  failed: "bg-destructive",
  cancelled: "bg-amber-500",
  running: "bg-sky-500 animate-pulse",
  queued: "bg-muted-foreground",
  paused: "bg-amber-500",
};

function formatDuration(from?: string, to?: string): string {
  if (!from || !to) return "—";
  const ms = +new Date(to) - +new Date(from);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function formatAgo(iso: string): string {
  const ms = Date.now() - +new Date(iso);
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function RunHistory() {
  const { data: runs = [], isLoading } = useQuery({
    queryKey: ["issue-tracker", "run-history"],
    queryFn: () => issueTrackerApi.listRuns(10),
    // History is low-stakes background data: a stale list is fine, and a
    // failed fetch shouldn't retry aggressively against a down backend.
    // The first fetch can land while the very run it should list is still
    // in flight (panel mounts at page load) — the interval picks the
    // settled run up without waiting for a remount/focus event.
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });

  if (!isLoading && runs.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Run History
        </CardTitle>
        <CardDescription>
          Past verification runs, newest first — kept across server restarts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : (
          <ul className="divide-y divide-border">
            {runs.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
              >
                <span
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    STATUS_TONE[r.status] ?? "bg-muted-foreground",
                  )}
                  aria-label={r.status}
                  title={r.status}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">
                    {Object.values(r.targetNames).join(", ") || "verification run"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatAgo(r.startedAt)} · {r.scope.length} checks ·{" "}
                    {formatDuration(r.startedAt, r.completedAt)} · {r.eventCount} events
                  </p>
                </div>
                <span className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
                  {r.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
