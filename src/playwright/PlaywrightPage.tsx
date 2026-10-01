import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import CodeMirror from "@uiw/react-codemirror";
import {
  Clipboard,
  ClipboardCheck,
  Eye,
  EyeOff,
  FileCode2,
  Loader2,
  Play,
  RotateCcw,
  Square,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActionButton } from "../shared/ui/ActionButton";
import { PageHeader } from "../shared/ui/PageHeader";
import {
  runPlaywright,
  type HighlightInfo,
  type RunnerLog,
  type RunnerLogKind,
} from "./playwrightRunner";
import { consumePendingPlaywrightSource } from "./pwPendingSource";

type Script = {
  id: string;
  label: string;
  code: string;
};

const STARTER_SCRIPT = `// Welcome to the Playwright runner.
// Available APIs:
//   page.goto(path)        - SPA-navigate to a path inside this app
//   page.url()             - read the current pathname
//   page.locator(selector) - resolve a CSS selector (Locator)
//     .click() .fill(t) .textContent() .isVisible() .isEnabled()
//     .getAttribute(name) .count() .nth(i) .first()
//     .waitFor(state?, timeoutMs?)
//   page.expect(target)    - assertions
//     .toBeVisible() .toBeHidden() .toContainText(t) .toHaveText(t)
//     .toEqual(v) .toBeTruthy() .toHaveCount(n) .toHaveAttribute(k, v)
//   page.evaluate(fn)      - run a synchronous function in the page
//   page.waitForTimeout(ms)
//   test(name, fn) / test.describe(name, fn) / test.step(name, fn)
//     Playwright-style block APIs (see repo browser outline panel)
//   env.KEY                - read a value from the repo browser's .env panel
//   console.log(...)       - writes to the output panel
//
// Use top-level await and the page's actual DOM.

console.log("Running on:", page.url());
console.log("Env keys loaded:", Object.keys(env).length);

const header = page.locator(".pw-card-header").first();
await page.expect(header).toBeVisible();
console.log("Section header:", (await header.textContent())?.trim());

const buttons = page.locator(".row-actions button").count();
console.log("Header buttons found:", await buttons);

// Show that you can iterate over multiple elements.
const toolbar = page.locator(".pw-toolbar .pw-select").count();
console.log("Toolbar dropdowns:", await toolbar);

// Drop a line into the output panel from inside the page itself.
console.log("Snippet executed without any goto -- you stay on /playwright");
`;

const SCRIPT_LIBRARY: Script[] = [
  {
    id: "starter",
    label: "Starter walkthrough",
    code: STARTER_SCRIPT,
  },
  {
    id: "navigate-audit",
    label: "Navigate to API audit + check rows",
    code: `await page.goto("/audit");
await page.waitForTimeout(150);
const pageRows = page.locator(".audit-paginator-range");
await page.expect(pageRows).toBeVisible();
console.log("Paginator text:", (await pageRows.textContent())?.trim());
const firstRow = page.locator(".audit-row").first().locator(".mono").first();
if (await firstRow.count() > 0) {
  console.log("First cell text:", (await firstRow.textContent())?.trim());
}
`,
  },
  {
    id: "language-switcher",
    label: "Check topbar language switcher",
    code: `// Stay on /playwright but inspect the surrounding AppShell topbar.
await page.waitForTimeout(200);
const sidebar = page.locator(".app-shell-sidebar, .sidebar, aside, [aria-label*='sidebar' i]").first();
console.log("Sidebar visible?", await sidebar.isVisible());
const brandLink = page.locator(".app-brand, .brand, [aria-label*='brand' i]").first();
console.log("Brand in DOM?", await brandLink.count() > 0);
`,
  },
  {
    id: "dom-snapshot",
    label: "Print a snapshot of page sections",
    code: `// Walk this page's own DOM without navigating away.
for (const tag of ["h2", "h3"]) {
  const count = await page.locator(tag).count();
  if (count > 0) {
    const text = (await page.locator(tag).first().textContent())?.trim();
    console.log(tag + ":", text, "(of " + count + ")");
  }
}
console.log("Cards on screen:", await page.locator(".pw-editor-card, .pw-output-card").count());
console.log("Editor lines:", await page.locator(".cm-line").count());
`,
  },
  {
    id: "login-flow",
    label: "Login flow (button check)",
    code: `// Exercises the login page WITHOUT leaving the app's origin.
// The submit button kicks off the OIDC redirect via window.location.href,
// which the in-browser runner sandbox blocks. So this snippet verifies
// the button is mounted, labeled, and clickable -- not that sign-in
// actually succeeds. For an end-to-end sign-in test, use the real
// Playwright runner outside this browser sandbox.
test("Login button is mounted and clickable", async () => {
  await page.goto("/login");
  await page.waitForTimeout(150);

  const submit = page.locator(".auth-submit");
  await page.expect(submit).toBeVisible();
  console.log("Submit visible:", await submit.isVisible());
  console.log("Submit text:", (await submit.textContent())?.trim());

  await submit.click();
  console.log("Click dispatched -- runner stays on /login because external redirects are sandboxed.");
});
`,
  },
  {
    id: "navbar-smoke",
    label: "Navbar smoke test (topbar controls)",
    code: `// The AppShell topbar wraps every protected route, so the test stays
// on /playwright (no goto needed). The runner must be authenticated,
// otherwise RequireAuth redirects to /login and the topbar never mounts.
//
// Topbar buttons in render order -- see src/app/layout/AppShell.tsx:
//   .sidebar-collapse-toggle  -- sidebar expand/collapse
//   .icon-button[aria-label^='Theme'] -- cycles system -> light -> dark
//   NotificationsMenu trigger  -- aria-label "Notifications"
//   LanguageSwitcher trigger   -- aria-label includes the current language
//   .user-menu-trigger         -- avatar dropdown
test("Navbar topbar controls are mounted and clickable", async () => {
  await page.waitForTimeout(150);

  const sidebarToggle = page.locator(".sidebar-collapse-toggle");
  await page.expect(sidebarToggle).toBeVisible();
  console.log("Sidebar toggle label:", await sidebarToggle.getAttribute("aria-label"));

  const themeBtn = page.locator(".icon-button[aria-label^='Theme']");
  await page.expect(themeBtn).toBeVisible();
  console.log("Theme label before:", await themeBtn.getAttribute("aria-label"));

  // Theme cycles: system -> light -> dark -> system. The cycle is driven
  // by the data-theme attribute on <html>, which is what the assertion
  // reads. Two clicks should be enough to observe a state change from
  // whatever the current mode is.
  const before = document.documentElement.dataset.theme ?? "system";
  await themeBtn.click();
  await page.waitForTimeout(80);
  await themeBtn.click();
  await page.waitForTimeout(80);
  const after = document.documentElement.dataset.theme ?? "system";
  console.log("Theme before/after two clicks:", before, "->", after);
  console.log("Theme label after:", await themeBtn.getAttribute("aria-label"));

  // The remaining controls are dropdown triggers. We only assert they
  // are mounted and labelled -- clicking would open a popover we don't
  // need to inspect for a smoke test.
  const notifications = page.locator("[aria-label='Notifications']");
  await page.expect(notifications).toBeVisible();
  console.log("Notifications mounted:", await notifications.count() > 0);

  const langSwitcher = page.locator(".icon-button[aria-label*='language' i], .icon-button[title='Switch language']");
  console.log("Language switcher mounted:", await langSwitcher.count() > 0);

  const userMenu = page.locator(".user-menu-trigger");
  console.log("User menu mounted:", await userMenu.count() > 0);
});
`,
  },
];

/**
 * Tally bar shown above the log list. Reports the number of passing
 * expects (kind=expect), the number of failing expects / thrown errors
 * (kind=error, including AssertionError), and a single big verdict
 * pill. While the run is in flight we hide the verdict and only show
 * the running counters.
 */
export function RunSummary({
  counts,
  running,
  total,
}: {
  counts: Partial<Record<RunnerLogKind, number>>;
  running: boolean;
  total: number;
}) {
  const passed = counts.expect ?? 0;
  const failed = counts.error ?? 0;
  const verdict: "pass" | "fail" | "running" | "empty" = running
    ? "running"
    : total === 0
      ? "empty"
      : failed === 0
        ? "pass"
        : "fail";
  const verdictLabel =
    verdict === "pass"
      ? "PASS"
      : verdict === "fail"
        ? "FAIL"
        : verdict === "running"
          ? "RUNNING"
          : "—";
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
          {passed} passed
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300">
          {failed} failed
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium border-border bg-background text-muted-foreground">
          {total} {total === 1 ? "entry" : "entries"}
        </span>
      </div>
      <span
        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-xs font-semibold uppercase tracking-wider pw-summary-verdict ${
          verdict === "pass"
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            : verdict === "fail"
              ? "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
              : verdict === "running"
                ? "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300"
                : "border-border bg-muted text-muted-foreground"
        }`}
      >
        {verdictLabel}
      </span>
    </div>
  );
}

export function PlaywrightPage() {
  const [activeScript, setActiveScript] = useState<string>(
    SCRIPT_LIBRARY[0]!.id,
  );
  const [code, setCode] = useState<string>(SCRIPT_LIBRARY[0]!.code);
  const [logs, setLogs] = useState<RunnerLog[]>([]);
  const [running, setRunning] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [runId, setRunId] = useState(0);
  const [launchedFrom, setLaunchedFrom] = useState<string | null>(null);
  const [highlightEnabled, setHighlightEnabled] = useState(true);
  const [currentHighlight, setCurrentHighlight] =
    useState<HighlightInfo | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const consoleRef = useRef<HTMLDivElement | null>(null);
  /**
   * Mounted flag prevents the runner from calling `setLogs` after the
   * page has unmounted (e.g. user navigated to /audit while the script
   * was still running). Without this guard React logs a
   * "setState on unmounted component" warning to `console.error`, which
   * our console interceptor would then capture and write back to the
   * logs, causing a feedback loop.
   */
  const mountedRef = useRef(true);
  const logCounterRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelRef.current?.();
    };
  }, []);

  /**
   * If the repo browser handed us a pending snippet (via the per-block
   * Play buttons next to test/test.describe/test.step), drop it into
   * the editor, switch the dropdown to a synthetic "<from repo>"
   * entry, and auto-run. The pending slot is consumed exactly once —
   * a subsequent manual reload of /playwright falls back to the
   * starter script.
   */
  const autoRunRequestedRef = useRef(false);
  /**
   * Always points at the latest `run` so the mount-time effect can
   * trigger it without a stale-closure issue. `run` references
   * several state values (logs, code, running), so we can't hoist it
   * — the ref-to-latest pattern keeps it in one place.
   */
  const runRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    const pending = consumePendingPlaywrightSource();
    if (!pending) return;
    setCode(pending.source);
    setActiveScript(`__pending__${Date.now()}`);
    setLaunchedFrom(pending.label);
    setLogs([]);
    logCounterRef.current = 0;
    if (pending.autoRun) {
      autoRunRequestedRef.current = true;
      // Defer a few frames so the editor mounts and the `code` state
      // is settled before the run picks it up.
      window.setTimeout(() => {
        if (mountedRef.current && autoRunRequestedRef.current) {
          autoRunRequestedRef.current = false;
          void runRef.current();
        }
      }, 80);
    }
    return () => {
      autoRunRequestedRef.current = false;
    };
  }, []);

  function nextLogId() {
    logCounterRef.current += 1;
    return runId * 100_000 + logCounterRef.current;
  }

  function appendLog(entry: Omit<RunnerLog, "id">) {
    if (!mountedRef.current) return;
    setLogs((current) => [...current, { id: nextLogId(), ...entry }]);
  }

  function loadScript(id: string) {
    const script = SCRIPT_LIBRARY.find((item) => item.id === id);
    if (!script) {
      // Synthetic id from the repo-browser launch ("__pending__…") or
      // an unknown value — keep whatever the user is currently
      // looking at but reset the logs so they don't see stale output.
      setActiveScript(id);
      setLogs([]);
      logCounterRef.current = 0;
      setLaunchedFrom(null);
      return;
    }
    setActiveScript(script.id);
    setCode(script.code);
    setLogs([]);
    logCounterRef.current = 0;
    setLaunchedFrom(null);
  }

  async function run() {
    if (running) return;
    setLogs([]);
    logCounterRef.current = 0;
    setRunId((current) => current + 1);
    setRunning(true);
    setCurrentHighlight(null);

    let cancel!: () => void;
    const cancelled = new Promise<void>((resolve) => {
      cancel = () => resolve();
    });
    cancelRef.current = cancel;

    try {
      await runPlaywright(code, appendLog, cancelled, {
        onHighlight: highlightEnabled ? setCurrentHighlight : undefined,
      });
    } finally {
      setRunning(false);
      cancelRef.current = null;
      // Keep the last highlight on screen for a beat so the user can see
      // where the run ended, then let the CSS animation finish naturally
      // by unmounting the overlay.
      window.setTimeout(() => {
        if (mountedRef.current) setCurrentHighlight(null);
      }, 1500);
    }
  }

  // Keep the latest `run` reachable from the mount-time effect (the
  // pending-snippet consumer above) without leaking its captures.
  runRef.current = run;

  function stop() {
    cancelRef.current?.();
  }

  function reset() {
    setLogs([]);
    const fromLibrary = SCRIPT_LIBRARY.find((s) => s.id === activeScript);
    if (fromLibrary) {
      setCode(fromLibrary.code);
    } else {
      // Reset button while a pending snippet is loaded -> fall back
      // to the library starter instead of clearing the editor.
      setCode(STARTER_SCRIPT);
      setActiveScript(SCRIPT_LIBRARY[0]!.id);
    }
    setLaunchedFrom(null);
  }

  // Auto-scroll the console when new entries arrive, unless the user has
  // scrolled up to read older output.
  useEffect(() => {
    const node = consoleRef.current;
    if (!node) return;
    const isAtBottom =
      node.scrollHeight - node.scrollTop - node.clientHeight < 80;
    if (isAtBottom) {
      node.scrollTop = node.scrollHeight;
    }
  }, [logs]);

  const counts = useMemo(() => {
    const byKind: Partial<Record<RunnerLogKind, number>> = {};
    for (const log of logs) {
      byKind[log.kind] = (byKind[log.kind] ?? 0) + 1;
    }
    return byKind;
  }, [logs]);

  async function copyLogs() {
    const text = logs
      .map(
        (log) =>
          `[${log.kind}] ${log.text}${log.detail ? `\n${log.detail}` : ""}`,
      )
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey("all");
      window.setTimeout(
        () => setCopiedKey((current) => (current === "all" ? null : current)),
        1500,
      );
    } catch {
      // same fallback as the audit page
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopiedKey("all");
        window.setTimeout(
          () => setCopiedKey((current) => (current === "all" ? null : current)),
          1500,
        );
      } finally {
        document.body.removeChild(ta);
      }
    }
  }

  return (
    <section>
      {currentHighlight ? <HighlightOverlay info={currentHighlight} /> : null}
      <PageHeader
        title="Playwright Runner"
        subtitle="Run Playwright-style scripts against the live DOM of this app."
        actions={
          <div className="row-actions">
            {running ? (
              <ActionButton
                variant="primary"
                onClick={stop}
                icon={<Square size={16} />}
              >
                Stop
              </ActionButton>
            ) : (
              <ActionButton
                variant="primary"
                onClick={run}
                icon={<Play size={16} />}
              >
                Run
              </ActionButton>
            )}
            <ActionButton
              variant="icon"
              onClick={reset}
              icon={<RotateCcw size={16} />}
              title="Reset"
            />
            <ActionButton
              variant="icon"
              onClick={() => setHighlightEnabled((value) => !value)}
              icon={highlightEnabled ? <Eye size={16} /> : <EyeOff size={16} />}
              title={
                highlightEnabled ? "Live highlight: on" : "Live highlight: off"
              }
            />
            <ActionButton
              variant="icon"
              disabled={logs.length === 0}
              onClick={copyLogs}
              icon={
                copiedKey === "all" ? (
                  <ClipboardCheck size={16} />
                ) : (
                  <Clipboard size={16} />
                )
              }
              title={copiedKey === "all" ? "Copied!" : "Copy output"}
            />
          </div>
        }
      />

      <div className="flex flex-wrap items-end gap-3 pw-toolbar">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground pw-select">
          <span>Snippet</span>
          <select
            value={activeScript}
            onChange={(event) => loadScript(event.target.value)}
            disabled={running}
          >
            {SCRIPT_LIBRARY.map((script) => (
              <option key={script.id} value={script.id}>
                {script.label}
              </option>
            ))}
            {launchedFrom ? (
              <option value={activeScript}>From repo · {launchedFrom}</option>
            ) : null}
          </select>
        </label>
        {launchedFrom ? (
          <span
            className="audit-pill"
            title="This snippet was launched from the repo browser."
          >
            launched from repo
          </span>
        ) : null}
        {counts.log !== undefined ? (
          <span className="audit-pill">{counts.log} logs</span>
        ) : null}
        {counts.expect !== undefined ? (
          <span className="audit-pill audit-pill-pass">
            {counts.expect} expect pass
          </span>
        ) : null}
        {counts.error !== undefined ? (
          <span className="audit-pill audit-pill-fail">
            {counts.error} error{counts.error === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex min-h-[400px] flex-col rounded-lg border border-border bg-card overflow-hidden pw-editor-card">
          <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2 text-sm font-medium text-foreground pw-card-header">
            <FileCode2 size={16} />
            <span>Script</span>
            {running ? <Loader2 size={14} className="animate-spin" /> : null}
          </header>
          <div
            className={`flex-1 overflow-auto pw-editor ${running ? "pointer-events-none opacity-60" : ""}`}
          >
            <CodeMirror
              value={code}
              theme={oneDark}
              extensions={[javascript({ typescript: false })]}
              onChange={(value) => setCode(value)}
              editable={!running}
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                highlightActiveLine: true,
                highlightActiveLineGutter: true,
                indentOnInput: true,
                bracketMatching: true,
                autocompletion: false,
                highlightSelectionMatches: true,
              }}
              aria-label="Playwright script source"
              minHeight="320px"
              height="100%"
            />
          </div>
        </div>
        <div
          className="flex max-h-[60vh] flex-col rounded-lg border border-border bg-card overflow-hidden pw-output-card"
          ref={consoleRef}
        >
          <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2 text-sm font-medium text-foreground pw-card-header">
            <span>Output</span>
            {running ? <Loader2 size={14} className="animate-spin" /> : null}
          </header>
          {logs.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              No output yet. Click <strong>Run</strong> to execute the snippet.
            </div>
          ) : (
            <>
              <RunSummary
                counts={counts}
                running={running}
                total={logs.length}
              />
              <ul className="flex-1 overflow-y-auto p-2 space-y-1 text-xs">
                {logs.map((log) => (
                  <li
                    key={log.id}
                    className={`flex flex-col gap-1 rounded-md border border-border bg-background px-3 py-2 pw-log pw-log-${log.kind}${
                      log.kind === "error"
                        ? " border-red-500/30 bg-red-500/5"
                        : log.kind === "expect"
                          ? " border-blue-500/30 bg-blue-500/5"
                          : ""
                    }`}
                  >
                    <span className="inline-flex w-fit items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      {log.kind}
                    </span>
                    <span className="flex flex-col gap-1">
                      {log.text}
                      {log.detail ? (
                        <pre className="whitespace-pre-wrap rounded bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
                          <X
                            size={12}
                            style={{ float: "right", cursor: "pointer" }}
                            onClick={() =>
                              setLogs((current) =>
                                current.filter((item) => item.id !== log.id),
                              )
                            }
                            aria-label="Dismiss entry"
                          />
                          {log.detail}
                        </pre>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Briefly-drawn outline + label that flashes over the element the
 * runner is about to click or fill. Rendered as a sibling of the rest
 * of the page (after `<section>` opens) but laid out with
 * `position: fixed` so it escapes any ancestor transform/overflow.
 *
 * While the overlay is on screen we re-read the target's bounding rect
 * on scroll/resize so the outline tracks moving elements — cheap
 * because the listeners only attach while a highlight is visible.
 */
function HighlightOverlay({ info }: { info: HighlightInfo }) {
  const [rect, setRect] = useState(info.rect);

  useEffect(() => {
    setRect(info.rect);
  }, [info]);

  useEffect(() => {
    const update = () => {
      const el = document.querySelector(info.selector);
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [info.selector]);

  return (
    <div
      className="pointer-events-none fixed z-50 rounded-md border-2 border-blue-500 bg-blue-500/10 transition-all duration-150"
      style={{
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      }}
      data-pw-action={info.action}
    >
      <span className="absolute -top-6 left-0 inline-flex items-center gap-1 rounded bg-blue-500 px-2 py-0.5 text-[10px] font-medium text-white shadow">
        {info.label}
      </span>
    </div>
  );
}
