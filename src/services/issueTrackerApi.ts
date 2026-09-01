// Frontend-only service abstraction for the Issue Tracker.
// Today every method returns a Promise that resolves to mock data. When the
// backend is ready, only the bodies of these functions need to change —
// components depend on this surface, not on the mock data directly.
//
// IMPORTANT: This file must never log credentials, never write secrets to
// localStorage, and never hardcode real passwords. See spec section 12.3.

import {
  mockIssues,
  mockSecrets,
  mockTargets,
  idleRun,
} from "@/data/mockIssueTrackerData";
import type {
  ChatMessage,
  ChatAction,
  Issue,
  Secret,
  VerificationRun,
  VerificationTarget,
} from "@/types/issue-tracker";

// ────────────────────────────────────────────────────────────────────────────
//  Targets
// ────────────────────────────────────────────────────────────────────────────

export const issueTrackerApi = {
  async getTargets(): Promise<VerificationTarget[]> {
    await delay(120);
    return [...mockTargets];
  },

  async addTarget(
    payload: Omit<VerificationTarget, "id" | "createdAt" | "updatedAt">,
  ): Promise<VerificationTarget> {
    await delay(120);
    const now = new Date().toISOString();
    const created: VerificationTarget = {
      ...payload,
      id: `tgt-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: now,
      updatedAt: now,
    };
    mockTargets.push(created);
    return created;
  },

  async removeTarget(id: string): Promise<void> {
    await delay(80);
    const idx = mockTargets.findIndex((t) => t.id === id);
    if (idx >= 0) mockTargets.splice(idx, 1);
  },

  async updateTarget(
    id: string,
    patch: Partial<VerificationTarget>,
  ): Promise<VerificationTarget> {
    await delay(80);
    const idx = mockTargets.findIndex((t) => t.id === id);
    if (idx < 0) throw new Error("Target not found");
    mockTargets[idx] = { ...mockTargets[idx], ...patch, updatedAt: new Date().toISOString() };
    return mockTargets[idx];
  },

  // ──────────────────────────────────────────────────────────────────────────
  //  Secrets
  // ──────────────────────────────────────────────────────────────────────────

  async getSecrets(): Promise<Secret[]> {
    await delay(120);
    return [...mockSecrets];
  },

  async addSecret(payload: { name: string; email: string; password: string }): Promise<Secret> {
    await delay(120);
    const now = new Date().toISOString();
    const created: Secret = {
      id: `secret-${Math.random().toString(36).slice(2, 8)}`,
      name: payload.name,
      email: payload.email,
      passwordMasked: "•".repeat(Math.min(10, Math.max(6, payload.password.length))),
      createdAt: now,
      updatedAt: now,
    };
    mockSecrets.push(created);
    // Real password is intentionally dropped — never persisted, never logged.
    return created;
  },

  async deleteSecret(id: string): Promise<void> {
    await delay(80);
    const idx = mockSecrets.findIndex((s) => s.id === id);
    if (idx >= 0) mockSecrets.splice(idx, 1);
  },

  // ──────────────────────────────────────────────────────────────────────────
  //  Issues
  // ──────────────────────────────────────────────────────────────────────────

  async getIssues(): Promise<Issue[]> {
    await delay(120);
    return [...mockIssues];
  },

  async updateIssueStatus(id: string, status: Issue["status"]): Promise<Issue> {
    await delay(80);
    const idx = mockIssues.findIndex((i) => i.id === id);
    if (idx < 0) throw new Error("Issue not found");
    mockIssues[idx] = { ...mockIssues[idx], status };
    return mockIssues[idx];
  },

  // ──────────────────────────────────────────────────────────────────────────
  //  Test connection (section 14)
  // ──────────────────────────────────────────────────────────────────────────

  async testConnection(target: VerificationTarget): Promise<{
    urlReachable: boolean;
    loginSuccessful: boolean;
  }> {
    await delay(900);
    // Deterministic mock — reachable if hostname looks valid.
    const reachable = /^https?:\/\//.test(target.url);
    return {
      urlReachable: reachable,
      loginSuccessful: reachable && !!target.credentialId,
    };
  },

  // ──────────────────────────────────────────────────────────────────────────
  //  Verification runs (sections 16, 19, 20)
  // ──────────────────────────────────────────────────────────────────────────

  async getCurrentRun(): Promise<VerificationRun> {
    await delay(80);
    return { ...idleRun };
  },

  async startVerification(targets: VerificationTarget[]): Promise<VerificationRun> {
    await delay(150);
    const now = new Date().toISOString();
    return {
      id: `run-${Math.random().toString(36).slice(2, 8)}`,
      status: "running",
      totalTargets: targets.length,
      completedTargets: 0,
      failedTargets: 0,
      startedAt: now,
      perApp: targets.map((t) => ({
        targetId: t.id,
        applicationName: t.applicationName,
        status: "queued",
      })),
      currentActivity: [
        { step: "Open application",          done: false },
        { step: "Check page load",           done: false },
        { step: "Authenticate",              done: false },
        { step: "Inspect navigation",        done: false },
        { step: "Detect UI issues",          done: false },
        { step: "Generate report",           done: false },
      ],
      scope: idleRun.scope,
    };
  },

  // ──────────────────────────────────────────────────────────────────────────
  //  Chat (section 7) — pattern-matches the user message and returns a
  //  canned reply plus optional inline actions.
  // ──────────────────────────────────────────────────────────────────────────

  async sendChatMessage(text: string): Promise<ChatMessage> {
    await delay(450);
    const lower = text.toLowerCase();
    const actions: ChatAction[] = [];

    let content: string;
    if (lower.includes("verify all")) {
      content = `I found ${mockTargets.length} configured applications:\n\n${mockTargets
        .map((t) => `• ${t.applicationName}`)
        .join("\n")}\n\nReady to start verification.`;
      actions.push({ id: "act-start", label: "Start Verification", kind: "start_verification" });
    } else if (lower.includes("critical")) {
      const critical = mockIssues.filter((i) => i.severity === "critical");
      content = `I found ${critical.length} critical issue${
        critical.length === 1 ? "" : "s"
      }:\n\n${critical.map((i, idx) => `${idx + 1}. ${i.title}`).join("\n")}`;
      actions.push({
        id: "act-critical",
        label: "View Critical Issues",
        kind: "view_critical_issues",
      });
    } else if (lower.match(/verify\s+issue-\d+/i)) {
      const match = text.match(/issue-\d+/i);
      const issueId = match?.[0].toUpperCase();
      const issue = mockIssues.find((i) => i.id === issueId);
      content = issue
        ? `Targeted verification started for ${issue.id}.\n\n✓ Issue located in mock store\n✓ Reproduction steps queued\n⟳ Running checks...`
        : `I couldn't find ${issueId ?? "that issue"} in the current issue list.`;
      if (issue) {
        actions.push({
          id: "act-again",
          label: "Verify Again",
          kind: "verify_again",
          payload: { issueId: issue.id },
        });
      }
    } else if (lower.includes("changed") || lower.includes("last verification")) {
      content = `Since the last verification:\n\n• 2 new issues detected\n• 1 issue marked fixed\n• 0 issues reopened`;
    } else {
      content = `I can help with that. Try one of the suggested prompts, or ask me about verification, issues, or configuration.`;
    }

    return {
      id: `msg-${Math.random().toString(36).slice(2, 8)}`,
      role: "assistant",
      content,
      timestamp: new Date().toISOString(),
      actions: actions.length ? actions : undefined,
    };
  },
};

// ────────────────────────────────────────────────────────────────────────────
//  Helpers
// ────────────────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
