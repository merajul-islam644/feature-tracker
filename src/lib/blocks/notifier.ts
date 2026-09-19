// Thin wrapper around `blocksClient.notifier.*` so call-sites stay tidy.
//
// Two surfaces live here:
//
//   1. `notifyRole(role, payload)` — fire-and-forget wrapper that pushes
//      a notification to the user ids registered for the given IAM role
//      (see `RECIPIENTS_BY_ROLE`). Targets the notifier by `userIds`
//      (not `roles`) because the platform's `GetNotifications` list
//      endpoint in this tenant enumerates user-targeted records but not
//      role-targeted ones — so user-targeted payloads are the only kind
//      the bell can read back. Errors are swallowed upstream of the
//      notifier; the create/rename/delete mutation itself must always
//      succeed regardless of notification backend health.
//
//   2. `useNotificationInbox()` — TanStack Query-backed inbox for the
//      signed-in user. Replaces the previous zustand mock store with
//      real `blocksClient.notifier.getNotifications` calls plus the
//      matching `markNotificationAsRead` / `markAllNotificationAsRead`
//      mutations. The returned shape mirrors the old store (`items`,
//      `markRead`, `markAllRead`) so NotificationBell needs only a
//      small swap.
//
// `payload` is sent as a `subscriptionFilter` (so the manager can
// filter by `context`/`actionName` later) AND as a denormalized payload
// (so the inbox can render a title/body without a follow-up read).
// The `saveDenormalizedPayloadAsAnObject: true` flag keeps the server
// able to index the fields — read back they arrive as a parsed object
// on `n.denormalizedPayload`.
//
// Tenant-side status (verified 2026-09-18):
//   - `blocks notification save --update --name feature-tracker-events
//     --channel 0 --type 1 --enable-persistence --notify-method 0`
//     is required. `--type 0` makes the notifier return 500
//     "Invalid ReceiverType (Parameter 'NoReceiverType')"; `--type 1`
//     (UserSpecificReceiverType) is what the platform's own
//     translation/import notifications use.
//   - `--type 1` + `userIds` from the browser succeeds (200) and the
//     bell shows it (verified).
//   - `--type 1` + `roles` from the browser also succeeds (200) but
//     the List endpoint doesn't enumerate role-targeted records —
//     `totalNotificationsCount` increments, `notifications: []`.
//   - The CLI returns `no_configuration_exist` for the same config
//     the browser accepts; this is a token-scope mismatch (CLI is
//     admin, browser is user) and not actionable from app code.

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { blocksClient } from "./client";
import { useAuth } from "@/hooks/useAuth";

export interface NotifyRolePayload {
  /** Free-form grouping — `project`, `feature`, etc. */
  context: string;
  /** What happened — `created`, `updated`, etc. */
  actionName: string;
  /** Resource id (or `*` when there isn't one). */
  value?: string;
  /** Free-form extras — these all flow into the inbox title/body. */
  [key: string]: unknown;
}

// Configuration name for our notification channel. Created via the
// Blocks CLI:
//   blocks notification save --update --name "feature-tracker-events" \
//     --channel 0 --type 1 --enable-persistence --notify-method 0
// Centralized so a future rename only touches one place. The `type=1`
// flag is the magic bit — `type=0` makes the notifier return 500
// "Invalid ReceiverType (Parameter 'NoReceiverType')" once a
// `configurationName` is set; `type=1` (UserSpecificReceiverType)
// matches what the platform's own language-translation notifications
// use and is what the gateway accepts.
const NOTIFIER_CONFIGURATION_NAME = "feature-tracker-events";

// Notification recipients, indexed by IAM role. `notifyRole(role)`
// looks the role up here and targets the resulting user ids
// directly.
//
// Why user ids instead of `roles: [role]`: the platform's
// `GetNotifications` list endpoint counts role-targeted records
// (`totalNotificationsCount: 6`) but never enumerates them
// (`notifications: []`), and the subscription-filter GET endpoint
// requires a JSON body the SDK cannot send. User-targeted
// notifications, by contrast, render through the same List endpoint
// the inbox already polls — so the bell actually shows them.
//
// Why a hardcoded map: `iam.users.list({ filter: { roles: role } })`
// returns 403 from a browser session — the endpoint is admin-only.
// The tenant has exactly one tester today (Meraj Zoarder,
// meraz-zoarder14@yopmail.com, db4bca2e-…); any new testers added
// via `blocks iam users update --roles tester …` need their id
// appended here until the platform exposes a browser-safe listing.
const RECIPIENTS_BY_ROLE: Record<string, readonly string[]> = {
  tester: ["db4bca2e-459d-4bd5-8c65-4700ca858084"],
  // Manager role intentionally has no recipients — managers see
  // their own actions reflected in the project list and don't need
  // to be notified.
};

export async function notifyRole(
  role: string,
  payload: NotifyRolePayload,
): Promise<unknown> {
  const userIds = RECIPIENTS_BY_ROLE[role];
  // No recipients registered for this role — silently no-op. This
  // happens when notifyRole is called with a role we haven't
  // onboarded (e.g. `admin`) and shouldn't surface as an error.
  if (!userIds || userIds.length === 0) return undefined;
  return blocksClient.notifier.notify({
    configurationName: NOTIFIER_CONFIGURATION_NAME,
    // The SDK type marks these three fields optional, but the gateway
    // returns 400 if any is missing once `configurationName` is set
    // (verified via `blocks notifier notify` on 2026-09-18). The
    // values are not used by the inbox (the real content lives in
    // `denormalizedPayload`); the gateway just insists they be
    // present.
    connectionId: "default",
    responseKey: "default",
    responseValue: "default",
    userIds: [...userIds],
    subscriptionFilters: [
      {
        context: payload.context,
        actionName: payload.actionName,
        value: payload.value ?? "*",
      },
    ],
    denormalizedPayload: JSON.stringify(payload),
    saveDenormalizedPayloadAsAnObject: true,
  });
}

// ── Inbox hook ────────────────────────────────────────────────────────

export interface InboxItem {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}

interface RawInboxNotification {
  id?: string;
  createdTime?: string;
  isRead?: boolean;
  denormalizedPayload?: unknown;
}

interface RawInboxResponse {
  notifications?: RawInboxNotification[];
  totalNotificationsCount?: number;
  unReadNotificationsCount?: number;
}

function parseDenormalized(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function deriveTitle(payload: Record<string, unknown>): string {
  const ctx = typeof payload.context === "string" ? payload.context : "item";
  const action = typeof payload.actionName === "string" ? payload.actionName : "updated";
  if (ctx === "project" && action === "created") return "New project";
  if (ctx === "project" && action === "renamed") return "Project renamed";
  if (ctx === "project" && action === "deleted") return "Project deleted";
  if (ctx === "feature" && action === "created") return "New feature";
  if (ctx === "feature" && action === "renamed") return "Feature renamed";
  if (ctx === "feature" && action === "deleted") return "Feature deleted";
  if (ctx === "flow" && action === "created") return "New flow";
  if (ctx === "flow" && action === "renamed") return "Flow renamed";
  if (ctx === "flow" && action === "deleted") return "Flow deleted";
  if (ctx === "environment" && action === "created") return "Environment added";
  if (ctx === "environment" && action === "renamed") return "Environment renamed";
  return `${ctx} ${action}`;
}

function deriveBody(payload: Record<string, unknown>): string {
  const actorName =
    typeof payload.actorName === "string" ? payload.actorName : "A manager";
  const projectName =
    typeof payload.projectName === "string" ? payload.projectName : undefined;
  const featureName =
    typeof payload.featureName === "string" ? payload.featureName : undefined;
  const flowName =
    typeof payload.flowName === "string" ? payload.flowName : undefined;
  const envSlug =
    typeof payload.envSlug === "string" ? payload.envSlug : undefined;
  const newName =
    typeof payload.newName === "string" ? payload.newName : undefined;
  const oldName =
    typeof payload.oldName === "string" ? payload.oldName : undefined;
  const ctx = typeof payload.context === "string" ? payload.context : "item";
  const action = typeof payload.actionName === "string" ? payload.actionName : "updated";

  // Project events
  if (ctx === "project" && projectName) {
    if (action === "created") return `${actorName} created project “${projectName}”.`;
    if (action === "renamed")
      return `${actorName} renamed project “${oldName ?? ""}” to “${newName ?? projectName}”.`;
    if (action === "deleted") return `${actorName} deleted project “${projectName}”.`;
  }
  // Feature events
  if (ctx === "feature" && featureName) {
    if (action === "created")
      return `${actorName} added feature “${featureName}”${
        projectName ? ` to project “${projectName}”` : ""
      }.`;
    if (action === "renamed")
      return `${actorName} renamed feature “${oldName ?? ""}” to “${newName ?? featureName}”${
        projectName ? ` in project “${projectName}”` : ""
      }.`;
    if (action === "deleted")
      return `${actorName} deleted feature “${featureName}”${
        projectName ? ` from project “${projectName}”` : ""
      }.`;
  }
  // Flow events
  if (ctx === "flow" && flowName) {
    if (action === "created")
      return `${actorName} added flow “${flowName}”${
        projectName ? ` in project “${projectName}”` : ""
      }.`;
    if (action === "renamed")
      return `${actorName} renamed flow “${oldName ?? ""}” to “${newName ?? flowName}”${
        projectName ? ` in project “${projectName}”` : ""
      }.`;
    if (action === "deleted")
      return `${actorName} deleted flow “${flowName}”${
        projectName ? ` from project “${projectName}”` : ""
      }.`;
  }
  // Environment events
  if (ctx === "environment" && envSlug) {
    if (action === "created")
      return `${actorName} added environment “${envSlug}”${
        projectName ? ` to project “${projectName}”` : ""
      }.`;
    if (action === "renamed")
      return `${actorName} renamed environment “${oldName ?? ""}” to “${envSlug}”${
        projectName ? ` in project “${projectName}”` : ""
      }.`;
  }
  const value =
    typeof payload.value === "string" && payload.value !== "*"
      ? payload.value
      : undefined;
  return value ? `Reference: ${value}` : "You have a new notification.";
}

function toInboxItem(n: RawInboxNotification): InboxItem {
  const payload = parseDenormalized(n.denormalizedPayload);
  return {
    // Real `id` is required for the SDK's `markNotificationAsRead({ id })`.
    // Fall back to a per-render uuid only if the upstream record is
    // missing one — that case is exotic (legacy rows?) and a click will
    // be a no-op rather than a hard crash.
    id: n.id ?? crypto.randomUUID(),
    title: deriveTitle(payload),
    body: deriveBody(payload),
    createdAt: n.createdTime ?? new Date(0).toISOString(),
    read: Boolean(n.isRead),
  };
}

const INBOX_PAGE_SIZE = 20;
// How often the bell re-fetches the inbox. Aggressive enough that a
// tester who has the app open in another tab learns about a manager
// action within ~30s, light enough that 100 concurrent sessions don't
// hammer the notifier service. Visibility changes refresh immediately
// — the 30s timer is the backstop for a tab that has been left open.
const INBOX_POLL_MS = 30 * 1000;

export function useNotificationInbox() {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["notifications", userId, INBOX_PAGE_SIZE] as const,
    enabled: Boolean(userId),
    queryFn: async () => {
      // Single List endpoint suffices now that `notifyRole` targets
      // by `userIds` — user-targeted records render through here
      // correctly (`totalNotificationsCount`, `notifications`, and
      // `unReadNotificationsCount` are all populated). We previously
      // tried `roles: [...]` targeting because it's the SDK-documented
      // path, but the platform's List endpoint counts those records
      // without enumerating them and the subscription-filter GET
      // endpoint requires a JSON body the SDK can't send — so the
      // only end-to-end-working path today is `userIds`.
      const result = (await blocksClient.notifier.getNotifications({
        page: 1,
        pageSize: INBOX_PAGE_SIZE,
      })) as RawInboxResponse;
      return result;
    },
  });

  // 30s polling + visibility-refresh. `refetchInterval` from TanStack
  // Query would also work, but we already do the same pattern in
  // `AuthProvider` (visibilitychange + setInterval) — keeping the two
  // pieces of "ambient refresh" symmetric makes future readers' job
  // easier.
  useEffect(() => {
    if (!userId) return;
    const id = window.setInterval(() => {
      qc.invalidateQueries({ queryKey: ["notifications", userId] });
    }, INBOX_POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        qc.invalidateQueries({ queryKey: ["notifications", userId] });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [userId, qc]);

  const markRead = useMutation({
    mutationFn: async (id: string) =>
      blocksClient.notifier.markNotificationAsRead({ id }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["notifications", userId] }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => blocksClient.notifier.markAllNotificationAsRead(),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["notifications", userId] }),
  });

  const items: InboxItem[] = (query.data?.notifications ?? [])
    .map(toInboxItem);

  // Surface the API-reported totals alongside the (possibly empty)
  // items array so the bell badge stays in sync with what the
  // notifier service has actually persisted. In this tenant the
  // platform counts records it can't enumerate — `totalNotificationsCount`
  // climbs as we send but `notifications: []` — so deriving the badge
  // count from `items.length` would silently underreport.
  const totalCount =
    query.data?.totalNotificationsCount ?? items.length;
  const unreadFromApi = query.data?.unReadNotificationsCount ?? 0;
  // Take the larger of (unread-from-items, unread-from-api) so we
  // never hide a count the server knows about.
  const unread = Math.max(
    unreadCount(items),
    unreadFromApi,
    totalCount - items.filter((n) => n.read).length,
  );

  return {
    items,
    isLoading: query.isLoading,
    unread,
    total: totalCount,
    markRead: (id: string) => markRead.mutate(id),
    markAllRead: () => markAllRead.mutate(),
  };
}

// Count + relative-time helpers — moved here from the old zustand store
// so NotificationBell only needs to import from one place.

export function unreadCount(items: InboxItem[]): number {
  return items.filter((n) => !n.read).length;
}

export function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diffSec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (diffSec < 60) return "just now";
  const m = Math.floor(diffSec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
