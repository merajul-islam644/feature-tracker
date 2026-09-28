// scripts/grab-token.mjs — extract a fresh bearer token from the user's
// logged-in browser. Used by:
//   • scripts/list-targets.mjs        (Claude's queue fetch at STEP 1)
//   • scripts/verify-<timestamp>.mjs  (runtime script for issue filing)
//
// Approach: Playwright launches a persistent context pointing at the
// user's default browser profile, reads the access_token cookie, returns
// the value, closes the context. The token is consumed by the caller;
// never logged, never written to disk.
//
// Multi-profile aware: Chrome's User Data dir usually has more than one
// profile ("Default", "Profile 1", "Profile 2", …) and one of them holds
// the app session. We enumerate every profile dir matching that pattern,
// launch a context against each in turn, and return the first
// `access_token` cookie we find. Zero config; works on any machine that
// has Chrome + a logged-in app session in any profile.
//
// Requirements:
//   • Chrome or Edge installed (Chromium-based browsers with profiles
//     on disk).
//   • User logged into the Lattice app at least once in that browser.
//   • Same browser CLOSED while the script runs (Chromium locks the
//     profile directory; running it concurrently with the user's open
//     Chrome throws EBUSY. Close Chrome first, run the script, reopen.)
//
// Env overrides:
//   • CHROME_USER_DATA_DIR — full path to the browser's User Data dir
//     (e.g. %LOCALAPPDATA%\Google\Chrome\User Data).
//   • CHROME_CHANNEL       — "chrome" (default) or "msedge".
//   • CHROME_PROFILE_DIR   — pin ONE profile (e.g. "Profile 16") to skip
//     the auto-scan. Use this once you've identified the right profile
//     and want subsequent runs to skip probing the others.

import { chromium } from "playwright";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { platform, homedir } from "node:os";

// ── Browser location discovery ────────────────────────────────────────────

function detectBrowser() {
  const override = process.env.CHROME_USER_DATA_DIR;
  if (override) {
    return {
      userDataDir: override,
      // Channel defaults to chrome; user can set CHROME_CHANNEL=msedge
      // to force Edge when pointing at a custom dir.
      channel: process.env.CHROME_CHANNEL === "msedge" ? "msedge" : "chrome",
      browser: process.env.CHROME_CHANNEL === "msedge" ? "Edge" : "Chrome",
    };
  }

  const p = platform();
  if (p === "win32") {
    const local = process.env.LOCALAPPDATA || "";
    const chrome = join(local, "Google", "Chrome", "User Data");
    const edge = join(local, "Microsoft", "Edge", "User Data");
    if (existsSync(chrome)) {
      return { userDataDir: chrome, channel: "chrome", browser: "Chrome" };
    }
    if (existsSync(edge)) {
      return { userDataDir: edge, channel: "msedge", browser: "Edge" };
    }
    return { userDataDir: chrome, channel: "chrome", browser: "Chrome" };
  }
  if (p === "darwin") {
    const chrome = join(homedir(), "Library", "Application Support", "Google", "Chrome");
    return { userDataDir: chrome, channel: "chrome", browser: "Chrome" };
  }
  const chrome = join(homedir(), ".config", "google-chrome");
  return { userDataDir: chrome, channel: "chrome", browser: "Chrome" };
}

// ── Profile discovery ──────────────────────────────────────────────────────

// Chrome profile dir names we recognize. Guests / system profiles are
// skipped — they hold no user login data.
const CHROME_PROFILE_RE = /^(Default|Profile\s\d+)$/;

function listBrowserProfiles(userDataDir) {
  if (!existsSync(userDataDir)) return [];
  return readdirSync(userDataDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && CHROME_PROFILE_RE.test(e.name))
    .map((e) => e.name);
}

function matchesAccessTokenCookie(c) {
  return (
    c.name === "access_token" ||
    c.name === "at" ||
    c.name.toLowerCase().includes("access_token")
  );
}

// ── Token grab ───────────────────────────────────────────────────────────

export async function getBearerToken() {
  const { userDataDir, channel, browser } = detectBrowser();

  // CHROME_PROFILE_DIR pins a single profile (skips the auto-scan).
  // Otherwise enumerate every Default / Profile<N> dir under User Data
  // and try them in turn — first hit with the cookie wins.
  const explicitProfile = process.env.CHROME_PROFILE_DIR;
  const profiles = explicitProfile
    ? [explicitProfile]
    : listBrowserProfiles(userDataDir);

  if (profiles.length === 0) {
    throw new Error(
      `No ${browser} profiles found at ${userDataDir}.\n` +
        `Either:\n` +
        `  • Install ${browser} and log into the app, then re-run.\n` +
        `  • Set CHROME_USER_DATA_DIR=<full path> for a portable install.`,
    );
  }

  for (const profile of profiles) {
    const profilePath = join(userDataDir, profile);
    if (!existsSync(profilePath)) continue;

    let context;
    try {
      context = await chromium.launchPersistentContext(profilePath, {
        headless: true,
        channel,
        args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // EBUSY = the user's browser is open and holds an exclusive lock
      // on this profile dir. No other profile in the same User Data dir
      // is reachable either (Chrome locks the user-data-dir globally),
      // so bail fast rather than spinning on the same lock for each.
      if (/EBUSY|resource busy|locked/i.test(msg)) {
        throw new Error(
          `Could not open ${browser} profile "${profile}" — it's locked.\n` +
            `Most likely ${browser} is currently running. CLOSE all ${browser}\n` +
            `windows, then re-run this script. The token is read from the\n` +
            `on-disk cookie store, which ${browser} holds an exclusive lock on\n` +
            `while it's running.`,
        );
      }
      console.warn(`[grab-token] ${profile}: launch failed (${msg}) — skipping`);
      continue;
    }

    try {
      const cookies = await context.cookies();
      const tokenCookie = cookies.find(matchesAccessTokenCookie);
      if (tokenCookie) {
        console.error(`✓ token from ${browser} profile: ${profile}`);
        return tokenCookie.value;
      }
    } finally {
      await context.close();
    }
  }

  // No profile held the cookie. Print what we tried so the user can
  // either log into the right one or pin a known-good profile.
  throw new Error(
    `Scanned ${profiles.length} ${browser} profile(s) — none has an access_token cookie.\n\n` +
      `Profiles tried:\n${profiles.map((p) => `  • ${p}`).join("\n")}\n\n` +
      `Log into the Lattice app in any of these profiles (cookies are set\n` +
      `on /login/callback), then re-run this script.\n` +
      `To pin a single profile in future runs, set\n` +
      `CHROME_PROFILE_DIR=<name> in .env (e.g. CHROME_PROFILE_DIR=Profile 16).`,
  );
}
