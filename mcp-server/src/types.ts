// Wire-compatible mirror of src/types/issue-tracker.ts (frontend).
//
// Every event the MCP server emits must match a `kind` in this union
// exactly — otherwise the frontend's discriminated-union parser will
// drop events. Kept hand-rolled (no codegen) because the two repos are
// meant to stay independent; an out-of-band change here is a contract
// break and must be reflected in the frontend in the same patch.

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

export type IssueSeverity = "critical" | "high" | "medium" | "low";

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

export interface IssueEvidence {
  type: "screenshot" | "video" | "console" | "network" | "url" | "observation";
  label: string;
  value: string;
  timestamp?: string;
  storageRef?: string;
}

export interface Issue {
  id: string;
  title: string;
  applicationName: string;
  url: string;
  category: IssueCategory;
  severity: IssueSeverity;
  status: "open";
  description: string;
  expected?: string;
  actual?: string;
  reproductionSteps?: string[];
  evidence?: IssueEvidence[];
  detectedAt: string;
  verificationRunId?: string;
}

export type RunEvent =
  | {
      kind: "target_started";
      runId: string;
      targetId: string;
      applicationName: string;
    }
  | {
      kind: "target_progress";
      runId: string;
      targetId: string;
      step: string;
      done: boolean;
    }
  | {
      kind: "target_completed";
      runId: string;
      targetId: string;
      status: "passed" | "failed" | "issues_found";
    }
  | {
      kind: "issue_detected";
      runId: string;
      targetId: string;
      payload: Issue;
    }
  | {
      kind: "evidence";
      runId: string;
      targetId: string;
      storageRef: string;
      evidenceKind: "screenshot" | "log" | "network";
      issueId?: string;
    }
  | {
      kind: "run_completed";
      runId: string;
      completedAt: string;
      failedTargets: number;
    }
  | { kind: "run_failed"; runId: string; reason: string };

// Shapes posted in by the frontend (see issueTrackerApi.ts:startVerification).
export interface StartVerificationRequest {
  runId: string;
  userId: string;
  targets: Array<{
    id: string;
    applicationName: string;
    url: string;
    enabled: boolean;
    credentialId?: string | null;
  }>;
  scope: VerificationCheckId[];
}

export interface TestConnectionRequest {
  target: {
    id: string;
    applicationName: string;
    url: string;
    credentialId?: string | null;
  };
}

export interface TestConnectionResponse {
  urlReachable: boolean;
  loginSuccessful: boolean;
  durationMs: number;
  screenshotRef?: string;
  error?: string;
}

// Secrets API — the frontend's Secrets panel posts here; the MCP
// server owns the encrypted storage so the password never reaches
// localStorage. Matches the shape in src/types/issue-tracker.ts:Secret
// but with extra `hasPassword` and `length` so the panel can render
// the masked value without ever touching plaintext.
export interface SecretSummary {
  id: string;
  name: string;
  email: string;
  hasPassword: boolean;
  passwordLength: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSecretRequest {
  name: string;
  email: string;
  password: string;
}
