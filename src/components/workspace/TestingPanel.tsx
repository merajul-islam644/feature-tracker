// Testing panel — our analog of VS Code's Testing view. It discovers
// the workspace root's test files (`*.test.*` / `*.spec.*`), parses
// the describe/test/it tree out of each, and one click runs a whole
// file or a single test in the active terminal.
//
// v1 keeps discovery dependency-free: a brace-depth scan over the
// source (no AST, no runner import) resolves suites and tests well
// enough for navigation + run — the same trade the early test
// explorers made. Known limits: `test.each(...)`-style table calls
// and block comments confuse the scan; structured per-test results
// and editor gutter marks are the planned v2.
//
// The run command comes from the root package.json's dependencies
// (vitest → jest → Playwright → mocha); with no match (or no
// package.json at all) it falls back to `node --test <file>`.

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileCode2, FlaskConical, Play, RefreshCw } from "lucide-react";
import { devServerApi } from "@/services/devServerApi";
import type { FileNode } from "@/types/dev-server";
import { cn } from "@/lib/utils";

interface TestingPanelProps {
  workspaceId: string | null;
  /** Workspace root folder — tests are discovered under it. */
  root: string | null;
  /** Run a composed command line in the active terminal. */
  onRunCommand: (command: string) => void;
}

/** A suite or test parsed out of source. Suites nest via `children`. */
interface TestEntry {
  kind: "suite" | "test";
  name: string;
  /** 1-based source line of the call. */
  line: number;
  children?: TestEntry[];
}

interface DiscoveredFile {
  path: string;
  tests: TestEntry[];
  /** The file matched by name but couldn't be read. */
  error?: string;
}

interface Runner {
  id: "vitest" | "jest" | "playwright" | "mocha" | "node";
  label: string;
  /** Command for a whole file. */
  fileCmd: (file: string) => string;
  /** Command for one test inside a file. */
  testCmd: (file: string, name: string) => string;
}

/** Double quotes would break the shell wrapping; test names almost
 *  never need a literal `"` anyway. */
function shellSafe(name: string): string {
  return name.replace(/"/g, "'");
}

const RUNNERS: Record<"vitest" | "jest" | "playwright" | "mocha", Runner> = {
  vitest: {
    id: "vitest",
    label: "vitest",
    fileCmd: (f) => `npx vitest run ${f}`,
    testCmd: (f, n) => `npx vitest run ${f} -t "${shellSafe(n)}"`,
  },
  jest: {
    id: "jest",
    label: "jest",
    fileCmd: (f) => `npx jest ${f}`,
    testCmd: (f, n) => `npx jest ${f} -t "${shellSafe(n)}"`,
  },
  playwright: {
    id: "playwright",
    label: "Playwright",
    fileCmd: (f) => `npx playwright test ${f}`,
    testCmd: (f, n) => `npx playwright test ${f} -g "${shellSafe(n)}"`,
  },
  mocha: {
    id: "mocha",
    label: "mocha",
    fileCmd: (f) => `npx mocha ${f}`,
    testCmd: (f, n) => `npx mocha ${f} --grep "${shellSafe(n)}"`,
  },
};

const NODE_FALLBACK: Runner = {
  id: "node",
  label: "node --test",
  fileCmd: (f) => `node --test ${f}`,
  // Node's built-in runner has no per-test filter; run the whole file.
  testCmd: (f) => `node --test ${f}`,
};

/** Detect the runner from the root package.json's dependency keys. */
function detectRunner(pkgRaw: string | null): Runner {
  if (pkgRaw === null) return NODE_FALLBACK;
  try {
    // Same BOM leniency as NpmScriptsPanel — Windows-authored files.
    const pkg = JSON.parse(pkgRaw.replace(/^﻿/, "")) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    const deps = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ]);
    if (deps.has("vitest")) return RUNNERS.vitest;
    if (deps.has("jest")) return RUNNERS.jest;
    if (deps.has("@playwright/test")) return RUNNERS.playwright;
    if (deps.has("mocha")) return RUNNERS.mocha;
  } catch {
    // Malformed package.json — the scripts panel surfaces that story;
    // here node --test is still a sane default.
  }
  return NODE_FALLBACK;
}

const DESCRIBE_RE =
  /\b(?:test\.describe|describe|suite)\s*\(\s*(['"`])(.*?)\1/;
const TEST_RE = /\b(?:test|it)\s*\(\s*(['"`])(.*?)\1/;

/** Brace-depth scan: suites stay on the stack while the cursor is
 *  inside their callback; tests attach to the innermost open suite. */
function parseTestSource(source: string): TestEntry[] {
  const root: TestEntry[] = [];
  const stack: { entry: TestEntry; depth: number }[] = [];
  let depth = 0;
  source.split(/\r?\n/).forEach((raw, idx) => {
    // Line comments only — block comments are rare around test
    // declarations and would need a real tokenizer to strip safely.
    const comment = raw.indexOf("//");
    const line = comment >= 0 ? raw.slice(0, comment) : raw;
    const attach = (entry: TestEntry) => {
      const parent = stack[stack.length - 1];
      (parent ? parent.entry.children! : root).push(entry);
    };
    let openedSuite: TestEntry | null = null;
    const d = DESCRIBE_RE.exec(line);
    if (d) {
      openedSuite = { kind: "suite", name: d[2], line: idx + 1, children: [] };
      attach(openedSuite);
    }
    const t = TEST_RE.exec(line);
    if (t) attach({ kind: "test", name: t[2], line: idx + 1 });
    for (const ch of line) {
      if (ch === "{") {
        depth += 1;
      } else if (ch === "}") {
        depth -= 1;
        while (stack.length && depth < stack[stack.length - 1].depth) {
          stack.pop();
        }
      }
    }
    if (openedSuite) stack.push({ entry: openedSuite, depth });
  });
  return root;
}

const TEST_FILE_RE = /\.(?:test|spec)\.(?:js|jsx|ts|tsx|mjs|cjs)$/i;

/** testid-safe slug (names carry spaces, dots, parens…). */
function slug(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function countTests(entries: TestEntry[]): number {
  return entries.reduce(
    (n, e) => n + (e.kind === "test" ? 1 : countTests(e.children ?? [])),
    0,
  );
}

export function TestingPanel({
  workspaceId,
  root,
  onRunCommand,
}: TestingPanelProps) {
  const [files, setFiles] = useState<DiscoveredFile[] | null>(null);
  const [runner, setRunner] = useState<Runner | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId || !root) {
      setFiles(null);
      setRunner(null);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const pkgRaw = await devServerApi.readUserFile({
        workspaceId,
        root,
        path: "package.json",
      });
      const detected = detectRunner(pkgRaw);
      setRunner(detected);

      const tree = await devServerApi.listTree({ workspaceId, root });
      const paths: string[] = [];
      const walk = (nodes: FileNode[]) => {
        for (const n of nodes) {
          if (n.kind === "file") {
            if (TEST_FILE_RE.test(n.name)) paths.push(n.path);
          } else if (n.children) {
            walk(n.children);
          }
        }
      };
      walk(tree);
      paths.sort();

      // Bound the read burst — a workspace with more than 100 test
      // files gets the first 100 (alphabetical), which is still a
      // better story than hammering the route with thousands.
      const discovered = await Promise.all(
        paths.slice(0, 100).map(async (p) => {
          const src = await devServerApi.readUserFile({
            workspaceId,
            root,
            path: p,
          });
          if (src === null) return { path: p, tests: [], error: "unreadable" };
          return { path: p, tests: parseTestSource(src) };
        }),
      );
      setFiles(discovered.filter((f) => f.tests.length > 0 || f.error));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, root]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalTests = useMemo(
    () => (files ?? []).reduce((n, f) => n + countTests(f.tests), 0),
    [files],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="testing-panel">
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3 text-[11px] uppercase tracking-wider text-muted-foreground">
        <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="font-semibold">Testing</span>
        {runner && (
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] normal-case tracking-normal text-muted-foreground/80">
            {runner.label}
          </span>
        )}
        <span className="normal-case tracking-normal text-muted-foreground/60">
          {totalTests > 0 ? `${totalTests} tests` : ""}
        </span>
        <button
          type="button"
          onClick={() => void load()}
          aria-label="Refresh tests"
          title="Re-scan the workspace for test files"
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
        {!root && <EmptyRow text="Open a folder to discover its tests." />}
        {root && loading && !files && <EmptyRow text="Scanning for tests…" />}
        {root && !loading && loadError && (
          <EmptyRow text={`Scan failed — ${loadError}`} />
        )}
        {root && !loading && !loadError && files && files.length === 0 && (
          <EmptyRow text="No *.test.* or *.spec.* files in this workspace." />
        )}
        {files?.map((f) => (
          <div key={f.path} data-testid={`testing-file-${slug(f.path)}`}>
            <div className="flex items-center gap-1.5 bg-muted/30 px-1.5 py-1 hover:bg-muted/50">
              <FileCode2
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span
                className="min-w-0 flex-1 truncate text-[11px] font-medium text-muted-foreground"
                title={f.path}
              >
                {f.path}
              </span>
              {f.error ? (
                <span className="text-[10px] text-muted-foreground/60">
                  {f.error}
                </span>
              ) : (
                <button
                  type="button"
                  aria-label={`Run all tests in ${f.path}`}
                  title={runner ? runner.fileCmd(f.path) : f.path}
                  data-testid={`testing-run-file-${slug(f.path)}`}
                  onClick={() => runner && onRunCommand(runner.fileCmd(f.path))}
                  className="rounded p-1 text-muted-foreground opacity-70 hover:bg-accent hover:text-foreground hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <Play className="h-3 w-3" aria-hidden="true" />
                </button>
              )}
            </div>
            {!f.error && runner && (
              <EntryRows
                entries={f.tests}
                depth={1}
                path={f.path}
                runner={runner}
                onRunCommand={onRunCommand}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function EntryRows({
  entries,
  depth,
  path,
  runner,
  onRunCommand,
}: {
  entries: TestEntry[];
  depth: number;
  path: string;
  runner: Runner;
  onRunCommand: (command: string) => void;
}) {
  return (
    <>
      {entries.map((e) =>
        e.kind === "suite" ? (
          <div key={`${e.name}:${e.line}`} style={{ paddingLeft: depth * 12 }}>
            <div
              className="truncate px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70"
              title={`describe on line ${e.line}`}
            >
              {e.name}
            </div>
            <EntryRows
              entries={e.children ?? []}
              depth={depth + 1}
              path={path}
              runner={runner}
              onRunCommand={onRunCommand}
            />
          </div>
        ) : (
          <div
            key={`${e.name}:${e.line}`}
            className="group flex items-center gap-1 pr-1.5 hover:bg-muted/50"
            style={{ paddingLeft: depth * 12 }}
            data-testid={`testing-row-test-${slug(e.name)}`}
          >
            <button
              type="button"
              aria-label={`Run ${e.name}`}
              title={runner.testCmd(path, e.name)}
              data-testid={`testing-run-test-${slug(e.name)}`}
              onClick={() => onRunCommand(runner.testCmd(path, e.name))}
              className="rounded p-1 text-muted-foreground opacity-70 hover:bg-accent hover:text-foreground hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Play className="h-3 w-3" aria-hidden="true" />
            </button>
            <span
              className="min-w-0 flex-1 truncate text-xs text-foreground"
              title={`line ${e.line}`}
            >
              {e.name}
            </span>
          </div>
        ),
      )}
    </>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <p className="px-3 py-2 text-xs text-muted-foreground" role="status">
      {text}
    </p>
  );
}
