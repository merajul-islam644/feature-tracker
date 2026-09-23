// One-off driver: logs into the Feature Tracker app (credential resolved
// from the encrypted store server-side — the password NEVER appears in
// logs, output, or an LLM context), then asks the app's chatbot to start
// verification, clicks Allow, and prints the live chat/activity feed so
// the whole "tell its AI to verify" flow is visible in the terminal.
//
//   npm --prefix mcp-server run drive:chat-verify

import { chromium } from "playwright";
import { listSecrets, resolveCredentialForTarget } from "../src/secrets.js";

const APP = "https://dbeegi.slsblx.com:5173/issue-tracker";
const EMAIL_HINT = process.argv[2] ?? "meraz-zoarder15";
const MESSAGE =
  "Start verification now — verify all enabled targets through login, All Functionality + Authentication. I want to watch it live.";

const line = (s: string) => process.stdout.write(`[drive] ${s}\n`);

async function main() {
  // Resolve credential without ever printing the password.
  const secret = listSecrets().find((s) => s.email.includes(EMAIL_HINT));
  if (!secret) throw new Error(`no secret matching ${EMAIL_HINT}`);
  const cred = resolveCredentialForTarget(secret.id);
  if (!cred) throw new Error("credential could not be decrypted");

  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();

  // ── Login (app redirects to IAM when the session is gone) ─────────────
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  if (/iam\.|\/login/i.test(page.url())) {
    // The app's own /login usually shows a trigger that starts the OIDC
    // hop; the IdP form only appears after clicking it. Handle both.
    let passwordField = page.locator('input[type="password"]').first();
    if (!(await passwordField.isVisible().catch(() => false))) {
      line("app login page — clicking the login trigger to reach the IdP…");
      const trigger = page
        .locator('a, button')
        .filter({ hasText: /log\s*in|sign\s*in/i })
        .first();
      await trigger.waitFor({ state: "visible", timeout: 30_000 });
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {}),
        trigger.click(),
      ]);
    }
    const email = page.locator('input[type="email"], input[name*="email" i], input[name*="user" i]').first();
    const password = page.locator('input[type="password"]').first();
    await email.waitFor({ state: "visible", timeout: 30_000 });
    await email.fill(cred.email);
    await password.fill(cred.password); // stays in this process only
    await Promise.all([
      page
        .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60_000 })
        .catch(() => {}),
      password.press("Enter"),
    ]);
    // OIDC hops: IdP → callback → app (sometimes a transient /login hop).
    for (let i = 0; i < 30 && !page.url().includes("/issue-tracker"); i++) {
      await page.waitForTimeout(2_000);
    }
    if (!page.url().includes("/issue-tracker")) await page.goto(APP);
  }
  line(`app ready: ${page.url()}`);

  // ── Seed: targets + credential ────────────────────────────────────────
  // Per-user targets/secrets live in Blocks Data collections, which can be
  // empty on a fresh dev environment — the chatbot refuses to start a run
  // with zero targets, so top them up through the app's own UI first (the
  // same forms a human would use). The password is resolved server-side
  // and only ever touched inside this process.
  const SEED_URLS = [
    "https://dbeegi.slsblx.com:5173",
    "https://dbeegi.slsblx.com:5173/issue-tracker",
  ];
  // UrlInput prefixes its id with "url-" — the add-target input's real
  // id is "url-draft" (VerificationTargets passes id="draft").
  await page.locator("#url-draft").waitFor({ state: "visible", timeout: 30_000 });
  // Let the Blocks Data queries settle: network idle + a buffer. The
  // Add URL button can't be used as a loading signal (it is disabled
  // whenever the draft is empty, by design), and the empty-state text
  // renders while the list is still loading — both made earlier runs
  // misread a populated list as empty and die on a duplicate-URL
  // disabled button.
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(3_000);
  // Target rows expose an "Edit <name>" button — the draft row doesn't,
  // so this counts real configured targets.
  const targetRows = page.locator('button[aria-label^="Edit "]');
  const existingTargets = await targetRows.count();
  if (existingTargets === 0) {
    // Fill → wait for the button to enable → click. If it never enables
    // the URL is a duplicate (target arrived late) — skip it.
    let added = 0;
    for (const url of SEED_URLS) {
      await page.locator("#url-draft").fill(url);
      const addBtn = page.getByRole("button", { name: "Add URL" });
      let ready = false;
      for (let i = 0; i < 10 && !ready; i++) {
        ready = await addBtn.isEnabled().catch(() => false);
        if (!ready) await page.waitForTimeout(500);
      }
      if (!ready) {
        line(`skipped ${url} — already configured or not addable`);
        continue;
      }
      await addBtn.click();
      await page.waitForTimeout(2_000);
      added++;
    }
    line(`seeded ${added} verification target(s)`);
  } else {
    line(`targets already configured (${existingTargets}) — skipping seed`);
  }

  const noSecrets = await page
    .getByText("No credentials configured", { exact: false })
    .isVisible()
    .catch(() => false);
  if (noSecrets) {
    await page.getByRole("button", { name: "+ Add Secret" }).click();
    await page.locator("#secret-name").fill("QA Account");
    await page.locator("#secret-email").fill(cred.email);
    await page.locator("#secret-password").fill(cred.password); // in-process only
    // Bind to the first configured target (option 0 is the "no binding"
    // sentinel).
    const optionCount = await page.locator("#secret-target option").count();
    if (optionCount > 1) {
      await page.locator("#secret-target").selectOption({ index: 1 });
    }
    await page.getByRole("button", { name: "Add Secret", exact: true }).click();
    await page.waitForTimeout(2_000);
    line(`seeded credential ${cred.email}${optionCount > 1 ? " (bound to first target)" : ""}`);
  } else {
    line("credential already configured — skipping seed");
  }

  // ── Ask the chatbot to verify ─────────────────────────────────────────
  const box = page.getByPlaceholder("Ask anything about your application…");
  await box.waitFor({ state: "visible", timeout: 30_000 });
  await box.fill(MESSAGE);
  await box.press("Enter");
  line("message sent — waiting for the assistant's permission card…");

  // Chat panel = the <aside> wrapping the chat surface. Snapshot its text
  // BEFORE granting permissions so the "✓ Done" lines each grant produces
  // are printed as new — they land within a second of the click, so a
  // snapshot taken after the wait-for-next-card loop would swallow them.
  const chat = page.locator("aside").first();
  let seen = new Set(((await chat.innerText().catch(() => "")) || "").split("\n"));
  const printNew = async (): Promise<string> => {
    const text = (await chat.innerText().catch(() => "")) || "";
    for (const l of text.split("\n")) {
      const t = l.trim();
      if (t && !seen.has(l)) {
        seen.add(l);
        if (/verify|verif|Done|Watch|pass|walk|Login|target|complete|issue|run |⚠|✓|■|●|▶/i.test(t)) {
          line(t.slice(0, 160));
        }
      }
    }
    return text;
  };

  // Grant up to 4 sequential permission cards (check toggles, then the
  // start-verification proposal). Each card's Allow button appears as the
  // live one; clicked ones relabel to "Allowed".
  for (let round = 1; round <= 4; round++) {
    const allow = page.locator("button", { hasText: /^Allow$/ }).first();
    try {
      await allow.waitFor({ state: "visible", timeout: 45_000 });
    } catch {
      break; // no more cards — the assistant answered with plain text
    }
    line(`Allow card #${round} found — clicking…`);
    await allow.click();
    await page.waitForTimeout(2_000);
    await printNew();
  }
  line("permissions granted — following the chat feed…");

  // The chatbot is single-shot per message: if the first turn only set up
  // scope/targets, it will NOT start a run by itself. Watch for a run
  // starting (~30s); if none does, send a follow-up that asks for the run
  // explicitly and grant whatever it proposes (up to 2 nudges).
  const FOLLOWUP =
    "Now start the live verification run for all enabled targets — All Functionality + Authentication checks. I want to watch it live.";
  for (let nudge = 0; nudge < 2; nudge++) {
    let started = false;
    for (let i = 0; i < 8 && !started; i++) {
      await page.waitForTimeout(4_000);
      started = /Live verification|Verification (started|running)|run [a-z0-9-]{6,}/i.test(
        await printNew(),
      );
    }
    if (started) {
      line("verification run detected — following it to completion…");
      break;
    }
    line(`no run yet — sending follow-up #${nudge + 1}…`);
    await box.fill(FOLLOWUP);
    await box.press("Enter");
    for (let round = 1; round <= 4; round++) {
      const allow = page.locator("button", { hasText: /^Allow$/ }).first();
      try {
        await allow.waitFor({ state: "visible", timeout: 30_000 });
      } catch {
        break;
      }
      line("Allow card (follow-up) — clicking…");
      await allow.click();
      await page.waitForTimeout(2_000);
      await printNew();
    }
  }

  // Follow the feed (permission confirmations, run progress, "✓ Done"
  // lines) until the run reports completion (~7 min budget).
  for (let i = 0; i < 100; i++) {
    await page.waitForTimeout(4_000);
    const text = await printNew();
    if (/Verification complete|run (completed|failed)/i.test(text)) break;
  }

  await browser.close();
  line("done — browser closed.");
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`[drive] failed: ${(err as Error).message}\n`);
  process.exit(1);
});
