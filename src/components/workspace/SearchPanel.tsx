// Project-wide search modal — the "Cmd+Shift+F" panel.
//
// Wraps the mcp-server `/dev-server/:wsId/search` endpoint in a
// VS Code-style dialog: input row with case / word / regex toggles,
// scrollable result list with `(path:line:col)` rows, click to open
// the file in the editor + jump to the match.
//
// "Search" vs "Find" (Cmd+F) — search is project-wide (this file);
// find is in-buffer (CodeMirror's built-in). Splitting keeps the
// server contract simple (the mcp-server never buffers a file into
// memory for a regex; ripgrep does that).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CaseSensitive, Regex, Search, WholeWord, X } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { useT } from "@/lib/blocks/i18n";
import { useDevServer } from "@/contexts/DevServerContext";
import type { SearchResult } from "@/types/dev-server";
import { cn } from "@/lib/utils";
import { basename } from "./treeHelpers";

interface SearchPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when the user clicks a result. Receives the file path
   *  and the line number — the consumer is expected to open the
   *  file + jump the cursor. */
  onOpenResult: (path: string, line: number, column: number) => void;
}

interface ResultRow {
  result: SearchResult;
  filePath: string;
  matchPreview: string;
}

export function SearchPanel({ open, onOpenChange, onOpenResult }: SearchPanelProps) {
  const t = useT();
  const { search } = useDevServer();
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [count, setCount] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // AbortController so a rapid-typing user doesn't see stale results
  // land out of sequence. Cancelling on each new keystroke.
  const inFlightRef = useRef<AbortController | null>(null);

  // Focus the input on open + reset transient state.
  useEffect(() => {
    if (!open) return;
    setActiveIdx(0);
    // Slight defer so the Dialog animation doesn't fight the focus.
    const id = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, [open]);

  // Run a search whenever the query or any toggle flips. The mcp-server
  // route is fast (single round-trip on a typical project), so debounce
  // ~150ms — enough to coalesce a rapid typing streak without making
  // the result feel laggy.
  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setCount(0);
      setTruncated(false);
      setError(null);
      return;
    }
    const ctrl = new AbortController();
    inFlightRef.current?.abort();
    inFlightRef.current = ctrl;
    const id = window.setTimeout(async () => {
      setRunning(true);
      setError(null);
      try {
        const res = await search({
          query: trimmed,
          caseSensitive,
          wholeWord,
          regex,
        });
        if (ctrl.signal.aborted) return;
        setResults(res.results);
        setCount(res.count);
        setTruncated(res.truncated);
        setActiveIdx(0);
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
        setResults([]);
        setCount(0);
        setTruncated(false);
      } finally {
        if (!ctrl.signal.aborted) setRunning(false);
      }
    }, 150);
    return () => {
      window.clearTimeout(id);
      ctrl.abort();
    };
  }, [open, query, caseSensitive, wholeWord, regex, search]);

  // Reset state on close so re-opening starts clean.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setError(null);
      setResults([]);
      setCount(0);
      setTruncated(false);
      setActiveIdx(0);
    }
  }, [open]);

  // Decorate each result with a preview that highlights the match.
  // Cheap implementation: split the line on the first match, render
  // the head + match + tail as separate spans. For regex we use the
  // undecorated line (highlighting an arbitrary regex in plain text
  // is its own rabbit hole — VS Code shows them with a faint
  // background and skips the rest).
  const decorated: ResultRow[] = useMemo(() => {
    if (!query.trim()) return [];
    return results.map((r) => {
      const needle = caseSensitive ? query : query.toLowerCase();
      const line = r.preview;
      const haystack = caseSensitive ? line : line.toLowerCase();
      const idx = haystack.indexOf(needle);
      if (regex || idx < 0) {
        return { result: r, filePath: r.path, matchPreview: line };
      }
      const before = line.slice(0, idx);
      const hit = line.slice(idx, idx + query.length);
      const after = line.slice(idx + query.length);
      // Build a single string with sentinel characters; we render
      // with React's split in JSX below via matchPreview + parts.
      // To keep the type simple, return the line un-split and let
      // the renderer do the split inline.
      return {
        result: r,
        filePath: r.path,
        matchPreview: `${before}__${hit}__${after}`,
      };
    });
  }, [results, query, caseSensitive, regex]);

  // Scroll active row into view on arrow-nav.
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-result-idx="${activeIdx}"]`,
    );
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  const onInputKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onOpenChange(false);
        return;
      }
      if (decorated.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, decorated.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const row = decorated[activeIdx];
        if (row) {
          onOpenResult(row.result.path, row.result.line, row.result.column);
          onOpenChange(false);
        }
      }
    },
    [decorated, activeIdx, onOpenResult, onOpenChange],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="gap-0">
        <DialogTitle className="sr-only">
          {t("issueTracker.workspace.search.title", "Search in project")}
        </DialogTitle>
        <DialogHeader className="flex-row items-center gap-2 py-3">
          <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder={t(
              "issueTracker.workspace.search.placeholder",
              "Search in project (regex, case-sensitive, whole word)",
            )}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
            aria-label="Search query"
            // Spell-check off — code identifiers are rarely English.
            spellCheck={false}
            autoComplete="off"
          />
          <ToggleButton
            label="Match case"
            active={caseSensitive}
            onClick={() => setCaseSensitive((v) => !v)}
            icon={<CaseSensitive className="h-3.5 w-3.5" />}
          />
          <ToggleButton
            label="Whole word"
            active={wholeWord}
            onClick={() => setWholeWord((v) => !v)}
            icon={<WholeWord className="h-3.5 w-3.5" />}
          />
          <ToggleButton
            label="Regular expression"
            active={regex}
            onClick={() => setRegex((v) => !v)}
            icon={<Regex className="h-3.5 w-3.5" />}
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            className="h-7 w-7"
            aria-label="Close search"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </DialogHeader>

        <DialogBody className="p-0">
          <div className="flex items-center justify-between border-b border-border bg-surface-muted px-4 py-2 text-[11px] text-muted-foreground">
            <div>
              {running
                ? t("issueTracker.workspace.search.running", "Searching…")
                : error
                  ? error
                  : query.trim() === ""
                    ? t(
                        "issueTracker.workspace.search.empty",
                        "Type to search across the project",
                      )
                    : `${count.toLocaleString()} ${count === 1 ? "result" : "results"}${truncated ? " (truncated — refine your query)" : ""}`}
            </div>
            <div className="flex items-center gap-1">
              <span>
                <Kbd>↑</Kbd> <Kbd>↓</Kbd> to navigate
              </span>
              <span aria-hidden="true">·</span>
              <span>
                <Kbd>Enter</Kbd> to open
              </span>
              <span aria-hidden="true">·</span>
              <span>
                <Kbd>Esc</Kbd> to close
              </span>
            </div>
          </div>

          <div
            ref={listRef}
            role="listbox"
            aria-label="Search results"
            className="max-h-[60vh] overflow-y-auto"
          >
              {decorated.map((row, i) => {
                const isActive = i === activeIdx;
                return (
                  <button
                    key={`${row.result.path}:${row.result.line}:${row.result.column}`}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    data-result-idx={i}
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => {
                      onOpenResult(
                        row.result.path,
                        row.result.line,
                        row.result.column,
                      );
                      onOpenChange(false);
                    }}
                    className={cn(
                      "flex w-full flex-col items-start gap-1 border-b border-border-subtle px-4 py-2 text-left transition-colors",
                      isActive
                        ? "bg-primary-muted text-foreground"
                        : "text-foreground hover:bg-surface-muted",
                    )}
                  >
                    <div className="flex w-full items-center gap-2 text-xs">
                      <span className="font-mono text-muted-foreground">
                        {row.result.path}
                      </span>
                      <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                        :{row.result.line}:{row.result.column}
                      </span>
                    </div>
                    <PreviewLine
                      text={row.matchPreview}
                      isActive={isActive}
                    />
                  </button>
                );
              })}
              {!running && !error && query.trim() !== "" && decorated.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No matches.
                </div>
              )}
            </div>
          </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function ToggleButton({
  label,
  active,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors",
        active
          ? "bg-primary-muted text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {icon}
    </button>
  );
}

function PreviewLine({ text, isActive }: { text: string; isActive: boolean }) {
  // The match decorator encodes the match as `before__hit__after`.
  // Split on that exact triple. If absent (regex / not found), render
  // the whole line.
  const sentinel = "__";
  const i = text.indexOf(sentinel);
  if (i < 0) {
    return (
      <span
        className={cn(
          "line-clamp-1 font-mono text-[11px]",
          isActive ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {text}
      </span>
    );
  }
  const j = text.indexOf(sentinel, i + sentinel.length);
  if (j < 0) {
    return (
      <span className="line-clamp-1 font-mono text-[11px] text-muted-foreground">
        {text}
      </span>
    );
  }
  const before = text.slice(0, i);
  const hit = text.slice(i + sentinel.length, j);
  const after = text.slice(j + sentinel.length);
  return (
    <span
      className={cn(
        "line-clamp-1 font-mono text-[11px]",
        isActive ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {before}
      <span className="rounded bg-amber-300/40 px-0.5 text-foreground dark:bg-amber-300/30">
        {hit}
      </span>
      {after}
    </span>
  );
}

// Re-export for consumers that want to render a tiny standalone
// "no results" placeholder (rare; mainly for tests).
export function SearchEmptyHint() {
  return <span className="text-xs text-muted-foreground">no results</span>;
}

// Helper for WorkspacePage — exposes the basename of a search result.
// (We don't use it directly here; re-exported because the divider in
// WorkspacePage's breadcrumb uses basename from treeHelpers.)
export { basename };