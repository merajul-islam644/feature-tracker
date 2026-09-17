// Single state hook that owns the Issue Tracker UI state. Components consume
// narrow selectors from here so we don't re-render the whole page when one
// slice changes (spec section 39).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { issueTrackerApi } from "@/services/issueTrackerApi";
import { mockInitialChat, idleRun } from "@/data/mockIssueTrackerData";
import { useToast } from "@/hooks/useToast";
import { useAuth } from "@/hooks/useAuth";
import {
  useAppendChatMessage,
  useChatHistory,
  useChatSessions,
} from "@/lib/blocks/hooks";
import type {
  ChatMessage,
  Evidence,
  Issue,
  IssueFilters,
  RunEvent,
  Secret,
  TargetStatus,
  VerificationCheckId,
  VerificationRun,
  VerificationTarget,
} from "@/types/issue-tracker";

// Default filter: nothing selected = show everything.
const defaultFilters: IssueFilters = {
  search: "",
  severities: [],
  statuses: [],
  categories: [],
  application: null,
  sort: "newest",
};

export function useIssueTracker() {
  const toast = useToast();
  const { currentUser } = useAuth();

  // Per-user session storage key. Survives refreshes so the user lands back
  // in the conversation they were in. Keyed by user id so a sign-out /
  // sign-in cycle doesn't bleed one user's session into another's.
  const sessionStorageKey = currentUser
    ? `issue-tracker:active-session:${currentUser.id}`
    : null;

  // Default session id: a stable per-user string for first-time visitors.
  // Matches the previous behaviour exactly so anyone upgrading doesn't lose
  // their existing chat. New sessions spin off a UUID from this prefix.
  const defaultSessionId = currentUser
    ? `issue-tracker:${currentUser.id}`
    : "issue-tracker:anon";

  const [sessionId, setSessionId] = useState<string>(() => {
    if (!sessionStorageKey) return defaultSessionId;
    try {
      const stored = window.localStorage.getItem(sessionStorageKey);
      return stored && stored.length > 0 ? stored : defaultSessionId;
    } catch {
      // Private mode / disabled storage — fall back silently.
      return defaultSessionId;
    }
  });

  // Persist on every change. Effects run after render, so the UI sees the
  // new id first; the next tick the localStorage copy catches up.
  useEffect(() => {
    if (!sessionStorageKey) return;
    try {
      window.localStorage.setItem(sessionStorageKey, sessionId);
    } catch {
      /* ignore — best-effort */
    }
  }, [sessionId, sessionStorageKey]);

  // ──────────────────────────────────────────────────────────────────────────
  //  Core data
  // ──────────────────────────────────────────────────────────────────────────
  const [targets, setTargets] = useState<VerificationTarget[]>([]);
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [run, setRun] = useState<VerificationRun>(idleRun);
  const [scope, setScope] = useState<VerificationCheckId[]>(idleRun.scope);

  // Chat
  const [chat, setChat] = useState<ChatMessage[]>(mockInitialChat);
  const [sendingMessage, setSendingMessage] = useState(false);
  // Reset when the active session changes — the hydration effect below
  // re-runs and pulls messages for `sessionId`.
  const [chatLoaded, setChatLoaded] = useState(false);
  const chatHistoryQuery = useChatHistory(sessionId);
  const chatSessionsQuery = useChatSessions();
  const appendChatMessage = useAppendChatMessage();

  // UI state
  const [filters, setFilters] = useState<IssueFilters>(defaultFilters);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [testingTargetId, setTestingTargetId] = useState<string | null>(null);

  // Loading flags (section 41)
  const [loading, setLoading] = useState({
    targets: true,
    issues: true,
    secrets: true,
    run: false,
  });

  // ──────────────────────────────────────────────────────────────────────────
  //  Initial load
  // ──────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      issueTrackerApi.getTargets(),
      issueTrackerApi.getSecrets(),
      issueTrackerApi.getIssues(),
    ])
      .then(([t, s, i]) => {
        if (cancelled) return;
        setTargets(t);
        setSecrets(s);
        setIssues(i);
        setLoading((l) => ({ ...l, targets: false, secrets: false, issues: false }));
      })
      .catch(() => {
        if (cancelled) return;
        setLoading((l) => ({ ...l, targets: false, secrets: false, issues: false }));
        toast.error("Unable to load Issue Tracker data.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset the hydration flag whenever the active session changes — the
  // effect below then re-pulls the messages for the new session.
  useEffect(() => {
    setChatLoaded(false);
  }, [sessionId]);

  // Load persisted chat history once we have a session id. If the store has
  // anything for this session, replace the seed greeting with the real
  // conversation; if not, keep the greeting and start fresh.
  useEffect(() => {
    if (!sessionId || chatLoaded) return;
    if (chatHistoryQuery.isLoading) return;
    if (chatHistoryQuery.error) {
      // Don't block the UI on a failed history fetch — fall back to seed.
      setChatLoaded(true);
      return;
    }
    const persisted = chatHistoryQuery.data ?? [];
    if (persisted.length > 0) {
      // Hydrate from the store. The greeting is NOT re-prepended — the
      // persisted thread already stands on its own.
      setChat(
        persisted.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
          actions: m.actions as ChatMessage["actions"],
        })),
      );
    } else if (chat.length !== 1 || chat[0]?.id !== mockInitialChat[0].id) {
      // Switching to an empty session — reset the panel to the seed
      // greeting. Don't touch the greeting if it's already showing; that
      // would blank the UI on the first hydration attempt for a fresh
      // session.
      setChat(mockInitialChat);
    }
    setChatLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, chatHistoryQuery.isLoading, chatHistoryQuery.data, chatHistoryQuery.error]);

  // ──────────────────────────────────────────────────────────────────────────
  //  Targets
  // ──────────────────────────────────────────────────────────────────────────
  const addTarget = useCallback(
    async (payload: { url: string; applicationName?: string; credentialId?: string | null }) => {
      try {
        const created = await issueTrackerApi.addTarget({
          url: payload.url,
          applicationName: payload.applicationName ?? deriveNameFromUrl(payload.url),
          environment: "production",
          credentialId: payload.credentialId ?? null,
          enabled: true,
          lastVerifiedAt: null,
          lastStatus: null,
        });
        setTargets((cur) => [...cur, created]);
        toast.success("URL added successfully.");
        return created;
      } catch {
        toast.error("Unable to add URL.");
        throw new Error("add_failed");
      }
    },
    [toast],
  );

  const removeTarget = useCallback(
    async (id: string) => {
      try {
        await issueTrackerApi.removeTarget(id);
        setTargets((cur) => cur.filter((t) => t.id !== id));
        toast.success("URL removed.");
      } catch {
        toast.error("Unable to remove URL.");
      }
    },
    [toast],
  );

  // Flip the per-target `enabled` flag. Optimistically updates local state so
  // the toggle reflects instantly; the API call is fire-and-forget — a
  // failure rolls back and surfaces a toast.
  const setTargetEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      const previous = targets.find((t) => t.id === id);
      if (!previous) return;
      setTargets((cur) =>
        cur.map((t) => (t.id === id ? { ...t, enabled } : t)),
      );
      try {
        await issueTrackerApi.updateTarget(id, { enabled });
      } catch {
        setTargets((cur) =>
          cur.map((t) => (t.id === id ? { ...t, enabled: previous.enabled } : t)),
        );
        toast.error(`Unable to update ${previous.applicationName}.`);
      }
    },
    [targets, toast],
  );

  // ──────────────────────────────────────────────────────────────────────────
  //  Secrets — the *real* password never reaches state. The form holds it
  //  locally while open; `issueTrackerApi.addSecret` strips it before
  //  persisting, and the API returns only a masked display value.
  // ──────────────────────────────────────────────────────────────────────────

  const addSecret = useCallback(
    async (payload: { name: string; email: string; password: string }) => {
      try {
        const created = await issueTrackerApi.addSecret(payload);
        setSecrets((cur) => [...cur, created]);
        toast.success("Credential added successfully.");
        return created;
      } catch {
        toast.error("Unable to add credential.");
        throw new Error("add_failed");
      }
    },
    [toast],
  );

  const deleteSecret = useCallback(
    async (id: string) => {
      try {
        await issueTrackerApi.deleteSecret(id);
        setSecrets((cur) => cur.filter((s) => s.id !== id));
        toast.success("Credential removed.");
      } catch {
        toast.error("Unable to remove credential.");
      }
    },
    [toast],
  );

  // ──────────────────────────────────────────────────────────────────────────
  //  Issues
  // ──────────────────────────────────────────────────────────────────────────
  const updateIssueStatus = useCallback(
    async (id: string, status: Issue["status"]) => {
      try {
        const updated = await issueTrackerApi.updateIssueStatus(id, status);
        setIssues((cur) => cur.map((i) => (i.id === id ? updated : i)));
        toast.success("Issue updated.");
      } catch {
        toast.error("Unable to update issue.");
      }
    },
    [toast],
  );

  const filteredIssues = useMemo(() => applyFilters(issues, filters), [issues, filters]);
  const groupedIssues = useMemo(() => groupByApplication(filteredIssues), [filteredIssues]);

  const issueCounts = useMemo(
    () => ({
      total: issues.length,
      critical: issues.filter((i) => i.severity === "critical").length,
      high: issues.filter((i) => i.severity === "high").length,
      medium: issues.filter((i) => i.severity === "medium").length,
      low: issues.filter((i) => i.severity === "low").length,
      open: issues.filter((i) => i.status === "open" || i.status === "investigating" || i.status === "reopened").length,
    }),
    [issues],
  );

  // Compact string the header pill and verification tile both consume.
  // `null` means "no completed run yet" — UI hides the badge in that case.
  const lastRunAgo = lastCompletedRun(run);

  // ──────────────────────────────────────────────────────────────────────────
  //  Test connection (section 14)
  // ──────────────────────────────────────────────────────────────────────────
  const testConnection = useCallback(
    async (target: VerificationTarget) => {
      setTestingTargetId(target.id);
      try {
        const result = await issueTrackerApi.testConnection(target);
        if (result.urlReachable && result.loginSuccessful) {
          toast.success(`${target.applicationName}: URL reachable, login successful.`);
        } else if (!result.urlReachable) {
          toast.error(`${target.applicationName}: unable to reach URL.`);
        } else {
          toast.error(`${target.applicationName}: authentication failed.`);
        }
      } finally {
        setTestingTargetId(null);
      }
    },
    [toast],
  );

  // ──────────────────────────────────────────────────────────────────────────
  //  Verification runs
  // ──────────────────────────────────────────────────────────────────────────
  //
  // MCP step 2: when the flag is on, run progress arrives via SSE
  // (`issueTrackerApi.subscribeRun`) instead of the local mock driver.
  // Either way the `setRun` reducer is the single sink — UI consumers
  // don't care which side drove the transition. We hold the unsubscribe
  // in a ref so `stopVerification` can tear the stream down cleanly.
  const unsubscribeRunRef = useRef<(() => void) | null>(null);

  const applyRunEvent = useCallback((event: RunEvent) => {
    switch (event.kind) {
      // ── Run-level lifecycle ─────────────────────────────────────────
      case "run_completed":
        setRun((r) => ({
          ...r,
          status: "completed",
          completedAt: event.completedAt,
          failedTargets: event.failedTargets,
        }));
        unsubscribeRunRef.current?.();
        unsubscribeRunRef.current = null;
        toast.success("Verification complete.");
        break;
      case "run_failed":
        setRun((r) => ({
          ...r,
          status: "cancelled",
          completedAt: new Date().toISOString(),
        }));
        unsubscribeRunRef.current?.();
        unsubscribeRunRef.current = null;
        toast.error(`Verification failed: ${event.reason}`);
        break;

      // ── Per-target progress (MCP step 5) ─────────────────────────────
      case "target_started":
        setRun((r) => ({
          ...r,
          perApp: r.perApp.map((p) =>
            p.targetId === event.targetId
              ? { ...p, status: "verifying", startedAt: new Date().toISOString() }
              : p,
          ),
        }));
        break;

      case "target_progress":
        // `step` is one of the canonical activity labels from the backend.
        // If it matches an existing entry, flip its `done` flag; otherwise
        // append a new entry. Same shape `driveMockRun` produces, so the
        // existing CurrentActivity UI renders both streams identically.
        setRun((r) => {
          const existing = r.currentActivity.find((a) => a.step === event.step);
          if (existing) {
            return {
              ...r,
              currentActivity: r.currentActivity.map((a) =>
                a.step === event.step ? { ...a, done: event.done } : a,
              ),
            };
          }
          return {
            ...r,
            currentActivity: [...r.currentActivity, { step: event.step, done: event.done }],
          };
        });
        break;

      case "target_completed": {
        // Map the backend's passed/failed/issues_found tri-state onto the
        // UI's TargetStatus enum. The component-level StatusPill in
        // VerificationTargets already renders each one with its own tone.
        const status = mapTargetCompletionStatus(event.status);
        const isFailure = status === "verification_failed";
        setRun((r) => ({
          ...r,
          completedTargets: r.completedTargets + 1,
          failedTargets: r.failedTargets + (isFailure ? 1 : 0),
          perApp: r.perApp.map((p) =>
            p.targetId === event.targetId
              ? { ...p, status, completedAt: new Date().toISOString() }
              : p,
          ),
        }));
        // Mirror the result onto the target itself so the row in
        // VerificationTargets picks it up on next render.
        setTargets((cur) =>
          cur.map((t) =>
            t.id === event.targetId
              ? {
                  ...t,
                  lastStatus: status,
                  lastVerifiedAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                }
              : t,
          ),
        );
        break;
      }

      // ── Findings (MCP step 5) ───────────────────────────────────────
      case "issue_detected":
        // Optimistic local insert. The Blocks collection query (in
        // useChatHistory etc.) will refresh on its own cadence, but the
        // issue list should reflect new findings immediately.
        setIssues((cur) => {
          if (cur.some((i) => i.id === event.payload.id)) return cur;
          return [{ ...event.payload, verificationRunId: event.runId }, ...cur];
        });
        toast.info(`Issue detected: ${event.payload.title}`);
        break;

      case "evidence":
        // Attach the evidence to the issue it belongs to. When the
        // backend omits issueId, the evidence is run-level — we still
        // store it on the issue list as the "no-issue" case so the
        // user can review it. The display is driven by EvidenceViewer.
        setIssues((cur) =>
          cur.map((issue) => {
            const target = event.issueId
              ? issue.id === event.issueId
              : issue.verificationRunId === event.runId;
            if (!target) return issue;
            const ev: Evidence = {
              type: event.evidenceKind === "screenshot" ? "screenshot" : "url",
              label: event.evidenceKind,
              // MCP step 7: keep the storageRef separate from `value` so
              // the viewer can distinguish "resolve me via /api/evidence"
              // (storageRef set, value empty) from "inline content" (data
              // URI in value). The wire shape is the same.
              value: "",
              storageRef: event.storageRef,
              timestamp: new Date().toISOString(),
            };
            return {
              ...issue,
              evidence: [...(issue.evidence ?? []), ev],
            };
          }),
        );
        break;

      default: {
        // Exhaustiveness check — TS will flag a missing case here.
        const _exhaustive: never = event;
        void _exhaustive;
      }
    }
  }, [toast]);

  const startVerification = useCallback(async () => {
    setLoading((l) => ({ ...l, run: true }));
    try {
      const enabled = targets.filter((t) => t.enabled);
      const fresh = await issueTrackerApi.startVerification(enabled);
      setRun(fresh);
      toast.success("Verification started.");

      // Always tear down any leftover subscription before opening a new one.
      unsubscribeRunRef.current?.();
      unsubscribeRunRef.current = null;

      // Try the real stream first when the flag is on. The proxy returns
      // 503 (or the EventSource errors immediately) if the backend isn't
      // wired up — in that case we fall through to the local mock so the
      // demo still animates.
      let subscribed = false;
      if (import.meta.env.VITE_USE_REAL_VERIFY === "1") {
        unsubscribeRunRef.current = issueTrackerApi.subscribeRun(fresh.id, {
          onEvent: applyRunEvent,
          onError: () => {
            // Stream went away — leave the run state as-is (the user can
            // still pause/stop locally) and stop trying.
            unsubscribeRunRef.current?.();
            unsubscribeRunRef.current = null;
          },
        });
        subscribed = true;
      }
      if (!subscribed) {
        driveMockRun(fresh, setRun, setIssues, () => {
          toast.success("Verification complete.");
        });
      }
    } catch {
      toast.error("Unable to start verification.");
    } finally {
      setLoading((l) => ({ ...l, run: false }));
    }
  }, [targets, toast, applyRunEvent]);

  const pauseVerification = useCallback(() => {
    setRun((r) => (r.status === "running" ? { ...r, status: "paused" } : r));
  }, []);

  const resumeVerification = useCallback(() => {
    setRun((r) => (r.status === "paused" ? { ...r, status: "running" } : r));
  }, []);

  const stopVerification = useCallback(() => {
    unsubscribeRunRef.current?.();
    unsubscribeRunRef.current = null;
    setRun((r) => ({ ...r, status: "cancelled", completedAt: new Date().toISOString() }));
    toast.info("Verification cancelled.");
  }, [toast]);

  // Clean up any open SSE subscription on unmount so we don't leak.
  useEffect(() => {
    return () => {
      unsubscribeRunRef.current?.();
      unsubscribeRunRef.current = null;
    };
  }, []);

  // ──────────────────────────────────────────────────────────────────────────
  //  Chat session controls
  // ──────────────────────────────────────────────────────────────────────────

  // Spin up a brand-new conversation. The current chat contents are simply
  // abandoned in the UI; their persisted messages stay in the store under
  // the previous sessionId and surface in History.
  const startNewSession = useCallback(() => {
    const userPart = currentUser?.id ?? "anon";
    const next = `issue-tracker:${userPart}:${cryptoUuid()}`;
    setSessionId(next);
    // Seed the new session with the greeting immediately so the panel
    // doesn't flash empty during the history fetch for an unused session.
    setChat(mockInitialChat);
    setChatLoaded(true);
  }, [currentUser?.id]);

  // Switch to an existing conversation. The hydration effect picks this up
  // via the sessionId dep and re-runs.
  const switchSession = useCallback((next: string) => {
    if (!next || next === sessionId) return;
    setSessionId(next);
  }, [sessionId]);

  // ──────────────────────────────────────────────────────────────────────────
  //  Chat
  // ──────────────────────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const userMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: "user",
        content: trimmed,
        timestamp: new Date().toISOString(),
      };
      setChat((cur) => [...cur, userMsg]);
      // Persist the user turn immediately so a network blip on the AI reply
      // doesn't lose the question. Failures are silently swallowed — the
      // local state already has the message.
      void appendChatMessage.mutateAsync({
        sessionId,
        role: "user",
        content: trimmed,
      }).catch(() => {});
      setSendingMessage(true);
      try {
        const reply = await issueTrackerApi.sendChatMessage(trimmed);
        setChat((cur) => [...cur, reply]);
        void appendChatMessage.mutateAsync({
          sessionId,
          role: reply.role,
          content: reply.content,
          actions: reply.actions,
        }).catch(() => {});
      } catch {
        toast.error("Unable to send message.");
      } finally {
        setSendingMessage(false);
      }
    },
    [toast, sessionId, appendChatMessage],
  );

  const applyChatAction = useCallback(
    async (action: ChatMessage["actions"] extends (infer A)[] | undefined ? A : never) => {
      if (!action) return;
      switch (action.kind) {
        case "start_verification":
          await startVerification();
          break;
        case "view_critical_issues":
          setFilters((f) => ({ ...f, severities: ["critical"] }));
          break;
        case "verify_again": {
          const issueId = action.payload?.issueId as string | undefined;
          if (!issueId) break;
          setSelectedIssueId(null);
          toast.info(`Re-running verification for ${issueId}…`);
          break;
        }
        case "filter_severity":
          setFilters((f) => ({ ...f, severities: [action.payload?.severity as never] }));
          break;
        case "dismiss":
        default:
          break;
      }
    },
    [startVerification, toast],
  );

  // ──────────────────────────────────────────────────────────────────────────
  //  Scope
  // ──────────────────────────────────────────────────────────────────────────
  const toggleScope = useCallback((id: VerificationCheckId) => {
    setScope((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
  }, []);

  // ──────────────────────────────────────────────────────────────────────────
  //  Exposed surface
  // ──────────────────────────────────────────────────────────────────────────
  return {
    // data
    targets,
    secrets,
    issues,
    filteredIssues,
    groupedIssues,
    run,
    scope,
    chat,
    filters,
    selectedIssueId,

    // counts / summaries
    issueCounts,
    applications: Array.from(new Set(issues.map((i) => i.applicationName))),
    // Compact "5m ago" / "just now" label for the most recently completed
    // run; `null` when there isn't one yet.
    lastRunAgo,

    // flags
    loading,
    sendingMessage,
    testingTargetId,

    // targets
    addTarget,
    removeTarget,
    setTargetEnabled,

    // secrets
    addSecret,
    deleteSecret,

    // issues
    setFilters,
    clearFilters: () => setFilters(defaultFilters),
    setSelectedIssueId,
    updateIssueStatus,

    // verification
    startVerification,
    pauseVerification,
    resumeVerification,
    stopVerification,
    toggleScope,

    // test connection
    testConnection,

    // chat
    sendMessage,
    applyChatAction,
    currentSessionId: sessionId,
    sessions: chatSessionsQuery.data ?? [],
    sessionsLoading: chatSessionsQuery.isLoading,
    startNewSession,
    switchSession,
  };
}

// ────────────────────────────────────────────────────────────────────────────
//  Helpers (pure functions)
// ────────────────────────────────────────────────────────────────────────────

function applyFilters(issues: Issue[], f: IssueFilters): Issue[] {
  const search = f.search.trim().toLowerCase();
  let out = issues.filter((i) => {
    if (f.severities.length && !f.severities.includes(i.severity)) return false;
    if (f.statuses.length && !f.statuses.includes(i.status)) return false;
    if (f.categories.length && !f.categories.includes(i.category)) return false;
    if (f.application && i.applicationName !== f.application) return false;
    if (search && !`${i.title} ${i.description} ${i.applicationName} ${i.id}`
      .toLowerCase()
      .includes(search)) return false;
    return true;
  });
  switch (f.sort) {
    case "newest":
      out = out.sort((a, b) => +new Date(b.detectedAt) - +new Date(a.detectedAt));
      break;
    case "oldest":
      out = out.sort((a, b) => +new Date(a.detectedAt) - +new Date(b.detectedAt));
      break;
    case "severity":
      out = out.sort(severityRank);
      break;
    case "application":
      out = out.sort((a, b) => a.applicationName.localeCompare(b.applicationName));
      break;
  }
  return out;
}

function severityRank(a: Issue, b: Issue): number {
  const order: Record<Issue["severity"], number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  return order[a.severity] - order[b.severity];
}

function groupByApplication(issues: Issue[]): Map<string, Issue[]> {
  const map = new Map<string, Issue[]>();
  for (const i of issues) {
    const arr = map.get(i.applicationName) ?? [];
    arr.push(i);
    map.set(i.applicationName, arr);
  }
  return map;
}

function deriveNameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Unnamed application";
  }
}

function lastCompletedRun(run: VerificationRun): string | null {
  if (!run.completedAt) return null;
  const diffMs = Date.now() - new Date(run.completedAt).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

// Map the agent loop's tri-state completion status onto the UI's
// `TargetStatus` enum. The StatusPill in VerificationTargets renders
// each value with its own tone — keep the mapping exhaustive so
// adding a new agent outcome fails the build rather than silently
// rendering as `not_verified`.
function mapTargetCompletionStatus(
  outcome: "passed" | "failed" | "issues_found",
): TargetStatus {
  switch (outcome) {
    case "passed":
      return "healthy";
    case "failed":
      return "verification_failed";
    case "issues_found":
      return "issues_found";
  }
}

// Random suffix for new chat sessions. Prefers the platform UUID API when
// available; falls back to a short hex string derived from Math.random for
// the rare environment that doesn't ship `crypto.randomUUID`.
function cryptoUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

// Mock progress driver — replaces the AI Agent / MCP for this phase.
function driveMockRun(
  initial: VerificationRun,
  setRun: React.Dispatch<React.SetStateAction<VerificationRun>>,
  setIssues: React.Dispatch<React.SetStateAction<Issue[]>>,
  onDone: () => void,
): void {
  let snapshot = initial;
  const tick = (delay: number, mutate: () => void) => {
    setTimeout(() => {
      mutate();
      setRun({ ...snapshot });
    }, delay);
  };

  // Step through currentActivity over ~6 seconds.
  const activitySteps = snapshot.currentActivity.length || 6;
  const stepMs = 600;
  for (let i = 0; i < activitySteps; i++) {
    tick(stepMs * (i + 1), () => {
      snapshot = {
        ...snapshot,
        currentActivity: snapshot.currentActivity.map((a, idx) =>
          idx <= i ? { ...a, done: true } : a,
        ),
      };
    });
  }

  // Mark per-app statuses progressively.
  const apps = snapshot.perApp;
  apps.forEach((app, idx) => {
    tick(stepMs * (idx + 1), () => {
      const completed = idx + 1;
      const failed = Math.max(0, completed - snapshot.completedTargets - 1);
      snapshot = {
        ...snapshot,
        completedTargets: completed,
        failedTargets: failed,
        perApp: snapshot.perApp.map((a, i) =>
          i === idx ? { ...a, status: idx === apps.length - 1 ? "issues_found" : "healthy", completedAt: new Date().toISOString() } : a,
        ),
      };
    });
  });

  // Final completion.
  tick(stepMs * (apps.length + 2), () => {
    snapshot = {
      ...snapshot,
      status: "completed",
      completedAt: new Date().toISOString(),
      completedTargets: snapshot.totalTargets,
    };
    setRun(snapshot);
    // Synthesize a fresh issue discovered during the run.
    const detected: Issue = {
      id: `ISSUE-${String(Math.floor(Math.random() * 9000) + 1000)}`,
      title: "Newly discovered: console error on initial paint",
      applicationName: apps[0]?.applicationName ?? "MailCraft",
      url: "/dashboard",
      category: "console_errors" as Issue["category"],
      severity: "medium",
      status: "open",
      description: "Detected during the most recent verification run.",
      detectedAt: new Date().toISOString(),
    };
    setIssues((cur) => [detected, ...cur]);
    onDone();
  });
}
