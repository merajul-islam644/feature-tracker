// Standalone login reproducer — drives the exact OIDC flow attemptLogin
// uses, in a HEADED browser, with every URL change and every >=400 /
// OIDC-related network response logged. Exists to answer one question:
// WHERE does the dev-os login actually fail (IdP rejects the password vs
// the SPA's token exchange failing after a successful IdP redirect)?
//
// Usage:  npx tsx scripts/debug-login.ts [email-substring] [target-url]
//   e.g.  npx tsx scripts/debug-login.ts zoarder https://dev-os.blocksdevelopers.com/login
//
// SECURITY: the password is decrypted in memory only and passed straight
// to Playwright's fill(). It is never printed, logged, or echoed — same
// rule as src/secrets.ts.

import { chromium } from "playwright";
import { listSecrets, resolveCredentialForTarget } from "../src/secrets";

const emailFilter = process.argv[2] ?? "";
const targetUrl =
  process.argv[3] ?? "https://dev-os.blocksdevelopers.com/login";

function log(msg: string) {
  process.stdout.write(`[debug-login] ${msg}\n`);
}

async function main() {
  // ── Pick the credential (never print the password) ──────────────────
  const secrets = listSecrets();
  if (secrets.length === 0) throw new Error("No secrets stored.");
  const meta =
    secrets.find((s) => s.email.toLowerCase().includes(emailFilter.toLowerCase())) ??
    secrets[0];
  const cred = resolveCredentialForTarget(meta.id);
  if (!cred) throw new Error(`Could not resolve secret ${meta.id}`);
  log(`secret="${meta.name}" email=${cred.email} password=<${cred.password.length} chars, hidden>`);
  log(`target=${targetUrl}`);

  // ── Headed browser with full network visibility ─────────────────────
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) log(`URL → ${frame.url()}`);
  });
  page.on("response", async (res) => {
    const url = res.url();
    const interesting =
      res.status() >= 400 || /oidc|authorize|token|callback|login|session/i.test(url);
    if (!interesting) return;
    let body = "";
    if (res.status() >= 400) {
      try {
        body = (await res.text()).slice(0, 300).replace(/\s+/g, " ");
      } catch {
        body = "(body unavailable)";
      }
    }
    log(`HTTP ${res.status()} ${res.request().method()} ${url}${body ? ` — ${body}` : ""}`);
  });

  try {
    // Step 1 — landing page
    await page.goto(targetUrl, { waitUntil: "commit", timeout: 30_000 });
    await page.waitForTimeout(6_000); // let the SPA mount
    log(`landed on ${page.url()}`);

    // Step 2 — same-origin form, or OIDC trigger?
    let emailInput = await page.$('input[type="email"], input[name*="email" i], input[id*="email" i]');
    let passwordInput = await page.$('input[type="password"]');
    if (!emailInput || !passwordInput) {
      const trigger = await page.evaluateHandle(() => {
        const nodes = Array.from(document.querySelectorAll('button, a, [role="button"]'));
        return (
          nodes.find((b) => {
            const t = (b.textContent ?? "").toLowerCase();
            return /(log\s*in|sign\s*in)/.test(t) && !/sign\s*up|log\s*out/.test(t);
          }) ?? null
        );
      });
      if (!trigger || !(trigger.asElement())) {
        log("FAIL: no login form and no login trigger found on the landing page.");
        log(`page text: ${(await documentText(page)).slice(0, 300)}`);
        return;
      }
      log("clicking OIDC trigger…");
      const startOrigin = new URL(page.url()).origin;
      await Promise.all([
        page
          .waitForURL((u) => { try { return new URL(u).origin !== startOrigin; } catch { return false; } }, { timeout: 20_000 })
          .catch(() => undefined),
        (trigger.asElement() as import("playwright").Locator).click(),
      ]);
      await page.waitForTimeout(4_000);
      emailInput = await page.$('input[type="email"], input[name*="email" i], input[id*="email" i]');
      passwordInput = await page.$('input[type="password"]');
      log(`after trigger: ${page.url()} (email=${!!emailInput} pwd=${!!passwordInput})`);
    } else {
      log("same-origin login form found");
    }

    if (!emailInput || !passwordInput) {
      log("FAIL: no email/password inputs found after the IdP redirect.");
      log(`page text: ${await documentText(page)}`);
      return;
    }

    // Step 3 — fill and submit (password goes straight to fill())
    await emailInput.fill(cred.email);
    await passwordInput.fill(cred.password);
    const submit = await page.$('button[type="submit"], input[type="submit"]') ??
      (await page.$('button:not([type])'));
    if (!submit) {
      log("FAIL: no submit button on the IdP form.");
      return;
    }
    log("submitting…");
    await Promise.all([
      page.waitForTimeout(8_000),
      submit.click(),
    ]);

    // Step 4 — what happened? Watch navigation for up to 45s more.
    const settleStart = Date.now();
    while (Date.now() - settleStart < 45_000) {
      await page.waitForTimeout(5_000);
      const path = safePath(page.url());
      // Leave early once the SPA has clearly settled somewhere that is not
      // the IdP and not a callback.
      if (!/dev-iam|callback/i.test(page.url())) {
        log(`settled at ${page.url()}`);
        break;
      }
    }

    const finalUrl = page.url();
    const pwdStill = !!(await page.$('input[type="password"]'));
    log("──────── RESULT ────────");
    log(`final URL: ${finalUrl}`);
    log(`password input still visible: ${pwdStill}`);
    log(`page text (first 500 chars): ${(await documentText(page)).slice(0, 500)}`);
  } finally {
    await browser.close();
  }
}

function safePath(url: string): string {
  try { return new URL(url).pathname; } catch { return ""; }
}

async function documentText(page: import("playwright").Page): Promise<string> {
  try {
    return ((await page.evaluate(() => document.body?.innerText ?? "")) ?? "")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return "(text unavailable)";
  }
}

main().catch((err) => {
  process.stderr.write(`[debug-login] crashed: ${(err as Error).stack}\n`);
  process.exit(1);
});
