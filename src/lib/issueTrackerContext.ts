// Compact, AI-safe snapshot of the Issue Tracker page state.
//
// The chatbot has no memory of what the user is looking at — it would
// otherwise have to ask "which checks did you select?" before answering
// any verification question. This module builds a small, deterministic
// JSON blob the proxy injects into the system prompt on every turn.
//
// Security: every field the assistant sees must come from this builder
// — it never accepts raw state. Passwords/tokens are NOT in this shape:
// the upstream `Secret` type only carries a masked display string today
// (see `useCreateSecret`), and we still keep the door closed by dropping
// any field we don't have an explicit reason to expose.

import type {
  ChatToolName,
  Issue,
  IssueFilters,
  IssueSeverity,
  IssueStatus,
  Secret,
  VerificationCheckId,
  VerificationRun,
  VerificationTarget,
} from "@/types/issue-tracker";
import type { Project } from "@/lib/blocks/data";
import { verificationChecks } from "@/data/issueTrackerConstants";

export interface IssueTrackerContextSnapshot {
  generatedAt: string;
  // Projects the signed-in user owns (compact). The assistant can create,
  // edit and delete projects via chat tools, so it needs the real ids to
  // resolve "rename the Blocks-Logic project" — same resolve-from-state
  // rule as targets/secrets. Description is truncated hard: it's context,
  // not content.
  projects: Array<{
    id: string;
    name: string;
    status: string;
    description?: string;
  }>;
  targets: Array<{
    id: string;
    applicationName: string;
    url: string;
    enabled: boolean;
    lastStatus: VerificationTarget["lastStatus"];
    hasCredential: boolean;
    // Name of the secret currently bound to this target, if any. The AI
    // uses this to answer "which secret does X use?" questions without
    // having to cross-reference the secrets[] list itself.
    boundSecretName?: string | null;
  }>;
  secrets: Array<{
    id: string;
    name: string;
    email: string;
    // Name of the target this secret is currently bound to, if any. Lets
    // the AI answer "which target uses this credential?" without scanning
    // the targets[] list itself.
    boundToTargetName?: string | null;
  }>;
  issues: Array<{
    id: string;
    title: string;
    severity: IssueSeverity;
    status: IssueStatus;
    category: Issue["category"];
    applicationName: string;
    detectedAt: string;
    // Recurrence info from fingerprint dedup — lets the assistant answer
    // "is this the same bug again?" without guessing from titles.
    occurrenceCount?: number;
    lastSeenAt?: string;
  }>;
  scope: {
    enabled: VerificationCheckId[];
    available: VerificationCheckId[];
    labels: Record<VerificationCheckId, string>;
  };
  run: {
    status: VerificationRun["status"];
    totalTargets: number;
    completedTargets: number;
    failedTargets: number;
    startedAt?: string;
    completedAt?: string;
    // Checks × targets matrix the agent announced at run start, when the
    // backend sent one — lets the assistant answer "what did you test?"
    // from state instead of guessing from the scope list.
    testPlan?: {
      checks: string[];
      targets: Array<{ applicationName: string; url: string }>;
    };
  };
  // Application map from the latest run's deep walks — application name →
  // page → discovered pages (URLs trimmed to origin-relative paths so the
  // prompt stays small). The assistant uses this to scope follow-ups
  // ("only test the /app/console pages") without re-crawling.
  appMap?: Record<string, Record<string, string[]>>;
  filters: {
    severities: IssueSeverity[];
    statuses: IssueStatus[];
    categories: Issue["category"][];
    application: string | null;
    search: string;
  };
  counts: {
    totalIssues: number;
    openIssues: number;
    enabledTargets: number;
    enabledChecks: number;
  };
}

export function buildIssueTrackerContext(input: {
  targets: VerificationTarget[];
  secrets: Secret[];
  issues: Issue[];
  scope: VerificationCheckId[];
  run: VerificationRun;
  filters: IssueFilters;
  projects?: Project[];
}): IssueTrackerContextSnapshot {
  const { targets, secrets, issues, scope, run, filters, projects } = input;
  const labelMap = Object.fromEntries(
    verificationChecks.map((c) => [c.id, c.label]),
  ) as Record<VerificationCheckId, string>;

  // Drop the verbose `evidence` payload from issues — the assistant
  // doesn't render screenshots, and the wire would balloon the prompt
  // with base64 data.
  const compactIssues = issues.slice(0, 50).map((i) => ({
    id: i.id,
    title: i.title,
    severity: i.severity,
    status: i.status,
    category: i.category,
    applicationName: i.applicationName,
    detectedAt: i.detectedAt,
    occurrenceCount: i.occurrenceCount,
    lastSeenAt: i.lastSeenAt,
  }));

  return {
    generatedAt: new Date().toISOString(),
    projects: (projects ?? []).slice(0, 30).map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status ?? "active",
      description: p.description?.slice(0, 80),
    })),
    targets: targets.map((t) => ({
      id: t.id,
      applicationName: t.applicationName,
      url: t.url,
      enabled: t.enabled,
      lastStatus: t.lastStatus,
      hasCredential: !!t.credentialId,
      boundSecretName: t.credentialId
        ? secrets.find((s) => s.id === t.credentialId)?.name ?? null
        : null,
    })),
    secrets: secrets.map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      boundToTargetName: (() => {
        const owner = targets.find((t) => t.credentialId === s.id);
        return owner?.applicationName ?? null;
      })(),
    })),
    issues: compactIssues,
    scope: {
      enabled: scope,
      available: verificationChecks.map((c) => c.id),
      labels: labelMap,
    },
    run: {
      status: run.status,
      totalTargets: run.totalTargets,
      completedTargets: run.completedTargets,
      failedTargets: run.failedTargets,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      testPlan: run.testPlan
        ? {
            checks: run.testPlan.checks,
            targets: run.testPlan.targets.map((t) => ({
              applicationName: t.applicationName,
              url: t.url,
            })),
          }
        : undefined,
    },
    appMap:
      run.appMaps && Object.keys(run.appMaps).length > 0
        ? Object.fromEntries(
            Object.entries(run.appMaps).map(([app, pages]) => [
              app,
              // Same trim as the tree panel: keep paths readable and the
              // prompt bounded (cap the graph at 60 pages per app).
              Object.fromEntries(
                Object.entries(pages)
                  .slice(0, 60)
                  .map(([from, tos]) => [
                    trimUrl(from),
                    tos.slice(0, 20).map(trimUrl),
                  ]),
              ),
            ]),
          )
        : undefined,
    filters: {
      severities: filters.severities,
      statuses: filters.statuses,
      categories: filters.categories,
      application: filters.application,
      search: filters.search,
    },
    counts: {
      totalIssues: issues.length,
      openIssues: issues.filter(
        (i) =>
          i.status === "open" ||
          i.status === "investigating" ||
          i.status === "reopened",
      ).length,
      enabledTargets: targets.filter((t) => t.enabled).length,
      enabledChecks: scope.length,
    },
  };
}

// Render the snapshot as a stable, deterministic text block the proxy
// drops into the system prompt. JSON.stringify gives us readable text
// for any model version (the upstream API also accepts a structured
// system block — but the plain-text path works on more providers and
// is easier to debug from a log line).
export function renderContextForSystemPrompt(
  ctx: IssueTrackerContextSnapshot,
): string {
  return "CURRENT STATE:\n" + JSON.stringify(ctx, null, 2);
}

function trimUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + (u.search || "");
  } catch {
    return url;
  }
}

// Quick lookup for the renderer when summarising a tool_use proposal
// ("toggle off the Forms check" needs the human label, not the id).
export function checkLabel(id: VerificationCheckId): string {
  return verificationChecks.find((c) => c.id === id)?.label ?? id;
}

// Re-exported for convenience — callers shouldn't have to reach into
// the types module just to declare a tool name.
export type { ChatToolName };
