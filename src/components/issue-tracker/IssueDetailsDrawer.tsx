// Issue detail drawer (spec section 25). Slides in from the right.

import { X, ExternalLink, RefreshCcw } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { EvidenceViewer } from "./EvidenceViewer";
import type { Issue, IssueStatus } from "@/types/issue-tracker";

interface Props {
  issue: Issue | null;
  onClose: () => void;
  onChangeStatus: (id: string, status: IssueStatus) => void;
  // Optional: when provided, render a "Verify Again" button next to the
  // status chips. Same call the chat layer uses; the mock assistant
  // replays "Targeted verification started for ISSUE-XXX".
  onVerifyAgain?: (id: string) => void;
}

const statusOptions: IssueStatus[] = [
  "open",
  "investigating",
  "confirmed",
  "fixed",
  "resolved",
  "wont_fix",
  "ignored",
  "reopened",
];

const severityTone: Record<Issue["severity"], string> = {
  critical: "bg-red-500/10 text-red-600 dark:text-red-400",
  high: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  medium: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
  low: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
};

export function IssueDetailsDrawer({ issue, onClose, onChangeStatus, onVerifyAgain }: Props) {
  const open = !!issue;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 sm:max-w-lg"
        aria-describedby="issue-drawer-desc"
      >
        {issue && (
          <>
            <SheetHeader>
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <SheetTitle className="text-base">{issue.title}</SheetTitle>
                  <SheetDescription id="issue-drawer-desc">
                    {issue.applicationName} — {issue.url}
                  </SheetDescription>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={onClose}
                  aria-label="Close details"
                  className="-mr-2 -mt-1 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </SheetHeader>

            <div className="flex flex-wrap items-center gap-2 px-4 py-2">
              <Badge className={severityTone[issue.severity]}>{issue.severity}</Badge>
              <Badge variant="muted">{issue.category.replace("_", " ")}</Badge>
              <span className="font-mono text-xs text-muted-foreground">{issue.id}</span>
              {(issue.occurrenceCount ?? 1) > 1 && (
                <Badge className="bg-violet-500/10 text-violet-600 dark:text-violet-400">
                  Seen ×{issue.occurrenceCount}
                  {issue.lastSeenAt
                    ? ` · last ${new Date(issue.lastSeenAt).toLocaleDateString()}`
                    : null}
                </Badge>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                Detected {new Date(issue.detectedAt).toLocaleString()}
              </span>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Description
                </h3>
                <p className="text-sm text-foreground">{issue.description}</p>
              </section>

              {(issue.expected || issue.actual) && (
                <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {issue.expected && (
                    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                        Expected
                      </p>
                      <p className="text-sm text-foreground">{issue.expected}</p>
                    </div>
                  )}
                  {issue.actual && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-destructive">
                        Actual
                      </p>
                      <p className="text-sm text-foreground">{issue.actual}</p>
                    </div>
                  )}
                </section>
              )}

              {issue.reproductionSteps && issue.reproductionSteps.length > 0 && (
                <section>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Reproduction steps
                  </h3>
                  <ol className="list-decimal space-y-1 pl-5 text-sm text-foreground">
                    {issue.reproductionSteps.map((step, idx) => (
                      <li key={idx}>{step}</li>
                    ))}
                  </ol>
                </section>
              )}

              <Separator />

              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Evidence
                  </h3>
                  {issue.evidence && issue.evidence.length > 0 && (
                    <Badge variant="muted">{issue.evidence.length}</Badge>
                  )}
                </div>
                {issue.evidence && issue.evidence.length > 0 ? (
                  <ul className="space-y-2">
                    {issue.evidence.map((ev, idx) => (
                      <li key={idx}>
                        <EvidenceViewer evidence={ev} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No evidence captured for this issue.
                  </p>
                )}
              </section>
            </div>

            <div className="flex flex-col gap-2 border-t border-border bg-background p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Update status
              </p>
              <div className="flex flex-wrap gap-1.5">
                {statusOptions.map((s) => {
                  const active = s === issue.status;
                  return (
                    <Button
                      key={s}
                      type="button"
                      variant={active ? "default" : "outline"}
                      size="sm"
                      onClick={() => onChangeStatus(issue.id, s)}
                      disabled={active}
                    >
                      {s.replace("_", " ")}
                    </Button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {onVerifyAgain && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onVerifyAgain(issue.id)}
                  >
                    <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    Verify Again
                  </Button>
                )}
                <a
                  href={issue.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Open in app <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
