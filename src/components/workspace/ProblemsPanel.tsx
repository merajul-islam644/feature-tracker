// Problems panel — the sidebar tab that lists language-server
// diagnostics (Phase 1: TypeScript) grouped by file. VS Code keeps
// Problems in the bottom dock; here it's a sidebar tab because the
// activity bar already exists and the dock is terminal real estate —
// if the dock grows a PROBLEMS tab later this component is the list
// renderer either way.
//
// Data comes straight from DevServerContext (`lspDiagnostics`,
// `lspOnline`) — no props for state, only the click-to-source
// callback. Clicking a row opens the file and centers the offending
// line (same mechanic as SearchPanel's results).

import { useMemo } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Info,
  ListFilter,
  PlugZap,
} from "lucide-react";
import { useDevServer } from "@/contexts/DevServerContext";
import type { LspDiagnostic } from "@/types/dev-server";
import { cn } from "@/lib/utils";

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

interface FileGroup {
  path: string;
  diagnostics: LspDiagnostic[];
  errors: number;
  warnings: number;
}

function groupByFile(map: Record<string, LspDiagnostic[]>): FileGroup[] {
  const groups: FileGroup[] = [];
  for (const [path, diagnostics] of Object.entries(map)) {
    const meaningful = diagnostics.filter((d) => d.severity <= 2);
    if (meaningful.length === 0) continue;
    groups.push({
      path,
      diagnostics: meaningful,
      errors: meaningful.filter((d) => d.severity === 1).length,
      warnings: meaningful.filter((d) => d.severity === 2).length,
    });
  }
  // Files with the most errors first — the "what do I fix first"
  // ordering. Stable within a group (insertion order of the map).
  groups.sort((a, b) => b.errors - a.errors || b.warnings - a.warnings);
  return groups;
}

function SeverityIcon({ severity }: { severity: number }) {
  if (severity === 1) {
    return <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden="true" />;
  }
  if (severity === 2) {
    return <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />;
  }
  return <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-500" aria-hidden="true" />;
}

export function ProblemsPanel({
  onOpen,
}: {
  onOpen: (path: string, line: number, column: number) => void;
}) {
  const { lspDiagnostics, lspOnline } = useDevServer();

  const groups = useMemo(() => groupByFile(lspDiagnostics), [lspDiagnostics]);
  const totalErrors = useMemo(
    () => groups.reduce((n, g) => n + g.errors, 0),
    [groups],
  );
  const totalWarnings = useMemo(
    () => groups.reduce((n, g) => n + g.warnings, 0),
    [groups],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="problems-panel">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <ListFilter className="h-3.5 w-3.5" aria-hidden="true" />
          Problems
        </div>
        {(totalErrors > 0 || totalWarnings > 0) && (
          <div className="flex items-center gap-2 text-[11px]">
            {totalErrors > 0 && (
              <span className="flex items-center gap-1 text-red-500">
                <CircleAlert className="h-3 w-3" aria-hidden="true" />
                {totalErrors}
              </span>
            )}
            {totalWarnings > 0 && (
              <span className="flex items-center gap-1 text-amber-500">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                {totalWarnings}
              </span>
            )}
          </div>
        )}
      </div>

      {!lspOnline ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-xs text-center text-xs text-muted-foreground">
            <PlugZap
              className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40"
              aria-hidden="true"
            />
            <p className="mb-2 font-medium text-foreground">
              Language server offline
            </p>
            <p>
              TypeScript diagnostics couldn&apos;t start for this
              workspace. The editor still works — this panel will
              light up once the server is available.
            </p>
          </div>
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-xs text-center text-xs text-muted-foreground">
            <CheckCircle2
              className="mx-auto mb-3 h-8 w-8 text-emerald-500/70"
              aria-hidden="true"
            />
            <p className="mb-2 font-medium text-foreground">
              No problems detected
            </p>
            <p>Diagnostics refresh as you type and when files change.</p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto py-1 text-xs">
          {groups.map((group) => (
            <div key={group.path} className="mb-1">
              <div className="flex items-center gap-1.5 px-3 py-1 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">
                  {basename(group.path)}
                </span>
                {dirname(group.path) && (
                  <span className="truncate">{dirname(group.path)}</span>
                )}
                <span className="ml-auto shrink-0">
                  {group.errors > 0 && (
                    <span className="text-red-500">{group.errors}</span>
                  )}
                  {group.errors > 0 && group.warnings > 0 && (
                    <span className="mx-1">·</span>
                  )}
                  {group.warnings > 0 && (
                    <span className="text-amber-500">{group.warnings}</span>
                  )}
                </span>
              </div>
              {group.diagnostics.map((d, i) => (
                <button
                  key={`${d.range.start.line}-${d.range.start.character}-${i}`}
                  type="button"
                  onClick={() =>
                    onOpen(
                      d.path,
                      d.range.start.line + 1,
                      d.range.start.character + 1,
                    )
                  }
                  className={cn(
                    "flex w-full items-start gap-2 px-3 py-1 text-left",
                    "hover:bg-accent/50 focus-visible:bg-accent/50",
                    "focus-visible:outline-none",
                  )}
                  title={d.message}
                >
                  <SeverityIcon severity={d.severity} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-foreground">
                      {d.message}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      Ln {d.range.start.line + 1}, Col{" "}
                      {d.range.start.character + 1}
                      {d.source ? ` · ${d.source}` : ""}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
