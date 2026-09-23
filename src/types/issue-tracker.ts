// Type definitions for the Issue Tracker feature.
// All shapes are intentionally self-contained — see src/types/Shemastructure/
// for the project's canonical data schemas (kept separate, not imported).

// ────────────────────────────────────────────────────────────────────────────
//  Enums
// ────────────────────────────────────────────────────────────────────────────

export type IssueSeverity = "critical" | "high" | "medium" | "low";

export type IssueStatus =
  | "open"
  | "investigating"
  | "confirmed"
  | "fixed"
  | "resolved"
  | "wont_fix"
  | "ignored"
  | "reopened";

export type IssueCategory =
  | "authentication"
  | "authorization"
  | "navigation"
  | "ui"
  | "functional"
  | "forms"
  | "api"
  | "performance"
  | "accessibility"
  | "other";

export type TargetEnvironment = "production" | "staging" | "development" | "preview";

export type TargetStatus =
  | "not_verified"
  | "queued"
  | "verifying"
  | "healthy"
  | "issues_found"
  | "verification_failed"
  | "authentication_failed"
  | "unreachable"
  | "completed";

export type VerificationRunStatus =
  | "idle"
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type ChatRole = "user" | "assistant" | "system";

// ────────────────────────────────────────────────────────────────────────────
//  Verification scope — each item is an opt-in check the AI Agent will run
// ────────────────────────────────────────────────────────────────────────────

export type VerificationCheckId =
  | "page_load"
  | "navigation"
  | "buttons"
  | "forms"
  | "broken_links"
  | "console_errors"
  | "network_errors"
  | "authentication"
  | "accessibility"
  | "performance"
  | "all_functionality";

export interface VerificationCheck {
  id: VerificationCheckId;
  label: string;
  description: string;
  recommended: boolean; // true = on by default
}

// ────────────────────────────────────────────────────────────────────────────
//  Verification target — one configured application URL
// ────────────────────────────────────────────────────────────────────────────

export interface VerificationTarget {
  id: string;
  applicationName: string;
  url: string;
  environment: TargetEnvironment;
  credentialId?: string | null;
  enabled: boolean;
  lastVerifiedAt?: string | null;
  lastStatus?: TargetStatus | null;
  createdAt: string;
  updatedAt: string;
}

// ────────────────────────────────────────────────────────────────────────────
//  Secret — credential the AI Agent can use to log into a target
//  Password is *never* persisted to localStorage in the frontend phase — see
//  section 12.3 of the spec. Kept in-memory only.
// ────────────────────────────────────────────────────────────────────────────

export interface Secret {
  id: string;
  name: string;
  email: string;
  // Masked display string only. The real value lives in component state for
  // the current session and is dropped on unmount / refresh.
  passwordMasked: string;
  createdAt: string;
  updatedAt: string;
}

// ────────────────────────────────────────────────────────────────────────────
//  Evidence — anything gathered during a verification step
// ────────────────────────────────────────────────────────────────────────────

export interface Evidence {
  type: "screenshot" | "video" | "console" | "network" | "url" | "observation";
  label: string;
  value: string; // text content or a data URI / placeholder
  timestamp?: string;
  // MCP step 7: when set, the backend stored the actual artifact under
  // this id; the viewer resolves it via `/api/evidence/:ref`. Used for
  // real MCP runs. Inline (data: URI) content still goes through `value`.
  storageRef?: string;
}

// ────────────────────────────────────────────────────────────────────────────
//  Issue — detected defect, shown in the issues section
// ────────────────────────────────────────────────────────────────────────────

export interface Issue {
  id: string;
  title: string;
  applicationName: string;
  url: string;
  category: IssueCategory;
  severity: IssueSeverity;
  status: IssueStatus;
  description: string;
  expected?: string;
  actual?: string;
  reproductionSteps?: string[];
  evidence?: Evidence[];
  detectedAt: string;
  verificationRunId?: string;
  // Dedup identity + recurrence stats. Absent on rows created before
  // fingerprinting landed — treat undefined occurrenceCount as "1 seen".
  fingerprint?: string;
  occurrenceCount?: number;
  lastSeenAt?: string;
  seenInRunIds?: string[];
  /** OIDC subs of the developers this issue is assigned to (multi-select dropdown). */
  assignedDeveloperIds?: string[];
  /** OIDC sub of the tester who manually re-tested and approved this
   *  issue. Undefined/empty = unapproved — only approved issues are
   *  assignable to developers. */
  approvedById?: string;
  // Future-ready linking into existing Project/Feature/Flow hierarchy
  projectId?: string;
  featureId?: string;
  flowId?: string;
}

// ────────────────────────────────────────────────────────────────────────────
//  Verification run — one execution of a verification job
// ────────────────────────────────────────────────────────────────────────────

export interface PerAppStatus {
  targetId: string;
  applicationName: string;
  status: TargetStatus;
  message?: string;
  startedAt?: string;
  completedAt?: string;
  // Transient per-app evidence rows gathered during a verification run.
  // Empty array means "no evidence yet"; missing field means "run hasn't
  // started". Renderer/UI treats both the same. Cleared when a new run
  // starts (the run reducer resets `perApp` in `idleRun`).
  evidence?: Evidence[];
}

export interface VerificationRun {
  id: string;
  status: VerificationRunStatus;
  totalTargets: number;
  completedTargets: number;
  failedTargets: number;
  startedAt?: string;
  completedAt?: string;
  perApp: PerAppStatus[];
  currentActivity: { step: string; done: boolean }[];
  scope: VerificationCheckId[];
  // Filled from the run's `test_plan` event — the concrete checks ×
  // targets matrix the agent announced at start.
  testPlan?: { checks: string[]; targets: Array<{ targetId: string; applicationName: string; url: string }> };
  // Filled from per-target `app_map` events — application name keyed to
  // its page → discovered-pages graph. Rendered as the tree panel.
  appMaps?: Record<string, Record<string, string[]>>;
}

// ────────────────────────────────────────────────────────────────────────────
//  Run activity line — one human-readable line of what the verification
//  agent is doing right now. Rendered as a live feed in the chat panel
//  (the "assistant is working" block) so the user can watch the run
//  progress inside the conversation instead of a single static
//  "Verification started." message. Ephemeral — never persisted.
// ────────────────────────────────────────────────────────────────────────────

export type RunActivityTone = "info" | "success" | "issue" | "error";

export interface RunActivityLine {
  id: number;
  text: string;
  tone: RunActivityTone;
}

// ────────────────────────────────────────────────────────────────────────────
//  Chat — AI Assistant message thread
// ────────────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: string;
  // Optional inline action buttons inside assistant responses (section 7.2)
  actions?: ChatAction[];
  // When the assistant emits a tool_use proposal, the full proposal is
  // stashed here so the renderer can show what was requested alongside
  // the human-readable summary. Mirrors Anthropic's `tool_use` content
  // block shape so callers don't have to keep a parallel structure.
  toolUse?: ToolUseBlock[];
  // In-chat widget attached to an assistant message. "verify-target"
  // renders the target picker (dropdown of configured URLs + a free-text
  // URL box) — used when the user asks to verify without naming a URL.
  // Local-only: never persisted, so a reloaded session shows the message
  // text without the widget.
  picker?: "verify-target";
}

export interface ChatAction {
  id: string;
  label: string;
  // Logical action that the page interprets (e.g. "start_verification",
  // "filter_issues", "verify_again").
  kind:
    | "start_verification"
    | "view_critical_issues"
    | "verify_again"
    | "filter_severity"
    | "dismiss"
    | "request_tool_permission";
  payload?: Record<string, unknown>;
}

// Mirror of Anthropic's `tool_use` content block. We don't pull the SDK
// into the frontend just for this; the shape is small enough to declare
// here. The renderer and the permission dispatcher both consume it.
export interface ToolUseBlock {
  id: string;
  name: string;
  // Tool parameters exactly as the model returned them. Schema-validated
  // by `chatTools.ts` at dispatch time, not here — keep this loose so a
  // newer model version that adds a field doesn't break the wire.
  input: Record<string, unknown>;
}

// The complete list of tool names the assistant may invoke. Keeping this
// as a union (instead of `string`) means a typo at the dispatch site
// fails the build instead of silently no-oping.
export type ChatToolName =
  | "toggle_verification_check"
  | "set_target_enabled"
  | "set_filters"
  | "start_verification"
  | "update_issue_status"
  | "open_target_in_browser"
  | "add_verification_target"
  | "update_verification_target"
  | "delete_verification_target"
  | "create_secret"
  | "update_secret"
  | "delete_secret"
  | "bind_secret"
  | "create_project"
  | "update_project"
  | "delete_project"
  | "add_project_environment"
  | "list_project_contents"
  | "create_feature"
  | "update_feature"
  | "delete_feature"
  | "create_flow"
  | "update_flow"
  | "delete_flow"
  | "verify_live_url";

// Anthropic `tools` array shape — declared here once so both the
// client payload and the proxy can speak the same vocabulary.
export interface AnthropicTool {
  // Static chat tools are union-typed (a typo fails the build). Browser
  // tools from the official Playwright MCP catalog arrive at RUNTIME from
  // the backend bridge, so the name also accepts arbitrary strings —
  // `(string & {})` keeps the union's autocomplete while staying open.
  name: ChatToolName | (string & {});
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ──────────────────────────────────────────────────────────────────────────
//  RunEvent — wire contract for the SSE stream the verification backend
//  pushes while a run is in flight. See prompt/Issue-Tracker-MCP-Design.md
//  §3.1 for the full design. Only the fields the frontend reads are typed;
//  anything else the backend sends is preserved under `extra` so we don't
//  have to update this union every time the agent gains a tool.
// ──────────────────────────────────────────────────────────────────────────

export type RunEvent =
  | { kind: "target_started"; runId: string; targetId: string; applicationName: string }
  | { kind: "target_progress"; runId: string; targetId: string; step: string; done: boolean }
  | {
      kind: "target_completed";
      runId: string;
      targetId: string;
      status: "passed" | "failed" | "issues_found";
    }
  | { kind: "issue_detected"; runId: string; targetId: string; payload: Issue }
  | {
      kind: "evidence";
      runId: string;
      targetId: string;
      storageRef: string;
      evidenceKind: "screenshot" | "log" | "network";
      // Most evidence is attached to a specific issue. When the backend
      // captures run-level evidence (e.g. the home page screenshot), it
      // omits this field.
      issueId?: string;
    }
  | {
      kind: "run_completed";
      runId: string;
      completedAt: string;
      failedTargets: number;
    }
  | {
      // Once per run, right after start: the concrete checks × targets
      // matrix the agent is about to execute. Rendered as the run's test
      // plan and included in the exported report.
      kind: "test_plan";
      runId: string;
      checks: string[];
      targets: Array<{ targetId: string; applicationName: string; url: string }>;
    }
  | {
      // End of a target's deep walk: every page visited mapped to the
      // same-origin pages discovered from it. Rendered as the application
      // map tree; the chat AI reasons over it for scoped follow-ups.
      kind: "app_map";
      runId: string;
      targetId: string;
      applicationName: string;
      pages: Record<string, string[]>;
    }
  | { kind: "run_failed"; runId: string; reason: string };

// ────────────────────────────────────────────────────────────────────────────
//  Chat session summary — derived from the persisted ChatMessage store. One
//  row per `sessionId` with at least one saved message.
// ────────────────────────────────────────────────────────────────────────────

export interface ChatSessionSummary {
  sessionId: string;
  // First user message in the session, truncated for display. Falls back to
  // the first assistant turn if the session somehow has no user input.
  title: string;
  // ISO timestamp of the most recent message in the session.
  lastActivity: string;
  messageCount: number;
}

// ────────────────────────────────────────────────────────────────────────────
//  Filters / search for the issues section
// ────────────────────────────────────────────────────────────────────────────

export type IssueSort = "newest" | "oldest" | "severity" | "application";

export interface IssueFilters {
  search: string;
  severities: IssueSeverity[]; // empty = all
  statuses: IssueStatus[];     // empty = all
  categories: IssueCategory[]; // empty = all
  application: string | null;  // null = all
  sort: IssueSort;
}
