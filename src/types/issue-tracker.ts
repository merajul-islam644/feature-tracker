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
  | "performance";

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
    | "dismiss";
  payload?: Record<string, unknown>;
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
