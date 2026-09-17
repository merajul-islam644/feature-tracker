// Thin wrapper around `blocksClient.notifier.*` so call-sites stay tidy.
//
// Two surfaces live here:
//
//   1. `notifyRole(role, payload)` — fire-and-forget wrapper that targets
//      every user holding a given IAM role. Errors are swallowed
//      upstream of the notifier (we want the create mutation to succeed
//      even if the tenant hasn't set up the manager role yet).
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

export async function notifyRole(
  role: string,
  payload: NotifyRolePayload,
): Promise<unknown> {
  return blocksClient.notifier.notify({
    roles: [role],
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
  if (ctx === "feature" && action === "created") return "New feature";
  if (ctx === "project" && action === "updated") return "Project updated";
  if (ctx === "feature" && action === "updated") return "Feature updated";
  return `${ctx} ${action}`;
}

function deriveBody(payload: Record<string, unknown>): string {
  const projectName =
    typeof payload.projectName === "string" ? payload.projectName : undefined;
  const featureName =
    typeof payload.featureName === "string" ? payload.featureName : undefined;
  if (projectName && featureName) {
    return `“${featureName}” added to project “${projectName}”.`;
  }
  if (projectName) return `Project “${projectName}” was created.`;
  if (featureName) return `Feature “${featureName}” was created.`;
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

export function useNotificationInbox() {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["notifications", userId, INBOX_PAGE_SIZE] as const,
    enabled: Boolean(userId),
    queryFn: async () => {
      const result = (await blocksClient.notifier.getNotifications({
        page: 1,
        pageSize: INBOX_PAGE_SIZE,
        sortBy: "CreatedTime",
        sortDescending: true,
      })) as RawInboxResponse;
      return result;
    },
  });

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

  return {
    items,
    isLoading: query.isLoading,
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
