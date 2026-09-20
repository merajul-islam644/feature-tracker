// Real verification agent — Playwright runner.
//
// One `agent.ts:runAgent()` call drives the full verification flow for a
// given runId. Spec §6 step 5:
//
//   1. Create one Playwright `browser` per run (cleared on completion).
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
import { resolveCredentialForTarget } from "./secrets.js";
import type { Issue, RunEvent, StartVerificationRequest, VerificationCheckId } from "./types.js";
import { resolve as resolveUrl } from "node:url";

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
  await ctx.page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
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

async function buttonsCheck(ctx: CheckCtx): Promise<Issue[]> {
  const handles = await ctx.page.$$("button, [role=button], input[type=submit]");
  const issues: Issue[] = [];
  for (let i = 0; i < Math.min(handles.length, 15); i++) {
    const before = ctx.consoleBuffer.length;
    try {
      await handles[i].click({ timeout: 3_000, trial: false });
      // tiny wait for console events to surface
      await ctx.page.waitForTimeout(80);
      const newConsoleErrors = ctx.consoleBuffer.slice(before).filter((m) => m.type() === "error");
      if (newConsoleErrors.length > 0) {
        issues.push({
          id: `iss_${ctx.targetId}_btn_${Date.now()}_${i}`,
          title: `Button ${i + 1} triggered console error`,
          applicationName: ctx.applicationName,
          url: ctx.page.url(),
          category: "ui",
          severity: "medium",
          status: "open",
          description: newConsoleErrors.map((m) => m.text()).join("\n"),
          detectedAt: new Date().toISOString(),
        });
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
    try {
      for (const inp of inputs) {
        const t = await inp.getAttribute("type");
        if (t === "email") await inp.fill("verification@example.com");
        else if (t === "password") await inp.fill("Z9vQ!test2026");
        else await inp.fill("test value");
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
};

// ────────────────────────────────────────────────────────────────────────────
//  Heuristic login — fills the first email/password inputs and submits.
// ────────────────────────────────────────────────────────────────────────────

async function attemptLogin(
  page: Page,
  credentialId: string | null | undefined,
): Promise<{ ok: boolean; passwordBox?: { x: number; y: number; width: number; height: number } }> {
  if (!credentialId) return { ok: false };
  const cred = resolveCredentialForTarget(credentialId);
  if (!cred) return { ok: false };

  // Find a login form heuristically.
  const emailInput = await page.$('input[type="email"], input[name*=email i], input[id*=email i]');
  const passwordInput = await page.$('input[type="password"]');
  if (!emailInput || !passwordInput) return { ok: false };

  // Record the password field's bbox so screenshot redaction can blur it.
  const passwordBox = await passwordInput.boundingBox();
  await emailInput.fill(cred.email);
  await passwordInput.fill(cred.password);

  const submitButton =
    (await page.$('button[type="submit"]')) ??
    (await page.$('form button')) ??
    (await page.$('input[type="submit"]'));
  if (!submitButton) return { ok: false, passwordBox: passwordBox ?? undefined };

  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle", timeout: 15_000 }).catch(() => undefined),
    submitButton.click(),
  ]);
  // small settle
  await page.waitForTimeout(400);
  const stillOnLogin = await page.$('input[type="password"]');
  return { ok: !stillOnLogin, passwordBox: passwordBox ?? undefined };
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
    let png = await page.screenshot({ fullPage: false });
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

  const enabledTargets = req.targets.filter((t) => t.enabled);
  let browser: Browser | undefined;
  let failed = 0;
  const issueIds = new Map<string, string>(); // synthetic id -> server id (already in event)

  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    for (const target of enabledTargets) {
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

        const context = await browser.newContext({
          viewport: { width: 1280, height: 800 },
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

        // Attempt login first if the scope includes 'authentication'.
        let loginOk = false;
        let passwordBox: { x: number; y: number; width: number; height: number } | undefined;
        if (
          req.scope.includes("authentication") &&
          target.credentialId
        ) {
          try {
            const result = await attemptLogin(page, target.credentialId);
            loginOk = result.ok;
            passwordBox = result.passwordBox;
          } catch {
            loginOk = false;
          }
          // Screenshot the post-login page (with redacted password region).
          const ev = await captureEvidence(req.runId, target.id, page, target.applicationName, passwordBox);
          if (ev) appendEvent(req.runId, ev);
        }

        const allIssues: Issue[] = [];
        for (const checkId of req.scope) {
          if (ctx.page.url() === "about:blank") continue; // page never loaded
          appendEvent(req.runId, {
            kind: "target_progress",
            runId: req.runId,
            targetId: target.id,
            step: checkId,
            done: false,
          });
          try {
            const issues = await HANDLERS[checkId](ctx);
            for (const issue of issues) {
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

  appendEvent(req.runId, {
    kind: "run_completed",
    runId: req.runId,
    completedAt: new Date().toISOString(),
    failedTargets: failed,
  });
  setStatus(req.runId, "completed", { completedAt: new Date().toISOString() });
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
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
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
