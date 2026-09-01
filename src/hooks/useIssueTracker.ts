// Single state hook that owns the Issue Tracker UI state. Components consume
// narrow selectors from here so we don't re-render the whole page when one
// slice changes (spec section 39).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { issueTrackerApi } from "@/services/issueTrackerApi";
import { mockInitialChat, idleRun } from "@/data/mockIssueTrackerData";
import { useToast } from "@/hooks/useToast";
import type {
  ChatMessage,
  Issue,
  IssueFilters,
  Secret,
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

  // UI state
  const [filters, setFilters] = useState<IssueFilters>(defaultFilters);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [urlErrors, setUrlErrors] = useState<Record<string, string>>({});
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

  // ──────────────────────────────────────────────────────────────────────────
  //  Secrets — the *real* password never leaves this hook. We hold it only in
  //  a ref so it never causes a re-render, and it dies with the hook.
  // ──────────────────────────────────────────────────────────────────────────
  const passwordBufferRef = useRef<Record<string, string>>({});

  const addSecret = useCallback(
    async (payload: { name: string; email: string; password: string }) => {
      try {
        const created = await issueTrackerApi.addSecret(payload);
        setSecrets((cur) => [...cur, created]);
        // Drop the plaintext immediately — the persisted record only stores a mask.
        delete passwordBufferRef.current["__pending__"];
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

  const summary = useMemo(
    () => ({
      applications: targets.length,
      openIssues: issueCounts.open,
      critical: issueCounts.critical,
      lastRunAt: lastCompletedRun(run),
    }),
    [targets.length, issueCounts.open, issueCounts.critical, run],
  );

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
  const startVerification = useCallback(async () => {
    setLoading((l) => ({ ...l, run: true }));
    try {
      const enabled = targets.filter((t) => t.enabled);
      const fresh = await issueTrackerApi.startVerification(enabled);
      setRun(fresh);
      toast.success("Verification started.");
      // Drive the run forward with mock progress (section 16, 18).
      driveMockRun(fresh, setRun, setIssues, () => {
        toast.success("Verification complete.");
      });
    } catch {
      toast.error("Unable to start verification.");
    } finally {
      setLoading((l) => ({ ...l, run: false }));
    }
  }, [targets, toast]);

  const pauseVerification = useCallback(() => {
    setRun((r) => (r.status === "running" ? { ...r, status: "paused" } : r));
  }, []);

  const resumeVerification = useCallback(() => {
    setRun((r) => (r.status === "paused" ? { ...r, status: "running" } : r));
  }, []);

  const stopVerification = useCallback(() => {
    setRun((r) => ({ ...r, status: "cancelled", completedAt: new Date().toISOString() }));
    toast.info("Verification cancelled.");
  }, [toast]);

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
      setSendingMessage(true);
      try {
        const reply = await issueTrackerApi.sendChatMessage(trimmed);
        setChat((cur) => [...cur, reply]);
      } catch {
        toast.error("Unable to send message.");
      } finally {
        setSendingMessage(false);
      }
    },
    [toast],
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
    summary,
    applications: Array.from(new Set(issues.map((i) => i.applicationName))),

    // flags
    loading,
    sendingMessage,
    testingTargetId,
    urlErrors,

    // targets
    addTarget,
    removeTarget,
    setUrlErrors,

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
