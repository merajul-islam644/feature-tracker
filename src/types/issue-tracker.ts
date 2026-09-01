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
