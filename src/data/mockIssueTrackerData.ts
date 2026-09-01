// Centralized mock data for the Issue Tracker feature.
// Components must never hardcode business values — they all flow from here.

import type {
  ChatMessage,
  Issue,
  Secret,
  VerificationCheck,
  VerificationRun,
  VerificationTarget,
} from "@/types/issue-tracker";

// ────────────────────────────────────────────────────────────────────────────
//  Recommended verification scope (section 15)
// ────────────────────────────────────────────────────────────────────────────

export const verificationChecks: VerificationCheck[] = [
  { id: "page_load",      label: "Page Load",       description: "Pages respond and render without crashing.", recommended: true },
  { id: "navigation",     label: "Navigation",      description: "Links and routes reach their destinations.",  recommended: true },
  { id: "buttons",        label: "Buttons",         description: "Clickable controls trigger their handlers.",    recommended: true },
  { id: "forms",          label: "Forms",           description: "Inputs submit and validate correctly.",         recommended: true },
  { id: "broken_links",   label: "Broken Links",    description: "No anchor or asset links return 404.",           recommended: true },
  { id: "console_errors", label: "Console Errors",  description: "No uncaught errors logged to the browser console.", recommended: true },
  { id: "network_errors", label: "Network Errors",  description: "No failed XHR / fetch requests in critical paths.", recommended: true },
  { id: "authentication", label: "Authentication",  description: "Login / logout flows succeed with valid credentials.", recommended: true },
  { id: "accessibility",  label: "Accessibility",   description: "Basic a11y: labels, contrast, keyboard reach.", recommended: false },
  { id: "performance",    label: "Performance",     description: "Pages reach interactive under threshold.",      recommended: false },
];

// ────────────────────────────────────────────────────────────────────────────
//  Demo secrets — passwords intentionally masked. The real value lives only
//  in component state during the active session (see spec section 12.3).
// ────────────────────────────────────────────────────────────────────────────

export const mockSecrets: Secret[] = [
  {
    id: "secret-qa",
    name: "QA Account",
    email: "qa@example.com",
    passwordMasked: "••••••••••",
    createdAt: "2024-08-01T09:00:00.000Z",
    updatedAt: "2024-08-01T09:00:00.000Z",
  },
  {
    id: "secret-admin",
    name: "Admin Account",
    email: "admin@example.com",
    passwordMasked: "••••••••••",
    createdAt: "2024-08-02T09:00:00.000Z",
    updatedAt: "2024-08-02T09:00:00.000Z",
  },
];

// ────────────────────────────────────────────────────────────────────────────
//  Demo verification targets — one empty input is seeded so the user can
//  immediately add a URL (spec section 9.2).
// ────────────────────────────────────────────────────────────────────────────

export const mockTargets: VerificationTarget[] = [
  {
    id: "tgt-mailcraft",
    applicationName: "MailCraft",
    url: "https://mailcraft.example.com",
    environment: "production",
    credentialId: "secret-qa",
    enabled: true,
    lastVerifiedAt: "2024-08-28T16:00:00.000Z",
    lastStatus: "issues_found",
    createdAt: "2024-08-01T09:00:00.000Z",
    updatedAt: "2024-08-28T16:00:00.000Z",
  },
  {
    id: "tgt-iam",
    applicationName: "IAM",
    url: "https://iam.example.com",
    environment: "production",
    credentialId: "secret-admin",
    enabled: true,
    lastVerifiedAt: "2024-08-28T16:00:00.000Z",
    lastStatus: "issues_found",
    createdAt: "2024-08-02T09:00:00.000Z",
    updatedAt: "2024-08-28T16:00:00.000Z",
  },
  {
    id: "tgt-data-gateway",
    applicationName: "Data Gateway",
    url: "https://data.example.com",
    environment: "production",
    credentialId: null,
    enabled: true,
    lastVerifiedAt: "2024-08-28T16:05:00.000Z",
    lastStatus: "verification_failed",
    createdAt: "2024-08-03T09:00:00.000Z",
    updatedAt: "2024-08-28T16:05:00.000Z",
  },
];

// ────────────────────────────────────────────────────────────────────────────
//  Issues — covers all severities / statuses / categories (sections 21–26)
// ────────────────────────────────────────────────────────────────────────────

export const mockIssues: Issue[] = [
  {
    id: "ISSUE-001",
    title: "Login button not working",
    applicationName: "MailCraft",
    url: "/login",
    category: "authentication",
    severity: "high",
    status: "open",
    description: "Clicking the primary login button on /login does not submit the form.",
    expected: "User is authenticated and redirected to /inbox.",
    actual: "Nothing happens; no network request is observed.",
    reproductionSteps: [
      "Visit https://mailcraft.example.com/login",
      "Enter any valid email and password",
      "Click 'Sign in'",
    ],
    evidence: [
      { type: "screenshot", label: "Screenshot", value: "mock://issue-001.png" },
      { type: "console",    label: "Console",    value: "TypeError: Cannot read properties of undefined (reading 'submit')" },
      { type: "url",        label: "URL",        value: "https://mailcraft.example.com/login", timestamp: "2024-08-28T16:00:00.000Z" },
    ],
    detectedAt: "2024-08-28T16:00:00.000Z",
  },
  {
    id: "ISSUE-002",
    title: "API returns 500 on /projects",
    applicationName: "Data Gateway",
    url: "/api/projects",
    category: "api",
    severity: "critical",
    status: "open",
    description: "GET /api/projects returns a 500 error for authenticated users.",
    expected: "200 OK with the list of projects.",
    actual: "500 Internal Server Error after ~3s timeout.",
    evidence: [
      { type: "network", label: "Network", value: "GET /api/projects → 500 (3021 ms)" },
    ],
    detectedAt: "2024-08-28T16:05:00.000Z",
  },
  {
    id: "ISSUE-003",
    title: "Authentication failure on first attempt",
    applicationName: "IAM",
    url: "/sign-in",
    category: "authentication",
    severity: "critical",
    status: "confirmed",
    description: "First sign-in attempt always fails; second attempt succeeds.",
    reproductionSteps: [
      "Open an incognito window",
      "Visit /sign-in",
      "Submit credentials",
    ],
    detectedAt: "2024-08-28T15:55:00.000Z",
  },
  {
    id: "ISSUE-004",
    title: "Password reset link broken",
    applicationName: "MailCraft",
    url: "/reset-password",
    category: "authentication",
    severity: "high",
    status: "open",
    description: "Reset link in email results in 404 page.",
    detectedAt: "2024-08-28T15:30:00.000Z",
  },
  {
    id: "ISSUE-005",
    title: "Console error: undefined property 'theme'",
    applicationName: "MailCraft",
    url: "/settings",
    category: "ui",
    severity: "medium",
    status: "investigating",
    description: "Settings page logs a TypeError when the dark mode toggle is interacted with rapidly.",
    detectedAt: "2024-08-27T11:00:00.000Z",
  },
  {
    id: "ISSUE-006",
    title: "Sidebar collapses unexpectedly on resize",
    applicationName: "IAM",
    url: "/dashboard",
    category: "ui",
    severity: "medium",
    status: "open",
    description:
      "When the viewport is resized below 720px, the sidebar collapses and does not remember its expanded state.",
    detectedAt: "2024-08-27T10:30:00.000Z",
  },
  {
    id: "ISSUE-007",
    title: "Back navigation skips a step",
    applicationName: "MailCraft",
    url: "/inbox/compose",
    category: "navigation",
    severity: "medium",
    status: "open",
    description:
      "Pressing the browser back button from /inbox/compose jumps past the inbox list to /dashboard.",
    detectedAt: "2024-08-27T09:00:00.000Z",
  },
  {
    id: "ISSUE-008",
    title: "Form fields lose focus on validation error",
    applicationName: "IAM",
    url: "/profile",
    category: "forms",
    severity: "medium",
    status: "open",
    description:
      "When a validation error appears, focus jumps to the page header instead of staying on the offending input.",
    detectedAt: "2024-08-26T16:00:00.000Z",
  },
  {
    id: "ISSUE-009",
    title: "Avatar color contrast fails WCAG AA",
    applicationName: "MailCraft",
    url: "/profile",
    category: "accessibility",
    severity: "low",
    status: "open",
    description:
      "Default avatar background vs text contrast ratio measured at 3.2:1, below the 4.5:1 WCAG AA threshold.",
    detectedAt: "2024-08-26T14:00:00.000Z",
  },
  {
    id: "ISSUE-010",
    title: "Initial page load > 4s on slow network",
    applicationName: "Data Gateway",
    url: "/dashboard",
    category: "performance",
    severity: "low",
    status: "open",
    description:
      "Cold load on simulated 3G takes 4.3s before the dashboard is interactive.",
    detectedAt: "2024-08-26T12:00:00.000Z",
  },
  {
    id: "ISSUE-011",
    title: "Logout button missing aria-label",
    applicationName: "IAM",
    url: "/dashboard",
    category: "accessibility",
    severity: "low",
    status: "fixed",
    description:
      "Icon-only logout button had no accessible name. Resolved in release 2024.08.25.",
    detectedAt: "2024-08-25T09:00:00.000Z",
  },
  {
    id: "ISSUE-012",
    title: "Forbidden 403 on /admin for non-admin role",
    applicationName: "IAM",
    url: "/admin",
    category: "authorization",
    severity: "medium",
    status: "open",
    description:
      "Standard users receive a raw 403 page on /admin instead of a friendly access-denied screen.",
    detectedAt: "2024-08-25T08:00:00.000Z",
  },
];

// ────────────────────────────────────────────────────────────────────────────
//  Initial chat — seeded with the AI greeting only. User / assistant turns
//  are appended as the conversation progresses.
// ────────────────────────────────────────────────────────────────────────────

export const mockInitialChat: ChatMessage[] = [
  {
    id: "msg-seed-1",
    role: "assistant",
    content:
      "Hello! I'm the AI verification assistant. Tell me what you'd like to verify, configure, or review.",
    timestamp: new Date().toISOString(),
  },
];

// ────────────────────────────────────────────────────────────────────────────
//  Suggested prompts (section 7.3)
// ────────────────────────────────────────────────────────────────────────────

export const suggestedPrompts: string[] = [
  "Verify all applications",
  "Show critical issues",
  "Check MailCraft login flow",
  "Verify ISSUE-001 again",
  "What changed since the last verification?",
];

// ────────────────────────────────────────────────────────────────────────────
//  Idle verification run (no in-flight run when the page first loads)
// ────────────────────────────────────────────────────────────────────────────

export const idleRun: VerificationRun = {
  id: "run-idle",
  status: "idle",
  totalTargets: 0,
  completedTargets: 0,
  failedTargets: 0,
  perApp: [],
  currentActivity: [],
  scope: verificationChecks.filter((c) => c.recommended).map((c) => c.id),
};
