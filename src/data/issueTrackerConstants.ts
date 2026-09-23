// Static reference data for the Issue Tracker feature — labels, prompts,
// and the initial empty verification-run state.
//
// What lives here is NOT business data: verification checks (the menu of
// scopes the user can opt into), suggested chat prompts, the idle
// VerificationRun shape (used to seed `useState` before any run starts),
// and the AI greeting message that seeds a fresh conversation.
//
// Mutable data lives in the Blocks data collections instead — see
// `blocks/data/schemas/VerificationTarget.json`, `Secret.json`, and
// `Issue.json`. The frontend reads them through the hooks in
// `src/lib/blocks/hooks.ts` (useIssueTrackerTargets / -Secrets / -Issues)
// so a refresh, another device, or a second user never sees stale rows.

import type {
  ChatMessage,
  VerificationCheck,
  VerificationRun,
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
  { id: "all_functionality", label: "All Functionality", description: "Walks every reachable page and exercises links, buttons, and forms across the whole app.", recommended: false },
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
  "Verify https://example.com right now",
];

// ────────────────────────────────────────────────────────────────────────────
//  Initial chat — the AI greeting shown when a new session has no persisted
//  history. Mirrored on the server when the first assistant turn gets saved
//  (useAppendChatMessage fires for every assistant reply).
// ────────────────────────────────────────────────────────────────────────────

export const mockInitialChat: ChatMessage[] = [
  {
    id: "msg-seed-1",
    role: "assistant",
    content:
      "Hello! I'm the AI verification assistant. I can see your current targets, scope, and open issues — ask me anything, or tell me to make a change and I'll ask for your permission first.",
    timestamp: new Date().toISOString(),
  },
];

// ────────────────────────────────────────────────────────────────────────────
//  Idle verification run — the empty state shown in the header + progress
//  panels when no run is currently in flight. The `scope` field carries the
//  list of enabled VerificationCheckIds (initialised to the recommended
//  subset, matching the form's default toggles).
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
