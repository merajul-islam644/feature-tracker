// Single state hook that owns the Issue Tracker UI state. Components consume
// narrow selectors from here so we don't re-render the whole page when one
// slice changes (spec section 39).
//
// Storage strategy:
//
//   * Per-user data (targets, secrets, issues) now lives in Blocks Data
//     collections — see `src/lib/blocks/hooks.ts` for the read/mutation
//     hooks (`useIssueTrackerTargets` / `-Secrets` / `-Issues`, plus their
//     `useCreate*` / `useUpdate*` / `useDelete*` siblings). This hook is a
//     thin façade over those hooks, swapping in TanStack Query
//     invalidations for the old manual `setX` reducer plumbing.
//
//   * Runtime state that still lives in component state: active session
//     id, current run object (verification progress is ephemeral so we
//     don't round-trip it through the cloud), filter chip selections,
//     selected-issue drawer, and the various loading flags. None of that
//     survives a refresh today; the few flags the user actually cares
//     about persisting (active chat session) live in localStorage.
//
//   * One thing stays inside `src/services/issueTrackerApi.ts`: the
//     four backend-coupled methods (`testConnection`, `startVerification`,
//     `subscribeRun`, `sendChatMessage`). CRUD doesn't go through the
//     mock seam any more — only the live-verify seam does.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { issueTrackerApi } from "@/services/issueTrackerApi";
import { mockInitialChat, idleRun, verificationChecks } from "@/data/issueTrackerConstants";
import { useToast } from "@/hooks/useToast";
import { useAuth } from "@/hooks/useAuth";
import {
  fetchProjectContents,
  useAppendChatMessage,
  useChatHistory,
  useChatSessions,
  useCreateFeature,
  useCreateFlow,
  useCreateIssue,
  useCreateProject,
  useCreateSecret,
  useCreateVerificationTarget,
  useDeleteChatSession,
  useDeleteFeature,
  useDeleteFlow,
  useDeleteProject,
  useDeleteSecret,
  useDeleteVerificationTarget,
  useIssueTrackerIssues,
  useIssueTrackerSecrets,
  useIssueTrackerTargets,
  useProjects,
  useRenameChatSession,
  useUserAiConfig,
  useUpdateFeature,
  useUpdateFlow,
  useUpdateIssue,
  useUpdateIssueStatus,
  useUpdateProject,
  useUpdateSecret,
  useUpdateVerificationTarget,
} from "@/lib/blocks/hooks";
import { buildIssueTrackerContext } from "@/lib/issueTrackerContext";
import { chatTools, browserToolSummary } from "@/lib/chatTools";
import type {
  AnthropicTool,
  ChatAction,
  ChatMessage,
  ChatToolName,
  Evidence,
  Issue,
  IssueFilters,
  IssueSeverity,
  IssueStatus,
  RunActivityLine,
  RunActivityTone,
  RunEvent,
  Secret,
  TargetEnvironment,
  TargetStatus,
  ToolUseBlock,
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

// check id → display label, derived from the verificationChecks catalog so
// the activity feed and the scope card can never drift apart. Keyed as
// plain string — steps arrive over the wire and aren't narrowed to the
// check-id union until a lookup succeeds.
const checkLabelById = new Map<string, string>(
  verificationChecks.map((c) => [c.id, c.label]),
);

// Human-readable label for a `target_progress` step id. Check steps
// resolve their label from the `verificationChecks` catalog (the single
// source of truth — a new check id needs no change here). The remaining
// step shapes are the backend's wire protocol and are parsed dynamically:
//   deep_walk:<path> / deep_walk_page_failed:<path> / deep_walk_done:<n>
//   watch-<n>
function describeStep(step: string): string {
  if (/^watch-(\d+)$/.test(step)) return `Watch pass ${step.slice(6)}`;
  if (step.startsWith("deep_walk_page_failed:"))
    return `Deep walk couldn't load ${step.slice("deep_walk_page_failed:".length) || "a page"}`;
  if (step.startsWith("deep_walk_done:"))
    return `Deep walk complete — ${step.slice("deep_walk_done:".length)} visited`;
  if (step.startsWith("deep_walk:"))
    return `Deep walk: ${step.slice("deep_walk:".length) || "walking pages…"}`;
  const check = checkLabelById.get(step);
  return check ?? step;
}

// Case-insensitive unique-name matcher for chat-driven feature/flow
// resolution ("rename the login flow" → which row?). Returns the single
// row whose name matches, undefined when nothing matches, and THROWS when
// several do — the caller's error path then surfaces "ask the user which
// one" instead of acting on a guess.
function matchUnique<T extends { id: string; name: string }>(
  rows: T[],
  name: string,
): T | undefined {
  const hits = rows.filter((r) => r.name.toLowerCase() === name.toLowerCase());
  if (hits.length > 1) {
    throw new Error(
      `ambiguous — ${hits.length} rows are named "${name}"; ask the user which one they mean`,
    );
  }
  return hits[0];
}

// ──────────────────────────────────────────────────────────────────────────
// Issue fingerprinting (cross-run dedup)
//
// Every run re-detects the same defects, and agent-generated titles embed
// volatile numbers ("Slow page load: 6234ms", "3 console error(s)
// detected", "Button 5 triggered console error"). A fingerprint normalizes
// that noise away so a re-detected defect merges into its existing row
// instead of filing a duplicate:
//     origin + pathname | category | lowercased title, digit runs → "#"
// Severity is deliberately excluded — escalation is a merge feature, not
// part of identity. Query strings and hashes are dropped too (session
// params / animator noise shouldn't split one page into many).
function normalizeIssueUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    // Not a parseable absolute URL — keep the raw string so identical
    // malformed inputs still match each other.
    return url.trim();
  }
}

function normalizeIssueTitle(title: string): string {
  return title.toLowerCase().replace(/\d+/g, "#").trim();
}

function computeIssueFingerprint(
  issue: Pick<Issue, "url" | "category" | "title">,
): string {
  const composite = `${normalizeIssueUrl(issue.url)}|${issue.category}|${normalizeIssueTitle(issue.title)}`;
  // FNV-1a 32-bit — short, sync, and collision risk is irrelevant at
  // issue-list scale. Hex so the Blocks String field stays clean.
  let hash = 0x811c9dc5;
  for (let i = 0; i < composite.length; i++) {
    hash ^= composite.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// Escalation order + terminal statuses for the merge path. A merged
// occurrence escalates severity upward but never downward (a later, calmer
// run shouldn't bury an earlier critical reading), and a defect that
// re-appears after being closed is a regression → "reopened".
const SEVERITY_RANK: readonly IssueSeverity[] = [
  "low",
  "medium",
  "high",
  "critical",
];
const CLOSED_ISSUE_STATUSES: readonly IssueStatus[] = [
  "resolved",
  "fixed",
  "wont_fix",
  "ignored",
];
// Cap the persisted run-id history so a long-lived recurring issue row
// can't grow unbounded in the primitive-only Blocks schema.
const MAX_TRACKED_RUN_IDS = 20;

// Scope + device survive reloads via localStorage. These are per-browser
// UI prefs (not shared state) — same bucket as a remembered filter.
const SCOPE_STORAGE_KEY = "issue-tracker:scope";
const DEVICE_STORAGE_KEY = "issue-tracker:device";
const DEVICE_VALUES: ReadonlySet<string> = new Set(["desktop", "mobile", "tablet"]);

function readStoredScope(fallback: VerificationCheckId[]): VerificationCheckId[] {
  try {
    const raw = localStorage.getItem(SCOPE_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((x) => typeof x === "string")
    ) {
      return parsed as VerificationCheckId[];
    }
  } catch {
    // Corrupt / private mode — fall through to defaults.
  }
  return fallback;
}

function readStoredDevice(): "desktop" | "mobile" | "tablet" {
  try {
    const raw = localStorage.getItem(DEVICE_STORAGE_KEY);
    if (raw && DEVICE_VALUES.has(raw)) return raw as "desktop" | "mobile" | "tablet";
  } catch {
    // Same best-effort rationale as readStoredScope.
  }
  return "desktop";
}

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
  //  Core data — sourced from TanStack Query so refreshes pull fresh rows,
  //  cross-device sessions stay in sync, and the page header pill /
  //  filter counts automatically reflect new findings.
  // ──────────────────────────────────────────────────────────────────────────
  const targetsQuery = useIssueTrackerTargets();
  const secretsQuery = useIssueTrackerSecrets();
  const issuesQuery = useIssueTrackerIssues();
  // User's saved AI gateway overrides (URL / model / token) — read once
  // here so the chat request below can attach them as `x-ai-gateway-*`
  // headers. Empty fields fall through to the proxy's .env defaults.
  const aiConfigQuery = useUserAiConfig();
  // Projects come from the same Blocks layer the Projects page uses — the
  // chatbot can create/edit/delete projects, and its CURRENT STATE snapshot
  // needs the real ids so "rename Blocks-Logic" resolves against state
  // instead of a guess. Small list; TanStack caches it across pages.
  const projectsQuery = useProjects();

  const targets = targetsQuery.data ?? [];
  const secrets = secretsQuery.data ?? [];
  const issues = issuesQuery.data ?? [];
  const projects = projectsQuery.data ?? [];

  // Mutations — wrapped in stable callbacks further down. Holding them as
  // refs at the top avoids re-creating the `addTarget` etc. closures on
  // every render (each closure otherwise depends on the fresh mutation
  // object). The `useMutation().mutateAsync` reference is stable enough
  // for our purposes, but binding through `useCallback` keeps the public
  // surface bit-identical to the previous file.
  const createTarget = useCreateVerificationTarget();
  const deleteTarget = useDeleteVerificationTarget();
  const updateTarget = useUpdateVerificationTarget();
  const createSecret = useCreateSecret();
  const removeSecret = useDeleteSecret();
  const updateSecret = useUpdateSecret();
  const createIssue = useCreateIssue();
  const changeIssueStatus = useUpdateIssueStatus();
  // Partial-update mutation for the dedup/merge path (occurrence bumps,
  // severity escalation, reopen-on-regression).
  const updateIssue = useUpdateIssue();
  // Project-domain mutations for the chat tools. Same hooks the Projects
  // page dialogs use — tester/manager role guards included, so a chat
  // request from a tester surfaces the same clear error the UI shows.
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();
  // Feature / flow mutations for the chat tools. Cascades (cross-env clone
  // rename/delete propagation) live inside these hooks, so chat-driven
  // actions behave exactly like the project page's kebab-menu actions.
  const createFeature = useCreateFeature();
  const updateFeature = useUpdateFeature();
  const deleteFeature = useDeleteFeature();
  const createFlow = useCreateFlow();
  const updateFlow = useUpdateFlow();
  const deleteFlow = useDeleteFlow();

  // Runtime verification-run state. Lives outside TanStack Query because
  // each run is a single transient process — we don't need persistence, we
  // need the SSE-or-mock reducer to drive per-app progress, pause/stop,
  // and the "5m ago" header pill.
  const [run, setRun] = useState<VerificationRun>(idleRun);

  // Live activity feed for the chat panel — one line per meaningful run
  // event (target started, check finished, issue found, run done). Same
  // spirit as an assistant's streaming tool-use rows: the user sees the
  // agent working instead of one static "Verification started." message.
  // Capped so a long watch loop can't grow it unbounded; cleared at the
  // start of each run.
  const [runActivityLog, setRunActivityLog] = useState<RunActivityLine[]>([]);
  const activityIdRef = useRef(0);
  const pushActivity = useCallback((text: string, tone: RunActivityTone = "info") => {
    setRunActivityLog((log) => {
      const next = [...log, { id: ++activityIdRef.current, text, tone }];
      return next.length > 60 ? next.slice(next.length - 60) : next;
    });
  }, []);
  // Render-synced mirror of `run` so event handlers can read per-app names
  // without becoming setRun-updater side effects.
  const runRef = useRef(run);
  runRef.current = run;
  // Live mirror of `issues` for the same reason: the SSE subscription
  // captures `persistDetectedIssue` once at run start, and that closure
  // used to hold the rows snapshot from subscribe time. A run started
  // soon after page load (Blocks query still in flight) captured an
  // EMPTY list, so every re-detected defect filed a duplicate row even
  // though its fingerprint already existed. Reading through this ref
  // means the dedup match always sees the rows loaded so far.
  const issuesRef = useRef(issues);
  issuesRef.current = issues;
  // Completed-target count kept in a ref (not state) because target_completed
  // and run_completed SSE events can arrive in the same tick — reading
  // runRef.current.completedTargets in run_completed would see the
  // pre-increment value and report "0/N targets done". This ref increments
  // synchronously, so the summary line always counts every finished target.
  const completedTargetsRef = useRef(0);
  // Tool calls already executed via an Allow click, keyed by the model's
  // toolUse id. The card UI swaps the button for an "Allowed" label, but
  // that's cosmetic — this set is the real idempotency guard against
  // double dispatch (double-click races, a restored session replaying
  // actions, a gateway retry re-landing the same tool_use block).
  const executedToolIdsRef = useRef<Set<string>>(new Set());
  // Fingerprints already persisted (or matched) during the CURRENT run.
  // The verification agent can hit the same defect repeatedly inside one
  // run (deep-walk visits a page, then a later check revisits it) — those
  // repeats count once, here, without a round-trip. Reset alongside
  // completedTargetsRef at the start of every run.
  const seenFingerprintsRef = useRef<Set<string>>(new Set());
  const [scope, setScope] = useState<VerificationCheckId[]>(() =>
    readStoredScope(idleRun.scope),
  );
  // Device emulation for the next run — forwarded through the api layer so
  // the backend sizes the browser context (viewport + touch).
  const [device, setDevice] = useState<"desktop" | "mobile" | "tablet">(
    readStoredDevice,
  );

  // Scope + device survive page reloads (localStorage) — the user's check
  // matrix is a deliberate setup, and losing it to every HMR refresh or
  // navigation silently shrank full runs to the 8-check default twice.
  useEffect(() => {
    try {
      localStorage.setItem(SCOPE_STORAGE_KEY, JSON.stringify(scope));
    } catch {
      // Private mode / storage disabled — persistence is best-effort.
    }
  }, [scope]);
  useEffect(() => {
    try {
      localStorage.setItem(DEVICE_STORAGE_KEY, device);
    } catch {
      // Same best-effort rationale as scope.
    }
  }, [device]);
  // Live-preview overlay removed: the Playwright agent runs in headed
  // mode, so the actual browser window is the preview. No in-app state
  // mirror needed — the MCP server still emits `live_preview` / `target_
  // started` SSE events but we ignore them on the client.

  // Chat
  const [chat, setChat] = useState<ChatMessage[]>(mockInitialChat);
  const [sendingMessage, setSendingMessage] = useState(false);
  // Transient gateway-retry status ("Retrying AI request… 2/3") shown in
  // place of silent dead air while sendChatMessage backs off a 502/503.
  const [aiRetryStatus, setAiRetryStatus] = useState<string | null>(null);
  // Reset when the active session changes — the hydration effect below
  // re-runs and pulls messages for `sessionId`.
  const [chatLoaded, setChatLoaded] = useState(false);

  // Official Playwright MCP browser tools — fetched live from the backend
  // bridge (which spawns `npx @playwright/mcp@latest`). Empty when the
  // backend is down; the chatbot then simply works without browser tools.
  const [browserTools, setBrowserTools] = useState<AnthropicTool[]>([]);
  // Rolling memory of the last browser tool results. The chat AI call is
  // stateless per message, so without this the model could never see what
  // the browser showed on the previous turn.
  const browserResultRef = useRef<string[]>([]);
  // Consecutive AUTO-continuations fired after allowed browser_* tools.
  // Each Allow → tool → next-model-turn cycle increments it; a fresh user
  // message resets it. The walkthrough is meant to run until the user
  // says stop — the generous cap only guards against a confused model
  // looping forever with nobody watching.
  const agentTurnsRef = useRef(0);
  // Consecutive model turns that contained NO tool_use blocks (i.e. text
  // narration only). If this climbs to 2 the AI is stalling — narrating
  // "I will…" without ever pairing it with a tool call — so the next
  // continuation injects a forceful reminder. Reset whenever a turn
  // carries at least one tool_use block.
  const narrationOnlyStreakRef = useRef(0);
  // Tracks the most recent auto-continuation's reply. If the model goes
  // silent for `AUTO_CONTINUE_STUCK_MS` without producing a tool_use
  // (i.e. this ref is still pointing at an unanswered turn), a nudge is
  // fired so the walkthrough doesn't appear frozen.
  const lastAutoTurnAtRef = useRef<number | null>(null);
  // Latest-ref bridge for auto-run browser tools: runModelTurn dispatches
  // them through applyChatAction, but applyChatAction is memoized later in
  // the hook (it depends on runModelTurn), so a direct closure reference
  // would be a use-before-define. Reassigned every render.
  const applyChatActionRef = useRef<((action: ChatAction) => Promise<void>) | null>(null);
  const chatHistoryQuery = useChatHistory(sessionId);
  const chatSessionsQuery = useChatSessions();
  const appendChatMessage = useAppendChatMessage();
  const deleteChatSession = useDeleteChatSession();
  const renameChatSession = useRenameChatSession();

  // Load the Playwright MCP tool catalog once on mount. Failure is silent —
  // `listBrowserTools` already returns [] on any error, so the chat degrades
  // to the static tool set instead of breaking.
  useEffect(() => {
    let cancelled = false;
    issueTrackerApi
      .listBrowserTools()
      .then((tools) => {
        if (!cancelled && tools.length > 0) setBrowserTools(tools);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // UI state
  const [filters, setFilters] = useState<IssueFilters>(defaultFilters);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [testingTargetId, setTestingTargetId] = useState<string | null>(null);

  // Loading flags (section 41). The data-loading flags are now derived
  // from TanStack Query — `targetsQuery.isLoading` etc. — and surfaced as
  // a unified object so callers don't have to learn the new API. The `run`
  // flag is local because run progress is the one stream that still lives
  // outside the cache.
  const loading = useMemo(
    () => ({
      targets: targetsQuery.isLoading,
      secrets: secretsQuery.isLoading,
      issues: issuesQuery.isLoading,
      run: false,
    }),
    [
      targetsQuery.isLoading,
      secretsQuery.isLoading,
      issuesQuery.isLoading,
    ],
  );

  // Surface a single error toast when any of the three core queries fail.
  // Without this aggregation a transient network blip on one collection
  // could scroll three separate toasts past the user.
  useEffect(() => {
    if (
      targetsQuery.error ||
      secretsQuery.error ||
      issuesQuery.error
    ) {
      toast.error("Unable to load Issue Tracker data.");
    }
    // We intentionally key on the queries themselves — toasts firing on
    // every render would be the wrong semantic.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetsQuery.error, secretsQuery.error, issuesQuery.error]);

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
  //
  //  Each mutating action routes through a TanStack Query mutation. The
  //  optimistic-update bookkeeping that used to live here is now in the
  //  hooks themselves — `useCreateVerificationTarget` etc. each invalidate
  //  the right keys on success and surface errors through their `.error`
  //  state. From the consumer's perspective, success: toast + refresh;
  //  failure: toast + leave list untouched.
  // ──────────────────────────────────────────────────────────────────────────
  const addTarget = useCallback(
    async (payload: { url: string; applicationName?: string; credentialId?: string | null }) => {
      try {
        const created = await createTarget.mutateAsync({
          url: payload.url,
          applicationName:
            payload.applicationName ?? deriveNameFromUrl(payload.url),
          environment: "production",
          credentialId: payload.credentialId ?? null,
          enabled: true,
          lastVerifiedAt: null,
          lastStatus: null,
        });
        toast.success("URL added successfully.");
        return created;
      } catch (err) {
        // Surface the real failure (validation error, missing collection,
        // permission denial) so the user can self-diagnose.
        const message = err instanceof Error ? err.message : String(err);
        console.error("useIssueTracker.addTarget failed:", err);
        toast.error(`Unable to add URL: ${message}`);
        throw new Error("add_failed");
      }
    },
    [createTarget, toast],
  );

  const removeTarget = useCallback(
    async (id: string) => {
      try {
        await deleteTarget.mutateAsync(id);
        toast.success("URL removed.");
      } catch {
        toast.error("Unable to remove URL.");
      }
    },
    [deleteTarget, toast],
  );

  // Flip the per-target `enabled` flag. Round-trips through the Blocks
  // collection — TanStack Query invalidates the list on success, so the
  // other panels (verification summary etc.) pick up the new state in
  // place. The optimistic shape that used to live in `setTargets` isn't
  // needed because the per-target row is small enough that one cache
  // invalidation round-trip is imperceptible.
  const setTargetEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      const previous = targets.find((t) => t.id === id);
      if (!previous) return;
      try {
        await updateTarget.mutateAsync({
          id,
          patch: { enabled },
        });
      } catch {
        toast.error(`Unable to update ${previous.applicationName}.`);
      }
    },
    [targets, updateTarget, toast],
  );

  // Rename / re-URL a target. Routed through the same `useUpdateVerificationTarget`
  // hook as the enable toggle — that hook already echoes the row's existing
  // required fields back to the gateway, so a rename ships as one PATCH
  // carrying only the two fields the user changed. Network round-trip is
  // imperceptible for a single row.
  const editTarget = useCallback(
    async (
      id: string,
      patch: { applicationName: string; url: string },
    ) => {
      const previous = targets.find((t) => t.id === id);
      if (!previous) return;
      try {
        await updateTarget.mutateAsync({ id, patch });
        toast.success(`${patch.applicationName} updated.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("useIssueTracker.editTarget failed:", err);
        toast.error(`Unable to update ${previous.applicationName}: ${message}`);
      }
    },
    [targets, updateTarget, toast],
  );

  // ──────────────────────────────────────────────────────────────────────────
  //  Secrets — the *real* password never reaches the form state's parent.
  //  The form keeps it locally while open; `useCreateSecret` strips it
  //  before persisting, and the API returns only a masked display value.
  // ──────────────────────────────────────────────────────────────────────────

  const addSecret = useCallback(
    async (payload: {
      name: string;
      email: string;
      password: string;
      targetId?: string;
    }) => {
      try {
        const created = await createSecret.mutateAsync({
          name: payload.name,
          email: payload.email,
          // Mask before persisting — the cloud only ever stores the
          // display string during the frontend phase (see spec 12.3).
          // Keep the masking consistent with `issueTrackerApi`'s original
          // mock so a row created via either path renders identically.
          passwordMasked: "•".repeat(
            Math.min(10, Math.max(6, payload.password.length)),
          ),
        });
        // Push the real password to the MCP server's encrypted store
        // (AES-256-GCM at rest). We use the Blocks Data ItemId as the
        // explicit id so VerificationTarget.credentialId stays aligned
        // with what the verification agent looks up by at verify-time.
        // This is best-effort: if the MCP server is down we still keep
        // the Blocks Data row so the UI doesn't break; the user can
        // re-create the secret later and it'll upsert.
        try {
          const res = await fetch("/api/secrets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: created.id,
              name: payload.name.trim(),
              email: payload.email.trim(),
              password: payload.password,
            }),
          });
          if (!res.ok) {
            console.warn(
              `MCP /api/secrets returned ${res.status}; credential will not be usable for verification.`,
            );
          }
        } catch (err) {
          console.warn(
            "Failed to push secret to MCP server (is it running on :8787?):",
            err,
          );
        }
        // If the user picked a target in the form, bind it now. We do
        // this AFTER the credential is created so we have its id. If the
        // binding fails we still keep the secret — the user can rebind
        // from the SecretCard row.
        if (payload.targetId) {
          const target = targets.find((t) => t.id === payload.targetId);
          if (target) {
            // If another secret was already bound to this target, its
            // credentialId will be overwritten — which is the documented
            // contract. The form surfaces a warning before this happens.
            await updateTarget.mutateAsync({
              id: target.id,
              patch: { credentialId: created.id },
            });
          }
        }
        toast.success("Credential added successfully.");
        return created;
      } catch (err) {
        // Surface the real failure so the user can self-diagnose — the
        // generic "Unable to add credential" was hiding schema- or
        // permission-related errors that show up at the cloud boundary.
        const message = err instanceof Error ? err.message : String(err);
        console.error("useIssueTracker.addSecret failed:", err);
        toast.error(`Unable to add credential: ${message}`);
        throw new Error("add_failed");
      }
    },
    [createSecret, toast, targets, updateTarget],
  );

  const deleteSecretFn = useCallback(
    async (id: string) => {
      try {
        await removeSecret.mutateAsync(id);
        toast.success("Credential removed.");
      } catch {
        toast.error("Unable to remove credential.");
      }
    },
    [removeSecret, toast],
  );

  // Edit the credential's name + email (password is intentionally not
  // editable here — see `useUpdateSecret`). The form only sends the two
  // fields it allows the user to change.
  const editSecret = useCallback(
    async (id: string, patch: { name: string; email: string }) => {
      // Look the row up so we can surface the right name in the toast /
      // error message even if the cache has already been mutated.
      const previous = secrets.find((s) => s.id === id);
      try {
        await updateSecret.mutateAsync({ id, patch });
        toast.success(`${patch.name} updated.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("useIssueTracker.editSecret failed:", err);
        toast.error(
          `Unable to update ${previous?.name ?? "credential"}: ${message}`,
        );
      }
    },
    [secrets, updateSecret, toast],
  );

  // Re-bind an existing secret to a (possibly different) target, or clear
  // its binding entirely. The relationship is stored on the target side
  // (target.credentialId) — to clear, we set it back to null/empty. To
  // unbind from the previously-bound target when switching, we also patch
  // the old target so we don't leave a dangling pointer.
  const bindSecret = useCallback(
    async (secretId: string, newTargetId: string | null) => {
      const secret = secrets.find((s) => s.id === secretId);
      const previousTarget = targets.find((t) => t.credentialId === secretId);
      try {
        // 1) Clear any previous binding so we don't leave the old target
        //    pointing at a credential that has moved.
        if (previousTarget && previousTarget.id !== newTargetId) {
          await updateTarget.mutateAsync({
            id: previousTarget.id,
            patch: { credentialId: null },
          });
        }
        // 2) Set the new binding (or clear it).
        if (newTargetId) {
          const next = targets.find((t) => t.id === newTargetId);
          if (!next) {
            toast.error("That target no longer exists.");
            return;
          }
          // If the new target was bound to a different secret, that binding
          // is replaced — same contract as on creation. We just write the
          // new credentialId; Blocks will hold the latest value.
          await updateTarget.mutateAsync({
            id: newTargetId,
            patch: { credentialId: secretId },
          });
        }
        toast.success(
          newTargetId
            ? `${secret?.name ?? "Credential"} re-bound.`
            : `${secret?.name ?? "Credential"} un-bound.`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("useIssueTracker.bindSecret failed:", err);
        toast.error(`Unable to re-bind credential: ${message}`);
      }
    },
    [secrets, targets, updateTarget, toast],
  );

  // ──────────────────────────────────────────────────────────────────────────
  //  Issues
  // ──────────────────────────────────────────────────────────────────────────
  const updateIssueStatusFn = useCallback(
    async (id: string, status: Issue["status"]) => {
      try {
        await changeIssueStatus.mutateAsync({ id, status });
        toast.success("Issue updated.");
      } catch {
        toast.error("Unable to update issue.");
      }
    },
    [changeIssueStatus, toast],
  );

  // Developer triage — toggle one developer in/out of the assignee list
  // of a batch of issues (one application group). Each row's patch is the
  // row's own list ± the developer, so concurrent toggles on different
  // developers don't clobber each other. Fires the row updates in
  // parallel and reports a single toast; partial failures don't roll
  // back (each row is an independent PATCH — retrying re-sends the same
  // value).
  const toggleIssuesAssignee = useCallback(
    async (
      issues: Pick<Issue, "id" | "assignedDeveloperIds">[],
      developerId: string,
      assigned: boolean,
    ) => {
      const results = await Promise.allSettled(
        issues.map((i) => {
          const current = i.assignedDeveloperIds ?? [];
          const next = assigned
            ? current.includes(developerId)
              ? current
              : [...current, developerId]
            : current.filter((d) => d !== developerId);
          return updateIssue.mutateAsync({
            id: i.id,
            patch: { assignedDeveloperIds: next },
          });
        }),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) {
        toast.error(`Assignment failed on ${failed} of ${issues.length} issues.`);
        return false;
      }
      toast.success(
        assigned
          ? `Assigned ${issues.length} issue${issues.length === 1 ? "" : "s"}.`
          : `Unassigned ${issues.length} issue${issues.length === 1 ? "" : "s"}.`,
      );
      return true;
    },
    [updateIssue, toast],
  );

  // Tester approval (manual re-test after the AI run). Stamps the signed-in
  // tester's sub on the row; the developer-scoped view only surfaces
  // approved rows, so this is what pushes an issue into a developer's queue.
  const approveIssue = useCallback(
    async (id: string) => {
      if (!currentUser?.id) {
        toast.error("Sign in to approve issues.");
        return false;
      }
      try {
        await updateIssue.mutateAsync({ id, patch: { approvedById: currentUser.id } });
        toast.success("Issue approved.");
        return true;
      } catch {
        toast.error("Could not approve the issue.");
        return false;
      }
    },
    [updateIssue, toast, currentUser?.id],
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
  //
  // Re-tick every 30s so the label drifts from "1m ago" → "2m ago" without
  // the user having to refresh. The interval is cleaned up on unmount.
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const lastRunAgo = useMemo(
    () => lastCompletedRun(run, nowTick),
    [run, nowTick],
  );

  // ──────────────────────────────────────────────────────────────────────────
  //  Test connection (section 14)
  //  No mutations touch the cloud; this still round-trips through
  //  `issueTrackerApi` for the SSE-only gateVerify seam.
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
  //
  //  MCP step 2: when the flag is on, run progress arrives via SSE
  //  (`issueTrackerApi.subscribeRun`) instead of the local mock driver.
  //  Either way the `setRun` reducer is the single sink — UI consumers
  //  don't care which side drove the transition. We hold the unsubscribe
  //  in a ref so `stopVerification` can tear the stream down cleanly.
  // ──────────────────────────────────────────────────────────────────────────
  const unsubscribeRunRef = useRef<(() => void) | null>(null);
  const mockCancelRef = useRef<(() => void) | null>(null);

  // Persist issue findings to Blocks when they come in, deduplicating by
  // fingerprint (see computeIssueFingerprint above). Each `issue_detected`
  // event stamps `verificationRunId` on the row so the issue list can pivot
  // by run; re-detections of a known defect merge into the existing row
  // instead of filing a duplicate.
  const persistDetectedIssue = useCallback(
    async (payload: Issue, runId: string) => {
      try {
        const fingerprint = computeIssueFingerprint(payload);

        // Same-run repeat — already counted, drop it without a round-trip.
        if (seenFingerprintsRef.current.has(fingerprint)) return;
        seenFingerprintsRef.current.add(fingerprint);

        // Cross-run match. Legacy rows created before fingerprinting carry
        // no fingerprint and never match — the first re-detection of an old
        // defect files a fresh fingerprinted row (one-time cost, self-heals
        // as old rows age out or get resolved). Reads issuesRef (live rows),
        // NOT the `issues` captured when the subscription was made.
        const match = issuesRef.current.find((i) => i.fingerprint === fingerprint);

        if (!match) {
          await createIssue.mutateAsync({
            ...payload,
            verificationRunId: runId,
            fingerprint,
            occurrenceCount: 1,
            lastSeenAt: payload.detectedAt,
            seenInRunIds: [runId],
          });
          return;
        }

        // Guard the race where the same fingerprint somehow slips past the
        // per-run set (e.g. two drivers sharing the hook): a run id already
        // on the row means this occurrence was counted.
        if ((match.seenInRunIds ?? []).includes(runId)) return;

        const patch: Parameters<typeof updateIssue.mutateAsync>[0]["patch"] = {
          occurrenceCount: (match.occurrenceCount ?? 1) + 1,
          lastSeenAt: payload.detectedAt,
          seenInRunIds: [...(match.seenInRunIds ?? []), runId].slice(
            -MAX_TRACKED_RUN_IDS,
          ),
        };
        // Escalate upward only — see SEVERITY_RANK note above.
        if (
          SEVERITY_RANK.indexOf(payload.severity) >
          SEVERITY_RANK.indexOf(match.severity)
        ) {
          patch.severity = payload.severity;
        }
        // Re-detection after the user closed the row is a regression.
        if (CLOSED_ISSUE_STATUSES.includes(match.status)) {
          patch.status = "reopened";
        }

        await updateIssue.mutateAsync({ id: match.id, patch });
      } catch {
        // Don't toast on every finding — the run-level toast on
        // completion already covers user feedback. A single missing
        // finding on a network blip shouldn't flood the inbox.
      }
    },
    [createIssue, updateIssue],
  );

  // Mirror a target's result onto its row so the `VerificationTargets`
  // list reflects the latest run. `useUpdateVerificationTarget` invalidates
  // the list cache on success.
  const persistTargetRunResult = useCallback(
    async (
      targetId: string,
      status: TargetStatus,
      verifiedAt: string,
    ) => {
      try {
        await updateTarget.mutateAsync({
          id: targetId,
          patch: { lastStatus: status, lastVerifiedAt: verifiedAt },
        });
      } catch {
        // Same fire-and-forget rationale as persistDetectedIssue.
      }
    },
    [updateTarget],
  );

  const applyRunEvent = useCallback(
    (event: RunEvent) => {
      switch (event.kind) {
        // ── Run-level lifecycle ─────────────────────────────────────────
        case "test_plan":
          // The agent's announced checks × targets matrix. Kept on the run
          // state for the summary panel and the exported report.
          setRun((r) => ({
            ...r,
            testPlan: { checks: event.checks, targets: event.targets },
          }));
          pushActivity(
            `Test plan: ${event.checks.length} checks × ${event.targets.length} target${event.targets.length === 1 ? "" : "s"}.`,
          );
          break;

        case "app_map":
          // Deep-walk result for one target: page → discovered pages. Kept
          // per application name so the tree panel can render each app's
          // crawl graph once the run settles.
          setRun((r) => ({
            ...r,
            appMaps: {
              ...(r.appMaps ?? {}),
              [event.applicationName]: event.pages,
            },
          }));
          break;

        case "run_completed":
          setRun((r) => ({
            ...r,
            status: "completed",
            completedAt: event.completedAt,
            failedTargets: event.failedTargets,
          }));
          pushActivity(
            `Verification complete — ${completedTargetsRef.current}/${runRef.current.totalTargets} targets done.`,
            "success",
          );
          // Keep the final frame visible briefly so the user sees the
          // post-run state; cleared by the overlay's auto-hide timer.
          unsubscribeRunRef.current?.();
          unsubscribeRunRef.current = null;
          mockCancelRef.current?.();
          mockCancelRef.current = null;
          toast.success("Verification complete.");
          break;
        case "run_failed":
          setRun((r) => ({
            ...r,
            status: "cancelled",
            completedAt: new Date().toISOString(),
          }));
          pushActivity(`Verification failed: ${event.reason}`, "error");
          unsubscribeRunRef.current?.();
          unsubscribeRunRef.current = null;
          mockCancelRef.current?.();
          mockCancelRef.current = null;
          toast.error(`Verification failed: ${event.reason}`);
          break;

        // ── Per-target progress (MCP step 5) ─────────────────────────────
        case "target_started":
          pushActivity(`Verifying ${event.applicationName}…`);
          setRun((r) => ({
            ...r,
            // Belt-and-braces: the start response maps "queued" →
            // "running", but a replayed run (fresh mount + SSE replay)
            // can arrive here still idle/queued.
            status: r.status === "running" ? r.status : "running",
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
          //
          // Feed mapping: deep-walk page visits arrive as done:false — log
          // them as info lines so a long walk shows live progress instead
          // of silence; failures get the issue tone; everything else logs
          // on completion.
          if (event.step.startsWith("deep_walk_page_failed:")) {
            pushActivity(describeStep(event.step), "issue");
          } else if (event.step.startsWith("deep_walk:") && !event.done) {
            pushActivity(describeStep(event.step));
          } else if (event.done) {
            pushActivity(`✓ ${describeStep(event.step)}`, "success");
          }
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
          const appName =
            runRef.current.perApp.find((p) => p.targetId === event.targetId)
              ?.applicationName ?? "target";
          pushActivity(
            `${appName}: ${isFailure ? "verification failed" : event.status.replace("_", " ")}`,
            isFailure ? "error" : "success",
          );
          completedTargetsRef.current += 1;
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
          // Mirror the result onto the target row itself so the
          // `VerificationTargets` panel picks it up on next render.
          void persistTargetRunResult(
            event.targetId,
            status,
            new Date().toISOString(),
          );
          break;
        }

        // ── Findings (MCP step 5) ───────────────────────────────────────
        case "issue_detected":
          // Persist through Blocks — the cached query refreshes on its
          // own cadence and the issue list reflects the new finding on
          // next render. The toast still fires for immediate feedback.
          void persistDetectedIssue(event.payload, event.runId);
          pushActivity(`⚠ Issue found: ${event.payload.title}`, "issue");
          toast.info(`Issue detected: ${event.payload.title}`);
          break;

        case "evidence":
          // Attach the evidence to the issue it belongs to. Stored in the
          // shape EvidenceViewer already knows how to render — kept on
          // component state because evidence is high-cadence (one row per
          // step) and we don't want to round-trip every step through the
          // collection. The data is replayed from local state when the
          // drawer reopens.
          //
          // We track evidence rows against the currently selected issue
          // (or run-level fallback) so the EvidenceViewer renders
          // something useful without a manual refresh.
          //
          // Note: when persistence becomes part of the spec, this moves
          // into a `useCreateEvidence` mutation. For now the per-run
          // stream of steps is ephemeral.
          setRun((r) => {
            if (r.status !== "running" && r.status !== "paused") return r;
            const ev: Evidence = {
              // Map the backend's three evidence kinds onto the renderer's
              // viewer types. Anything that isn't a screenshot is a text
              // artefact that the viewer renders in a console pane — the
              // exact viewer for that pane is keyed off `type`, so an
              // unrecognised kind falls back to "console" rather than
              // "url" (which would render the storageRef as a clickable
              // link to /api/evidence/:ref — wrong for log / network data).
              type:
                event.evidenceKind === "screenshot"
                  ? "screenshot"
                  : event.evidenceKind === "network"
                    ? "network"
                    : "console",
              label: event.evidenceKind,
              // MCP step 7: keep the storageRef separate from `value` so
              // the viewer can distinguish "resolve me via /api/evidence"
              // (storageRef set, value empty) from "inline content" (data
              // URI in value). The wire shape is the same.
              value: "",
              storageRef: event.storageRef,
              timestamp: new Date().toISOString(),
            };
            // Stash on the per-app entry as a transient field so future
            // enhancements (e.g. an Evidence tab in the drawer) have raw
            // data to render.
            return {
              ...r,
              perApp: r.perApp.map((p) =>
                p.targetId === event.targetId
                  ? {
                      ...p,
                      evidence: [...(p.evidence ?? []), ev],
                    }
                  : p,
              ),
            };
          });
          break;

        default: {
          // Exhaustiveness check — TS will flag a missing case here.
          const _exhaustive: never = event;
          void _exhaustive;
        }
      }
    },
    [toast, persistDetectedIssue, persistTargetRunResult, pushActivity],
  );

  const startVerification = useCallback(async () => {
    const enabled = targets.filter((t) => t.enabled);
    if (enabled.length === 0) {
      toast.error("Add an enabled target before starting verification.");
      return;
    }
    try {
      // Guarantee the fingerprint-dedup list is loaded BEFORE any
      // issue_detected events can arrive. A run started right after a
      // page load used to race the Blocks query — the dedup match then
      // saw an empty list and filed a duplicate row for every defect
      // that already existed.
      await issuesQuery.refetch().catch(() => undefined);
      // MCP step 5/7: when the real backend is wired up, the api call
      // emits `{ id, replay, status }`. The matched run id (existing
      // or fresh) is what the SSE stream key on. We also pass the full
      // enabled-target list + the user's chosen scope so the agent
      // knows what to visit and which checks to run.
      const fresh = await issueTrackerApi.startVerification(enabled, {
        scope,
        userId: currentUser?.id,
        device,
      });
      setRun(fresh);
      // Reset the chat-panel activity feed for the new run and seed it with
      // a first line so the "assistant is working" block appears instantly.
      setRunActivityLog([
        {
          id: ++activityIdRef.current,
          text: `Verification started — ${enabled.length} target${enabled.length === 1 ? "" : "s"}, ${scope.length} check${scope.length === 1 ? "" : "s"} in scope.`,
          tone: "info",
        },
      ]);
      completedTargetsRef.current = 0;
      // Fresh dedup window for the new run — fingerprints counted in the
      // previous run must count again in this one.
      seenFingerprintsRef.current = new Set();
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
        // Always cancel a previous mock before kicking off a new one so
        // stale timers don't overwrite the fresh run's state.
        mockCancelRef.current?.();
        mockCancelRef.current = driveMockRun(
          fresh,
          setRun,
          persistDetectedIssue,
          () => {
            mockCancelRef.current = null;
            toast.success("Verification complete.");
          },
        );
      }
    } catch {
      toast.error("Unable to start verification.");
    }
  }, [targets, scope, device, currentUser?.id, toast, applyRunEvent, persistDetectedIssue, issuesQuery]);

  const pauseVerification = useCallback(() => {
    setRun((r) => (r.status === "running" ? { ...r, status: "paused" } : r));
  }, []);

  const resumeVerification = useCallback(() => {
    setRun((r) => (r.status === "paused" ? { ...r, status: "running" } : r));
  }, []);

  const stopVerification = useCallback(() => {
    unsubscribeRunRef.current?.();
    unsubscribeRunRef.current = null;
    // Cancel any pending mock-driver ticks so their deferred setRun calls
    // don't fire after we've already moved to "cancelled".
    mockCancelRef.current?.();
    mockCancelRef.current = null;
    setRun((r) => ({ ...r, status: "cancelled", completedAt: new Date().toISOString() }));
    toast.info("Verification cancelled.");
  }, [toast]);

  // Export the current run as a Markdown report — the "artifact" side of a
  // QA cycle: what was tested (test plan), what happened (per-target
  // results), what was found (issues with recurrence counts), and what the
  // app actually looks like (application map). Downloads via a Blob URL so
  // nothing round-trips through a server that would need the run's data.
  const exportRunReport = useCallback(() => {
    const r = runRef.current;
    const runIssues = issuesRef.current.filter(
      (i) => (i.seenInRunIds ?? []).includes(r.id) || i.verificationRunId === r.id,
    );
    const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString() : "—");
    const lines: string[] = [
      `# Verification Report`,
      "",
      `- **Run:** \`${r.id}\``,
      `- **Status:** ${r.status}`,
      `- **Started:** ${fmt(r.startedAt)}`,
      `- **Completed:** ${fmt(r.completedAt)}`,
      `- **Targets:** ${r.completedTargets}/${r.totalTargets} completed` +
        (r.failedTargets > 0 ? `, ${r.failedTargets} failed` : ""),
      "",
    ];

    if (r.testPlan) {
      lines.push("## Test plan", "");
      lines.push(
        `**Checks (${r.testPlan.checks.length}):** ${r.testPlan.checks.join(", ")}`,
        "",
        "| Target | URL |",
        "| --- | --- |",
      );
      for (const t of r.testPlan.targets) {
        lines.push(`| ${t.applicationName} | ${t.url} |`);
      }
      lines.push("");
    }

    lines.push("## Results", "", "| Target | Status |", "| --- | --- |");
    for (const p of r.perApp) {
      lines.push(`| ${p.applicationName} | ${p.status} |`);
    }
    lines.push("");

    lines.push("## Issues", "");
    if (runIssues.length === 0) {
      lines.push("_No issues recorded for this run._", "");
    } else {
      for (const i of runIssues) {
        lines.push(
          `### [${i.severity.toUpperCase()}] ${i.title}`,
          "",
          `- **Application:** ${i.applicationName}`,
          `- **URL:** ${i.url}`,
          `- **Category:** ${i.category} · **Status:** ${i.status}`,
          `- **Detected:** ${fmt(i.detectedAt)}` +
            (i.occurrenceCount && i.occurrenceCount > 1
              ? ` · **Seen in ${i.occurrenceCount} runs**`
              : ""),
          "",
          i.description || "_no description_",
          "",
        );
      }
    }

    if (r.appMaps && Object.keys(r.appMaps).length > 0) {
      lines.push("## Application map", "");
      for (const [app, pages] of Object.entries(r.appMaps)) {
        lines.push(`**${app}**`, "");
        // Same forest semantics as the UI's ApplicationMap tree: one rendered
        // set shared across ALL roots of the app, so a page already listed
        // under an earlier root never re-renders its whole subtree under a
        // later one (per-root sets duplicated /console's subtree per root).
        // Cycles and cross-root repeats become "_(already listed)_" leaves.
        const rendered = new Set<string>();
        const emit = (url: string, depth: number, ancestors: Set<string>) => {
          rendered.add(url);
          lines.push(`${"  ".repeat(depth)}- \`${new URL(url, "https://x").pathname}\``);
          for (const to of pages[url] ?? []) {
            if (ancestors.has(to) || rendered.has(to)) {
              lines.push(`${"  ".repeat(depth + 1)}- \`${new URL(to, "https://x").pathname}\` _(already listed)_`);
              continue;
            }
            ancestors.add(to);
            emit(to, depth + 1, ancestors);
            ancestors.delete(to);
          }
        };
        for (const root of Object.keys(pages)) {
          if (rendered.has(root)) continue;
          emit(root, 0, new Set([root]));
        }
        lines.push("");
      }
    }

    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `verification-report-${r.id}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Report downloaded.");
  }, [toast]);

  // Clean up any open SSE subscription on unmount so we don't leak.
  useEffect(() => {
    return () => {
      unsubscribeRunRef.current?.();
      unsubscribeRunRef.current = null;
      mockCancelRef.current?.();
      mockCancelRef.current = null;
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

  // Delete an entire chat session (every persisted message under its
  // sessionId). When the user deletes the session they're currently
  // looking at, fall back to the seed greeting so the panel doesn't
  // ghost — clearing the active id means the next render has empty
  // history and `mockInitialChat` is re-prepended by the hydration
  // effect.
  const deleteSessionFn = useCallback(
    async (targetSessionId: string) => {
      try {
        await deleteChatSession.mutateAsync(targetSessionId);
        if (targetSessionId === sessionId) {
          // Reset local state so the open chat shows the greeting again.
          const fallback = currentUser
            ? `issue-tracker:${currentUser.id}`
            : "issue-tracker:anon";
          setSessionId(fallback);
          setChat(mockInitialChat);
          setChatLoaded(true);
        }
        toast.success("Conversation deleted.");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("useIssueTracker.deleteSession failed:", err);
        toast.error(`Couldn't delete conversation: ${message}`);
      }
    },
    [deleteChatSession, sessionId, currentUser, toast],
  );

  // Rename a chat session by rewriting its most recent user turn.
  // Validation lives in the underlying hook; we surface the error via
  // toast so the caller's UX (button + dialog) stays simple.
  const renameSessionFn = useCallback(
    async (targetSessionId: string, newTitle: string) => {
      try {
        await renameChatSession.mutateAsync({
          sessionId: targetSessionId,
          newTitle,
        });
        toast.success("Conversation renamed.");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("useIssueTracker.renameSession failed:", err);
        toast.error(`Couldn't rename conversation: ${message}`);
      }
    },
    [renameChatSession, toast],
  );

  // ──────────────────────────────────────────────────────────────────────────
  //  Chat
  // ──────────────────────────────────────────────────────────────────────────
  // One model turn: builds the context snapshot + browser memory +
  // history, calls the gateway, appends the reply to the chat and
  // persists it. Shared by the user-facing sendMessage and the agent
  // auto-continuation after an allowed browser_* tool — same pipeline,
  // different prompt.
  const runModelTurn = useCallback(
    async (
      promptForModel: string,
      runOptions?: { toolChoice?: { type: "any" | "auto" | "tool"; name?: string } },
    ) => {
      // Snapshot the page state at send-time so the model sees exactly
      // what the user sees. Cheap (one shallow copy + filter pass) and
      // avoids stale-context surprises when a run finishes mid-send.
      const context = buildIssueTrackerContext({
        targets,
        secrets,
        issues,
        scope,
        run,
        filters,
        projects,
      });
      // Give the model the last browser tool results — the AI call is
      // stateless per message, so this memory is the only way it can
      // reason about what the Playwright browser just showed. Snapshot
      // results carry the element refs (e3, e5, …) the official
      // workflow cycle needs for the next browser_click, so they are
      // kept generously.
      const browserMemory = browserResultRef.current.join("\n");
      // Plus the last few conversation turns (user questions + assistant
      // answers) so a multi-step browser session survives the stateless
      // call: "open X" → "click the login button" → "what did it show?".
      const history = chat
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-6)
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content.slice(0, 500),
        }));
      const reply = await issueTrackerApi.sendChatMessage(
        browserMemory
          ? `${promptForModel}\n\n[Recent Playwright browser tool results]\n${browserMemory}`
          : promptForModel,
        {
          context,
          tools: [...chatTools, ...browserTools],
          history,
          onRetry: (attempt, maxAttempts) =>
            setAiRetryStatus(
              `AI gateway hiccup — retrying request… (attempt ${attempt} of ${maxAttempts})`,
            ),
          // Per-request overrides from the user's saved UserAiConfig row.
          // Empty strings mean "no override" — server falls back to .env.
          // `gatewayProvider` selects anthropic vs openai on the proxy; an
          // older row without a `provider` field falls through to
          // "anthropic" via `toUserAiConfig`.
          gatewayProvider: aiConfigQuery.data?.provider ?? "anthropic",
          gatewayUrl: aiConfigQuery.data?.gatewayUrl ?? "",
          gatewayModel: aiConfigQuery.data?.model ?? "",
          gatewayToken: aiConfigQuery.data?.token ?? "",
          // Force `tool_choice: any` when the caller asks for it. The
          // browser_* walkthrough auto-continue uses this so the model
          // CAN'T respond with prose alone — every turn must carry at
          // least one tool_use block (typically browser_snapshot or
          // browser_click, but anything in the browser_* set satisfies
          // the API). Without this the model happily narrates "I'll
          // click the next button…" and the walkthrough stalls.
          toolChoice: runOptions?.toolChoice,
        },
      );
      setAiRetryStatus(null);
      // Browser walkthrough steps (browser_*) run WITHOUT a permission
      // card — navigating, snapshotting and clicking inside the
      // verification browser is exactly what "verify this app" asks
      // for, so each step executes right after its narration line.
      // browser_run_code_unsafe stays carded (it is arbitrary code
      // execution); every non-browser tool keeps its Allow/Deny card.
      const isAutoRun = (name: string) =>
        name.startsWith("browser_") && name !== "browser_run_code_unsafe";
      const autoRun = (reply.toolUse ?? []).filter((t) => isAutoRun(t.name));
      const shownActions = autoRun.length
        ? reply.actions?.filter((a) => {
            const name = a.payload?.toolName;
            return !(
              a.kind === "request_tool_permission" &&
              typeof name === "string" &&
              isAutoRun(name)
            );
          })
        : reply.actions;
      const replyToShow =
        autoRun.length && (!shownActions || shownActions.length === 0)
          ? { ...reply, actions: undefined }
          : { ...reply, actions: shownActions };
      // Stuck-detection: did this turn actually pair its narration with a
      // tool call? Anything in `toolUse` (browser or otherwise) counts;
      // a turn with `reply.toolUse` empty/undefined is narration-only,
      // which the walkthrough can't move forward on. Counter feeds the
      // forced-reminder injection in the auto-continue block below.
      if (reply.toolUse && reply.toolUse.length > 0) {
        narrationOnlyStreakRef.current = 0;
      } else {
        narrationOnlyStreakRef.current += 1;
      }
      lastAutoTurnAtRef.current = Date.now();
      setChat((cur) => [...cur, replyToShow]);
      void appendChatMessage.mutateAsync({
        sessionId,
        role: replyToShow.role,
        content: replyToShow.content,
        actions: replyToShow.actions,
      }).catch(() => {});
      // Dispatch the auto-run steps through the same path an Allow
      // click takes (applyChatAction) so idempotency, the "✓ Done"
      // transcript line and the auto-continue loop stay identical.
      // Deferred one tick so the setChat above flushes first — the
      // dispatcher rebuilds the tool block from the payload when the
      // live chat lookup hasn't caught up yet.
      autoRun.forEach((t) => {
        window.setTimeout(() => {
          void applyChatActionRef.current?.({
            id: `auto-${t.id}`,
            label: "Allow",
            kind: "request_tool_permission",
            payload: { toolUseId: t.id, toolName: t.name, toolInput: t.input },
          });
        }, 60);
      });
      return reply;
    },
    [
      appendChatMessage,
      sessionId,
      targets,
      secrets,
      issues,
      projects,
      scope,
      run,
      filters,
      browserTools,
      chat,
    ],
  );

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
      // A verify ask WITHOUT a URL never reaches the gateway — it opens
      // the in-chat target picker instead (dropdown of configured
      // targets + a free-text URL box). The model only sees the
      // "Verify <url>" follow-up the picker emits on submit, so it
      // always starts from an explicit destination. Bengali verbs are
      // matched too (\b doesn't work on non-ASCII, hence the split).
      const verifyIntent =
        /\b(verify|test|check|audit)\b/i.test(trimmed) ||
        /ভেরিফাই|যাচাই|টেস্ট/.test(trimmed);
      const namesUrl = /\bhttps?:\/\/\S+|\bwww\.\S+/i.test(trimmed);
      // "Verify ISSUE-001 again" is an issue re-verify, not an app ask —
      // leave those to the model's verify_again tool.
      const aboutIssue = /\bissue\b/i.test(trimmed) || /ISSUE-?\d+/i.test(trimmed);
      const refersToApp =
        /\b(app|application|site|website|web\s?app|target|url|product|portal)\b/i.test(
          trimmed,
        ) || trimmed.split(/\s+/).length <= 3;
      if (
        targets.length > 0 &&
        verifyIntent &&
        !namesUrl &&
        !aboutIssue &&
        refersToApp
      ) {
        const pickerMsg: ChatMessage = {
          id: `msg-picker-${Date.now()}`,
          role: "assistant",
          content:
            "Sure — which app should I verify? Pick one of your verification targets, or paste a different URL below.",
          timestamp: new Date().toISOString(),
          // Widget flag is local-only; persistence below sends explicit
          // fields, so a reloaded session shows the question as text.
          picker: "verify-target",
        };
        setChat((cur) => [...cur, pickerMsg]);
        void appendChatMessage
          .mutateAsync({
            sessionId,
            role: "assistant",
            content: pickerMsg.content,
          })
          .catch(() => {});
        return;
      }
      setSendingMessage(true);
      // A fresh user message takes the wheel — reset the auto-continue
      // budget used by the browser walkthrough loop.
      agentTurnsRef.current = 0;
      narrationOnlyStreakRef.current = 0;
      lastAutoTurnAtRef.current = null;
      try {
        await runModelTurn(trimmed);
      } catch {
        toast.error("Unable to send message.");
      } finally {
        setSendingMessage(false);
        setAiRetryStatus(null);
      }
    },
    [toast, sessionId, appendChatMessage, runModelTurn, targets],
  );

  // Dispatch a single tool_use block to the matching state action. Returns
  // a short human-readable string the caller can append to the chat as a
  // "✓ Done" line. Centralised so every tool routes through the same
  // shape — keeps the permission card and the post-execution log in sync.
  const executeTool = useCallback(
    async (tool: ToolUseBlock): Promise<string> => {
      switch (tool.name as ChatToolName) {
        case "toggle_verification_check": {
          const checkId = tool.input.checkId as VerificationCheckId | undefined;
          if (!checkId) return "Skipped — missing checkId.";
          // The tool schema makes `enabled` explicit; if it's absent
          // (offline-fallback or legacy call), fall back to a flip.
          const enabled = tool.input.enabled as boolean | undefined;
          setScope((cur) => {
            const isOn = cur.includes(checkId);
            const target = enabled !== undefined ? enabled : !isOn;
            if (target === isOn) return cur;
            return target
              ? [...cur, checkId]
              : cur.filter((x) => x !== checkId);
          });
          return `Verification check "${checkId}" ${enabled === undefined ? "toggled" : enabled ? "enabled" : "disabled"}.`;
        }
        case "set_target_enabled": {
          const targetId = tool.input.targetId as string | undefined;
          const enabled = tool.input.enabled as boolean | undefined;
          if (!targetId || typeof enabled !== "boolean") {
            return "Skipped — missing targetId or enabled flag.";
          }
          const t = targets.find((x) => x.id === targetId);
          if (!t) return `Skipped — target ${targetId} not found.`;
          await setTargetEnabled(targetId, enabled);
          return `${t.applicationName} ${enabled ? "enabled" : "disabled"}.`;
        }
        case "set_filters": {
          setFilters((f) => {
            const next = { ...f };
            if (Array.isArray(tool.input.severities)) {
              next.severities = tool.input.severities as IssueFilters["severities"];
            }
            if (Array.isArray(tool.input.statuses)) {
              next.statuses = tool.input.statuses as IssueFilters["statuses"];
            }
            if (typeof tool.input.application === "string") {
              next.application = tool.input.application;
            }
            if (typeof tool.input.search === "string") {
              next.search = tool.input.search;
            }
            return next;
          });
          return "Filters updated.";
        }
        case "start_verification": {
          await startVerification();
          return "Verification started.";
        }
        case "update_issue_status": {
          const issueId = tool.input.issueId as string | undefined;
          const status = tool.input.status as IssueStatus | undefined;
          if (!issueId || !status) return "Skipped — missing issueId or status.";
          await updateIssueStatusFn(issueId, status);
          return `${issueId} set to ${status}.`;
        }
        case "add_verification_target": {
          // Validate the URL the model passed. We refuse to forward a
          // malformed value to Blocks — better to surface a friendly
          // "Skipped" than to write garbage to the user's data store.
          const rawUrl = tool.input.url as string | undefined;
          if (!rawUrl) return "Skipped — missing url.";
          let parsed: URL;
          try {
            parsed = new URL(rawUrl);
          } catch {
            return `Skipped — "${rawUrl}" is not a valid URL.`;
          }
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return `Skipped — only http(s) URLs are allowed (got ${parsed.protocol}).`;
          }
          // Reject obviously suspicious hosts that the user almost
          // certainly didn't mean to add (loopback, private RFC1918).
          const host = parsed.hostname.toLowerCase();
          const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
          const isPrivate =
            /^10\./.test(host) ||
            /^192\.168\./.test(host) ||
            /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host);
          if (isLoopback || isPrivate) {
            return `Skipped — refusing to add a local/private host (${host}). Use the Issue Tracker UI to register internal targets.`;
          }
          // Dedupe — refuse to add a target whose URL is already in the
          // user's configured list.
          if (targets.some((t) => t.url === parsed.toString())) {
            return `Skipped — ${parsed.toString()} is already a target.`;
          }
          const applicationName =
            (tool.input.applicationName as string | undefined)?.trim() ||
            parsed.hostname.replace(/^www\./, "");
          const environment: TargetEnvironment =
            (tool.input.environment as TargetEnvironment | undefined) ??
            "production";
          try {
            await createTarget.mutateAsync({
              applicationName,
              url: parsed.toString(),
              environment,
              enabled: true,
            });
            return `Target ${applicationName} (${parsed.toString()}) added.`;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return `Couldn't add target — ${message}`;
          }
        }
        case "update_verification_target": {
          const targetId = tool.input.targetId as string | undefined;
          const t = targetId ? targets.find((x) => x.id === targetId) : undefined;
          if (!t) return `Skipped — target ${targetId ?? "(none)"} not found.`;
          const applicationName =
            (tool.input.applicationName as string | undefined)?.trim() ||
            t.applicationName;
          const rawUrl = (tool.input.url as string | undefined)?.trim();
          // No fields to change → nothing to do (and editTarget would
          // happily write the identical row back; skip the round-trip).
          if (
            applicationName === t.applicationName &&
            (!rawUrl || rawUrl === t.url)
          ) {
            return "Skipped — nothing to change.";
          }
          let url = t.url;
          if (rawUrl && rawUrl !== t.url) {
            let parsed: URL;
            try {
              parsed = new URL(rawUrl);
            } catch {
              return `Skipped — "${rawUrl}" is not a valid URL.`;
            }
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
              return `Skipped — only http(s) URLs are allowed (got ${parsed.protocol}).`;
            }
            // Private/loopback hosts are allowed here (unlike add): the
            // target already exists, so pointing it at an internal staging
            // host is a legitimate edit of the user's own configuration.
            url = parsed.toString();
          }
          await editTarget(targetId!, { applicationName, url });
          return `${applicationName} updated.`;
        }
        case "delete_verification_target": {
          const targetId = tool.input.targetId as string | undefined;
          const t = targetId ? targets.find((x) => x.id === targetId) : undefined;
          if (!t) return `Skipped — target ${targetId ?? "(none)"} not found.`;
          await removeTarget(targetId!);
          return `${t.applicationName} removed.`;
        }
        case "create_secret": {
          const name = (tool.input.name as string | undefined)?.trim();
          const email = (tool.input.email as string | undefined)?.trim();
          const password = tool.input.password as string | undefined;
          if (!name || !email || !password) {
            return "Skipped — name, email and password are all required.";
          }
          const targetId = tool.input.targetId as string | undefined;
          if (targetId && !targets.some((x) => x.id === targetId)) {
            return `Skipped — target ${targetId} not found.`;
          }
          try {
            const created = await addSecret({ name, email, password, targetId });
            return `Credential "${created.name}" created${
              targetId ? " and bound to its target" : ""
            }.`;
          } catch {
            // addSecret already toasted the underlying error.
            return "Couldn't create the credential — see the error toast for details.";
          }
        }
        case "update_secret": {
          const secretId = tool.input.secretId as string | undefined;
          const s = secretId ? secrets.find((x) => x.id === secretId) : undefined;
          if (!s) return `Skipped — credential ${secretId ?? "(none)"} not found.`;
          const name =
            (tool.input.name as string | undefined)?.trim() || s.name;
          const email =
            (tool.input.email as string | undefined)?.trim() || s.email;
          if (name === s.name && email === s.email) {
            return "Skipped — nothing to change.";
          }
          await editSecret(secretId!, { name, email });
          return `Credential "${name}" updated.`;
        }
        case "delete_secret": {
          const secretId = tool.input.secretId as string | undefined;
          const s = secretId ? secrets.find((x) => x.id === secretId) : undefined;
          if (!s) return `Skipped — credential ${secretId ?? "(none)"} not found.`;
          // The binding lives on the target side (target.credentialId).
          // Clear it on every target pointing at this secret first, so the
          // delete never leaves a dangling pointer in Blocks Data.
          const bound = targets.filter((t) => t.credentialId === secretId);
          for (const t of bound) {
            await updateTarget.mutateAsync({ id: t.id, patch: { credentialId: null } });
          }
          await deleteSecretFn(secretId!);
          return `"${s.name}" removed${bound.length ? ` (unbound from ${bound.length} target${bound.length > 1 ? "s" : ""})` : ""}.`;
        }
        case "bind_secret": {
          const secretId = tool.input.secretId as string | undefined;
          const s = secretId ? secrets.find((x) => x.id === secretId) : undefined;
          if (!s) return `Skipped — credential ${secretId ?? "(none)"} not found.`;
          const targetId = tool.input.targetId as string | null | undefined;
          if (targetId === undefined) {
            return "Skipped — missing targetId (pass the target id, or null to unbind).";
          }
          if (targetId && !targets.some((x) => x.id === targetId)) {
            return `Skipped — target ${targetId} not found.`;
          }
          await bindSecret(secretId!, targetId);
          return targetId
            ? `"${s.name}" bound to ${targets.find((t) => t.id === targetId)?.applicationName ?? targetId}.`
            : `"${s.name}" unbound.`;
        }
        case "create_project": {
          const name = (tool.input.name as string | undefined)?.trim();
          if (!name) return "Skipped — missing project name.";
          // Same-name guard: the Projects list would render two rows the
          // user can't tell apart, and update/delete-by-name turns
          // ambiguous. Case-insensitive — matches how users expect it.
          if (projects.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
            return `Skipped — a project named "${name}" already exists.`;
          }
          const description = (tool.input.description as string | undefined)?.trim();
          try {
            const created = await createProject.mutateAsync({
              name,
              description: description || undefined,
            });
            return `Project "${created.name}" created. It's visible on the Projects page (not this Issue Tracker page).`;
          } catch (err) {
            // Role guards land here too — e.g. "Testers cannot create
            // projects." Surface it verbatim; don't retry.
            return `Couldn't create the project — ${
              err instanceof Error ? err.message : String(err)
            }`;
          }
        }
        case "update_project": {
          const projectId = tool.input.projectId as string | undefined;
          const p = projectId ? projects.find((x) => x.id === projectId) : undefined;
          if (!p) return `Skipped — project ${projectId ?? "(none)"} not found.`;
          const patch: { name?: string; description?: string; status?: string } = {};
          const name = (tool.input.name as string | undefined)?.trim();
          const description = (tool.input.description as string | undefined)?.trim();
          const status = (tool.input.status as string | undefined)?.trim();
          if (name && name !== p.name) patch.name = name;
          if (description && description !== (p.description ?? "")) {
            patch.description = description;
          }
          if (status && status !== (p.status ?? "active")) patch.status = status;
          if (Object.keys(patch).length === 0) return "Skipped — nothing to change.";
          try {
            const updated = await updateProject.mutateAsync({ id: projectId!, patch });
            return `Project "${updated.name}" updated.`;
          } catch (err) {
            return `Couldn't update the project — ${
              err instanceof Error ? err.message : String(err)
            }`;
          }
        }
        case "delete_project": {
          const projectId = tool.input.projectId as string | undefined;
          const p = projectId ? projects.find((x) => x.id === projectId) : undefined;
          if (!p) return `Skipped — project ${projectId ?? "(none)"} not found.`;
          try {
            await deleteProject.mutateAsync(projectId!);
            return `Project "${p.name}" deleted.`;
          } catch (err) {
            return `Couldn't delete the project — ${
              err instanceof Error ? err.message : String(err)
            }`;
          }
        }
        case "add_project_environment": {
          const projectId = tool.input.projectId as string | undefined;
          const p = projectId ? projects.find((x) => x.id === projectId) : undefined;
          if (!p) return `Skipped — project ${projectId ?? "(none)"} not found.`;
          const label = (tool.input.label as string | undefined)?.trim();
          if (!label) return "Skipped — missing environment label.";
          const slug =
            (tool.input.slug as string | undefined)?.trim() ||
            label
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, "");
          if (!slug) return "Skipped — couldn't derive a slug for that label.";
          // Reject duplicates against BOTH the canonical four and the
          // project's custom envs. `useAddProjectEnv` appends blindly and
          // reads the single-project cache (cold when the user never opened
          // the detail page), so we route through `useUpdateProject` with
          // the full array from the list row instead — no clobber, and the
          // same tester/manager role guard applies inside that hook.
          const existing = new Set([
            "dev",
            "stg",
            "prod",
            "uat",
            ...(p.customEnvs?.map((e) => e.slug) ?? []),
          ]);
          if (existing.has(slug)) {
            return `Skipped — environment "${slug}" already exists on this project.`;
          }
          try {
            await updateProject.mutateAsync({
              id: projectId!,
              patch: {
                customEnvs: [...(p.customEnvs ?? []), { slug, label, color: "#64748b" }],
              },
            });
            return `Environment "${label}" (${slug}) added to ${p.name}.`;
          } catch (err) {
            return `Couldn't add the environment — ${
              err instanceof Error ? err.message : String(err)
            }`;
          }
        }
        case "list_project_contents": {
          const projectId = tool.input.projectId as string | undefined;
          const p = projectId ? projects.find((x) => x.id === projectId) : undefined;
          if (!p) return `Skipped — project ${projectId ?? "(none)"} not found.`;
          try {
            const { features, flows } = await fetchProjectContents(projectId!);
            if (features.length === 0) {
              return `Project "${p.name}" has no features yet (create one with create_feature).`;
            }
            // Compact id-bearing listing — the model needs these ids for
            // update_feature / delete_feature / create_flow / update_flow /
            // delete_flow. Capped so a huge project can't blow the context.
            const featureLines = features.slice(0, 30).map((f) => {
              const fFlows = flows
                .filter((fl) => fl.featureId === f.id)
                .slice(0, 20)
                .map(
                  (fl) =>
                    `    - flow ${fl.id} "${fl.name}" [env:${f.envSlug ?? "—"} status:${fl.status ?? "active"}]`,
                );
              return `- feature ${f.id} "${f.name}" [env:${f.envSlug ?? "—"}]${fFlows.length ? `\n${fFlows.join("\n")}` : ""}`;
            });
            return `Contents of project "${p.name}" (${projectId}):\n${featureLines.join("\n")}${
              features.length > 30 || flows.length > 400
                ? "\n(list truncated — ask the user to narrow down)"
                : ""
            }`;
          } catch (err) {
            return `Couldn't list the project — ${
              err instanceof Error ? err.message : String(err)
            }`;
          }
        }
        case "create_feature": {
          const projectId = tool.input.projectId as string | undefined;
          const p = projectId ? projects.find((x) => x.id === projectId) : undefined;
          if (!p) return `Skipped — project ${projectId ?? "(none)"} not found.`;
          const name = (tool.input.name as string | undefined)?.trim();
          if (!name) return "Skipped — missing feature name.";
          // Features are env-scoped; dev is the source-of-truth env (the
          // cross-env cascade treats dev as the source), so an unspecified
          // env lands there rather than in the legacy env-less shape.
          const envSlug = ((tool.input.envSlug as string | undefined) ?? "dev").trim();
          try {
            const created = await createFeature.mutateAsync({ projectId: projectId!, name, envSlug });
            return `Feature "${created.name}" created in ${p.name} (${envSlug}).`;
          } catch (err) {
            return `Couldn't create the feature — ${
              err instanceof Error ? err.message : String(err)
            }`;
          }
        }
        case "update_feature": {
          const projectId = tool.input.projectId as string | undefined;
          const name = (tool.input.name as string | undefined)?.trim();
          const featureId = tool.input.featureId as string | undefined;
          const featureName = (tool.input.featureName as string | undefined)?.trim();
          if (!projectId || !name || (!featureId && !featureName)) {
            return "Skipped — projectId, the feature (id or name) and the new name are required.";
          }
          try {
            const { features } = await fetchProjectContents(projectId);
            const f = featureId
              ? features.find((x) => x.id === featureId)
              : matchUnique(features, featureName!);
            if (!f) return `Skipped — feature ${featureId ?? `"${featureName}"`} not found in that project.`;
            if (f.name === name) return "Skipped — nothing to change.";
            await updateFeature.mutateAsync({ id: f.id, projectId, patch: { name } });
            return `Feature renamed to "${name}" (was "${f.name}"). Cross-env clones sync automatically.`;
          } catch (err) {
            return `Couldn't rename the feature — ${
              err instanceof Error ? err.message : String(err)
            }`;
          }
        }
        case "delete_feature": {
          const projectId = tool.input.projectId as string | undefined;
          const featureId = tool.input.featureId as string | undefined;
          const featureName = (tool.input.featureName as string | undefined)?.trim();
          if (!projectId || (!featureId && !featureName)) {
            return "Skipped — projectId and the feature (id or name) are required.";
          }
          try {
            const { features } = await fetchProjectContents(projectId);
            const f = featureId
              ? features.find((x) => x.id === featureId)
              : matchUnique(features, featureName!);
            if (!f) return `Skipped — feature ${featureId ?? `"${featureName}"`} not found in that project.`;
            await deleteFeature.mutateAsync({ id: f.id, projectId });
            return `Feature "${f.name}" deleted (cross-env clones removed with it).`;
          } catch (err) {
            return `Couldn't delete the feature — ${
              err instanceof Error ? err.message : String(err)
            }`;
          }
        }
        case "create_flow": {
          const projectId = tool.input.projectId as string | undefined;
          const featureId = tool.input.featureId as string | undefined;
          const featureName = (tool.input.featureName as string | undefined)?.trim();
          const name = (tool.input.name as string | undefined)?.trim();
          if (!projectId || (!featureId && !featureName) || !name) {
            return "Skipped — projectId, the parent feature (id or name) and the flow name are required.";
          }
          const description = (tool.input.description as string | undefined)?.trim();
          const steps = Array.isArray(tool.input.steps)
            ? (tool.input.steps as string[]).map((s) => String(s).trim()).filter(Boolean)
            : undefined;
          try {
            const { features } = await fetchProjectContents(projectId);
            const f = featureId
              ? features.find((x) => x.id === featureId)
              : matchUnique(features, featureName!);
            if (!f) return `Skipped — feature ${featureId ?? `"${featureName}"`} not found in that project.`;
            const created = await createFlow.mutateAsync({
              projectId,
              featureId: f.id,
              name,
              // Flow inherits the parent feature's env — same rule the UI
              // follows, so the flow shows up on the right env page.
              envSlug: f.envSlug,
              ...(description ? { description } : {}),
              ...(steps ? { steps } : {}),
            });
            return `Flow "${created.name}" created under feature "${f.name}" (${f.envSlug ?? "no env"}).`;
          } catch (err) {
            return `Couldn't create the flow — ${
              err instanceof Error ? err.message : String(err)
            }`;
          }
        }
        case "update_flow": {
          const projectId = tool.input.projectId as string | undefined;
          const flowId = tool.input.flowId as string | undefined;
          const flowName = (tool.input.flowName as string | undefined)?.trim();
          if (!projectId || (!flowId && !flowName)) {
            return "Skipped — projectId and the flow (id or name) are required.";
          }
          const name = (tool.input.name as string | undefined)?.trim();
          const status = (tool.input.status as string | undefined)?.trim();
          if (!name && !status) return "Skipped — nothing to change.";
          try {
            const { flows } = await fetchProjectContents(projectId);
            const fl = flowId
              ? flows.find((x) => x.id === flowId)
              : matchUnique(flows, flowName!);
            if (!fl) return `Skipped — flow ${flowId ?? `"${flowName}"`} not found in that project.`;
            const newName = name || fl.name;
            const newStatus = (status || fl.status || "active") as Parameters<
              typeof updateFlow.mutateAsync
            >[0]["status"];
            if (newName === fl.name && newStatus === (fl.status ?? "active")) {
              return "Skipped — nothing to change.";
            }
            // One call covers rename and/or status: `useUpdateFlow` echoes
            // the required-on-update fields and cascades cross-env clones.
            await updateFlow.mutateAsync({
              id: fl.id,
              projectId,
              featureId: fl.featureId,
              status: newStatus,
              patch: name && name !== fl.name ? { name: newName } : {},
            });
            const changes: string[] = [];
            if (name && name !== fl.name) changes.push(`renamed to "${newName}"`);
            if (status && status !== (fl.status ?? "active")) changes.push(`status → ${newStatus}`);
            return `Flow "${fl.name}" ${changes.join(", ")}. Cross-env clones sync automatically.`;
          } catch (err) {
            return `Couldn't update the flow — ${
              err instanceof Error ? err.message : String(err)
            }`;
          }
        }
        case "delete_flow": {
          const projectId = tool.input.projectId as string | undefined;
          const flowId = tool.input.flowId as string | undefined;
          const flowName = (tool.input.flowName as string | undefined)?.trim();
          if (!projectId || (!flowId && !flowName)) {
            return "Skipped — projectId and the flow (id or name) are required.";
          }
          try {
            const { flows } = await fetchProjectContents(projectId);
            const fl = flowId
              ? flows.find((x) => x.id === flowId)
              : matchUnique(flows, flowName!);
            if (!fl) return `Skipped — flow ${flowId ?? `"${flowName}"`} not found in that project.`;
            await deleteFlow.mutateAsync({ id: fl.id, projectId, featureId: fl.featureId });
            return `Flow "${fl.name}" deleted (cross-env clones removed with it).`;
          } catch (err) {
            return `Couldn't delete the flow — ${
              err instanceof Error ? err.message : String(err)
            }`;
          }
        }
        case "open_target_in_browser": {
          // Allowlist dispatch — the targetId MUST match one of the
          // user's configured targets. We never accept a URL string the
          // model invents; even a correctly-shaped "id" that doesn't
          // resolve to a configured target is rejected. The opened page
          // runs in a sandboxed tab (noopener+noreferrer) so it can't
          // reach back into the parent.
          //
          // Falls back to the first configured target when the model
          // (or the local mock) omits targetId AND exactly one target
          // is configured — that's unambiguous enough to act on. When
          // multiple targets exist we still refuse and tell the user.
          const targetId = tool.input.targetId as string | undefined;
          let target = targetId
            ? targets.find((t) => t.id === targetId)
            : undefined;
          if (!target && targets.length === 1) {
            target = targets[0];
          }
          if (!target) {
            return targets.length === 0
              ? "No targets configured — add one first."
              : "Skipped — target not in allowlist. Ask which target to open.";
          }
          // window.open() returns null in some environments (notably
          // headless Chromium / Playwright) even when the tab actually
          // opened. We don't want to mis-report a successful open as a
          // popup block, so we treat `null` as "indeterminate, but
          // likely fine" — only an exception means real failure.
          try {
            window.open(target.url, "_blank", "noopener,noreferrer");
            return `${target.applicationName} opened in a new tab.`;
          } catch {
            return "Couldn't open tab — your browser blocked the popup.";
          }
        }
        case "verify_live_url": {
          // Validate the URL — refuse to forward malformed or non-http(s)
          // schemes. Unlike `add_verification_target` we ALLOW loopback and
          // private-RFC1918 hosts: the user explicitly typed the URL, so
          // we trust their intent (they're testing their own dev server).
          // We still reject file:, data:, javascript:, etc.
          const rawUrl = tool.input.url as string | undefined;
          if (!rawUrl) return "Skipped — missing url.";
          let parsed: URL;
          try {
            parsed = new URL(rawUrl);
          } catch {
            return `Skipped — "${rawUrl}" is not a valid URL.`;
          }
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return `Skipped — only http(s) URLs are allowed (got ${parsed.protocol}).`;
          }

          // Don't clobber an in-flight run. The user can stop / wait first.
          if (run.status === "running" || run.status === "paused") {
            return "Skipped — a verification is already in progress. Stop it first.";
          }

          // Synthesise a one-off target. NOT persisted to Blocks Data —
          // the MCP server keeps it in-memory only for this run. If the
          // user wants this URL saved permanently they can call
          // `add_verification_target`.
          const liveId = `live_${Date.now().toString(36)}_${Math.random()
            .toString(36)
            .slice(2, 6)}`;
          // Credential resolution for the one-off target — explicit-ish
          // hierarchy so a live verification can still log in without the
          // tool ever taking a password parameter:
          //   1. exact saved-target URL match → its bound credential
          //   2. all saved targets on this origin share ONE credential → it
          //   3. several DIFFERENT credentials on this origin → refuse to
          //      guess; ask instead of silently logging in with the wrong
          //      (or no) account.
          const stripTrailing = (u: string) => u.replace(/\/+$/, "");
          const exactTwin = targets.find((t) => {
            try {
              return (
                stripTrailing(new URL(t.url).href) === stripTrailing(parsed.href)
              );
            } catch {
              return false;
            }
          });
          const originTwins = targets.filter((t) => {
            try {
              return new URL(t.url).origin === parsed.origin;
            } catch {
              return false;
            }
          });
          const distinctCreds = new Set(
            originTwins
              .map((t) => t.credentialId)
              .filter((c): c is string => !!c),
          );
          if (!exactTwin?.credentialId && distinctCreds.size > 1) {
            return (
              "Several different credentials are bound to targets on this origin — " +
              "tell me which one to use (by name), or verify the saved target directly."
            );
          }
          const credentialId =
            exactTwin?.credentialId ??
            (distinctCreds.size === 1 ? [...distinctCreds][0] : null);
          const synthetic: VerificationTarget = {
            id: liveId,
            applicationName: parsed.hostname.replace(/^www\./, ""),
            url: parsed.toString(),
            environment: "production",
            enabled: true,
            credentialId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          // Optional scope override from the tool input; fall back to the
          // user's currently-enabled scope.
          const requestedScope = Array.isArray(tool.input.scope)
            ? (tool.input.scope as VerificationCheckId[])
            : scope;

          try {
            // Same load-before-events guarantee as startVerification —
            // the dedup match must see existing rows, not an empty
            // still-fetching list.
            await issuesQuery.refetch().catch(() => undefined);
            const fresh = await issueTrackerApi.startVerification([synthetic], {
              scope: requestedScope,
              userId: currentUser?.id,
            });
            setRun(fresh);
            toast.info(`Live verification of ${parsed.hostname} started.`);

            // Wire the SSE consumer the same way `startVerification` does.
            // Always tear down any leftover subscription first.
            unsubscribeRunRef.current?.();
            unsubscribeRunRef.current = null;
            if (import.meta.env.VITE_USE_REAL_VERIFY === "1") {
              unsubscribeRunRef.current = issueTrackerApi.subscribeRun(fresh.id, {
                onEvent: applyRunEvent,
                onError: () => {
                  unsubscribeRunRef.current?.();
                  unsubscribeRunRef.current = null;
                },
              });
            } else {
              mockCancelRef.current?.();
              mockCancelRef.current = driveMockRun(
                fresh,
                setRun,
                persistDetectedIssue,
                () => {
                  mockCancelRef.current = null;
                  toast.success("Verification complete.");
                },
              );
            }
            return `Live verification of ${parsed.toString()} started (run ${fresh.id})${credentialId ? " — logging in with the credential bound to the matching target" : ""}.`;
          } catch (err) {
            return `Couldn't start live verification — ${
              err instanceof Error ? err.message : String(err)
            }`;
          }
        }
        default: {
          // Browser tools from the official Playwright MCP catalog. Names
          // are whatever @playwright/mcp ships (browser_navigate,
          // browser_click, …) — forwarded verbatim through the backend
          // bridge, which relays them to the official server. The result
          // is remembered in browserResultRef so the NEXT model turn can
          // see what the browser showed. Snapshots (browser_snapshot /
          // browser_navigate output) embed the element refs (e3, e5, …)
          // the official workflow needs for follow-up clicks, so the
          // memory keeps the last two results with a large budget — a
          // truncated ref list is unusable for browser_click.
          if (tool.name.startsWith("browser_")) {
            try {
              const result = await issueTrackerApi.callBrowserTool(
                tool.name,
                tool.input,
              );
              browserResultRef.current = [
                ...browserResultRef.current.slice(-2),
                `${tool.name} → ${result.slice(0, 4000)}`,
              ];
              return `${browserToolSummary(tool.name, tool.input)} — result: ${result.slice(0, 200)}`;
            } catch (err) {
              return `Playwright tool ${tool.name} failed — ${
                err instanceof Error ? err.message : String(err)
              }`;
            }
          }
          return `Unknown tool: ${String(tool.name)}`;
        }
      }
    },
    [
      setTargetEnabled,
      setFilters,
      startVerification,
      updateIssueStatusFn,
      editTarget,
      removeTarget,
      addSecret,
      editSecret,
      deleteSecretFn,
      bindSecret,
      targets,
      secrets,
      projects,
      createProject,
      updateProject,
      deleteProject,
      createFeature,
      updateFeature,
      deleteFeature,
      createFlow,
      updateFlow,
      deleteFlow,
      createTarget,
      updateTarget,
      run.status,
      scope,
      currentUser?.id,
      applyRunEvent,
      persistDetectedIssue,
      toast,
    ],
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
        case "request_tool_permission": {
          // The card payload carries the full proposal — look it up by
          // toolUseId so we don't re-parse the assistant message here.
          const toolUseId = action.payload?.toolUseId as string | undefined;
          const toolName = action.payload?.toolName as string | undefined;
          if (!toolUseId || !toolName) return;
          // Idempotency: an Allow click executes a tool call exactly once,
          // no matter how the action gets re-fired.
          if (executedToolIdsRef.current.has(toolUseId)) return;
          executedToolIdsRef.current.add(toolUseId);
          // Find the assistant message + tool block this action belongs to.
          // Read straight from the live `chat` state — do NOT go through
          // setChat's updater to find it: setChat is async and the
          // closure side-effect wouldn't have run by the time we check
          // below, so `tool` would still be undefined.
          const tool =
            chat
              .flatMap((m) => m.toolUse ?? [])
              .find((x) => x.id === toolUseId) ??
            // Auto-run dispatch may arrive before the setChat that added
            // the proposal has flushed into this closure — rebuild the
            // block from the card payload instead of silently dropping it.
            ({
              id: toolUseId,
              name: toolName,
              input: (action.payload?.toolInput as Record<string, unknown>) ?? {},
            } as ToolUseBlock);
          if (!tool) return;
          // Replace the Allow button with a Deny/Allow status label pair
          // so the user can't fire the same action twice.
          setChat((cur) =>
            cur.map((m) =>
              m.actions?.some(
                (a) =>
                  a.kind === "request_tool_permission" &&
                  (a.payload?.toolUseId as string | undefined) === toolUseId,
              )
                ? {
                    ...m,
                    actions: m.actions.map((a) =>
                      a.kind === "request_tool_permission" &&
                      (a.payload?.toolUseId as string | undefined) === toolUseId
                        ? { ...a, label: "Allowed", id: `${a.id}-done` }
                        : a,
                    ),
                  }
                : m,
            ),
          );
          try {
            const summary = await executeTool(tool);
            // Surface the result back into the chat so the user has a
            // confirmation in-thread, and persist it for the session
            // history.
            const doneMsg: ChatMessage = {
              id: `msg-${Date.now()}`,
              role: "system",
              content: `✓ Done — ${summary}`,
              timestamp: new Date().toISOString(),
            };
            setChat((cur) => [...cur, doneMsg]);
            void appendChatMessage.mutateAsync({
              sessionId,
              role: "system",
              content: doneMsg.content,
            }).catch(() => {});
            // Agentic continuation: fire the model's next turn automatically
            // after a successful tool execution so the conversation flows
            // card → Allow → next card without the user typing "continue"
            // between steps. Applies to EVERY tool (not just browser_*),
            // so the AI follows its Plan→Act→Verify→Loop pattern across
            // state-changing tools (filters, scope, status, edits), browser
            // walkthroughs, and chained actions alike.
            //
            // EXCEPTIONS — tools whose progress is driven by a separate
            // long-running stream (the verification run's SSE feed) so the
            // AI shouldn't kick off another model turn on top of that.
            const SKIP_CONTINUE = new Set(["start_verification", "verify_live_url"]);
            if (!SKIP_CONTINUE.has(tool.name)) {
              if (agentTurnsRef.current >= 60) {
                const stopMsg: ChatMessage = {
                  id: `msg-${Date.now()}`,
                  role: "system",
                  content:
                    "Auto-continuation paused after 60 steps (runaway-loop safety cap) — send any message to continue.",
                  timestamp: new Date().toISOString(),
                };
                setChat((cur) => [...cur, stopMsg]);
                break;
              }
              agentTurnsRef.current += 1;
              setSendingMessage(true);
              try {
                // Browser tools get the proven walkthrough prompt — it
                // explicitly nudges the AI to keep clicking through every
                // reachable flow instead of stopping after one journey.
                // All other tools get the general Plan→Act→Verify→Loop
                // continuation prompt, which keeps the AI engaged after
                // state changes, edits, and chained actions.
                //
                // STUCK-DETECTION: if the last few model turns returned
                // narration-only (no tool_use block), append a forceful
                // reminder — the walkthrough can't move forward on prose
                // alone. The streak counter is reset inside runModelTurn
                // every time a turn carries any tool_use.
                const narrationStreak = narrationOnlyStreakRef.current;
                const isBrowser = tool.name.startsWith("browser_");
                const stuckSuffix =
                  narrationStreak >= 2
                    ? `\n\n⚠️ STUCK-DETECTION: Your last ${narrationStreak} turn(s) returned narration only — no tool_use block. You MUST include exactly ONE tool_use block in THIS reply, paired with ONE narration line. If there is genuinely nothing actionable left, write the FINAL VERIFICATION REPORT (what works, what's broken, evidence you captured) in this same reply — do NOT send another narration-only turn.`
                    : "";
                const continuationPrompt = isBrowser
                  ? `[Continuation] The browser tool "${tool.name}" executed successfully — its result is in the Playwright results block below.

RULES for your reply (browser walkthroughs):
- Your reply MUST contain exactly ONE tool_use block paired with exactly ONE narration line. A narration-only reply (text without a tool_use block) is INVALID — the walkthrough stalls on prose alone.
- The narration line goes FIRST in the same message as the tool call, present tense, action in progress, AND include WHY (not just what). Example: "Clicking the Sign in button to check where it leads…", "Reading the snapshot to pick the next element…", "Filling the email field with a test value to check validation…".
- The walkthrough is CONTINUOUS — there is ALWAYS a next step until the user says stop: the next page, link, form, button of this app, then the next verification target.
- Do NOT end the walkthrough on your own because a journey finished or a step is untestable (e.g. an encrypted credential you cannot type) — note it in one line and move straight on to the next flow.
- Only write the FINAL VERIFICATION REPORT (what works, what's broken, evidence you captured) if the user explicitly asked you to stop/summarize, or if you have genuinely exercised every reachable flow on every target (say so explicitly, flow by flow).
- Do not repeat a call that already succeeded.
- Capture evidence: take screenshots after every action that reveals UI state, and check browser_console_messages after navigation / form submissions / button clicks for unexpected errors.`
                  : `[Continuation] The tool "${tool.name}" executed successfully — its result summary is in the recent system messages above.

Follow your Plan → Act → Verify → Loop pattern:

1. VERIFY: Did the change actually take effect? For state-changing tools (filters, scope, status updates, edits), the NEXT CURRENT STATE you receive in this turn reflects the result — compare it to what you asked for. For query tools, decide whether the data answers the user's question.

2. DECIDE: If the user's goal is complete AND they have not asked for more, write a final answer (not a tool call). Otherwise propose exactly ONE next step — either a tool call OR a focused clarifying question. DO NOT end a multi-step journey on your own just because one tool succeeded.

3. NARRATE: Before any next tool call, write ONE line in the same message — present tense, action in progress, include WHY (not just what).

Continue.`;
                // FORCED TOOL USE: for browser_* walkthroughs we set `tool_choice: any`
                // so the model literally CANNOT produce a narration-only
                // reply. Even when it thinks the walkthrough should end,
                // the API forces it to call at least one tool first —
                // typically browser_take_screenshot or
                // browser_console_messages, which doubles as cheap
                // evidence the user can read. Non-browser continuations
                // intentionally keep `toolChoice` undefined so the model
                // can legitimately finish a multi-step journey with a
                // summary instead of another tool call.
                const toolChoice = isBrowser
                  ? ({ type: "any" } as const)
                  : undefined;
                await runModelTurn(continuationPrompt + stuckSuffix, { toolChoice });
                // STEP-TIMEOUT SAFETY: if the model produced a tool_use,
                // `narrationOnlyStreakRef` was reset inside runModelTurn —
                // we are healthy. If it returned narration only and the
                // user is staring at a stalled chat, schedule a nudge
                // that fires only if the NEXT turn also stalls (so we
                // don't interrupt a still-generating reply).
                if (narrationOnlyStreakRef.current >= 2) {
                  const turnAt = lastAutoTurnAtRef.current ?? Date.now();
                  window.setTimeout(() => {
                    // Only nudge if no new reply has landed in the
                    // meantime AND the streak is still at >=2. By then
                    // the AI should have either called a tool or written
                    // the final report — if it hasn't, force it to act.
                    if (
                      narrationOnlyStreakRef.current >= 2 &&
                      lastAutoTurnAtRef.current === turnAt
                    ) {
                      // The nudge also uses `tool_choice: any` for the
                      // same reason the auto-continue does: a nudge-only
                      // text reply re-stalls the walkthrough just as
                      // quickly as the original narration. Forcing
                      // tool use keeps the loop honest. Non-browser
                      // stalls still get to terminate with a summary.
                      const nudgeToolChoice = isBrowser
                        ? ({ type: "any" } as const)
                        : undefined;
                      void runModelTurn(
                        `[Nudge] Your last reply was narration-only and the walkthrough has been idle. Reply with EITHER one tool_use block (next flow, screenshot, console check, etc.) OR the final verification report — no more prose-only turns.`,
                        { toolChoice: nudgeToolChoice },
                      ).catch(() => {});
                    }
                  }, 30_000);
                }
              } catch {
                toast.error(
                  "Couldn't continue the conversation — send a message to resume.",
                );
              } finally {
                setSendingMessage(false);
                setAiRetryStatus(null);
              }
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            // Un-mark the call so the user can retry straight from the
            // card, and restore its Allow button — leaving an "Allowed"
            // label on a failed call misrepresents what happened.
            executedToolIdsRef.current.delete(toolUseId);
            setChat((cur) =>
              cur.map((m) =>
                m.actions?.some(
                  (a) =>
                    a.kind === "request_tool_permission" &&
                    (a.payload?.toolUseId as string | undefined) === toolUseId,
                )
                  ? {
                      ...m,
                      actions: m.actions.map((a) =>
                        a.kind === "request_tool_permission" &&
                        (a.payload?.toolUseId as string | undefined) ===
                          toolUseId
                          ? { ...a, label: "Allow" }
                          : a,
                      ),
                    }
                  : m,
              ),
            );
            const failMsg: ChatMessage = {
              id: `msg-${Date.now()}`,
              role: "system",
              content: `✗ Tool failed — ${message}. You can retry from the card above.`,
              timestamp: new Date().toISOString(),
            };
            setChat((cur) => [...cur, failMsg]);
            void appendChatMessage.mutateAsync({
              sessionId,
              role: "system",
              content: failMsg.content,
            }).catch(() => {});
            toast.error(`Tool failed: ${message}`);
          }
          break;
        }
        case "dismiss":
        default:
          break;
      }
    },
    [
      startVerification,
      toast,
      executeTool,
      setChat,
      appendChatMessage,
      sessionId,
      chat,
      runModelTurn,
    ],
  );
  // Latest-ref handoff for the auto-run browser dispatch in runModelTurn
  // (declared far above; see applyChatActionRef). Assigned during render —
  // the standard latest-ref pattern — so it always points at the closure
  // with the freshest `chat` state.
  applyChatActionRef.current = applyChatAction;

  // ──────────────────────────────────────────────────────────────────────────
  //  Scope
  // ──────────────────────────────────────────────────────────────────────────
  const toggleScope = useCallback((id: VerificationCheckId) => {
    setScope((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
  }, []);

  // Stable clearFilters — without the useCallback wrapper this closure is
  // reallocated on every render, which in turn re-renders `IssueFilters`
  // (it takes `onClear` as a prop and is memoised downstream).
  const clearFilters = useCallback(() => setFilters(defaultFilters), []);

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
    runActivityLog,
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
    aiRetryStatus,
    testingTargetId,

    // targets
    addTarget,
    removeTarget,
    setTargetEnabled,
    editTarget,

    // secrets
    addSecret,
    editSecret,
    deleteSecret: deleteSecretFn,
    bindSecret,

    // issues
    setFilters,
    clearFilters,
    setSelectedIssueId,
    updateIssueStatus: updateIssueStatusFn,
    toggleIssuesAssignee,
    approveIssue,

    // verification
    startVerification,
    pauseVerification,
    resumeVerification,
    stopVerification,
    toggleScope,
    device,
    setDevice,
    exportRunReport,

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
    deleteSession: deleteSessionFn,
    renameSession: renameSessionFn,
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

export function groupByApplication(issues: Issue[]): Map<string, Issue[]> {
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

function lastCompletedRun(run: VerificationRun, now: number = Date.now()): string | null {
  if (!run.completedAt) return null;
  // Clamp at zero — a client clock ahead of `completedAt` would otherwise
  // render "-1m ago" if local time drifted briefly.
  const diffMs = Math.max(0, now - new Date(run.completedAt).getTime());
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

// Mock progress driver — replaces the AI Agent / MCP for this phase. Now
// persists findings through `useCreateIssue` (the Blocks mutation) so the
// new issue actually lands in the cloud instead of vanishing on a refresh.
// `persistDetectedIssue` is the callback `useIssueTracker` builds with the
// mutation handle and passes back here.
//
// Returns a `cancel` function so the caller can flush pending timeouts when
// the user navigates away mid-run (otherwise setRun fires on an unmounted
// component and React logs a warning).
type PersistDetectedIssue = (
  payload: Issue,
  runId: string,
) => Promise<void>;

function driveMockRun(
  initial: VerificationRun,
  setRun: React.Dispatch<React.SetStateAction<VerificationRun>>,
  persistDetectedIssue: PersistDetectedIssue,
  onDone: () => void,
): () => void {
  let snapshot = initial;
  // Collect every timeout handle so we can flush them on cancel. Using a
  // single Set keeps cleanup O(n) regardless of how many ticks were
  // scheduled, and the Set#size doubles as a useful indicator when
  // debugging.
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let cancelled = false;

  const tick = (delay: number, mutate: () => void) => {
    const id = setTimeout(() => {
      timers.delete(id);
      if (cancelled) return;
      mutate();
      setRun({ ...snapshot });
    }, delay);
    timers.add(id);
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
    if (cancelled) return;
    snapshot = {
      ...snapshot,
      status: "completed",
      completedAt: new Date().toISOString(),
      completedTargets: snapshot.totalTargets,
    };
    setRun(snapshot);
    // Synthesize a fresh issue discovered during the run and persist it
    // through Blocks so the panel reflects it on the next render (and on
    // the next refresh / second device). Issue id is derived from the
    // first target's id so consecutive runs on the same target don't
    // collide; falls back to a random id only when no targets are
    // configured.
    const firstApp = apps[0];
    const detected: Issue = {
      id: firstApp
        ? `ISSUE-${firstApp.targetId}-${Date.now().toString(36)}`
        : `ISSUE-${String(Math.floor(Math.random() * 9000) + 1000)}`,
      title: "Newly discovered: console error on initial paint",
      applicationName: firstApp?.applicationName ?? "Unverified application",
      url: firstApp?.targetId
        ? ""
        : "/dashboard",
      category: "ui",
      severity: "medium",
      status: "open",
      description: "Detected during the most recent verification run.",
      detectedAt: new Date().toISOString(),
    };
    void persistDetectedIssue(detected, snapshot.id);
    onDone();
  });

  // Return a cancel function the caller can invoke on unmount / when a
  // real run replaces the mock. Flushed timeouts are no-ops because they
  // check `cancelled` before mutating.
  return () => {
    cancelled = true;
    timers.forEach((id) => clearTimeout(id));
    timers.clear();
  };
}
