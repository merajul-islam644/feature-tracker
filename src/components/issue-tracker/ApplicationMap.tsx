// Application Map (spec section: exploration) — the crawl graph the deep
// walk produces at the end of each target: every page visited mapped to the
// same-origin pages discovered from it. Rendered as a collapsible tree per
// application once the run settles. Pure presentational — the data lives on
// `VerificationRun.appMaps`, keyed by application name.

import { useMemo, useState } from "react";
import { ChevronRight, FileText, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  appMaps: Record<string, Record<string, string[]>>;
}

// Trim a URL to origin-relative path + hash-less query for readability.
function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + (u.search || "");
  } catch {
    return url;
  }
}

interface TreeNode {
  url: string;
  children: TreeNode[];
  // True when this node was already rendered elsewhere in the tree — the
  // crawl graph is cyclic (A→B→A), so second encounters render as leaves.
  repeated: boolean;
}

// Build a forest from the page → discovered-pages graph. The walk can enter
// a site at several disconnected points (redirects, probe landings), so any
// visited page that isn't reachable from an earlier root starts its own
// root. Cycles are cut by marking the second encounter of a URL as
// `repeated` and not descending into it; URLs already rendered under an
// earlier tree render as repeated leaves too.
function buildForest(pages: Record<string, string[]>): TreeNode[] {
  const rendered = new Set<string>();
  const forest: TreeNode[] = [];

  const makeNode = (url: string, ancestors: Set<string>): TreeNode => {
    rendered.add(url);
    const children: TreeNode[] = [];
    for (const to of pages[url] ?? []) {
      if (ancestors.has(to) || rendered.has(to)) {
        children.push({ url: to, children: [], repeated: true });
        continue;
      }
      ancestors.add(to);
      children.push(makeNode(to, ancestors));
      ancestors.delete(to);
    }
    return { url, children, repeated: false };
  };

  for (const key of Object.keys(pages)) {
    if (rendered.has(key)) continue;
    forest.push(makeNode(key, new Set([key])));
  }
  return forest;
}

function countPages(pages: Record<string, string[]>): number {
  return new Set(Object.keys(pages).concat(...Object.values(pages))).size;
}

export function ApplicationMap({ appMaps }: Props) {
  const apps = Object.entries(appMaps);
  if (apps.length === 0) return null;

  return (
    <div className="space-y-4">
      {apps.map(([appName, pages]) => (
        <ApplicationMapTree
          key={appName}
          appName={appName}
          pages={pages}
        />
      ))}
    </div>
  );
}

function ApplicationMapTree({
  appName,
  pages,
}: {
  appName: string;
  pages: Record<string, string[]>;
}) {
  const forest = useMemo(() => buildForest(pages), [pages]);
  const total = useMemo(() => countPages(pages), [pages]);
  const [collapsed, setCollapsed] = useState(false);

  if (forest.length === 0) return null;

  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <ChevronRight
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            !collapsed && "rotate-90",
          )}
          aria-hidden="true"
        />
        <Network className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="flex-1 text-sm font-medium text-foreground">{appName}</span>
        <span className="text-xs text-muted-foreground">
          {total} page{total === 1 ? "" : "s"}
        </span>
      </button>
      {!collapsed && (
        <ul className="space-y-0.5 border-t border-border px-3 py-2 pl-6">
          {forest.map((root, i) => (
            <TreeRow key={`${root.url}-${i}`} node={root} depth={0} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TreeRow({ node, depth }: { node: TreeNode; depth: number }) {
  return (
    <>
      <li
        className="flex items-center gap-1.5 py-0.5 text-xs"
        style={{ paddingLeft: `${depth * 14}px` }}
        title={node.url}
      >
        <FileText
          className={cn(
            "h-3 w-3 shrink-0",
            node.repeated ? "text-muted-foreground/50" : "text-muted-foreground",
          )}
          aria-hidden="true"
        />
        <span
          className={cn(
            "truncate",
            node.repeated
              ? "text-muted-foreground/60 italic"
              : "text-foreground",
          )}
        >
          {shortUrl(node.url)}
          {node.repeated && " (seen above)"}
        </span>
      </li>
      {node.children.map((child, i) => (
        <TreeRow key={`${child.url}-${i}`} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

// Small helper export so the summary panel can link "Export report" next to
// the map without importing the button separately.
export function ApplicationMapFooter({ onExport }: { onExport: () => void }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onExport}>
      Export report
    </Button>
  );
}
