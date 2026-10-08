// Command palette — VS Code-style quick-open / command runner.
//
// Two modes sharing one overlay:
//   • files    (Ctrl/Cmd+P)         — fuzzy-filter the workspace file
//                                     tree, Enter opens in the editor.
//   • commands (Ctrl/Cmd+Shift+P)   — run any workspace action from a
//                                     flat list built by the parent.
// Typing ">" in files mode flips to commands, matching VS Code.
//
// Keyboard-first: the input autofocuses, ↑/↓ move, Enter runs, Esc
// closes. Mouse works too (click item / backdrop). Plain fixed-
// positioning overlay instead of ui/dialog — VS Code parks the
// palette near the top of the window, not mid-screen.

import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { basename, dirname } from "./treeHelpers";

export interface CommandDef {
  id: string;
  label: string;
  /** Section header shown above the label (VS Code's category). */
  group: string;
  /** Right-aligned shortcut hint, e.g. "Ctrl+Shift+F". */
  hint?: string;
  run: () => void;
}

interface CommandPaletteProps {
  mode: "files" | "commands";
  /** Relative file paths from the workspace tree (files only). */
  files: string[];
  commands: CommandDef[];
  onOpenFile: (path: string) => void;
  onClose: () => void;
}

/** Max rows rendered — the scorer ranks everything, we just cap the
 *  DOM so a 5,000-file tree can't build a 5,000-node list. */
const MAX_RESULTS = 50;

/** Subsequence fuzzy scorer. Higher is better; `null` = no match.
 *  Rewards streaks and word starts, lightly penalizes long targets
 *  so "a.ts" beats "aaa/aaa/aaa/a.ts" for query "a.ts". */
function fuzzyScore(text: string, query: string): number | null {
  const t = text.toLowerCase();
  let qi = 0;
  let score = 0;
  let streak = 0;
  let lastHit = -2;
  for (let ti = 0; ti < t.length && qi < query.length; ti++) {
    if (t[ti] !== query[qi]) continue;
    streak = lastHit === ti - 1 ? streak + 1 : 1;
    const wordStart = ti === 0 || "/\\-_. ".includes(t[ti - 1]);
    score += 2 + streak * 2 + (wordStart ? 4 : 0);
    lastHit = ti;
    qi++;
  }
  if (qi < query.length) return null;
  return score - t.length * 0.01;
}

export function CommandPalette({
  mode,
  files,
  commands,
  onOpenFile,
  onClose,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // ">" typed in files mode flips to commands (VS Code's quick-open
  // convention). Strip it from the match string.
  const effectiveMode: "files" | "commands" =
    mode === "files" && !query.startsWith(">") ? "files" : "commands";
  const matchQuery =
    effectiveMode === "commands" && query.startsWith(">")
      ? query.slice(1)
      : query;

  // Fresh palette on every open — VS Code starts empty each time.
  useEffect(() => {
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
  }, [mode]);

  // Two separately-typed memos (the union from a single memo makes
  // every consumer cast) — `results` picks between them per mode.
  const commandResults = useMemo<CommandDef[]>(() => {
    const q = matchQuery.trim().toLowerCase();
    return commands
      .filter(
        (c) =>
          !q ||
          c.label.toLowerCase().includes(q) ||
          c.group.toLowerCase().includes(q),
      )
      .slice(0, MAX_RESULTS);
  }, [matchQuery, commands]);

  const fileResults = useMemo<string[]>(() => {
    const q = matchQuery.trim();
    if (!q) return files.slice(0, MAX_RESULTS);
    return files
      .map((path) => ({ path, score: fuzzyScore(path, q) }))
      .filter((r): r is { path: string; score: number } => r.score !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS)
      .map((r) => r.path);
  }, [matchQuery, files]);

  const results: string[] | CommandDef[] =
    effectiveMode === "commands" ? commandResults : fileResults;

  // Keep the selection in bounds as the filtered list shrinks/grows.
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, results.length - 1)));
  }, [results.length]);

  // Selection follows the viewport — `nearest` avoids whole-list
  // jumps when ↑/↓ walks past an edge.
  useEffect(() => {
    const el = listRef.current?.children[active];
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function runAt(index: number) {
    if (effectiveMode === "files") {
      const path = (results as string[])[index];
      if (path === undefined) return;
      onClose();
      onOpenFile(path);
    } else {
      const cmd = (results as CommandDef[])[index];
      if (cmd === undefined) return;
      onClose();
      cmd.run();
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (results.length ? (a + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) =>
        results.length ? (a - 1 + results.length) % results.length : 0,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      runAt(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    // Backdrop click closes; the palette itself stops the click from
    // reaching it (mousedown inside would otherwise blur-then-close
    // mid-selection).
    <div
      className="fixed inset-0 z-50 bg-black/30"
      data-testid="command-palette"
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        className={cn(
          "fixed left-1/2 top-[10vh] w-[560px] max-w-[92vw] -translate-x-1/2",
          "overflow-hidden rounded-xl border bg-popover shadow-2xl",
        )}
        role="dialog"
        aria-modal="true"
        aria-label={
          effectiveMode === "files" ? "Quick open file" : "Command palette"
        }
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={
              effectiveMode === "files"
                ? "Type a file name… (> for commands)"
                : "Type a command…"
            }
            className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            aria-label="Search files or commands"
            data-testid="command-palette-input"
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        {results.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            {effectiveMode === "files"
              ? "No matching files"
              : "No matching commands"}
          </div>
        ) : (
          <ul
            ref={listRef}
            className="max-h-[320px] overflow-y-auto py-1"
            role="listbox"
          >
            {results.map((item, i) => {
              const selected = i === active;
              // Branch per mode so the row body sees a concrete type —
              // a union here would leak casts into every JSX line.
              if (effectiveMode === "files") {
                const path = item as string;
                return (
                  <li
                    key={`f:${path}`}
                    role="option"
                    aria-selected={selected}
                    onMouseMove={() => setActive(i)}
                    // onMouseDown (not click) so the input keeps
                    // focus and the palette doesn't backdrop-close
                    // mid-selection.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      runAt(i);
                    }}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm",
                      selected
                        ? "bg-primary/10 text-foreground"
                        : "text-foreground/90",
                    )}
                    data-testid="command-palette-item"
                  >
                    <span className="font-medium">{basename(path)}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {dirname(path)}
                    </span>
                    {selected && (
                      <CornerDownLeft
                        className="ml-auto h-3 w-3 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    )}
                  </li>
                );
              }
              const cmd = item as CommandDef;
              return (
                <li
                  key={`c:${cmd.id}`}
                  role="option"
                  aria-selected={selected}
                  onMouseMove={() => setActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    runAt(i);
                  }}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm",
                    selected
                      ? "bg-primary/10 text-foreground"
                      : "text-foreground/90",
                  )}
                  data-testid="command-palette-item"
                >
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {cmd.group}
                  </span>
                  <span className="truncate">{cmd.label}</span>
                  {cmd.hint && (
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                      {cmd.hint}
                    </span>
                  )}
                  {selected && !cmd.hint && (
                    <CornerDownLeft
                      className="ml-auto h-3 w-3 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex items-center gap-3 border-t border-border bg-muted/30 px-3 py-1.5 text-[10px] text-muted-foreground">
          <span>↑↓ navigate</span>
          <span>↵ {effectiveMode === "files" ? "open" : "run"}</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
