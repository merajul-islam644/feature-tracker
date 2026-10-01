// Real verification agent — Playwright runner.
//
// One `agent.ts:runAgent()` call drives the full verification flow for a
// given runId. Spec §6 step 5:
//
//   1. Create one Playwright `browser` per run (cleared on completion).
//      Launched in HEADED mode so the user sees a real visible Chrome
//      window while verification runs — that browser is the preview.
//   2. For each enabled target:
//      a. Emit `target_started`.
//      b. Open the URL via `pageLoadCheck` — sets console + network
//         listeners so console_errors / network_errors checks can
//         inherit the captured buffer.
//      c. If the target has a credentialId, run the heuristic login
//         flow. On success, screenshot + emit `evidence`.
//      d. Run each remaining check from `scope`.
//      e. Emit `target_completed` with passed/failed/issues_found.
//   3. Emit `run_completed`.
//
// Each step is wrapped so that a thrown error doesn't abort the run;
// it emits a synthetic `issue_detected` and continues with the next
// target. Browser is closed in `finally` so a crash doesn't leak
// Chrome instances.

import { chromium, type ConsoleMessage, type Page, type Browser, type Request, type Response } from "playwright";
import { appendEvent, getRun, setStatus } from "./runs.js";
import { saveEvidence } from "./evidence.js";
import { resolveCredentialForTarget, listSecrets } from "./secrets.js";
import type { Issue, RunEvent, StartVerificationRequest, VerificationCheckId } from "./types.js";
import { resolve as resolveUrl } from "node:url";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_FILE = join(__dirname, "..", "data", "login-debug.log");
function loginLog(msg: string) {
  try {
    writeFileSync(LOG_FILE, `${new Date().toISOString()} ${msg}\n`, { encoding: "utf8", flag: "a" });
  } catch {
    // ignore
  }
  process.stdout.write(`[login] ${msg}\n`);
}

// ────────────────────────────────────────────────────────────────────────────
//  Per-check handlers — each is async, throws on failure, returns issues.
// ────────────────────────────────────────────────────────────────────────────

type CheckCtx = {
  page: Page;
  runId: string;
  targetId: string;
  applicationName: string;
  url: string;
  consoleBuffer: ConsoleMessage[];
  networkErrors: { url: string; status: number; method: string; resourceType: string }[];
  passwordFieldBox?: { x: number; y: number; width: number; height: number };
};

async function pageLoadCheck(ctx: CheckCtx): Promise<Issue[]> {
  const started = Date.now();
  await ctx.page.goto(ctx.url, { waitUntil: "domcontentloaded", timeout: 20_000 });
  // SPAs keep persistent WebSocket / construct connections open, so
  // networkidle may never fire. Cap the wait at 5s and proceed regardless
  // — domcontentloaded is enough to know the app shell is in.
  await ctx.page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  const elapsed = Date.now() - started;
  if (elapsed > 3_000) {
    return [
      {
        id: `iss_${ctx.targetId}_perf_${Date.now()}`,
        title: `Slow page load: ${elapsed}ms`,
        applicationName: ctx.applicationName,
        url: ctx.url,
        category: "performance",
        severity: elapsed > 8_000 ? "critical" : "high",
        status: "open",
        description: `The target took ${elapsed}ms to reach \`networkidle\`. Threshold: 3000ms.`,
        expected: "<= 3000ms",
        actual: `${elapsed}ms`,
        detectedAt: new Date().toISOString(),
      },
    ];
  }
  return [];
}

async function navigationCheck(ctx: CheckCtx): Promise<Issue[]> {
  const sameOrigin = new URL(ctx.url).origin;
  const anchors = await ctx.page.$$eval("a[href]", (els) =>
    (els as HTMLAnchorElement[]).map((a) => a.href).filter((h) => h && !h.startsWith("#")),
  );
  const unique = [...new Set(anchors.filter((u) => u.startsWith(sameOrigin)))].slice(0, 25);
  const issues: Issue[] = [];
  for (const href of unique) {
    try {
      const res = await ctx.page.context().request.get(href);
      if (res.status() >= 400) {
        issues.push({
          id: `iss_${ctx.targetId}_nav_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          title: `Broken link: ${new URL(href).pathname}`,
          applicationName: ctx.applicationName,
          url: ctx.url,
          category: "navigation",
          severity: res.status() === 404 ? "medium" : "high",
          status: "open",
          description: `GET ${href} returned ${res.status()}.`,
          evidence: [{ type: "url", label: "request", value: href, timestamp: new Date().toISOString() }],
          detectedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      // network error — flagged in network_errors instead
    }
  }
  return issues;
}

async function buttonsCheck(ctx: CheckCtx, opts?: { discoveredUrls?: Set<string> }): Promise<Issue[]> {
  const issues: Issue[] = [];
  // Click EVERY interactive element on the page. For each click, check
  // for console errors and a navigation. If the click navigates, record
  // the destination URL on the discovered set so the deep-walk can pick
  // it up later; then go back so the next button click still operates on
  // the original page. Hidden buttons (display:none, dropdowns) used to
  // be skipped silently — now we use {force: true} so popovers, menu
  // triggers, and toolbar actions all get exercised.
  //
  // The button list is re-queried every iteration: a click that
  // navigates (even after goBack re-renders the page) invalidates the
  // earlier element handles, which used to silently skip every button
  // after the first navigation.
  for (let i = 0; i < 200; i++) {
    const handles = await ctx.page.$$("button, [role=button], input[type=submit]");
    if (i >= handles.length) break;
    const before = ctx.consoleBuffer.length;
    const beforeUrl = ctx.page.url();
    try {
      // Never click destructive or session-ending controls — logging
      // out mid-run fails every subsequent page, and a verification
      // run must not delete production data.
      const label = ((await handles[i].textContent().catch(() => "")) ?? "").trim();
      if (
        RISKY_CONTROL.test(label) ||
        RISKY_CONTROL.test((await handles[i].getAttribute("aria-label")) ?? "")
      ) {
        continue;
      }
      await handles[i].click({ timeout: 3_000, trial: false, force: true });
      // tiny wait for console events to surface
      await ctx.page.waitForTimeout(120);
      let newConsoleErrors = ctx.consoleBuffer
        .slice(before)
        .filter((m) => m.type() === "error");
      if (newConsoleErrors.length > 0) {
        // Confirm before filing: dismiss whatever the click may have
        // opened, then repeat the exact same click. A one-off console
        // error (lazy chunk reload, an aborted fetch during route
        // change) shouldn't become a permanent issue row.
        await ctx.page.keyboard.press("Escape").catch(() => undefined);
        const retryHandles = await ctx.page.$$(
          "button, [role=button], input[type=submit]",
        );
        const retryMark = ctx.consoleBuffer.length;
        let reproduced = false;
        try {
          await retryHandles[i]?.click({ timeout: 3_000, force: true });
          await ctx.page.waitForTimeout(120);
          reproduced = ctx.consoleBuffer
            .slice(retryMark)
            .some((m) => m.type() === "error");
        } catch {
          // Element vanished after the first click — can't reproduce,
          // so don't file.
        }
        if (!reproduced) {
          // Transient — dropped. Fall through to the navigation-undo
          // branch below so the retry click's side effects are undone.
        } else {
          newConsoleErrors = ctx.consoleBuffer
            .slice(before)
            .filter((m) => m.type() === "error");
          issues.push({
            id: `iss_${ctx.targetId}_btn_${Date.now()}_${i}`,
            title: `Button ${i + 1} triggered console error`,
            applicationName: ctx.applicationName,
            url: ctx.page.url(),
            category: "ui",
            severity: "medium",
            status: "open",
            description: `Reproduced on 2/2 attempts.\n${newConsoleErrors
              .map((m) => m.text())
              .join("\n")}`,
            detectedAt: new Date().toISOString(),
          });
        }
      }
      // If the click navigated away, record the destination for the
      // deep-walk to revisit, then go back so the next button click
      // still operates on the original page. When goBack silently
      // no-ops, hard-navigate back instead.
      if (ctx.page.url() !== beforeUrl) {
        if (opts?.discoveredUrls) opts.discoveredUrls.add(ctx.page.url());
        await ctx.page.goBack({ waitUntil: "domcontentloaded", timeout: 10_000 }).catch(() => undefined);
        await ctx.page.waitForTimeout(150);
        if (ctx.page.url() !== beforeUrl) {
          await ctx.page.goto(beforeUrl, { waitUntil: "domcontentloaded", timeout: 10_000 }).catch(() => undefined);
          await ctx.page.waitForTimeout(150);
        }
      } else {
        // Dismiss whatever the click toggled open (menu, popover) so
        // UI state doesn't accumulate across probes.
        await ctx.page.keyboard.press("Escape").catch(() => undefined);
      }
    } catch {
      // not interactable — skip silently. Most pages have hidden/dropdown buttons.
    }
  }
  return issues;
}

async function formsCheck(ctx: CheckCtx): Promise<Issue[]> {
  const forms = await ctx.page.$$("form");
  const issues: Issue[] = [];
  for (let i = 0; i < Math.min(forms.length, 8); i++) {
    const inputs = await forms[i].$$("input:not([type=hidden]):not([type=submit]), textarea");
    if (inputs.length === 0) continue;
    // Test-data isolation: only clearly-marked synthetic values are
    // ever typed, and forms that look destructive (delete/remove in
    // their action/id/class) are skipped outright — apps can fire
    // requests on input/change handlers, and a verification run must
    // never risk destroying real data.
    const formMeta = [
      (await forms[i].getAttribute("action")) ?? "",
      (await forms[i].getAttribute("id")) ?? "",
      (await forms[i].getAttribute("class")) ?? "",
    ].join(" ");
    if (/(delet|remov|destroy|uninstall|purge|wipe)/i.test(formMeta)) continue;
    try {
      for (const inp of inputs) {
        const t = await inp.getAttribute("type");
        if (t === "email") await inp.fill("qa-verification@example.com");
        else if (t === "password") await inp.fill("Z9vQ!test2026");
        else await inp.fill("QA verification test value");
      }
      // We don't actually submit (would navigate away / submit real form
      // data); just verify inputs accept text without throwing.
    } catch (err) {
      issues.push({
        id: `iss_${ctx.targetId}_form_${Date.now()}_${i}`,
        title: `Form ${i + 1} did not accept synthetic input`,
        applicationName: ctx.applicationName,
        url: ctx.page.url(),
        category: "forms",
        severity: "medium",
        status: "open",
        description: `Could not fill form: ${(err as Error).message}`,
        detectedAt: new Date().toISOString(),
      });
    }
  }
  return issues;
}

async function brokenLinksCheck(ctx: CheckCtx): Promise<Issue[]> {
  return navigationCheck(ctx);
}

async function consoleErrorsCheck(ctx: CheckCtx): Promise<Issue[]> {
  const errors = ctx.consoleBuffer.filter((m) => m.type() === "error");
  if (errors.length === 0) return [];
  return [
    {
      id: `iss_${ctx.targetId}_console_${Date.now()}`,
      title: `${errors.length} console error(s) detected`,
      applicationName: ctx.applicationName,
      url: ctx.page.url(),
      category: "other",
      severity: "medium",
      status: "open",
      description: errors
        .slice(0, 10)
        .map((m) => `- ${m.location().url}:${m.location().lineNumber} — ${m.text()}`)
        .join("\n"),
      detectedAt: new Date().toISOString(),
      evidence: [
        {
          type: "console",
          label: "console",
          value: errors.map((m) => m.text()).join("\n"),
          timestamp: new Date().toISOString(),
        },
      ],
    },
  ];
}

async function networkErrorsCheck(ctx: CheckCtx): Promise<Issue[]> {
  if (ctx.networkErrors.length === 0) return [];
  return [
    {
      id: `iss_${ctx.targetId}_net_${Date.now()}`,
      title: `${ctx.networkErrors.length} network error(s)`,
      applicationName: ctx.applicationName,
      url: ctx.page.url(),
      category: "api",
      severity: "high",
      status: "open",
      description: ctx.networkErrors
        .slice(0, 10)
        .map((e) => `- ${e.status} ${e.method} ${e.url}`)
        .join("\n"),
      detectedAt: new Date().toISOString(),
      evidence: [
        {
          type: "network",
          label: "network",
          value: JSON.stringify(ctx.networkErrors, null, 2),
          timestamp: new Date().toISOString(),
        },
      ],
    },
  ];
}

async function authenticationCheck(ctx: CheckCtx): Promise<Issue[]> {
  // Login is handled during target setup (see runAgent below). Here we
  // just check that the page is no longer the login screen.
  const url = ctx.page.url();
  const stillOnLogin = await ctx.page.$('input[type="password"]');
  if (stillOnLogin) {
    return [
      {
        id: `iss_${ctx.targetId}_auth_${Date.now()}`,
        title: "Authentication did not complete",
        applicationName: ctx.applicationName,
        url,
        category: "authentication",
        severity: "high",
        status: "open",
        description:
          "The login form is still visible after the login attempt — credentials may be invalid or the redirect is missing.",
        detectedAt: new Date().toISOString(),
      },
    ];
  }
  return [];
}

async function accessibilityCheck(ctx: CheckCtx): Promise<Issue[]> {
  const issues: Issue[] = [];
  const h1Count = await ctx.page.locator("h1").count();
  if (h1Count === 0) {
    issues.push({
      id: `iss_${ctx.targetId}_a11y_h1_${Date.now()}`,
      title: "Page is missing an <h1> element",
      applicationName: ctx.applicationName,
      url: ctx.page.url(),
      category: "accessibility",
      severity: "low",
      status: "open",
      description: "No <h1> was found on the page. WCAG 1.3.1 expects a primary heading.",
      expected: "Exactly one <h1>",
      actual: "0 <h1>",
      detectedAt: new Date().toISOString(),
    });
  } else if (h1Count > 1) {
    issues.push({
      id: `iss_${ctx.targetId}_a11y_h1_${Date.now()}`,
      title: `Multiple <h1> elements found (${h1Count})`,
      applicationName: ctx.applicationName,
      url: ctx.page.url(),
      category: "accessibility",
      severity: "low",
      status: "open",
      description: `Found ${h1Count} <h1> elements. WCAG recommends one primary heading per page.`,
      detectedAt: new Date().toISOString(),
    });
  }
  return issues;
}

async function performanceCheck(ctx: CheckCtx): Promise<Issue[]> {
  // Already covered by pageLoadCheck's load-time component.
  return [];
}

// All Functionality — the umbrella interactive pass. On the landing page it
// exercises links, buttons, and forms in one go; its larger job is opting
// the run into the deep walk below (gated on this check), which carries the
// same exercise to every reachable same-origin page. Overlap with the
// standalone buttons/forms/navigation checks is harmless — the run's
// issue-signature set suppresses duplicates.
async function allFunctionalityCheck(ctx: CheckCtx): Promise<Issue[]> {
  return [
    ...(await navigationCheck(ctx)),
    ...(await buttonsCheck(ctx)),
    ...(await formsCheck(ctx)),
  ];
}

const HANDLERS: Record<VerificationCheckId, (ctx: CheckCtx) => Promise<Issue[]>> = {
  page_load: pageLoadCheck,
  navigation: navigationCheck,
  buttons: buttonsCheck,
  forms: formsCheck,
  broken_links: brokenLinksCheck,
  console_errors: consoleErrorsCheck,
  network_errors: networkErrorsCheck,
  authentication: authenticationCheck,
  accessibility: accessibilityCheck,
  performance: performanceCheck,
  all_functionality: allFunctionalityCheck,
};

// ────────────────────────────────────────────────────────────────────────────
//  Deep walk — BFS over the app's reachable same-origin pages.
//
//  The user's complaint after the first pass: "it's not verifying all
//  the functionality." The first pass only inspected the target URL —
//  it didn't follow menus into the app's other screens, so an issue
//  inside Settings or Billing or a sub-dashboard would never be seen.
//
//  `deepWalk` navigates the existing Playwright `page` to every
//  same-origin URL reachable from `target.url` (via <a> href + button
//  triggers), and on each page it:
//    1. Logs console + network errors seen since the last visit (so
//       issues are tagged with the page they appeared on, not the
//       landing page).
//    2. Captures an `evidence` screenshot so the user can see what
//       was visited.
//    3. Fills one form per page and submits it; if the form submit
//       navigates, the next iteration will discover the new URL on
//       its own.
//    4. Records broken links (4xx on same-origin HEAD/GET probes).
//
//  Bounds: at most `MAX_DEEP_WALK_PAGES` distinct URLs, at most
//  `MAX_DEEP_WALK_MS` wall-clock. The function is best-effort — any
//  per-page error is swallowed so a single bad page can't kill the
//  whole walk.
// ────────────────────────────────────────────────────────────────────────────

// Page cap is a safety bound only — the agent should keep walking
// until every reachable same-origin URL has been visited. The user
// wants the run to continue as long as the app's reachable
// functionality is being verified; nothing should make it stop early.
// BFS drains the queue until empty; the page cap exists purely to
// bound runaway link discovery (e.g. a calendar / feed that exposes
// thousands of unique same-origin URLs).
//
// The only things that end a walk early are the two cooperative
// bail-outs below: an explicit user Stop, or the whole-run deadline.
const MAX_DEEP_WALK_PAGES = 5_000;

// Hard ceiling on a single run. Generous on purpose — the user asked
// that runs "not stop until all functionality is verified", so this is
// NOT an aggressive per-check timeout. It exists so a pathologically
// stuck walk (infinite redirect loop, a page that re-enqueues itself,
// Playwright wedged on a dialog) surfaces as a visible failure instead
// of an invisible zombie that keeps a Chrome window open forever.
const MAX_RUN_MS = 30 * 60_000;

// Device emulation presets for the run's browser context. Desktop is
// the historical default; mobile/tablet exist so responsive layouts
// actually render (and get tested) in their compact variants.
const DEVICE_PRESETS = {
  desktop: { width: 1280, height: 800, isMobile: false, hasTouch: false },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true },
  tablet: { width: 820, height: 1180, isMobile: true, hasTouch: true },
} as const;

// Controls whose labels mark them as destructive or session-ending.
// The walker NEVER clicks these autonomously — a verification run must
// not delete production data or kill the session mid-walk. Node-side
// checks (buttons/forms) use this constant; the page.evaluate probe
// passes inline byte-identical copies (evaluate functions can't close
// over module scope).
const RISKY_CONTROL =
  /log\s*out|logoff|log-off|sign\s*out|delet|remov|destroy|uninstall|reset\b|purge|wipe/i;

// Cooperative bail-out checks. Both read shared run state, so a Stop
// issued mid-walk takes effect at the next loop boundary (per page in
// the deep walk, per candidate during the clickable pass) rather than
// after the whole target list finishes.
function runCancelled(runId: string, deadline: number): boolean {
  return getRun(runId)?.stopRequested === true || Date.now() > deadline;
}

async function deepWalk(
  req: StartVerificationRequest,
  target: StartVerificationRequest["targets"][number],
  page: Page,
  allIssues: Issue[],
  seenSignatures: Set<string>,
  discoveredUrls: Set<string>,
  deadline: number,
): Promise<void> {
  appendEvent(req.runId, {
    kind: "target_progress",
    runId: req.runId,
    targetId: target.id,
    step: "deep_walk",
    done: false,
  });

  // Debug: how many candidate clickables does the seed page have?
  // Emitted so the user can see in the UI whether the discovery
  // selectors are finding anything on the post-login page.
  try {
    const counts = await page.evaluate(() => {
      const sel = [
        "a[href]",
        "[role='button']",
        "[role='link']",
        "[data-card]",
        "[data-row]",
        "[data-clickable]",
        "[data-href]",
        "[data-link]",
        "[data-testid*='card' i]",
        "[data-testid*='row' i]",
        "[class*='card' i]",
        "[class*='tile' i]",
        "[class*='row-item' i]",
        "[class*='project' i]",
      ].join(", ");
      const seen = new Set<Element>();
      for (const n of Array.from(document.querySelectorAll(sel))) seen.add(n);
      return {
        url: window.location.href,
        total: seen.size,
        firstFew: Array.from(seen).slice(0, 5).map((el) => ({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent ?? "").trim().slice(0, 60),
          cls: (el as HTMLElement).className?.toString().slice(0, 60) ?? "",
          href: (el as HTMLAnchorElement).href || null,
        })),
      };
    });
    appendEvent(req.runId, {
      kind: "target_progress",
      runId: req.runId,
      targetId: target.id,
      step: `deep_walk_debug:url=${counts.url} candidates=${counts.total}`,
      done: false,
    });
  } catch {
    // best-effort
  }

  const origin = (() => {
    try {
      return new URL(target.url).origin;
    } catch {
      return "";
    }
  })();
  if (!origin) {
    appendEvent(req.runId, {
      kind: "target_progress",
      runId: req.runId,
      targetId: target.id,
      step: "deep_walk",
      done: true,
    });
    return;
  }

  const visited = new Set<string>();
  const queue: string[] = [];
  // Application map under construction: page URL -> same-origin pages
  // discovered from it. Emitted as an `app_map` event when the walk
  // finishes so the UI can render the site structure and the chat AI
  // can reason over it ("only test the /app/projects pages").
  const appMap: Record<string, string[]> = {};
  const noteDiscovered = (from: string, to: string) => {
    const list = (appMap[from] ??= []);
    // Same edge can be recorded twice (anchor + probe both land on a page).
    // Dedupe so the tree and report don't list a child twice under one page.
    if (!list.includes(to)) list.push(to);
  };
  // Seed with:
  //   - the current page URL (so the landing page is always walked);
  //   - every same-origin link visible on the current page (top nav,
  //     sidebar, footer, breadcrumbs);
  //   - every URL the per-check button pass discovered by clicking
  //     (project cards, sidebar toggles, menu items that navigate via
  //     client-side routing and don't carry an href).
  try {
    const here = page.url();
    // Never seed about:blank — the pre-navigation URL has no content to
    // walk and its pathname ("blank") shows up as noise in the UI feed.
    const seed = new Set<string>(here === "about:blank" ? [] : [here]);
    // If the walk starts on about:blank (first target, no navigation yet),
    // fall back to the target URL so the walk always begins on a real page.
    if (seed.size === 0) seed.add(target.url);
    for (const u of discoveredUrls) {
      try {
        if (u === "about:blank") continue;
        if (new URL(u).origin === origin) seed.add(u);
      } catch {
        // ignore
      }
    }
    const anchors = await page.$$eval("a[href]", (els) =>
      (els as HTMLAnchorElement[]).map((a) => a.href).filter((h) => !!h),
    );
    for (const a of anchors) {
      try {
        const u = new URL(a);
        if (u.origin === origin) seed.add(u.toString());
      } catch {
        // ignore malformed href
      }
    }
    for (const s of seed) queue.push(s);
  } catch {
    queue.push(page.url());
  }

  let pagesVisited = 0;
  // Drain the BFS queue until empty, the page cap, a user Stop, or the
  // run deadline. The last two are the cooperative bail-outs — without
  // them a Stop just relabels the run while Playwright keeps walking,
  // and a wedged walk never ends at all.
  while (
    queue.length > 0 &&
    pagesVisited < MAX_DEEP_WALK_PAGES &&
    !runCancelled(req.runId, deadline)
  ) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    pagesVisited++;
    appMap[url] = appMap[url] ?? [];

    try {
      // Step 1: navigate to the URL. domcontentloaded is enough; the
      // console + network listeners already capture everything that
      // fires during load. 30s because heavy SPA landing pages (the
      // dev-os login measured ~14s to domcontentloaded) sat right at
      // the old 15s budget and failed the walk on their seed URL.
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page
        .waitForLoadState("networkidle", { timeout: 5_000 })
        .catch(() => undefined);

      // Step 2: log a "page visited" progress event so the UI shows
      // the agent moving through the app in real time. The
      // observation-style checks (console / network / a11y) run in
      // the watch loop and capture everything on a rolling basis —
      // no need to re-run them per page here.
      appendEvent(req.runId, {
        kind: "target_progress",
        runId: req.runId,
        targetId: target.id,
        step: `deep_walk:${new URL(url).pathname}`,
        done: false,
      });

      // Step 3: enqueue every newly discovered same-origin link from
      // the page we just landed on. This is the BFS expansion.
      try {
        const anchors = await page.$$eval("a[href]", (els) =>
          (els as HTMLAnchorElement[]).map((a) => a.href).filter((h) => !!h),
        );
        for (const a of anchors) {
          try {
            const u = new URL(a);
            if (u.origin !== origin) continue;
            // Skip binary / asset links; we only want navigable pages.
            const path = u.pathname.toLowerCase();
            if (/\.(png|jpe?g|gif|svg|webp|ico|pdf|zip|json|xml|csv)$/.test(path)) continue;
            // Skip session-ending endpoints for the same reason they
            // are never clicked below — a GET /logout would kill the
            // auth session mid-walk and fail every subsequent page.
            if (/(log\s*out|logoff|log-off|sign\s*out)/i.test(path)) continue;
            if (visited.has(u.toString())) continue;
            queue.push(u.toString());
            noteDiscovered(url, u.toString());
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore anchor extraction failure
      }

      // Step 3.5: discover sub-pages that don't carry <a href> by
      // clicking candidate elements and watching for navigation. We
      // use page.evaluate so the click + URL read happen inside the
      // same JS context — Playwright's page.url() can briefly lag
      // SPAs that update window.location via history.pushState.
      //
      // Strategy: snapshot a JSON list of every candidate element's
      // tag + selector + textContent + href, click each one, read
      // window.location.href afterwards, then collect the unique new
      // same-origin URLs into the BFS queue. force-click to bypass
      // display:none parents and overlays that would otherwise
      // silently swallow clicks.
      try {
        const candidates = await page.evaluate(() => {
          const sel = [
            "a[href]",
            "[role='button']",
            "[role='link']",
            "[data-card]",
            "[data-row]",
            "[data-clickable]",
            "[data-href]",
            "[data-link]",
            "[data-testid*='card' i]",
            "[data-testid*='row' i]",
            "[class*='card' i]",
            "[class*='tile' i]",
            "[class*='row-item' i]",
            "[class*='project' i]",
          ].join(", ");
          const nodes = Array.from(document.querySelectorAll(sel));
          // Dedupe by element so an element matching multiple
          // selectors isn't clicked twice.
          const seen = new Set<Element>();
          const out: Array<{ idx: number; tag: string; text: string; href: string | null }> = [];
          let idx = 0;
          // Destructive / session-ending controls are never clicked —
          // a verification run must not delete production data or log
          // out mid-walk. They're counted here and reported as skipped.
          // This filter must stay byte-identical to the one in the
          // re-resolve pass below: candidates are addressed by index
          // into this exact dedup sequence.
          const risky = /log\s*out|logoff|log-off|sign\s*out|delet|remov|destroy|uninstall|reset\b|purge|wipe/i;
          let skippedRisky = 0;
          for (const n of nodes) {
            if (seen.has(n)) continue;
            seen.add(n);
            const a = n as HTMLAnchorElement;
            const label = (n.textContent ?? "").trim();
            if (
              risky.test(a.pathname || "") ||
              risky.test(label) ||
              risky.test(n.getAttribute("aria-label") ?? "") ||
              risky.test(n.getAttribute("title") ?? "")
            ) {
              skippedRisky++;
              continue;
            }
            out.push({
              idx: idx++,
              tag: n.tagName.toLowerCase(),
              text: (n.textContent ?? "").trim().slice(0, 80),
              href: a.href || null,
            });
          }
          return { kept: out, skipped: skippedRisky };
        });

        const beforeUrl = page.url();
        for (const c of candidates.kept) {
          if (c.idx > 200) break; // safety bound
          // Checked per candidate, not per page: this loop is the
          // slowest thing the walker does (each probe waits ~600ms for
          // client-side routing), so a page with 200 clickables takes
          // minutes. A Stop or deadline must land within one probe.
          if (runCancelled(req.runId, deadline)) break;
          try {
            // Re-resolve the element by index + tag + text each time
            // — element references go stale across navigations.
            await page.evaluate(
              ({ idx }) => {
                const sel = [
                  "a[href]",
                  "[role='button']",
                  "[role='link']",
                  "[data-card]",
                  "[data-row]",
                  "[data-clickable]",
                  "[data-href]",
                  "[data-link]",
                  "[data-testid*='card' i]",
                  "[data-testid*='row' i]",
                  "[class*='card' i]",
                  "[class*='tile' i]",
                  "[class*='row-item' i]",
                  "[class*='project' i]",
                ].join(", ");
                const nodes = Array.from(document.querySelectorAll(sel));
                const seen = new Set<Element>();
                const deduped: Element[] = [];
                // Same destructive/session-ending filter as the
                // candidate snapshot above — indexes must line up with
                // that exact sequence.
                const risky = /log\s*out|logoff|log-off|sign\s*out|delet|remov|destroy|uninstall|reset\b|purge|wipe/i;
                for (const n of nodes) {
                  if (seen.has(n)) continue;
                  seen.add(n);
                  const a = n as HTMLAnchorElement;
                  const label = (n.textContent ?? "").trim();
                  if (
                    risky.test(a.pathname || "") ||
                    risky.test(label) ||
                    risky.test(n.getAttribute("aria-label") ?? "") ||
                    risky.test(n.getAttribute("title") ?? "")
                  ) {
                    continue;
                  }
                  deduped.push(n);
                }
                const el = deduped[idx];
                if (!el) return;
                el.scrollIntoView({ block: "center" });
                (el as HTMLElement).click();
              },
              { idx: c.idx },
            );
            // Wait long enough for client-side routing to settle.
            await page.waitForTimeout(400);
            // Read the URL from inside the page — Playwright's
            // page.url() can briefly lag SPAs that pushState. A
            // full-page navigation destroys this evaluate mid-flight
            // and throws; that throw MEANS the click navigated, so
            // fall back to page.url() instead of skipping recovery
            // entirely. (The old code let the outer catch swallow it,
            // skipped goBack, and stranded the walk on the destination
            // page — every later probe then clicked the wrong page's
            // elements and the walk drifted away from the original
            // URL exactly as observed.)
            let afterHref: string;
            try {
              afterHref = await page.evaluate(() => window.location.href);
            } catch {
              afterHref = page.url();
            }
            if (afterHref !== beforeUrl) {
              try {
                const u = new URL(afterHref);
                if (u.origin === origin && !visited.has(afterHref)) {
                  queue.push(afterHref);
                  noteDiscovered(url, afterHref);
                }
              } catch {
                // ignore
              }
              // Undo the navigation so we keep probing candidates on
              // the original page.
              await page.goBack({ waitUntil: "domcontentloaded", timeout: 8_000 }).catch(() => undefined);
              await page.waitForTimeout(200);
              // goBack can silently no-op (history.replaceState apps,
              // a popstate the SPA swallows) — hard-navigate back so
              // the next candidate is probed on the right page.
              if (page.url() !== beforeUrl) {
                await page.goto(beforeUrl, { waitUntil: "domcontentloaded", timeout: 10_000 }).catch(() => undefined);
                await page.waitForTimeout(200);
              }
            } else {
              // No navigation — the click most likely toggled a menu,
              // popover, or modal. Dismiss it so UI state doesn't
              // accumulate across probes and swallow later clicks.
              await page.keyboard.press("Escape").catch(() => undefined);
            }
            // target=_blank clicks open tabs that nothing ever closed —
            // shut every page this probe may have spawned so the walk
            // stays on one tab.
            for (const p of page.context().pages()) {
              if (p !== page) await p.close().catch(() => undefined);
            }
          } catch {
            // not interactable — skip
          }
        }
        // Drift backstop. Uses page.url() rather than an evaluate — an
        // evaluate here throws if a slow navigation commits mid-read,
        // which used to skip the reset entirely.
        if (page.url() !== beforeUrl) {
          // We drifted during the card pass — return to the URL we
          // were supposed to be on so the next iteration sees the
          // correct starting state.
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 10_000 }).catch(() => undefined);
        }
        // Surface skipped destructive controls so the user knows what
        // the walker deliberately did NOT exercise (and can test those
        // flows by hand or via a scoped chat run).
        if (candidates.skipped > 0) {
          appendEvent(req.runId, {
            kind: "target_progress",
            runId: req.runId,
            targetId: target.id,
            step: `skipped_destructive:${candidates.skipped} control(s) on ${new URL(url).pathname} (delete/remove/reset-style actions are never auto-clicked)`,
            done: false,
          });
        }
      } catch {
        // best-effort
      }

      // Step 4: capture evidence so the user sees a screenshot of
      // every page the agent visited.
      try {
        const ev = await captureEvidence(
          req.runId,
          target.id,
          page,
          target.applicationName,
        );
        if (ev) appendEvent(req.runId, ev);
      } catch {
        // best-effort
      }
    } catch (err) {
      // best-effort: a single failing URL must not abort the walk
      console.error(
        `[deep-walk] page failed: ${url} — ${(err as Error).message}`,
      );
      appendEvent(req.runId, {
        kind: "target_progress",
        runId: req.runId,
        targetId: target.id,
        step: `deep_walk_page_failed:${new URL(url).pathname}`,
        done: true,
      });
      void err;
    }
  }

  appendEvent(req.runId, {
    kind: "target_progress",
    runId: req.runId,
    targetId: target.id,
    step: `deep_walk_done:${pagesVisited} pages`,
    done: true,
  });

  // Application map: every page visited -> pages discovered from it.
  // The walk's actual footprint, for the UI tree and the chat AI.
  appendEvent(req.runId, {
    kind: "app_map",
    runId: req.runId,
    targetId: target.id,
    applicationName: target.applicationName,
    pages: appMap,
  });
}

// ────────────────────────────────────────────────────────────────────────────
//  Heuristic login — fills the first email/password inputs and submits.
//
//  Handles two scenarios:
//    A. **Same-origin form** — the current page already has an email +
//       password input. Fill, submit, wait for navigation, confirm we
//       are no longer on the login form.
//    B. **OIDC SSO redirect** — the current page has no form but has a
//       "Log in" / "Sign in" trigger. Clicking it cross-origin-navigates
//       to an IdP (Authorization Code + PKCE). Re-locate the form on the
//       IdP, fill, submit, then wait for the redirect back to the
//       application's origin or `/login/callback` path. The IdP → app
//       round-trip can be slow (PKCE exchange + token bootstrap), so the
//       callback wait is generous (30s).
// ────────────────────────────────────────────────────────────────────────────

async function findEmailInput(page: Page) {
  return page.$('input[type="email"], input[name*="email" i], input[id*="email" i], input[autocomplete="username"]');
}

async function findPasswordInput(page: Page) {
  return page.$('input[type="password"], input[autocomplete="current-password"]');
}

async function findSubmitButton(page: Page) {
  return (
    (await page.$('button[type="submit"]')) ??
    (await page.$('form button')) ??
    (await page.$('input[type="submit"]'))
  );
}

async function findLoginTrigger(page: Page) {
  // Visible buttons/anchors whose text says "Log in" / "Sign in" but NOT
  // "Sign up" / "Log out". We deliberately avoid third-party SSO buttons
  // ("Sign in with Google") by keeping the regex tight to a word match.
  const handles = await page.$$('button, a, [role="button"]');
  for (const h of handles) {
    let text = "";
    try {
      text = ((await h.textContent()) ?? "").trim();
    } catch {
      continue;
    }
    if (!text) continue;
    const lower = text.toLowerCase();
    const matchesLogin = /(^|\s)(log\s*in|sign\s*in)(\s|$|[!.])/.test(lower);
    const matchesExclude = /sign\s*up|signup|log\s*out|logout/.test(lower);
    if (matchesLogin && !matchesExclude) {
      const visible = await h.isVisible().catch(() => false);
      if (visible) return h;
    }
  }
  return null;
}

// Login outcome — richer than a single boolean so the caller can surface
// a meaningful issue event when login technically "succeeds" (no password
// input remaining) but the SPA has bounced back to the public landing
// page because the token exchange failed (PKCE verifier mismatch, missing
// cross-origin cookie, etc.). Without this, the live preview frame captured
// at the end of attemptLogin shows whatever the SPA has rendered in that
// state — usually the public /login or / page — and the user has to dig
// through network errors to figure out what happened.
interface LoginResult {
  ok: boolean;
  passwordBox?: { x: number; y: number; width: number; height: number };
  // Path of the URL the SPA settled on after the OIDC dance. Empty if the
  // page never reached a known path (about:blank, network failure, etc.).
  finalPath?: string;
  // Human-readable reason for a failed login. Populated whenever ok=false
  // so the run loop can build an issue_detected event without re-querying.
  failureReason?: string;
  // Short issue title matching the failure mode ("IdP rejected the
  // credentials" vs "SPA bounced back…") so the Issues panel doesn't
  // report a token-exchange bounce when the real cause was a bad password.
  failureTitle?: string;
}

async function attemptLogin(
  page: Page,
  credentialId: string | null | undefined,
): Promise<LoginResult> {
  loginLog(`attemptLogin called, credentialId=${credentialId ?? "(none)"}, url=${page.url()}`);
  if (!credentialId) return { ok: false };
  // Debug: list all stored secret IDs so we can see if the lookup is mismatched
  try {
    const stored = listSecrets();
    loginLog(`stored secret count=${stored.length}, ids=${stored.map((s) => s.id).join(",")}`);
  } catch (err) {
    loginLog(`listSecrets error: ${(err as Error).message}`);
  }
  const cred = resolveCredentialForTarget(credentialId);
  if (!cred) {
    loginLog(`credential not found for id ${credentialId}`);
    return { ok: false };
  }
  loginLog(`starting attemptLogin on ${page.url()}`);

  // ─── Scenario A: same-origin login form ────────────────────────────────
  let emailInput = await findEmailInput(page).catch(() => null);
  let passwordInput = await findPasswordInput(page).catch(() => null);
  if (emailInput && passwordInput) {
    const passwordBox = (await passwordInput.boundingBox().catch(() => null)) ?? undefined;
    await emailInput.fill(cred.email);
    await passwordInput.fill(cred.password);
    const submitButton = await findSubmitButton(page);
    if (!submitButton) return { ok: false, passwordBox, failureReason: "no submit button on same-origin login form" };
    await Promise.all([
      page.waitForNavigation({ waitUntil: "load", timeout: 15_000 }).catch(() => undefined),
      submitButton.click(),
    ]);
    await page.waitForTimeout(800);
    const finalUrl = page.url();
    let finalPath = "";
    try { finalPath = new URL(finalUrl).pathname; } catch { /* leave empty */ }
    const passwordStillThere = await page.$('input[type="password"]').catch(() => null);
    const ok = !passwordStillThere;
    loginLog(`same-origin final URL: ${finalUrl}; stillOnLogin=${!!passwordStillThere}; ok=${ok}`);
    return ok
      ? { ok: true, passwordBox, finalPath }
      : {
          ok: false,
          passwordBox,
          finalPath,
          failureReason: `Same-origin login did not redirect away from the login form (still on "${finalPath}").`,
        };
  }

  // ─── Scenario B: OIDC SSO redirect ─────────────────────────────────────
  // The current page has no form, just a "Log in" / "Sign in" trigger that
  // initiates an Authorization Code + PKCE redirect to an IdP. Click it,
  // wait for the cross-origin navigation, then fill the IdP's form.
  // Slow SPAs (dev-os takes 14–20s to bootstrap under load) can render
  // the login trigger long after domcontentloaded — poll for it for up
  // to 30s instead of giving up on the first snapshot.
  let trigger = await findLoginTrigger(page).catch(() => null);
  for (let i = 0; !trigger && i < 15; i++) {
    await page.waitForTimeout(2_000);
    trigger = await findLoginTrigger(page).catch(() => null);
  }
  if (!trigger) {
    loginLog(`no OIDC trigger found on ${page.url()} after 30s of polling`);
    return {
      ok: false,
      failureTitle: "Login failed — no login form or trigger found",
      failureReason: `No "Log in" / "Sign in" trigger found on the landing page (${page.url()}) after waiting 30s for the SPA to render. The page may still be loading, or the trigger button uses non-standard markup.`,
    };
  }
  const triggerText = ((await trigger.textContent().catch(() => "")) ?? "").trim();
  const triggerTag = await trigger.evaluate((el) => el.tagName).catch(() => "?");
  loginLog(`trigger: ${triggerTag} "${triggerText.slice(0, 50)}"`);

  const startingUrl = page.url();
  let startingOrigin = "";
  try {
    startingOrigin = new URL(startingUrl).origin;
  } catch {
    // about:blank or other non-URL page — fall through with empty origin
  }

  await Promise.all([
    page
      .waitForURL(
        (url) => {
          try {
            return new URL(url).origin !== startingOrigin;
          } catch {
            return false;
          }
        },
        { timeout: 20_000 },
      )
      .catch(() => undefined),
    trigger.click(),
  ]);
  loginLog(`after trigger click URL: ${page.url()}`);

  // We should now be on the IdP. Re-locate inputs there.
  emailInput = await findEmailInput(page).catch(() => null);
  passwordInput = await findPasswordInput(page).catch(() => null);
  if (!emailInput || !passwordInput) {
    loginLog(`no form on IdP at ${page.url()} (email=${!!emailInput} pwd=${!!passwordInput})`);
    return {
      ok: false,
      failureReason: `After the OIDC trigger redirected to ${page.url()}, no email/password form was found on the IdP page.`,
    };
  }
  loginLog(`IdP form found`);

  const passwordBox = (await passwordInput.boundingBox().catch(() => null)) ?? undefined;
  await emailInput.fill(cred.email);
  await passwordInput.fill(cred.password);
  const submitButton = await findSubmitButton(page);
  if (!submitButton) return { ok: false, passwordBox, failureReason: "no submit button on IdP form" };

  // Wait for the IdP to redirect back to the application's origin OR to
  // a /login/callback path (the SPA exchanges the code for tokens next).
  await Promise.all([
    page
      .waitForURL(
        (url) => {
          try {
            const u = new URL(url);
            return (
              (startingOrigin && u.origin === startingOrigin) ||
              /\/login\/callback/.test(u.pathname) ||
              /\/oauth\/callback/.test(u.pathname)
            );
          } catch {
            return false;
          }
        },
        { timeout: 30_000 },
      )
      .catch(() => undefined),
    submitButton.click(),
  ]);
  loginLog(`post-submit URL: ${page.url()}`);

  // After the OIDC dance the SPA exchanges the code for tokens and then
  // either (a) lands on the authenticated dashboard, or (b) bounces back
  // to the public landing page. Bootstrapping the session can hop through
  // several transient URLs — dev-os goes /login/callback → / → /login →
  // /app/console — so sampling the URL once right after the submit races
  // that redirect chain and misreads the transient /login hop as a
  // failure. Poll for a stable outcome instead:
  //   success = app origin + non-public path + no password field, held 2s
  //   failure = IdP page, or public app page, with no navigation for 6s
  const isPublicAppPath = (p: string) => p === "" || p === "/" || /^\/login(\/|$)/.test(p);
  const originOf = (u: string) => {
    try { return new URL(u).origin; } catch { return ""; }
  };
  const pathOf = (u: string) => {
    try { return new URL(u).pathname; } catch { return ""; }
  };
  const deadline = Date.now() + 25_000;
  let lastUrl = page.url();
  let stableMs = 0;
  let finalUrl = lastUrl;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1_000);
    const url = page.url();
    if (url !== lastUrl) {
      lastUrl = url;
      stableMs = 0;
      continue;
    }
    stableMs += 1_000;
    finalUrl = url;
    const path = pathOf(url);
    const onIdp = startingOrigin !== "" && originOf(url) !== startingOrigin;
    const passwordStillThere = !!(await page.$('input[type="password"]').catch(() => null));
    // Success: an authenticated page that has held for 2s.
    if (!onIdp && !isPublicAppPath(path) && !passwordStillThere && stableMs >= 2_000) break;
    // Failure: settled on the IdP or a public app page for 6s. The
    // callback path is excluded — the token exchange is an XHR, so the
    // URL can legitimately sit there for a while; that case falls
    // through to the deadline and is reported as "stuck on callback".
    const publicSettled = isPublicAppPath(path) && !/\/login\/callback/.test(path);
    if ((onIdp || publicSettled) && stableMs >= 6_000) break;
  }

  const finalPath = pathOf(finalUrl);
  const stillOnCallback = /\/login\/callback/.test(finalPath);
  const onIdpFinal = startingOrigin !== "" && originOf(finalUrl) !== startingOrigin;
  const passwordStillThere = !!(await page.$('input[type="password"]').catch(() => null));
  const fellBackToPublic = !onIdpFinal && isPublicAppPath(finalPath);
  const ok = !onIdpFinal && !stillOnCallback && !passwordStillThere && !fellBackToPublic;

  let failureTitle: string | undefined;
  let failureReason: string | undefined;
  if (!ok) {
    if (onIdpFinal && passwordStillThere) {
      failureTitle = "Login failed — IdP rejected the credentials";
      failureReason =
        `The IdP did not accept the credentials: after submitting, its login form is still showing at ${finalUrl}. ` +
        `The stored password for ${cred.email} is likely wrong or expired — update it in the Secrets panel.`;
    } else if (onIdpFinal) {
      failureTitle = "Login failed — IdP did not redirect back";
      failureReason =
        `After submitting the credentials the IdP kept the browser at ${finalUrl} instead of redirecting back to ${startingOrigin}.`;
    } else if (fellBackToPublic) {
      failureTitle = "Login failed — SPA bounced back to public page";
      failureReason =
        `The IdP accepted the credentials and redirected back to ${startingOrigin}/login/callback, ` +
        `but the SPA then settled on the public page "${finalPath || "/"}" and never reached an authenticated page within 25s. ` +
        `Common causes: (1) PKCE code_verifier missing — the OIDC authorize URL sent code_challenge= (empty) but code_challenge_method=S256, ` +
        `so the IdP issued an auth code the SPA cannot redeem; (2) cross-origin session cookie not set on the application origin; ` +
        `(3) IdP rejected the token request (400). Check the Issues panel for the corresponding network error entries.`;
    } else if (stillOnCallback) {
      failureTitle = "Login failed — stuck on callback";
      failureReason =
        `Authentication did not complete: the page is still on "${finalPath}" 25s after the IdP submit. ` +
        `The SPA may be stuck on token exchange, or the callback handler crashed.`;
    } else if (passwordStillThere) {
      failureTitle = "Login failed";
      failureReason = `Authentication did not complete: the page still shows a password input at "${finalPath}".`;
    } else {
      failureTitle = "Login failed";
      failureReason = `Authentication state is uncertain at "${finalPath}".`;
    }
  }

  loginLog(
    `final URL: ${finalUrl}; stillOnLogin=${passwordStillThere}; stillOnCallback=${stillOnCallback}; ` +
    `onIdp=${onIdpFinal}; fellBackToPublic=${fellBackToPublic}; ok=${ok}` +
    (failureReason ? `; reason=${failureReason.slice(0, 120)}…` : ""),
  );
  return ok
    ? { ok: true, passwordBox, finalPath }
    : { ok: false, passwordBox, finalPath, failureTitle, failureReason };
}

// ────────────────────────────────────────────────────────────────────────────
//  Evidence helpers — screenshot with password-field redaction (spec §7).
// ────────────────────────────────────────────────────────────────────────────

async function captureEvidence(
  runId: string,
  targetId: string,
  page: Page,
  label: string,
  passwordBox?: { x: number; y: number; width: number; height: number },
): Promise<RunEvent | undefined> {
  try {
    // 5s timeout — page.screenshot can hang for tens of seconds if the
    // page is in a bad state (e.g. the pre-login goto timed out and left
    // the page mid-render). Without a timeout, the entire agent loop
    // blocks here, the SSE consumer goes silent, and the live preview
    // freezes on whatever frame was last delivered.
    let png = await page.screenshot({ fullPage: false, timeout: 5_000 });
    if (passwordBox && png) {
      // Lightweight blur substitute: paint a solid black rectangle over
      // the password field area. We're not doing per-pixel redraws —
      // we're proving the bbox redaction path works; a future phase can
      // swap in a real blur via Chromium's filter or an SVG overlay.
      const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
      const overlay = await page.evaluate(
        ({ dataUrl, box }) =>
          new Promise<string>((resolve) => {
            const img = new Image();
            img.onload = () => {
              const c = document.createElement("canvas");
              c.width = img.width;
              c.height = img.height;
              const ctx = c.getContext("2d")!;
              ctx.drawImage(img, 0, 0);
              ctx.fillStyle = "rgba(15,15,15,0.95)";
              ctx.fillRect(box.x, box.y, box.width, box.height);
              resolve(c.toDataURL("image/png"));
            };
            img.src = dataUrl;
          }),
        { dataUrl, box: passwordBox },
      );
      png = Buffer.from(overlay.split(",")[1], "base64");
    }
    const saved = saveEvidence(png, { mime: "image/png", extension: ".png", runId, label });
    return {
      kind: "evidence",
      runId,
      targetId,
      storageRef: saved.url.replace("/api/evidence/", ""),
      evidenceKind: "screenshot",
    };
  } catch (err) {
    return undefined;
  }
}

// ────────────────────────────────────────────────────────────────────────────
//  Run driver — one browser context per runId.
// ────────────────────────────────────────────────────────────────────────────

export async function runAgent(req: StartVerificationRequest) {
  const rec = getRun(req.runId);
  if (!rec) {
    setStatus(req.runId, "failed");
    return;
  }
  setStatus(req.runId, "running");

  // Whole-run deadline — see MAX_RUN_MS above for why it's this generous.
  const runDeadline = Date.now() + MAX_RUN_MS;

  const enabledTargets = req.targets.filter((t) => t.enabled);

  // Test-plan artifact: the concrete checks × targets matrix this run
  // will execute. Emitted up front so the UI and the export report can
  // show what was (planned to be) verified, not just what failed.
  appendEvent(req.runId, {
    kind: "test_plan",
    runId: req.runId,
    checks: req.scope,
    targets: enabledTargets.map((t) => ({
      targetId: t.id,
      applicationName: t.applicationName,
      url: t.url,
    })),
  });

  let browser: Browser | undefined;
  let failed = 0;
  const issueIds = new Map<string, string>(); // synthetic id -> server id (already in event)

  try {
    // Headed (visible) Chrome — the user asked for an actual browser
    // window they can watch while it verifies. Set HEADED=0 on the MCP
    // server to fall back to headless when running unattended (CI / WSL
    // without a display).
    browser = await chromium.launch({
      headless: process.env.HEADED === "0",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--start-maximized"],
    });
    for (const target of enabledTargets) {
      // Between targets is the cheapest place to honour a Stop / expired
      // deadline — everything below (context, login, checks, deep walk)
      // is skipped entirely rather than started and abandoned.
      if (runCancelled(req.runId, runDeadline)) break;
      const ctx: CheckCtx = {
        page: undefined as unknown as Page,
        runId: req.runId,
        targetId: target.id,
        applicationName: target.applicationName,
        url: target.url,
        consoleBuffer: [],
        networkErrors: [],
      } as CheckCtx;

      try {
        appendEvent(req.runId, {
          kind: "target_started",
          runId: req.runId,
          targetId: target.id,
          applicationName: target.applicationName,
        });

        // Device emulation — mobile/tablet change the viewport AND turn
        // on touch so responsive layouts actually render their mobile
        // variants during the run.
        const device = DEVICE_PRESETS[req.device ?? "desktop"];
        const context = await browser.newContext({
          viewport: { width: device.width, height: device.height },
          isMobile: device.isMobile,
          hasTouch: device.hasTouch,
          ignoreHTTPSErrors: true,
        });
        const page = await context.newPage();
        ctx.page = page;

        page.on("console", (msg) => ctx.consoleBuffer.push(msg));
        page.on("requestfailed", (req: Request) =>
          ctx.networkErrors.push({
            url: req.url(),
            status: 0,
            method: req.method(),
            resourceType: req.resourceType(),
          }),
        );
        page.on("response", (res: Response) => {
          const status = res.status();
          if (status >= 400 && status !== 304) {
            ctx.networkErrors.push({
              url: res.url(),
              status,
              method: res.request().method(),
              resourceType: res.request().resourceType(),
            });
          }
        });

        // Attempt login first if the scope includes 'authentication', or
        // the umbrella 'all_functionality' check (which covers every flow,
        // login included). Navigate to the target URL first so attemptLogin
        // runs against the real landing page — otherwise it sits on
        // about:blank and can't find the OIDC trigger. pageLoadCheck later
        // in the loop will re-navigate, which is a cheap no-op to the same
        // URL.
        let loginOk = false;
        let passwordBox: { x: number; y: number; width: number; height: number } | undefined;
        if (
          (req.scope.includes("authentication") ||
            req.scope.includes("all_functionality")) &&
          target.credentialId
        ) {
          try {
            // `commit` waits only for the HTTP response, not for
            // DOMContentLoaded — much faster on heavy SPAs like dev-os
            // whose JS bundles can take >20s to finish bootstrapping.
            // After the response lands, we give the SPA a generous moment
            // to render the trigger button before attemptLogin runs.
            await page.goto(target.url, { waitUntil: "commit", timeout: 30_000 });
            // Best-effort settle: wait for the OIDC trigger to appear OR
            // networkidle OR domcontentloaded, capped at 15s. Whichever
            // happens first wins. If none happen (hung SPA), we proceed
            // anyway — attemptLogin will simply report "no trigger" and
            // we move on.
            await Promise.race([
              page.waitForFunction(
                () => {
                  const buttons = Array.from(
                    document.querySelectorAll('button, a, [role="button"]'),
                  );
                  return buttons.some((b) => {
                    const t = (b.textContent ?? "").toLowerCase();
                    return /(log\s*in|sign\s*in)/.test(t) &&
                      !/sign\s*up|log\s*out/.test(t);
                  });
                },
                { timeout: 15_000 },
              ).catch(() => undefined),
              page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined),
              page.waitForTimeout(15_000),
            ]);
            loginLog(`pre-login navigation OK; now at ${page.url()}`);
          } catch (err) {
            loginLog(`pre-login navigation failed: ${(err as Error).message}`);
          }
          try {
            const result = await attemptLogin(page, target.credentialId);
            loginOk = result.ok;
            passwordBox = result.passwordBox;

            // If login filled the credentials and the IdP accepted them
            // but the SPA couldn't complete the token exchange and
            // bounced back to the public landing page, surface a clear
            // issue so the user doesn't have to dig through network
            // errors. attemptLogin populates `failureReason` for every
            // non-ok outcome.
            if (!result.ok && result.failureReason) {
              appendEvent(req.runId, {
                kind: "issue_detected",
                runId: req.runId,
                targetId: target.id,
                payload: {
                  id: `iss_${target.id}_login_${Date.now()}`,
                  title: result.failureTitle ?? "Login failed",
                  applicationName: target.applicationName,
                  url: target.url,
                  category: "authentication",
                  severity: "high",
                  status: "open",
                  description: result.failureReason,
                  detectedAt: new Date().toISOString(),
                  verificationRunId: req.runId,
                },
              });
            }
          } catch (err) {
            loginOk = false;
            appendEvent(req.runId, {
              kind: "issue_detected",
              runId: req.runId,
              targetId: target.id,
              payload: {
                id: `iss_${target.id}_login_fatal_${Date.now()}`,
                title: "Login attempt crashed",
                applicationName: target.applicationName,
                url: target.url,
                category: "authentication",
                severity: "high",
                status: "open",
                description: (err as Error).stack ?? (err as Error).message,
                detectedAt: new Date().toISOString(),
                verificationRunId: req.runId,
              },
            });
          }
          // Screenshot the post-login page (with redacted password region).
          // Note: if login failed, this captures whatever the SPA rendered
          // in its final state — usually the public landing page — which is
          // exactly what we want to show in the live preview and in the
          // evidence panel so the user can see the failure visually.
          const ev = await captureEvidence(req.runId, target.id, page, target.applicationName, passwordBox);
          if (ev) appendEvent(req.runId, ev);
        }

        const allIssues: Issue[] = [];
        const seenSignatures = new Set<string>();
        const sig = (i: Pick<Issue, "url" | "title" | "description">) =>
          `${i.url}|${i.title}|${i.description}`;

        // URLs discovered during the per-check loop (e.g. a button
        // click that navigates somewhere new). Seeded into the
        // deep-walk queue below so the agent follows the app's real
        // navigation graph instead of relying only on <a href>.
        const discoveredUrls = new Set<string>();

        for (const checkId of req.scope) {
          appendEvent(req.runId, {
            kind: "target_progress",
            runId: req.runId,
            targetId: target.id,
            step: checkId,
            done: false,
          });
          try {
            // buttonsCheck takes a side-channel for discovered URLs
            // because button clicks can navigate into project sub-pages
            // the user actually wants verified.
            const issues = checkId === "buttons"
              ? await buttonsCheck(ctx, { discoveredUrls })
              : await HANDLERS[checkId](ctx);
            for (const issue of issues) {
              seenSignatures.add(sig(issue));
              const withRunId = { ...issue, verificationRunId: req.runId };
              allIssues.push(withRunId);
              appendEvent(req.runId, {
                kind: "issue_detected",
                runId: req.runId,
                targetId: target.id,
                payload: withRunId,
              });
            }
          } catch (err) {
            appendEvent(req.runId, {
              kind: "issue_detected",
              runId: req.runId,
              targetId: target.id,
              payload: {
                id: `iss_${target.id}_${checkId}_${Date.now()}`,
                title: `Check "${checkId}" threw`,
                applicationName: target.applicationName,
                url: target.url,
                category: "other",
                severity: "medium",
                status: "open",
                description: (err as Error).message,
                detectedAt: new Date().toISOString(),
                verificationRunId: req.runId,
              },
            });
          }
          appendEvent(req.runId, {
            kind: "target_progress",
            runId: req.runId,
            targetId: target.id,
            step: checkId,
            done: true,
          });
        }

        // ──────────────────────────────────────────────────────────────
        //  Deep walk — recursively visit every reachable same-origin
        //  page on the app (menus, sub-pages, dashboards, settings) and
        //  run the observation-style checks against each one. The first
        //  pass above only inspected the target's landing URL; without
        //  this step the verification never sees the rest of the app's
        //  functionality (the user's complaint: "it's not verifying
        //  all the functionality"). BFS over clickable same-origin
        //  links plus any URLs discovered by button clicks during the
        //  per-check pass; cap the total pages to keep the run bounded.
        //  Opt-in: only runs when the "All Functionality" check is in
        //  the scope — that checkbox is the user-facing control for
        //  this whole-app walk.
        // ──────────────────────────────────────────────────────────────
        if (req.scope.includes("all_functionality")) {
          await deepWalk(req, target, page, allIssues, seenSignatures, discoveredUrls, runDeadline);
        }

        // Continuous watch loop — after the first pass, keep re-running
        // observation-style checks every few seconds until the user
        // stops/pauses the run (or the browser crashes). The first pass
        // already exercised destructive actions (clicked buttons, filled
        // forms), so the watch loop only re-runs checks that read state
        // — console errors, network failures, page-load metrics,
        // accessibility landmarks, broken-link probes, and a session-
        // alive check. New issues are emitted as they're discovered;
        // duplicates (same URL + title + description) are suppressed by
        // the signature set. The live preview ticker keeps streaming
        // frames throughout, so the user sees the page evolve in
        // real time even between watch iterations.
        const watchChecks = req.scope.filter(
          (c) => c !== "buttons" && c !== "forms" && c !== "all_functionality",
        );
        let watchIteration = 0;
        const WATCH_INTERVAL_MS = 8_000;
        // Cap the watch loop so a verification run auto-completes
        // instead of looping forever. After the first thorough pass
        // (covering every button / form / nav / console / network / a11y
        // / perf check), we re-observe a handful more times in case
        // anything changed (lazy-loaded errors, async failures,
        // navigation the user took while watching), then close out. The
        // user can always kick off another run if they want longer
        // observation.
        const MAX_WATCH_ITERATIONS = 3;
        while (watchIteration < MAX_WATCH_ITERATIONS) {
          const rec = getRun(req.runId);
          if (!rec) break;
          if (Date.now() > runDeadline) break;
          if (
            rec.status === "paused" ||
            rec.status === "cancelled" ||
            rec.status === "completed" ||
            rec.status === "failed"
          ) {
            break;
          }
          watchIteration++;
          appendEvent(req.runId, {
            kind: "target_progress",
            runId: req.runId,
            targetId: target.id,
            step: `watch-${watchIteration}`,
            done: false,
          });
          // Sleep in 500ms slices so a Stop request mid-sleep is
          // honoured quickly rather than blocking until the full
          // interval elapses.
          const sleepEnd = Date.now() + WATCH_INTERVAL_MS;
          while (Date.now() < sleepEnd) {
            const midRec = getRun(req.runId);
            if (
              !midRec ||
              midRec.status === "paused" ||
              midRec.status === "cancelled" ||
              midRec.status === "completed" ||
              midRec.status === "failed"
            ) {
              break;
            }
            await new Promise((r) => setTimeout(r, 500));
          }
          // Re-check status before running another round of checks.
          const rec2 = getRun(req.runId);
          if (
            !rec2 ||
            rec2.status === "paused" ||
            rec2.status === "cancelled" ||
            rec2.status === "completed" ||
            rec2.status === "failed"
          ) {
            break;
          }
          for (const checkId of watchChecks) {
            // Skip page_load in the watch loop — it always navigates
            // back to the starting URL, which would interrupt whatever
            // state the user has navigated to since the first pass.
            if (checkId === "page_load") continue;
            try {
              const issues = await HANDLERS[checkId](ctx);
              for (const issue of issues) {
                if (seenSignatures.has(sig(issue))) continue;
                seenSignatures.add(sig(issue));
                const withRunId = { ...issue, verificationRunId: req.runId };
                allIssues.push(withRunId);
                appendEvent(req.runId, {
                  kind: "issue_detected",
                  runId: req.runId,
                  targetId: target.id,
                  payload: withRunId,
                });
              }
            } catch {
              // best-effort — a single check failing shouldn't stop the
              // watch loop
            }
          }
          appendEvent(req.runId, {
            kind: "target_progress",
            runId: req.runId,
            targetId: target.id,
            step: `watch-${watchIteration}`,
            done: true,
          });
        }

        appendEvent(req.runId, {
          kind: "target_completed",
          runId: req.runId,
          targetId: target.id,
          status: allIssues.length > 0 ? "issues_found" : "passed",
        });
        await context.close();
      } catch (err) {
        failed++;
        appendEvent(req.runId, {
          kind: "target_completed",
          runId: req.runId,
          targetId: target.id,
          status: "failed",
        });
        appendEvent(req.runId, {
          kind: "issue_detected",
          runId: req.runId,
          targetId: target.id,
          payload: {
            id: `iss_${target.id}_fatal_${Date.now()}`,
            title: `Target crashed: ${(err as Error).message}`,
            applicationName: target.applicationName,
            url: target.url,
            category: "other",
            severity: "critical",
            status: "open",
            description: (err as Error).stack ?? (err as Error).message,
            detectedAt: new Date().toISOString(),
            verificationRunId: req.runId,
          },
        });
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }

  // Emit run_completed only if the run wasn't already stopped by the
  // user. The /verify/runs/:id/stop handler emits its own run_failed
  // event and flips status to "cancelled"; emitting run_completed on
  // top of that would be a duplicate terminal event. A deadline breach
  // gets its own run_failed so the UI shows WHY the run ended instead
  // of silently reporting partial results as a full pass.
  const finalRec = getRun(req.runId);
  if (finalRec && finalRec.status === "running") {
    if (Date.now() > runDeadline) {
      appendEvent(req.runId, {
        kind: "run_failed",
        runId: req.runId,
        reason:
          "Run hit the 30-minute safety ceiling and was stopped before every page was visited. Narrow the verification scope (fewer checks or targets) or start a fresh run to continue.",
      });
      setStatus(req.runId, "failed", { completedAt: new Date().toISOString() });
    } else {
      appendEvent(req.runId, {
        kind: "run_completed",
        runId: req.runId,
        completedAt: new Date().toISOString(),
        failedTargets: failed,
      });
      setStatus(req.runId, "completed", { completedAt: new Date().toISOString() });
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
//  Test-connection — one-off probe (used by the "Test Connection" button).
// ────────────────────────────────────────────────────────────────────────────

export async function testConnection(args: {
  target: { id: string; applicationName: string; url: string; credentialId?: string | null };
  runIdHint?: string;
}) {
  const started = Date.now();
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({
      headless: process.env.HEADED === "0",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();

    let urlReachable = true;
    try {
      await page.goto(args.target.url, { waitUntil: "domcontentloaded", timeout: 15_000 });
    } catch {
      urlReachable = false;
    }
    if (!urlReachable) {
      return { urlReachable: false, loginSuccessful: false, durationMs: Date.now() - started };
    }

    let loginSuccessful = false;
    if (args.target.credentialId) {
      try {
        const result = await attemptLogin(page, args.target.credentialId);
        loginSuccessful = result.ok;
      } catch {
        loginSuccessful = false;
      }
    }
    await context.close();
    return {
      urlReachable,
      loginSuccessful,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    return {
      urlReachable: false,
      loginSuccessful: false,
      durationMs: Date.now() - started,
      error: (err as Error).message,
    };
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}

// Reference for resolve() above — kept so the import isn't dropped if we
// later resolve href links via Node's URL.
void resolveUrl;
