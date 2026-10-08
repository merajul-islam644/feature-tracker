// Testing panel — our analog of VS Code's Testing view. It discovers
// the workspace root's test files (`*.test.*` / `*.spec.*`), parses
// the describe/test/it tree out of each, and runs files or single
// tests two ways:
//
//   • Play button (default) — structured run: the command executes
//     headlessly through the dev-server `/exec` route with the
//     runner's JSON reporter; per-test pass/fail + duration render
//     inline and publish gutter marks to the editor via `onTestResults`.
//   • Terminal icon (hover) — the v1 behavior: the plain command goes
//     to the active terminal via `onRunCommand`, for when you want to
//     watch it live or interact with it.
//
// Discovery stays dependency-free: a brace-depth scan over the source
// (no AST, no runner import) resolves suites and tests well enough
// for navigation + run. Known limits: `test.each(...)`-style table
// calls and block comments confuse the scan.
//
// Structured results parse the jest-compatible reporter document that
// both vitest (`--reporter=json`) and jest (`--json`) emit; runners
// without one (Playwright/mocha/node --test) report overall
// pass/fail from the exit code only.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  FileCode2,
  FlaskConical,
  Loader2,
  Play,
  RefreshCw,
  Square,
  Terminal,
  X,
} from "lucide-react";
import { devServerApi } from "@/services/devServerApi";
import type { FileNode } from "@/types/dev-server";
import { cn } from "@/lib/utils";

interface TestingPanelProps {
  workspaceId: string | null;
  /** Workspace root folder — tests are discovered under it. */
  root: string | null;
  /** Terminal-mode run: compose the command, parent sends it to the
   *  active terminal. */
  onRunCommand: (command: string) => void;
  /** Publishes per-line results after each structured run so the
   *  editor can draw gutter marks. Keyed by the file's rel path;
   *  replaces that file's previous marks. */
  onTestResults?: (path: string, marks: TestMark[]) => void;
}

/** A suite or test parsed out of source. Suites nest via `children`. */
export interface TestEntry {
  kind: "suite" | "test";
  name: string;
  /** 1-based source line of the call. */
  line: number;
  children?: TestEntry[];
}

/** One test's structured outcome, anchored to its source line. */
export interface TestMark {
  path: string;
  line: number;
  name: string;
  status: "passed" | "failed";
  duration?: number;
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
  /** Terminal-mode command for a whole file. */
  fileCmd: (file: string) => string;
  /** Terminal-mode command for one test inside a file. */
  testCmd: (file: string, name: string) => string;
  /** Whether this runner has a JSON reporter the panel can parse. */
  structured: boolean;
  /** Structured-mode commands (append the reporter flag). */
  structuredFileCmd?: (file: string) => string;
  structuredTestCmd?: (file: string, name: string) => string;
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
    structured: true,
    structuredFileCmd: (f) => `npx vitest run ${f} --reporter=json`,
    structuredTestCmd: (f, n) =>
      `npx vitest run ${f} -t "${shellSafe(n)}" --reporter=json`,
  },
  jest: {
    id: "jest",
    label: "jest",
    fileCmd: (f) => `npx jest ${f}`,
    testCmd: (f, n) => `npx jest ${f} -t "${shellSafe(n)}"`,
    structured: true,
    structuredFileCmd: (f) => `npx jest ${f} --json`,
    structuredTestCmd: (f, n) => `npx jest ${f} -t "${shellSafe(n)}" --json`,
  },
  playwright: {
    id: "playwright",
    label: "Playwright",
    fileCmd: (f) => `npx playwright test ${f}`,
    testCmd: (f, n) => `npx playwright test ${f} -g "${shellSafe(n)}"`,
    structured: false,
  },
  mocha: {
    id: "mocha",
    label: "mocha",
    fileCmd: (f) => `npx mocha ${f}`,
    testCmd: (f, n) => `npx mocha ${f} --grep "${shellSafe(n)}"`,
    structured: false,
  },
};

const NODE_FALLBACK: Runner = {
  id: "node",
  label: "node --test",
  fileCmd: (f) => `node --test ${f}`,
  // Node's built-in runner has no per-test filter; run the whole file.
  testCmd: (f) => `node --test ${f}`,
  structured: false,
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

/** Flatten a parsed tree to name → line, for anchoring reporter
 *  results back onto source lines. */
function flattenTests(
  entries: TestEntry[],
  out: { name: string; line: number }[] = [],
): { name: string; line: number }[] {
  for (const e of entries) {
    if (e.kind === "test") out.push({ name: e.name, line: e.line });
    else flattenTests(e.children ?? [], out);
  }
  return out;
}

interface ReporterAssertion {
  title: string;
  status: "passed" | "failed" | "skipped";
  duration?: number;
}

/** Pull assertion results out of the jest-compatible reporter doc
 *  that vitest `--reporter=json` and jest `--json` both emit. Returns
 *  [] on any parse trouble — the panel then falls back to the exit
 *  code's overall verdict. */
function parseReporterJson(stdout: string): ReporterAssertion[] {
  const start = stdout.indexOf("{");
  if (start < 0) return [];
  try {
    const doc = JSON.parse(stdout.slice(start)) as {
      testResults?: {
        assertionResults?: {
          title?: unknown;
          status?: unknown;
          duration?: unknown;
        }[];
      }[];
    };
    const out: ReporterAssertion[] = [];
    for (const tr of doc.testResults ?? []) {
      for (const a of tr.assertionResults ?? []) {
        if (typeof a.title !== "string" || typeof a.status !== "string") {
          continue;
        }
        out.push({
          title: a.title,
          status:
            a.status === "passed"
              ? "passed"
              : a.status === "failed"
                ? "failed"
                : "skipped",
          duration: typeof a.duration === "number" ? a.duration : undefined,
        });
      }
    }
    return out;
  } catch {
    return [];
  }
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

interface FileOverall {
  status: "passed" | "failed" | "error";
  message?: string;
}

type ResultMap = Record<string, Record<string, TestMark>>;

export function TestingPanel({
  workspaceId,
  root,
  onRunCommand,
  onTestResults,
}: TestingPanelProps) {
  const [files, setFiles] = useState<DiscoveredFile[] | null>(null);
  const [runner, setRunner] = useState<Runner | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** `${path}:${name|*}` while its structured run is in flight. */
  const [runningKey, setRunningKey] = useState<string | null>(null);
  /** Per-file overall verdict from the last structured run. */
  const [overall, setOverall] = useState<Record<string, FileOverall>>({});
  /** Per-file per-test-name marks from the last structured run. */
  const [results, setResults] = useState<ResultMap>({});

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

  /** Structured run: headless exec + JSON reporter → inline results
   *  and gutter marks. Falls back to the exit code's overall verdict
   *  when the runner has no parseable reporter. */
  const runStructured = useCallback(
    async (file: DiscoveredFile, testName?: string) => {
      if (!workspaceId || !root || !runner) return;
      const runKey = `${file.path}:${testName ?? "*"}`;
      setRunningKey(runKey);
      try {
        const cmd =
          testName && runner.structuredTestCmd
            ? runner.structuredTestCmd(file.path, testName)
            : runner.structuredFileCmd
              ? runner.structuredFileCmd(file.path)
              : testName
                ? runner.testCmd(file.path, testName)
                : runner.fileCmd(file.path);
        const res = await devServerApi.execUserCommand({
          workspaceId,
          root,
          command: cmd,
          timeoutMs: 180_000,
        });
        setOverall((prev) => ({
          ...prev,
          [file.path]: {
            status: res.code === 0 ? "passed" : "failed",
            message: res.timedOut
              ? "timed out"
              : res.code === 0
                ? undefined
                : `exit ${res.code ?? "?"}`,
          },
        }));

        const assertions = parseReporterJson(res.stdout);
        if (!runner.structured || assertions.length === 0) return;

        // Anchor reporter titles back onto the parsed source lines.
        const flat = flattenTests(file.tests);
        const byName = new Map(flat.map((t) => [t.name, t.line]));
        const marks: Record<string, TestMark> = {};
        for (const a of assertions) {
          if (a.status === "skipped") continue;
          const line = byName.get(a.title);
          if (line === undefined) continue;
          marks[a.title] = {
            path: file.path,
            line,
            name: a.title,
            status: a.status,
            duration: a.duration,
          };
        }
        setResults((prev) => ({ ...prev, [file.path]: marks }));
        onTestResults?.(file.path, Object.values(marks));
      } catch (err) {
        setOverall((prev) => ({
          ...prev,
          [file.path]: {
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          },
        }));
      } finally {
        setRunningKey(null);
      }
    },
    [workspaceId, root, runner, onTestResults],
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
        {files?.map((f) => {
          const fo = overall[f.path];
          const runKey = `${f.path}:*`;
          const isRunning = runningKey === runKey;
          return (
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
                {fo && (
                  <OverallBadge overall={fo} />
                )}
                {f.error ? (
                  <span className="text-[10px] text-muted-foreground/60">
                    {f.error}
                  </span>
                ) : (
                  runner && (
                    <>
                      <IconRunButton
                        label={`Run all tests in ${f.path}`}
                        title={
                          runner.structuredFileCmd
                            ? runner.structuredFileCmd(f.path)
                            : runner.fileCmd(f.path)
                        }
                        testid={`testing-run-file-${slug(f.path)}`}
                        running={isRunning}
                        onClick={() => void runStructured(f)}
                      />
                      <IconRunButton
                        label={`Run ${f.path} in terminal`}
                        title={runner.fileCmd(f.path)}
                        testid={`testing-term-file-${slug(f.path)}`}
                        running={false}
                        terminal
                        onClick={() => onRunCommand(runner.fileCmd(f.path))}
                      />
                    </>
                  )
                )}
              </div>
              {!f.error && runner && (
                <EntryRows
                  entries={f.tests}
                  depth={1}
                  file={f}
                  runner={runner}
                  runningKey={runningKey}
                  results={results[f.path] ?? {}}
                  onStructuredRun={(name) => void runStructured(f, name)}
                  onRunCommand={onRunCommand}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OverallBadge({ overall }: { overall: FileOverall }) {
  const passed = overall.status === "passed";
  return (
    <span
      className={cn(
        "flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium",
        passed
          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          : "bg-red-500/15 text-red-600 dark:text-red-400",
      )}
      title={overall.message ?? (passed ? "All passed" : "Run failed")}
      data-testid={`testing-overall-${overall.status}`}
    >
      {passed ? (
        <Check className="h-3 w-3" aria-hidden="true" />
      ) : (
        <X className="h-3 w-3" aria-hidden="true" />
      )}
      {overall.message}
    </span>
  );
}

function IconRunButton({
  label,
  title,
  testid,
  running,
  terminal = false,
  onClick,
}: {
  label: string;
  title: string;
  testid: string;
  running: boolean;
  terminal?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      data-testid={testid}
      onClick={onClick}
      disabled={running}
      className="rounded p-1 text-muted-foreground opacity-70 hover:bg-accent hover:text-foreground hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40"
    >
      {running ? (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
      ) : terminal ? (
        <Terminal className="h-3 w-3" aria-hidden="true" />
      ) : (
        <Play className="h-3 w-3" aria-hidden="true" />
      )}
    </button>
  );
}

function EntryRows({
  entries,
  depth,
  file,
  runner,
  runningKey,
  results,
  onStructuredRun,
  onRunCommand,
}: {
  entries: TestEntry[];
  depth: number;
  file: DiscoveredFile;
  runner: Runner;
  runningKey: string | null;
  results: Record<string, TestMark>;
  onStructuredRun: (name: string) => void;
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
              file={file}
              runner={runner}
              runningKey={runningKey}
              results={results}
              onStructuredRun={onStructuredRun}
              onRunCommand={onRunCommand}
            />
          </div>
        ) : (
          <TestRow
            key={`${e.name}:${e.line}`}
            entry={e}
            depth={depth}
            file={file}
            runner={runner}
            runningKey={runningKey}
            mark={results[e.name]}
            onStructuredRun={onStructuredRun}
            onRunCommand={onRunCommand}
          />
        ),
      )}
    </>
  );
}

function TestRow({
  entry,
  depth,
  file,
  runner,
  runningKey,
  mark,
  onStructuredRun,
  onRunCommand,
}: {
  entry: TestEntry;
  depth: number;
  file: DiscoveredFile;
  runner: Runner;
  runningKey: string | null;
  mark?: TestMark;
  onStructuredRun: (name: string) => void;
  onRunCommand: (command: string) => void;
}) {
  const runKey = `${file.path}:${entry.name}`;
  const isRunning = runningKey === runKey;
  return (
    <div
      className="group flex items-center gap-1 pr-1.5 hover:bg-muted/50"
      style={{ paddingLeft: depth * 12 }}
      data-testid={`testing-row-test-${slug(entry.name)}`}
    >
      <IconRunButton
        label={`Run ${entry.name}`}
        title={
          runner.structuredTestCmd
            ? runner.structuredTestCmd(file.path, entry.name)
            : runner.testCmd(file.path, entry.name)
        }
        testid={`testing-run-test-${slug(entry.name)}`}
        running={isRunning}
        onClick={() => onStructuredRun(entry.name)}
      />
      <span
        className="min-w-0 flex-1 truncate text-xs text-foreground"
        title={`line ${entry.line}`}
      >
        {entry.name}
      </span>
      {mark && (
        <span
          className={cn(
            "flex shrink-0 items-center gap-0.5 text-[10px] font-medium",
            mark.status === "passed"
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-600 dark:text-red-400",
          )}
          data-testid={`testing-result-${slug(entry.name)}`}
        >
          {mark.status === "passed" ? (
            <Check className="h-3 w-3" aria-hidden="true" />
          ) : (
            <Square className="h-3 w-3" aria-hidden="true" />
          )}
          {typeof mark.duration === "number" ? `${mark.duration}ms` : ""}
        </span>
      )}
      <button
        type="button"
        aria-label={`Run ${entry.name} in terminal`}
        title={runner.testCmd(file.path, entry.name)}
        data-testid={`testing-term-test-${slug(entry.name)}`}
        onClick={() => onRunCommand(runner.testCmd(file.path, entry.name))}
        className="rounded p-1 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100"
      >
        <Terminal className="h-3 w-3" aria-hidden="true" />
      </button>
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
