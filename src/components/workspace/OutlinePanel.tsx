// Outline panel — the sidebar tab listing the active file's symbols
// (functions, classes, methods, variables…) from the language server's
// textDocument/documentSymbol. Clicking a row opens the file at the
// symbol's selection range — the same openSearchResult mechanic the
// Search and Problems panels use.
//
// Data: fetched here directly via devServerApi.lspRequest (the panel
// owns its fetch lifecycle — WorkspacePage only hands it the active
// path + content). Re-queries 600ms after the content settles so an
// unsaved keystroke sequence doesn't spam the language server; the
// trailing debounce mirrors the editor's autosave/LSP-sync rhythm.

import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Braces,
  FileCode2,
  FunctionSquare,
  Hash,
  ListTree,
  Loader2,
  Package,
  PlugZap,
  Type,
  Variable,
  type LucideIcon,
} from "lucide-react";
import { useDevServer } from "@/contexts/DevServerContext";
import { devServerApi } from "@/services/devServerApi";
import type { LspDocumentSymbol } from "@/types/dev-server";
import { basename, dirname } from "./treeHelpers";
import { cn } from "@/lib/utils";

/** LSP SymbolKind → icon + label. Numbers come from the protocol
 *  enum; kinds tsserver actually emits for TS/JS are covered, the
 *  rest fall through to a generic file glyph. */
const KIND_INFO: Record<number, { icon: LucideIcon; label: string }> = {
  2: { icon: FileCode2, label: "Module" },
  3: { icon: Package, label: "Namespace" },
  4: { icon: Package, label: "Package" },
  5: { icon: Box, label: "Class" },
  6: { icon: FunctionSquare, label: "Method" },
  7: { icon: FunctionSquare, label: "Constructor" },
  8: { icon: Variable, label: "Field" },
  9: { icon: Hash, label: "Constant" },
  10: { icon: Type, label: "String" },
  11: { icon: Hash, label: "Number" },
  12: { icon: FunctionSquare, label: "Function" },
  13: { icon: ListTree, label: "Enum" },
  14: { icon: Braces, label: "Interface" },
  22: { icon: Box, label: "Struct" },
  23: { icon: Variable, label: "Variable" },
  24: { icon: Type, label: "Type Parameter" },
};

function kindInfo(kind: number): { icon: LucideIcon; label: string } {
  return KIND_INFO[kind] ?? { icon: FileCode2, label: "Symbol" };
}

interface OutlinePanelProps {
  activePath: string | null;
  /** Current editor content for the active file — the doc payload so
   *  the outline reflects unsaved edits. */
  content: string;
  /** Same navigation callback the Search/Problems panels use
   *  (1-indexed line + column). */
  onOpen: (path: string, line: number, column: number) => void;
}

interface OutlineRow {
  key: string;
  name: string;
  detail?: string;
  kind: number;
  depth: number;
  line: number;
  col: number;
}

/** Flatten the (possibly hierarchical) symbol response into indented
 *  rows. Handles both the hierarchical DocumentSymbol shape and the
 *  flat SymbolInformation fallback the server may negotiate down to. */
function flattenSymbols(
  symbols: LspDocumentSymbol[],
  depth = 0,
  out: OutlineRow[] = [],
): OutlineRow[] {
  for (const s of symbols) {
    const sel = s.selectionRange ?? s.location?.range;
    if (!sel) continue;
    out.push({
      key: `${depth}:${s.name}:${sel.start.line}:${sel.start.character}`,
      name: s.name,
      detail: s.detail,
      kind: s.kind,
      depth,
      line: sel.start.line + 1,
      col: sel.start.character + 1,
    });
    if (s.children?.length) flattenSymbols(s.children, depth + 1, out);
  }
  return out;
}

export function OutlinePanel({ activePath, content, onOpen }: OutlinePanelProps) {
  const { workspace, workspaceRoot } = useDevServer();

  const [symbols, setSymbols] = useState<LspDocumentSymbol[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const workspaceId = workspace?.id ?? null;
  const root = workspaceRoot?.path ?? null;

  useEffect(() => {
    setSymbols(null);
    setError(null);
    if (!activePath || !workspaceId || !root) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = (await devServerApi.lspRequest({
            workspaceId,
            root,
            method: "textDocument/documentSymbol",
            params: { path: activePath },
            doc: { path: activePath, content },
          })) as LspDocumentSymbol[] | null;
          if (cancelled) return;
          setSymbols(Array.isArray(result) ? result : []);
          setError(null);
        } catch (err) {
          // tsserver has no documentSymbol provider for this language
          // (markdown, css…) — surface a soft message, not a toast.
          if (!cancelled) {
            setSymbols(null);
            setError(err instanceof Error ? err.message : String(err));
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activePath, content, workspaceId, root]);

  const rows = useMemo(
    () => (symbols ? flattenSymbols(symbols) : []),
    [symbols],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="outline-panel">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Outline
        </span>
        {activePath && (
          <span
            className="max-w-[55%] truncate font-mono text-[10px] text-muted-foreground"
            title={activePath}
          >
            {basename(activePath)}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1 text-xs">
        {!activePath && (
          <p className="px-1.5 py-3 text-muted-foreground">
            No file open — the outline lists the active editor file's
            functions, classes and variables.
          </p>
        )}

        {activePath && loading && !symbols && (
          <p className="flex items-center gap-2 px-1.5 py-3 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Reading symbols…
          </p>
        )}

        {activePath && error && (
          <p className="flex items-start gap-2 px-1.5 py-3 text-muted-foreground">
            <PlugZap className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              No symbol information for this file.
              <span className="mt-1 block break-words font-mono text-[10px] opacity-70">
                {error}
              </span>
            </span>
          </p>
        )}

        {activePath && !error && symbols && rows.length === 0 && (
          <p className="px-1.5 py-3 text-muted-foreground">
            No symbols found in this file.
          </p>
        )}

        {activePath &&
          !error &&
          rows.map((row) => {
            const info = kindInfo(row.kind);
            const Icon = info.icon;
            return (
              <button
                key={row.key}
                type="button"
                data-testid="outline-row"
                title={`${info.label} · ${dirname(activePath) || "."}/${row.name} · line ${row.line}`}
                onClick={() => void onOpen(activePath, row.line, row.col)}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left",
                  "text-foreground/90 hover:bg-muted/60",
                )}
                style={{ paddingLeft: 6 + row.depth * 14 }}
              >
                <Icon
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  aria-label={info.label}
                />
                <span className="truncate font-mono">{row.name}</span>
                {row.detail && (
                  <span className="ml-auto shrink-0 truncate font-mono text-[10px] text-muted-foreground">
                    {row.detail}
                  </span>
                )}
              </button>
            );
          })}
      </div>
    </div>
  );
}
