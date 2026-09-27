// Thin wrapper around the custom `Notification` data-collection so call
// sites stay tidy. Replaces the previous platform-notifier path; the
// historical context for that decision lives in
// `docs/platform-bug-notifier-enumeration.md`.
//
// Two surfaces live here:
//
//   1. `notifyRole(role, payload)` — fire-and-forget wrapper that writes
//      one `Notification` row per recipient in `RECIPIENTS_BY_ROLE`.
//      Each row carries the full denormalized payload (projectName,
//      featureName, flowName, actorName, etc.) so the inbox can render
//      a title/body without a follow-up read. Errors are swallowed
//      upstream of the notifier; the create/rename/delete mutation
//      itself must always succeed regardless of notification backend
//      health.
//
//   2. `useNotificationInbox()` — TanStack Query-backed inbox for the
//      signed-in user. Polls `notificationsCollection.list({ filter:
//      { userId: me } })` every 5 s, sorts newest-first, returns
//      `InboxItem[]` shaped so `NotificationBell` and
//      `NotificationDetailPage` consume it unchanged. Read-state
//      mutations use `notificationsCollection.update(id, { readAt })`
//      for a single row and a list-then-update sweep for "mark all".
//
// Why user ids instead of `roles: [role]`: the data-collection is
// workspace-readable, so any user could query any row. We isolate
// visibility via the `filter: { userId: me }` clause on the read side,
// matching the per-user filter pattern used by `DirectMessage` and
// `CallSignal`. Server-side row ACLs would require a `rules.json`
// entry per row; we deliberately don't add one (see
// `blocks/data/rules.json` — empty `policies: []` matches the existing
// per-user collections).

import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FolderPlus,
  FolderEdit,
  FolderMinus,
  PackagePlus,
  PackageX,
  GitBranchPlus,
  GitBranch,
  Plus,
  Pencil,
  Trash2,
  Info,
  Activity,
  Layers,
  Copy,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { blocksClient } from "./client";
import {
  notificationsCollection,
  type CloudNotification,
  unwrapPaged,
} from "./data";
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

// Configuration name was used by the old `blocksClient.notifier.notify`
// path. Replaced by the data-collection write; the constant is kept as
// a historical pointer so anyone grepping the old name lands here.

// Notification recipients, indexed by IAM role. `notifyRole(role)`
// looks the role up here and targets the resulting user ids
// directly. `notifyRole` writes one `Notification` row per user id, so
// each recipient can filter their inbox with
// `filter: { userId: <me> }` (matches the `DirectMessage.recipientId`
// and `CallSignal.recipientId` pattern — workspace-readable collection,
// client-side per-user isolation).
//
// Hardcoded map: `iam.users.list({ filter: { roles: role } })` returns
// 403 from a browser session — the endpoint is admin-only. Verified via
// `blocks iam users list` on 2026-09-24 — the tenant has:
//   - 1 active tester:   Meraj Zoarder (meraz-zoarder14@yopmail.com,
//     db4bca2e-459d-4bd5-8c65-4700ca858084)
//   - 3 active developers: Hafizul Zoarder (d39eb926-…), Meraj
//     Zoarder meraz-zoarder13 (4832284e-…), Meraj Zoarder
//     meraz-zoarder15 (9890d32d-…).
//   - 1 inactive developer (hafijulzoarder@gmail.com, f3610e95-…)
//     intentionally excluded.
//
// TODO(server-side-proxy): the long-term fix is a server-side proxy
// that holds an admin token and forwards
// `iam.users.list({ filter: { roles: role } })` on behalf of the
// browser. Until that proxy ships, any new testers/developers added
// via `blocks iam users update --roles <role> …` need their id
// appended here, and a redeploy is required to pick the new ids up.
export const RECIPIENTS_BY_ROLE: Record<string, readonly string[]> = {
  tester: ["db4bca2e-459d-4bd5-8c65-4700ca858084"],
  developer: [
    "d39eb926-6c04-461c-8833-6ed00189a520",
    "4832284e-9219-42d5-bd2a-4d60dd30a3e8",
    "9890d32d-c956-429d-88d7-cce465824fe5",
  ],
  // Manager role intentionally has no recipients — managers see
  // their own actions reflected in the project list and don't need
  // to be notified.
};

export async function notifyRole(
  roles: string | readonly string[],
  payload: NotifyRolePayload,
): Promise<unknown> {
  // Accept either a single role or an array of roles. When multiple
  // roles are passed (e.g. `["tester", "developer"]`) the broadcast
  // reaches the union of all roles' user ids. Dedupe so a user who
  // holds both roles (e.g. a tester-also-developer) doesn't see the
  // same row twice in their inbox.
  const roleList = Array.isArray(roles) ? roles : [roles];
  const userIds = Array.from(
    new Set(roleList.flatMap((r) => RECIPIENTS_BY_ROLE[r] ?? [])),
  );
  // No recipients registered for any of the requested roles —
  // silently no-op. This happens when notifyRole is called with a
  // role we haven't onboarded (e.g. `admin`) and shouldn't surface
  // as an error.
  if (userIds.length === 0) return undefined;
  // Build the row payload ONCE — every recipient's row carries the
  // same denormalized fields, only `userId` differs.
  const rowBase: Omit<NotificationInsert, "userId"> = {
    context: payload.context,
    actionName: payload.actionName,
    actorId: typeof payload.actorId === "string" ? payload.actorId : "",
    value: typeof payload.value === "string" ? payload.value : "",
    actorName:
      typeof payload.actorName === "string" ? payload.actorName : "A manager",
    projectId: typeof payload.projectId === "string" ? payload.projectId : "",
    projectName:
      typeof payload.projectName === "string" ? payload.projectName : "",
    featureId: typeof payload.featureId === "string" ? payload.featureId : "",
    featureName:
      typeof payload.featureName === "string" ? payload.featureName : "",
    flowId: typeof payload.flowId === "string" ? payload.flowId : "",
    flowName: typeof payload.flowName === "string" ? payload.flowName : "",
    envSlug: typeof payload.envSlug === "string" ? payload.envSlug : "",
    oldName: typeof payload.oldName === "string" ? payload.oldName : "",
    newName: typeof payload.newName === "string" ? payload.newName : "",
    status: typeof payload.status === "string" ? payload.status : "",
    stack: typeof payload.stack === "string" ? payload.stack : "",
    // Mark unread on insert. Empty string (rather than undefined) so
    // the schema's "no default value" rule doesn't trip on missing.
    readAt: "",
  };
  // Best-effort write: every recipient is independent, so we use
  // `Promise.allSettled` rather than `Promise.all`. A failure on one
  // row doesn't drop the others. Call sites `.catch(() => {})` on the
  // returned promise because notifier errors must never block the
  // underlying mutation.
  return Promise.allSettled(
    userIds.map((userId) =>
      notificationsCollection.create({ ...rowBase, userId }),
    ),
  );
}

// Shape of the row passed to `notificationsCollection.create`. Mirrors
// `CloudNotification` but drops the platform-managed audit fields
// (`ItemId`, `CreatedDate`, `LastUpdatedDate`, `CreatedBy`,
// `LastUpdatedBy`) — those are auto-stamped by the data gateway.
type NotificationInsert = {
  userId: string;
  context: string;
  actionName: string;
  actorId: string;
  value: string;
  actorName: string;
  projectId: string;
  projectName: string;
  featureId: string;
  featureName: string;
  flowId: string;
  flowName: string;
  envSlug: string;
  oldName: string;
  newName: string;
  status: string;
  stack: string;
  readAt: string;
};

// Notify the SPECIFIC users assigned to a feature — both the chosen
// developers AND the chosen QAs. Differs from `notifyRole("tester",
// …)` (a role-targeted broadcast) in two ways:
//
//   1. Recipients are the per-feature `developerIds` / `qaIds`
//      arrays, not "every user holding the tester role". A tester
//      who wasn't picked for this feature won't see a row in their
//      inbox — only the people the manager actually assigned.
//
//   2. The action tag is `feature.assigned` (not `feature.created`),
//      so the inbox builder renders an "Assigned to feature …"
//      title and a body that addresses the recipient directly
//      ("…assigned you to…"). The general broadcast path keeps its
//      `feature.created` shape so an unassigned tester still sees a
//      creation event when one is emitted from anywhere else.
//
// Empty arrays short-circuit before the SDK call — a feature
// created without assignees skips the notifier entirely (the
// broadcast path in `notifyRole` is the right surface for that case
// if the caller wants it).
export interface NotifyAssignedFeatureInput {
  featureId: string;
  featureName: string;
  projectId: string;
  projectName?: string;
  envSlug?: string;
  developerIds: string[];
  qaIds: string[];
  actorName: string;
  actorId: string;
}

export async function notifyAssignedFeature(
  input: NotifyAssignedFeatureInput,
): Promise<unknown> {
  // Deduplicate — the same id could appear in both arrays (a user
  // holds both roles) and the inbox would otherwise render two rows
  // for the same feature-create event.
  const recipients = Array.from(
    new Set([...input.developerIds, ...input.qaIds]),
  );
  if (recipients.length === 0) return undefined;
  const rowBase: Omit<NotificationInsert, "userId"> = {
    context: "feature",
    actionName: "assigned",
    actorId: input.actorId,
    value: input.featureId,
    actorName: input.actorName,
    projectId: input.projectId,
    projectName: input.projectName ?? "",
    featureId: input.featureId,
    featureName: input.featureName,
    flowId: "",
    flowName: "",
    envSlug: input.envSlug ?? "",
    oldName: "",
    newName: "",
    status: "",
    stack: "",
    readAt: "",
  };
  return Promise.allSettled(
    recipients.map((userId) =>
      notificationsCollection.create({ ...rowBase, userId }),
    ),
  );
}

// ── Inbox hook ────────────────────────────────────────────────────────

export interface InboxItem {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  /** Raw context from the payload — `project`/`feature`/`flow`/`environment`. */
  context: string;
  /** Raw action from the payload — `created`/`renamed`/`deleted`. */
  action: string;
  /** Actor who triggered the event; defaults to "A manager" if the payload omitted it. */
  actorName: string;
  /** Optional ids/names denormalized for richer rendering. */
  projectId?: string;
  projectName?: string;
  featureId?: string;
  featureName?: string;
  flowId?: string;
  flowName?: string;
  envSlug?: string;
}

interface RawInboxResponse {
  notifications: InboxItem[];
  totalNotificationsCount: number;
  unReadNotificationsCount: number;
}

function deriveTitle(payload: Record<string, unknown>): string {
  const ctx = typeof payload.context === "string" ? payload.context : "item";
  const action = typeof payload.actionName === "string" ? payload.actionName : "updated";
  // `environment.renamed` keeps the old from→to distinction (env
  // slugs are user-typed identifiers); project/feature/flow rename
  // titles simplified to "X name updated" since those bodies now just
  // show the new name without the old→new pair.
  const oldName =
    typeof payload.oldName === "string" ? payload.oldName : undefined;
  const newName =
    typeof payload.newName === "string" ? payload.newName : undefined;
  if (ctx === "project" && action === "created") return "New project";
  if (ctx === "project" && action === "renamed") return "Project name updated";
  if (ctx === "project" && action === "deleted") return "Project deleted";
  if (ctx === "feature" && action === "created") return "New feature";
  if (ctx === "feature" && action === "assigned") return "Assigned to feature";
  if (ctx === "feature" && action === "renamed") return "Feature name updated";
  if (ctx === "feature" && action === "deleted") return "Feature deleted";
  if (ctx === "flow" && action === "created") return "New flow";
  if (ctx === "flow" && action === "renamed") return "Flow name updated";
  if (ctx === "flow" && action === "deleted") return "Flow deleted";
  if (ctx === "environment" && action === "created") return "Environment added";
  if (ctx === "environment" && action === "renamed")
    return oldName && oldName !== newName
      ? "Environment renamed"
      : "Environment updated";
  if (ctx === "flow" && action === "status_changed")
    return "Flow status updated";
  if (ctx === "flow" && action === "stack_changed")
    return "Flow stack updated";
  if (ctx === "flow" && action === "cloned") return "Flow cloned";
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

  // Project events. `projectName` is the typical payload field, but
  // some older records — and any path that fans out from a hook
  // missing the field — only carry `oldName` (the project as the
  // caller knew it). Fall back to `oldName` so testers still see a
  // useful sentence instead of the generic "Reference: <id>".
  //
  // A `project.renamed` whose old and new names are identical is a
  // no-op rename — happens when a hook fires the rename path because
  // the cloud schema required `name` on the patch but the user wasn't
  // actually renaming. Don't render "renamed X to X"; surface what
  // we know instead.
  const projectLabel =
    projectName ?? (ctx === "project" ? oldName : undefined);
  if (ctx === "project" && (projectLabel || oldName || newName)) {
    if (action === "created" && projectLabel)
      return `${actorName} created project “${projectLabel}”.`;
    if (action === "renamed") {
      const target = newName ?? projectLabel;
      if (target)
        return `${actorName} updated project name to “${target}”.`;
      return `${actorName} updated project name.`;
    }
    if (action === "deleted" && projectLabel)
      return `${actorName} deleted project “${projectLabel}”.`;
  }
  // Feature events
  if (ctx === "feature" && featureName) {
    if (action === "created")
      return `${actorName} added feature “${featureName}”${
        projectName ? ` to project “${projectName}”` : ""
      }.`;
    if (action === "assigned")
      return `${actorName} assigned you to feature “${featureName}”${
        projectName ? ` in project “${projectName}”` : ""
      }${envSlug ? ` (${envSlug})` : ""}.`;
    if (action === "renamed")
      return `${actorName} updated feature name to “${featureName}”${
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
      return `${actorName} updated flow name to “${flowName}”${
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
    if (action === "renamed") {
      if (oldName && oldName !== envSlug)
        return `${actorName} renamed environment “${oldName}” to “${envSlug}”${
          projectName ? ` in project “${projectName}”` : ""
        }.`;
      return `${actorName} updated environment “${envSlug}”${
        projectName ? ` in project “${projectName}”` : ""
      }.`;
    }
  }
  // Flow chip / clone events (added in Option C). `flowName` covers
  // status_changed / stack_changed / cloned; `envSlug` is the
  // destination env on `cloned` and the current env on chip changes.
  if (ctx === "flow" && flowName) {
    const statusLabel =
      typeof payload.status === "string" ? payload.status : undefined;
    const stackLabel =
      typeof payload.stack === "string" ? payload.stack : undefined;
    if (action === "status_changed" && statusLabel)
      return `${actorName} changed status of “${flowName}” to “${statusLabel}”${
        envSlug ? ` (${envSlug})` : ""
      }.`;
    if (action === "stack_changed" && stackLabel)
      return `${actorName} changed stack of “${flowName}” to “${stackLabel}”${
        envSlug ? ` (${envSlug})` : ""
      }.`;
    if (action === "cloned" && envSlug)
      return `${actorName} cloned flow “${flowName}” to environment “${envSlug}”${
        projectName ? ` in project “${projectName}”` : ""
      }.`;
  }
  const value =
    typeof payload.value === "string" && payload.value !== "*"
      ? payload.value
      : undefined;
  return value ? `Reference: ${value}` : "You have a new notification.";
}

function toInboxItem(n: CloudNotification): InboxItem | null {
  if (!n.ItemId) {
    console.warn(
      "[notifier] Skipping notification row without an id; mark-read would have been a silent no-op.",
      n,
    );
    return null;
  }
  const ctx = n.context ?? "";
  const action = n.actionName ?? "";
  // Build a payload-shaped object so `deriveTitle` and `deriveBody`
  // keep working unchanged. Mirrors the previous JSON-denormalized
  // shape, just sourced from typed columns instead of a parsed blob.
  const payload: Record<string, unknown> = {
    context: ctx,
    actionName: action,
    actorName: n.actorName ?? "A manager",
    projectId: n.projectId ?? "",
    projectName: n.projectName ?? "",
    featureId: n.featureId ?? "",
    featureName: n.featureName ?? "",
    flowId: n.flowId ?? "",
    flowName: n.flowName ?? "",
    envSlug: n.envSlug ?? "",
    oldName: n.oldName ?? "",
    newName: n.newName ?? "",
    status: n.status ?? "",
    stack: n.stack ?? "",
    value: n.value ?? "",
  };
  // `value` carries the resource id for feature/flow mutations;
  // project notifications use `projectId` directly. Mirror the
  // previous logic so the inbox's "Reference: <id>" fallback still
  // has a chance to render if every display field is missing.
  const valueId =
    typeof payload.value === "string" && payload.value !== ""
      ? payload.value
      : undefined;
  const featureId = ctx === "feature" ? valueId : n.featureId;
  const flowId = ctx === "flow" ? valueId : n.flowId;
  return {
    id: n.ItemId,
    title: deriveTitle(payload),
    body: deriveBody(payload),
    createdAt: n.CreatedDate ?? new Date(0).toISOString(),
    // Empty `readAt` (the value we stamp on insert) maps to unread;
    // any non-empty string marks the row read.
    read: Boolean(n.readAt && n.readAt !== ""),
    context: ctx,
    action,
    actorName: n.actorName && n.actorName !== "" ? n.actorName : "A manager",
    projectId: n.projectId || undefined,
    projectName: n.projectName || undefined,
    featureName: n.featureName || undefined,
    flowName: n.flowName || undefined,
    featureId: featureId || undefined,
    flowId: flowId || undefined,
    envSlug: n.envSlug || undefined,
  };
}

// `INBOX_PAGE_SIZE` is the per-page row count we ask the data
// gateway for. Sized to comfortably cover the largest inbox we've
// seen on this tenant (60 rows) so a single page fetch is enough —
// no pagination walk, no short-page ambiguity. If a future inbox
// exceeds this, bump the constant; the bell + detail page already
// cope with whatever the array holds.
const INBOX_PAGE_SIZE = 60;
// How often the bell re-fetches the inbox. 5s matches
// `useAnnouncements` and `useDirectMessages` so all three ambient
// surfaces refresh on the same cadence — a tester who has the app
// open learns about a manager action within seconds of the action
// landing.
const INBOX_POLL_MS = 5_000;

export function useNotificationInbox() {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  const qc = useQueryClient();

  // Snapshot of rows we've recently stamped as read. The platform's
  // read gateway is eventually-consistent (verified 2026-09-26): the
  // `update` writes are acknowledged immediately and a follow-up
  // direct `get` sees them, but the `list` endpoint can serve the
  // pre-write state for ~10 s. Without guarding, the very next poll
  // after mark-all-read would overwrite our optimistic "all read"
  // cache flip with rows where `readAt === ""`, re-painting the bell
  // badge back to N until the server-side write finally propagates.
  //
  // The snapshot records (a) the IDs we marked and (b) an expiry
  // timestamp. While the snapshot is fresh, the queryFn patches any
  // stale `unread` row whose ID is in the snapshot back to `read`.
  // New rows (not in the snapshot) pass through, so a manager action
  // during the cooldown window still surfaces immediately.
  const markedReadSnapshotRef = useRef<{
    ids: Set<string>;
    expiresAt: number;
  } | null>(null);
  // How long the snapshot stays authoritative. Long enough to span
  // the platform's worst observed read-replica lag window; short
  // enough that a stuck snapshot can't keep a stale row hidden
  // forever if the write genuinely failed.
  const MARKED_READ_SNAPSHOT_TTL_MS = 30_000;
  const stampMarkedReadSnapshot = (ids: string[]): void => {
    if (ids.length === 0) return;
    const expiresAt = Date.now() + MARKED_READ_SNAPSHOT_TTL_MS;
    const prev = markedReadSnapshotRef.current;
    if (prev && prev.expiresAt > Date.now()) {
      // Extend the existing snapshot's lifetime rather than reset it,
      // so consecutive single-row mark-reads don't punch a fresh
      // 30 s window starting at each click (they share one).
      prev.expiresAt = Math.max(prev.expiresAt, expiresAt);
      for (const id of ids) prev.ids.add(id);
      return;
    }
    markedReadSnapshotRef.current = { ids: new Set(ids), expiresAt };
  };
  const applyMarkedReadSnapshot = (
    notifications: InboxItem[],
  ): InboxItem[] => {
    const snap = markedReadSnapshotRef.current;
    if (!snap || snap.expiresAt <= Date.now() || snap.ids.size === 0) {
      return notifications;
    }
    let changed = false;
    const patched = notifications.map((n) => {
      if (!n.read && snap.ids.has(n.id)) {
        changed = true;
        return { ...n, read: true };
      }
      return n;
    });
    return changed ? patched : notifications;
  };

  // Cooldown on background polling after mark-all-read. The snapshot
  // patch above covers `queryFn` (which is the polling path), but the
  // user reported the bug kept re-occurring even with snapshot
  // patching — the platform's read lag window can stretch past 30 s
  // on this tenant, and *any* refetch that returns pre-write rows
  // clobbers the optimistic cache. While the cooldown is active, we
  // skip the periodic `invalidateQueries` tick entirely; new writes
  // from managers will still surface on the next non-cooldown tick
  // (or on the next focus / navigation, which use their own refetch
  // path that ALSO runs through `queryFn` and the snapshot patch).
  // We deliberately don't pause for single-row mark-read (it's rare
  // to click many rows in a row) — just for the bulk sweep, which is
  // the only path the user actually complains about.
  const pollingCooldownUntilRef = useRef<number>(0);
  const POLL_COOLDOWN_AFTER_MARK_ALL_MS = 60_000;

  // Read first — both mutations below need `query.data` to find the
  // unread rows to stamp. Polling is NOT wired through `useQuery`'s
  // built-in `refetchInterval` — instead it's hand-rolled via the
  // `useEffect` block further down so it can be paused while either
  // mark-read mutation is in flight (otherwise the 5 s tick can race
  // the in-flight updates and overwrite the optimistic "all read"
  // cache flip with stale "unread" rows from the platform's
  // eventually-consistent read replica).
  const query = useQuery({
    queryKey: ["notifications", userId] as const,
    enabled: Boolean(userId),
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<RawInboxResponse> => {
      // `userId` MUST be in the selector (see `notificationsCollection`
      // in `data.ts`); the gateway silently drops unselected filter
      // columns — same lesson as every other per-user collection.
      // Sorting by `CreatedDate: -1` keeps newest-first ordering so
      // the bell surfaces the freshest row at the top.
      const raw = await notificationsCollection.list({
        filter: { userId },
        pageNo: 1,
        pageSize: INBOX_PAGE_SIZE,
        sort: { CreatedDate: -1 },
      });
      const items: InboxItem[] = unwrapPaged<CloudNotification>(raw)
        .items.map(toInboxItem)
        .filter((item: InboxItem | null): item is InboxItem => item !== null);
      // Patch the server response with our locally-known read state
      // for any row that came back stale (still `unread`) but that we
      // recently stamped as read. See `markedReadSnapshotRef` above.
      const patched = applyMarkedReadSnapshot(items);
      const unReadNotificationsCount = patched.filter((n) => !n.read).length;
      return {
        notifications: patched,
        totalNotificationsCount: patched.length,
        unReadNotificationsCount,
      };
    },
  });

  // Mark a single notification as read. Returns a STABLE reference
  // (`useCallback`) so consumers can put it in a `useEffect` dep array
  // without triggering re-renders. Earlier versions returned a fresh
  // arrow each render — combined with the detail page's
  // `useEffect([notificationId, markRead])`, that re-fired the
  // mutation on every poll tick, eventually exhausting the browser's
  // request budget. The badge updates locally via `setQueryData` so
  // the unread count comes down immediately, without re-fetching the
  // inbox.
  //
  // Update shape: we send ONLY the `requiredOn: "Both"` fields plus
  // the field we're actually changing (`readAt`). Sending the full
  // row (every schema field echoed back) caused the platform's
  // `updateNotification` mutation to silently drop the change — the
  // row came back from the next poll with `readAt: ""`, the badge
  // snapped back to N, and the user saw the inbox re-fill itself
  // even after a successful mark-all-read round trip. Same root cause
  // as `useMarkDirectMessageRead` / `useUpdateAnnouncement`: those
  // send a small patch too (3–4 fields), not the full row.
  // Fetch-then-patch here so we have current `requiredOn: "Both"`
  // values to echo without re-typing the schema field list at every
  // call site.
  //
  // We also check `acknowledged` on the mutation response — the
  // platform's update returns `{ acknowledged, itemId, message, ... }`
  // and a validation miss surfaces as `acknowledged: false`, NOT as
  // a thrown error. Without this check we'd flip the local cache to
  // "read" while the server still thinks the row is unread, and the
  // very next 5s poll would re-paint the badge back up.
  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      // `notificationsCollection.get` is a list query filtered by `ItemId`,
      // so the response is the paged envelope `{ data: { getNotifications: { items: [...] } } }`.
      // `unwrapPaged` drills through both layers and returns `{ items, totalCount }`.
      // The earlier code used `current.userId` directly on the raw response —
      // those fields all live on `current.items[0]`, not on the envelope, so
      // they read as `undefined` and JSON.stringify silently dropped them,
      // which made the server reject the patch with `VALIDATION_ERROR`
      // ("Field 'userId' is required for update."). Verified 2026-09-26 in the
      // browser dev-tools: a `markAllRead` click sent only the 14
      // optional-on-update fields and the bell stayed at 5 unread.
      const paged = unwrapPaged<CloudNotification>(
        await notificationsCollection.get(id),
      );
      const current = paged.items[0];
      if (!current) {
        throw new Error(`Notification ${id} no longer exists`);
      }
      const now = new Date().toISOString();
      // Echo every field the schema defines, then override `readAt`.
      // `ItemId` and the audit fields (`CreatedDate` /
      // `LastUpdatedDate` / `CreatedBy` / `LastUpdatedBy`) are
      // platform-managed — do NOT send them in the update payload;
      // they're auto-stamped by the gateway. Verified 2026-09-26 by
      // the developer-account test: the 5-field minimal patch was
      // returning `acknowledged: true` and the optimistic flip stayed
      // at 0 while the page was open, but a hard refresh (which wipes
      // the in-memory cache + snapshot) brought back all N rows as
      // `readAt: ""`, proving the writes never actually persisted —
      // the gateway appears to silently drop the change when any
      // column is omitted from the patch.
      const response = (await notificationsCollection.update(id, {
        userId: current.userId,
        context: current.context,
        actionName: current.actionName,
        actorId: current.actorId,
        value: current.value ?? "",
        actorName: current.actorName ?? "",
        projectId: current.projectId ?? "",
        projectName: current.projectName ?? "",
        featureId: current.featureId ?? "",
        featureName: current.featureName ?? "",
        flowId: current.flowId ?? "",
        flowName: current.flowName ?? "",
        envSlug: current.envSlug ?? "",
        oldName: current.oldName ?? "",
        newName: current.newName ?? "",
        status: current.status ?? "",
        stack: current.stack ?? "",
        readAt: now,
      })) as { acknowledged?: boolean; message?: string } | undefined;
      if (response && response.acknowledged === false) {
        throw new Error(
          `Mark-read failed for ${id}: ${response.message ?? "not acknowledged"}`,
        );
      }
      return response;
    },
    onSuccess: (_data, id) => {
      // Record this row in the marked-read snapshot so the next poll,
      // if it returns the pre-write state for this row from a stale
      // read replica, gets patched back to `read` by the queryFn
      // before the cache is updated.
      stampMarkedReadSnapshot([id]);
      qc.setQueryData<RawInboxResponse>(
        ["notifications", userId],
        (prev) => {
          if (!prev) return prev;
          const notifications = prev.notifications.map((n) =>
            n.id === id ? { ...n, read: true } : n,
          );
          // Decrement the unread count by exactly one (floor at 0)
          // so the bell badge reflects the flip right away.
          const nextUnread = Math.max(0, prev.unReadNotificationsCount - 1);
          return {
            ...prev,
            notifications,
            unReadNotificationsCount: nextUnread,
          };
        },
      );
    },
  });

  // Mark every notification as read. Same minimal-patch shape as
  // `markReadMutation` (only the `requiredOn: "Both"` fields + the
  // `readAt` change) — sending the full row caused the server to
  // silently drop the change and the badge to snap back on the next
  // poll. Sequential updates keep request volume predictable for
  // small inboxes; if we ever grow past ~50 unread at once, switch to
  // `Promise.all` with a concurrency limiter. `allSettled` keeps the
  // local cache flip on the success path even if any single row
  // reports `acknowledged: false` — the failed rows just stay unread
  // on the server and a follow-up poll surfaces them naturally.
  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      if (!query.data) return;
      const unreadIds = query.data.notifications
        .filter((n) => !n.read)
        .map((n) => n.id);
      if (unreadIds.length === 0) return;
      const now = new Date().toISOString();
      const results = await Promise.allSettled(
        unreadIds.map(async (id) => {
          // See `markReadMutation` above for why we have to unwrap the
          // paged envelope (`{ data: { getNotifications: { items: [...] } } }`)
          // before reading any field on the row.
          const paged = unwrapPaged<CloudNotification>(
            await notificationsCollection.get(id),
          );
          const current = paged.items[0];
          if (!current) {
            throw new Error(`Notification ${id} no longer exists`);
          }
          // Echo every schema field — see the matching note on
          // `markReadMutation` above. The data-collection gateway in
          // this tenant silently drops `readAt` updates when any
          // column is omitted from the patch.
          const response = (await notificationsCollection.update(id, {
            userId: current.userId,
            context: current.context,
            actionName: current.actionName,
            actorId: current.actorId,
            value: current.value ?? "",
            actorName: current.actorName ?? "",
            projectId: current.projectId ?? "",
            projectName: current.projectName ?? "",
            featureId: current.featureId ?? "",
            featureName: current.featureName ?? "",
            flowId: current.flowId ?? "",
            flowName: current.flowName ?? "",
            envSlug: current.envSlug ?? "",
            oldName: current.oldName ?? "",
            newName: current.newName ?? "",
            status: current.status ?? "",
            stack: current.stack ?? "",
            readAt: now,
          })) as { acknowledged?: boolean; message?: string } | undefined;
          if (response && response.acknowledged === false) {
            throw new Error(
              `Mark-read failed for ${id}: ${response.message ?? "not acknowledged"}`,
            );
          }
          return id;
        }),
      );
      // Surface per-row failures so they show up in the dev console
      // — the cache flip below still happens (failed rows stay unread
      // on the server and the next poll surfaces them) but we don't
      // want a silent ack=false to disappear.
      results.forEach((r, i) => {
        if (r.status === "rejected") {
          console.warn(
            "[notifier] mark-all-read update failed for",
            unreadIds[i],
            r.reason,
          );
        }
      });
    },
    onSuccess: () => {
      // Capture every ID we just stamped into the marked-read
      // snapshot so the next few polls (which can return the pre-write
      // state from the platform's eventually-consistent read replica)
      // patch those rows back to `read` instead of clobbering our
      // optimistic flip. We snapshot from `query.data` (the pre-flip
      // inbox) — only `unread` rows were touched by the sweep, so we
      // don't need to track the full list.
      const stampedIds =
        query.data?.notifications
          .filter((n) => !n.read)
          .map((n) => n.id) ?? [];
      stampMarkedReadSnapshot(stampedIds);
      // Pause background polling for the cooldown window so the
      // platform's stale read replica can't clobber the optimistic
      // cache. `refetchOnWindowFocus` / manual navigation-triggered
      // invalidations still go through `queryFn` and the snapshot
      // patch above, so they're safe.
      pollingCooldownUntilRef.current =
        Date.now() + POLL_COOLDOWN_AFTER_MARK_ALL_MS;
      qc.setQueryData<RawInboxResponse>(
        ["notifications", userId],
        (prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            notifications: prev.notifications.map((n) => ({
              ...n,
              read: true,
            })),
            unReadNotificationsCount: 0,
          };
        },
      );
    },
  });

  // Polling is driven by a hand-rolled `useEffect` `setInterval` rather
  // than `useQuery`'s built-in `refetchInterval` for two reasons:
  //
  //   1. Mid-mutation pause. While `markReadMutation` /
  //      `markAllReadMutation` is in flight, the interval skips its
  //      `invalidateQueries` call so a stale poll can't race the
  //      optimistic cache flip.
  //
  //   2. Three-layer eventual-consistency defense:
  //      (a) minimal-payload update shape so the server actually
  //          persists `readAt` (the full-row shape caused silent
  //          drops — verified earlier in this fix chain);
  //      (b) `markedReadSnapshotRef` inside `queryFn` patches any
  //          pre-write row that the stale replica serves back;
  //      (c) `pollingCooldownUntilRef` below pauses background
  //          polling entirely for `POLL_COOLDOWN_AFTER_MARK_ALL_MS`
  //          after a mark-all-read sweep — the snapshot TTL alone
  //          wasn't enough on this tenant; the read lag can stretch
  //          past 30 s, and any refetch during that window would
  //          clobber the optimistic cache. The cooldown is set ONLY
  //          for bulk sweeps, never for single-row mark-read.
  useEffect(() => {
    if (!userId) return;
    const id = window.setInterval(() => {
      if (
        markReadMutation.isPending ||
        markAllReadMutation.isPending
      ) {
        return;
      }
      if (Date.now() < pollingCooldownUntilRef.current) {
        // Background polling is paused while the platform's read
        // replica catches up. New writes from managers will surface
        // on the first tick after cooldown (or sooner via a manual
        // refetch through `queryFn` + snapshot patch).
        return;
      }
      void qc.invalidateQueries({ queryKey: ["notifications", userId] });
    }, INBOX_POLL_MS);
    return () => window.clearInterval(id);
  }, [
    userId,
    qc,
    markReadMutation.isPending,
    markAllReadMutation.isPending,
  ]);

  const items = query.data?.notifications ?? [];
  const unread = unreadCount(items);
  const total = query.data?.totalNotificationsCount ?? items.length;

  return {
    items,
    isLoading: query.isLoading,
    unread,
    total,
    // Stable refs so consumers can put them in `useEffect` deps
    // without re-firing the mutation on every render.
    markRead: useCallback(
      (id: string) => markReadMutation.mutate(id),
      [markReadMutation],
    ),
    markAllRead: useCallback(
      () => markAllReadMutation.mutate(),
      [markAllReadMutation],
    ),
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

/**
 * Exact timestamp for tooltip on the relative "1d ago" label.
 * Locale-aware via `Intl.DateTimeFormat` (same approach as
 * `src/lib/blocks/i18n.tsx`'s `formatRelative`); falls back to a
 * locale-naive string if Intl throws.
 */
export function formatExact(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const date = new Date(t);
  try {
    return new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

/**
 * Per-(context, action) visual hint used by the bell row:
 * - icon: Lucide component to render in the colored circle
 * - tone: Tailwind classes for icon + circle (light + dark)
 *
 * Unknown (context, action) pairs collapse to a neutral info chip so
 * the bell never breaks when new payload combinations land before
 * this map is updated.
 */
export interface ActionVisual {
  // Lucide icon component, typed as `LucideIcon` so the row can pass
  // any of the standard Lucide props (size, className, aria-hidden)
  // without a per-call cast.
  Icon: LucideIcon;
  // Tailwind classes for the icon text color and the background ring.
  // Pattern matches `IssueSummary.tsx` so the bell visually agrees
  // with the rest of the app's tone vocabulary.
  tone: string;
  ring: string;
}

export function actionVisual(
  context: string,
  action: string,
): ActionVisual {
  // Project
  if (context === "project") {
    if (action === "created")
      return {
        Icon: FolderPlus,
        tone: "text-emerald-600 dark:text-emerald-400",
        ring: "bg-emerald-500/10 dark:bg-emerald-400/10",
      };
    if (action === "renamed")
      return {
        Icon: FolderEdit,
        tone: "text-sky-600 dark:text-sky-400",
        ring: "bg-sky-500/10 dark:bg-sky-400/10",
      };
    if (action === "deleted")
      return {
        Icon: FolderMinus,
        tone: "text-red-600 dark:text-red-400",
        ring: "bg-red-500/10 dark:bg-red-400/10",
      };
  }
  // Feature
  if (context === "feature") {
    if (action === "created")
      return {
        Icon: PackagePlus,
        tone: "text-emerald-600 dark:text-emerald-400",
        ring: "bg-emerald-500/10 dark:bg-emerald-400/10",
      };
    if (action === "assigned")
      return {
        Icon: UserPlus,
        tone: "text-blue-600 dark:text-blue-400",
        ring: "bg-blue-500/10 dark:bg-blue-400/10",
      };
    if (action === "renamed")
      return {
        Icon: Pencil,
        tone: "text-sky-600 dark:text-sky-400",
        ring: "bg-sky-500/10 dark:bg-sky-400/10",
      };
    if (action === "deleted")
      return {
        Icon: PackageX,
        tone: "text-red-600 dark:text-red-400",
        ring: "bg-red-500/10 dark:bg-red-400/10",
      };
  }
  // Flow
  if (context === "flow") {
    if (action === "created")
      return {
        Icon: GitBranchPlus,
        tone: "text-emerald-600 dark:text-emerald-400",
        ring: "bg-emerald-500/10 dark:bg-emerald-400/10",
      };
    if (action === "renamed")
      return {
        Icon: GitBranch,
        tone: "text-sky-600 dark:text-sky-400",
        ring: "bg-sky-500/10 dark:bg-sky-400/10",
      };
    if (action === "deleted")
      return {
        Icon: Trash2,
        tone: "text-red-600 dark:text-red-400",
        ring: "bg-red-500/10 dark:bg-red-400/10",
      };
    // Chip changes and cross-env clones added in Option C. Each gets a
    // distinct tone so the bell can distinguish "the flow's chip value
    // moved" from "the flow itself moved to another env" without the
    // user reading the body.
    if (action === "status_changed")
      return {
        Icon: Activity,
        tone: "text-amber-600 dark:text-amber-400",
        ring: "bg-amber-500/10 dark:bg-amber-400/10",
      };
    if (action === "stack_changed")
      return {
        Icon: Layers,
        tone: "text-violet-600 dark:text-violet-400",
        ring: "bg-violet-500/10 dark:bg-violet-400/10",
      };
    if (action === "cloned")
      return {
        Icon: Copy,
        tone: "text-blue-600 dark:text-blue-400",
        ring: "bg-blue-500/10 dark:bg-blue-400/10",
      };
  }
  // Environment (only created + renamed are emitted today; deleted is
  // implicit via project delete, so map it defensively).
  if (context === "environment") {
    if (action === "created")
      return {
        Icon: Plus,
        tone: "text-emerald-600 dark:text-emerald-400",
        ring: "bg-emerald-500/10 dark:bg-emerald-400/10",
      };
    if (action === "renamed")
      return {
        Icon: Pencil,
        tone: "text-sky-600 dark:text-sky-400",
        ring: "bg-sky-500/10 dark:bg-sky-400/10",
      };
    if (action === "deleted")
      return {
        Icon: Trash2,
        tone: "text-red-600 dark:text-red-400",
        ring: "bg-red-500/10 dark:bg-red-400/10",
      };
  }
  // Fallback for any unknown context/action pair.
  return {
    Icon: Info,
    tone: "text-muted-foreground",
    ring: "bg-muted",
  };
}
