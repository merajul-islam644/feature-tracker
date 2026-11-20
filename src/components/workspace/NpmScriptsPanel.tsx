// npm Scripts panel — the sidebar tab that reads the workspace root's
// package.json and lists its `scripts` entries. One click on a row's
// play button sends `npm run <name>` to the active terminal: the panel
// only calls `onRunScript(name)`; the terminal-write signal itself is
// owned by WorkspacePage → TerminalPanel (`runCommandSignal`).
//
// Data: devServerApi.readUserFile("package.json") — the same
// relative-path read the editor uses, so the panel inherits the
// server's path-traversal guard. 404 → the "no package.json" empty
// state; a malformed package.json gets its own error row, because
// that's a real situation the user needs to see, not swallow.

import { useCallback, useEffect, useState } from "react";
import { Package, Play, RefreshCw } from "lucide-react";
import { devServerApi } from "@/services/devServerApi";
import { cn } from "@/lib/utils";

interface NpmScriptsPanelProps {
  workspaceId: string | null;
  /** Workspace root folder — package.json is read at its top level. */
  root: string | null;
  /** Run a script by name in the active terminal. */
  onRunScript: (name: string) => void;
}

interface ParsedPackage {
  name: string | null;
  scripts: [string, string][];
  /** package.json exists but isn't valid JSON — the message. */
  error: string | null;
  /** No package.json at the root (readUserFile 404). */
  missing: boolean;
}

function parsePackageJson(raw: string | null): ParsedPackage {
  if (raw === null) {
    return { name: null, scripts: [], error: null, missing: true };
  }
  try {
    // Strip a leading BOM — Windows-authored package.json files often
    // carry one, npm itself tolerates it, and JSON.parse chokes on it.
    const json = JSON.parse(raw.replace(/^\uFEFF/, "")) as {
      name?: unknown;
      scripts?: unknown;
    };
    const scripts: [string, string][] = [];
    if (
      json.scripts &&
      typeof json.scripts === "object" &&
      !Array.isArray(json.scripts)
    ) {
      for (const [k, v] of Object.entries(
        json.scripts as Record<string, unknown>,
      )) {
        if (k && typeof v === "string") scripts.push([k, v]);
      }
    }
    return {
      name: typeof json.name === "string" ? json.name : null,
      scripts,
      error: null,
      missing: false,
    };
  } catch (err) {
    return {
      name: null,
      scripts: [],
      error: err instanceof Error ? err.message : String(err),
      missing: false,
    };
  }
}

export function NpmScriptsPanel({
  workspaceId,
  root,
  onRunScript,
}: NpmScriptsPanelProps) {
  const [state, setState] = useState<ParsedPackage | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId || !root) {
      setState(null);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const raw = await devServerApi.readUserFile({
        workspaceId,
        root,
        path: "package.json",
      });
      setState(parsePackageJson(raw));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, root]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="npm-scripts-panel"
    >
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3 text-[11px] uppercase tracking-wider text-muted-foreground">
        <Package className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="font-semibold">npm Scripts</span>
        {state?.name && (
          <span className="truncate normal-case tracking-normal text-muted-foreground/60">
            {state.name}
          </span>
        )}
        <button
          type="button"
          onClick={() => void load()}
          aria-label="Refresh scripts"
          title="Reload package.json"
          disabled={loading || !root}
          className="ml-auto rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40"
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", loading && "animate-spin")}
            aria-hidden="true"
          />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {!root && (
          <EmptyRow text="Open a folder to see its npm scripts." />
        )}
        {root && loading && !state && (
          <EmptyRow text="Loading package.json…" />
        )}
        {root && !loading && loadError && (
          <EmptyRow text={`Read failed — ${loadError}`} />
        )}
        {root && !loading && !loadError && state?.missing && (
          <EmptyRow text="No package.json at the workspace root." />
        )}
        {root && !loading && !loadError && state?.error && (
          <EmptyRow
            text={`package.json is not valid JSON — ${state.error}`}
          />
        )}
        {root &&
          !loading &&
          !loadError &&
          state &&
          !state.error &&
          !state.missing &&
          state.scripts.length === 0 && (
            <EmptyRow text="This package.json defines no scripts." />
          )}
        {state?.scripts.map(([name, cmd]) => (
          <div
            key={name}
            className="group flex items-start gap-1 px-1.5 py-1 hover:bg-muted/50"
            data-testid={`npm-script-row-${name}`}
          >
            <button
              type="button"
              aria-label={`Run ${name}`}
              title={`npm run ${name}`}
              data-testid={`npm-script-run-${name}`}
              onClick={() => onRunScript(name)}
              className="mt-0.5 rounded p-1 text-muted-foreground opacity-70 hover:bg-accent hover:text-foreground hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <div className="min-w-0 flex-1 cursor-pointer"
              onClick={() => onRunScript(name)}
              title={`npm run ${name}`}
            >
              <div className="truncate text-xs font-medium text-foreground">
                {name}
              </div>
              <div
                className="truncate font-mono text-[10px] text-muted-foreground"
                title={cmd}
              >
                {cmd}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <p className="px-3 py-2 text-xs text-muted-foreground" role="status">
      {text}
    </p>
  );
}
