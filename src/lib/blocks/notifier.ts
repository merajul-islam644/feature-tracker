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

import { useCallback, useEffect } from "react";
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
import { blocksConfig } from "./config";
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
// `GetNotifications` list endpoint counts records
// (`totalNotificationsCount: 6`) but on this tenant may return them
// without enumerating them (`notifications: []`) — both for
// role-targeted and, as of 2026-09-19, user-targeted payloads.
// We work around this with a subscription-filter fallback path
// (`getUnreadNotificationsBySubscriptionFilter`) that pulls rows
// by `(context, actionName)` even when the main List endpoint is
// silent. The fallback is gated on `totalCount > 0 &&
// notifications.length === 0` so we don't pay the extra round
// trips for inboxes that already enumerate cleanly.
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
    // `subscriptionFilters` was previously sent on every call so the
    // manager could filter by `context`/`actionName` later. That
    // works fine for the actions registered on the configuration
    // (`project.created`, `feature.deleted`, etc.) but the platform
    // appears to use the supplied filter as a deliverability gate —
    // actions outside the registered set (`project.renamed`,
    // `feature.renamed`, `flow.status_changed`, ...) were silently
    // dropped on 2026-09-19. Since `userIds` is the only
    // recipient-targeting we actually need today (see the long
    // comment on `RECIPIENTS_BY_ROLE` above), we stop sending
    // subscription filters and let every notification persist so
    // the inbox can render whatever shape arrives.
    denormalizedPayload: JSON.stringify(payload),
    saveDenormalizedPayloadAsAnObject: true,
  });
}

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
  return blocksClient.notifier.notify({
    configurationName: NOTIFIER_CONFIGURATION_NAME,
    connectionId: "default",
    responseKey: "default",
    responseValue: "default",
    userIds: recipients,
    denormalizedPayload: JSON.stringify({
      context: "feature",
      actionName: "assigned",
      value: input.featureId,
      projectId: input.projectId,
      projectName: input.projectName,
      featureName: input.featureName,
      envSlug: input.envSlug,
      actorName: input.actorName,
      actorId: input.actorId,
    }),
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
  /** True when the page walk hit an empty page — we've enumerated
   *  everything the server can give us, even if `notifications.length`
   *  is below `totalNotificationsCount` (tenant quirk). */
  exhausted?: boolean;
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
  // `*renamed` titles are misleading when `oldName === newName` — that
  // case usually means the hook fired the rename path because the
  // cloud schema required `name` on the patch even when nothing was
  // actually renamed. Degrade to a generic "updated" title so the
  // bell row doesn't lie about what happened.
  const oldName =
    typeof payload.oldName === "string" ? payload.oldName : undefined;
  const newName =
    typeof payload.newName === "string" ? payload.newName : undefined;
  const isRealRename =
    !!oldName && !!newName && oldName !== newName;
  if (ctx === "project" && action === "created") return "New project";
  if (ctx === "project" && action === "renamed")
    return isRealRename ? "Project renamed" : "Project updated";
  if (ctx === "project" && action === "deleted") return "Project deleted";
  if (ctx === "feature" && action === "created") return "New feature";
  if (ctx === "feature" && action === "assigned") return "Assigned to feature";
  if (ctx === "feature" && action === "renamed")
    return isRealRename ? "Feature renamed" : "Feature updated";
  if (ctx === "feature" && action === "deleted") return "Feature deleted";
  if (ctx === "flow" && action === "created") return "New flow";
  if (ctx === "flow" && action === "renamed")
    return isRealRename ? "Flow renamed" : "Flow updated";
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
      if (oldName && newName && oldName !== newName)
        return `${actorName} renamed project “${oldName}” to “${newName}”.`;
      if (projectLabel)
        return `${actorName} updated project “${projectLabel}”.`;
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
    if (action === "renamed") {
      if (oldName && newName && oldName !== newName)
        return `${actorName} renamed feature “${oldName}” to “${newName}”${
          projectName ? ` in project “${projectName}”` : ""
        }.`;
      return `${actorName} updated feature “${featureName}”${
        projectName ? ` in project “${projectName}”` : ""
      }.`;
    }
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
    if (action === "renamed") {
      if (oldName && newName && oldName !== newName)
        return `${actorName} renamed flow “${oldName}” to “${newName}”${
          projectName ? ` in project “${projectName}”` : ""
        }.`;
      return `${actorName} updated flow “${flowName}”${
        projectName ? ` in project “${projectName}”` : ""
      }.`;
    }
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

function toInboxItem(n: RawInboxNotification): InboxItem {
  const payload = parseDenormalized(n.denormalizedPayload);
  const ctx = typeof payload.context === "string" ? payload.context : "";
  const action =
    typeof payload.actionName === "string" ? payload.actionName : "";
  const projectId =
    typeof payload.projectId === "string" ? payload.projectId : undefined;
  const projectName =
    typeof payload.projectName === "string" ? payload.projectName : undefined;
  const featureName =
    typeof payload.featureName === "string" ? payload.featureName : undefined;
  const flowName =
    typeof payload.flowName === "string" ? payload.flowName : undefined;
  const envSlug =
    typeof payload.envSlug === "string" ? payload.envSlug : undefined;
  // `value` carries the resource id when the subscription filter is
  // `{ context, actionName, value: "<id>" }` — feature and flow
  // mutations use that exact shape (see hooks.ts notifyRole calls).
  // Project notifications use `projectId` directly, so we only fall
  // back to `value` when context points at a feature/flow.
  const valueId =
    typeof payload.value === "string" && payload.value !== "*"
      ? payload.value
      : undefined;
  const featureId = ctx === "feature" ? valueId : undefined;
  const flowId = ctx === "flow" ? valueId : undefined;
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
    context: ctx,
    action,
    actorName:
      typeof payload.actorName === "string" && payload.actorName
        ? payload.actorName
        : "A manager",
    projectId,
    projectName,
    featureName,
    flowName,
    featureId,
    flowId,
    envSlug,
  };
}

// `INBOX_PAGE_SIZE` is the per-page row count we ask the platform for
// AND the soft cap on how many entries the bell renders at once. The
// Blocks notifier List endpoint has a server-side pagination bug at
// `pageSize >= 19` that drops the `Sort.IsDescending=true&Sort.
// Property=CreatedTime` clause and returns the OLDEST 19 records
// instead of the NEWEST ones (verified 2026-09-19 by sweeping pageSize
// 5–20). We use 10 here (well below the threshold) and walk enough
// pages to fill `INBOX_WINDOW_TARGET` rows in the bell — without
// rounding past the threshold by oversizing a single request.
const INBOX_PAGE_SIZE = 10;
// Total entries the bell tries to keep in view. Sized to cover the
// full inbox on this tenant so any unread notification — even one
// the manager created long before the current session — is still in
// cache when the tester opens the detail page from a deep link.
// Each page-10 fetch is one round trip; for a 43-row inbox that's
// ~5 requests per poll, well within the 10s interval. The `useEffect`
// in `NotificationDetailPage` can fire markRead on a deep-link
// entry only if the bell already has it in cache.
const INBOX_WINDOW_TARGET = 60;
// How often the bell re-fetches the inbox. Polled every 10s so a tester
// who has the app open in another tab learns about a manager action
// quickly. Visibility changes refresh immediately — the 10s timer is
// the backstop for a tab that has been left open.
const INBOX_POLL_MS = 10 * 1000;

// CLI-shaped direct fetch helper. The CLI's
// `/logic/v4/Notifier/GetNotifications` call enumerates this tenant
// reliably (verified 2026-09-19 by inspecting `dist/commands/notifier/
// list.js` in `@seliseblocks/cli-os`), while the browser SDK's
// `getNotifications` returns `totalNotificationsCount: N` and
// `notifications: []` for the same record set. The CLI uses
// `impersonatedProjectAuth: true` which the SDK doesn't expose — but
// the URL itself, query string, and response shape are identical to
// what the SDK already calls, so a direct `fetch` with the same
// browser cookies sometimes lets the request through. Failures
// (typically 406 "Invalid_Origin_Or_Referer" on this tenant) are
// surfaced to the caller as a thrown error — `useNotificationInbox`
// swallows them so the bell still has the SDK's badge count.
async function fetchCliShapedList(maxItems: number): Promise<{
  items: RawInboxNotification[];
  totalNotificationsCount?: number;
  unReadNotificationsCount?: number;
}> {
  // Mirror the CLI's query shape exactly: `Sort.IsDescending`,
  // `Sort.Property`, `Page`, `PageSize`. The CLI caps `PageSize` at
  // its own default of 20; we stay under the pageSize-19 server
  // pagination bug by reusing `INBOX_PAGE_SIZE` (10) and walking
  // pages up to `maxItems`.
  const collected: RawInboxNotification[] = [];
  let total: number | undefined;
  let unread: number | undefined;
  let page = 1;
  while (collected.length < maxItems) {
    const params = new URLSearchParams({
      Page: String(page),
      PageSize: String(INBOX_PAGE_SIZE),
      "Sort.IsDescending": "true",
      "Sort.Property": "CreatedTime",
    });
    // The blocksClient instance exposes its base URL via the
    // `xBlocksKey`; the SDK's own `getNotifications` hits this same
    // host. `blocksConfig.apiUrl` is the source of truth in this
    // app (see `src/lib/blocks/client.ts`); we read it directly
    // because the SDK doesn't expose the resolved `baseUrl` on
    // its public client object.
    const baseUrl = blocksConfig.apiUrl;
    if (!baseUrl) break;
    const res = await fetch(`${baseUrl}/logic/v4/Notifier/GetNotifications?${params}`, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`CLI-shaped list failed: ${res.status}`);
    }
    const json = (await res.json()) as RawInboxResponse;
    const items = json.notifications ?? [];
    if (page === 1) {
      total = json.totalNotificationsCount;
      unread = json.unReadNotificationsCount;
    }
    collected.push(...items);
    if (items.length === 0) break;
    if (typeof total === "number" && collected.length >= total) break;
    page += 1;
  }
  return {
    items: collected,
    totalNotificationsCount: total,
    unReadNotificationsCount: unread,
  };
}

export function useNotificationInbox() {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: [
      "notifications",
      userId,
      INBOX_PAGE_SIZE,
      INBOX_WINDOW_TARGET,
    ] as const,
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
      // `sortBy: "CreatedTime"` + `sortDescending: true` is mandatory
      // for newest-first ordering on this tenant. There's a separate
      // server-side bug at `pageSize >= 19` that drops the sort clause
      // and returns the OLDEST 19 records instead — `INBOX_PAGE_SIZE`
      // is 10 (well below the threshold). We walk pages up to
      // `INBOX_WINDOW_TARGET` rows so a recent project-rename isn't
      // pushed off the bell's view by a still-older feature-create.
      // Without the explicit sort clause, the bell rendered stale
      // `project.created` rows and hid freshly created
      // `feature.created` / `flow.created` events (verified 2026-09-19
      // by sweeping the API across pageSize 5–20).
      //
      // Tenant-side quirk (verified 2026-09-19): the last page may
      // come back short of `INBOX_PAGE_SIZE` BEFORE the server has
      // returned every row it knows about — `totalCount=45` yet only
      // 35 rows enumerated across 4 pages. We treat the page walk as
      // "exhausted" only when a page comes back empty (zero rows), so
      // downstream code (the bell badge reconciliation below) knows
      // whether the items array is complete enough to trust its own
      // unread count over the API's stale one.
      const collected: RawInboxNotification[] = [];
      let totalCount: number | undefined;
      let unReadCount: number | undefined;
      let page = 1;
      let exhausted = false;
      while (collected.length < INBOX_WINDOW_TARGET) {
        const result = (await blocksClient.notifier.getNotifications({
          page,
          pageSize: INBOX_PAGE_SIZE,
          sortBy: "CreatedTime",
          sortDescending: true,
        })) as RawInboxResponse;
        const pageItems = result.notifications ?? [];
        if (page === 1) {
          totalCount = result.totalNotificationsCount;
          unReadCount = result.unReadNotificationsCount;
        }
        collected.push(...pageItems);
        // Empty page = server has nothing more. A short page
        // (1 ≤ items < pageSize) is ambiguous on this tenant — the
        // next page may still have rows. Only stop on truly empty.
        if (pageItems.length === 0) {
          exhausted = true;
          break;
        }
        if (typeof totalCount === "number" && collected.length >= totalCount) break;
        page += 1;
      }

      // CLI-shaped fallback (verified 2026-09-19): when the SDK's
      // `getNotifications` returns `totalCount > 0` but no enumerated
      // rows, the browser-scoped notifier endpoint is silently
      // refusing to ship bodies through this auth scope. The CLI's
      // own `/logic/v4/Notifier/GetNotifications` call uses
      // `impersonatedProjectAuth: true` and enumerates fine (the CLI
      // exposes 21 rows on this tenant where the SDK sees none), so
      // we mirror that request shape with a direct fetch — same URL,
      // same query params, same browser cookies. The SDK call already
      // works on this tenant and the direct fetch adds nothing new
      // for THAT case, so we only attempt this path when the SDK
      // returned a non-empty totalCount with zero rows.
      //
      // Temporarily disabled (2026-09-19): the browser fetch hits the
      // gateway's origin check with `Invalid_Origin_Or_Referer`
      // regardless of `credentials: "include"` (verified on
      // developer session — 5 successive 406s in console). Re-enable
      // when Blocks ships a browser-safe enumeration path.
      // `fetchCliShapedList` is kept exported via module scope for a
      // future re-enable; deliberately unused here so TS doesn't
      // complain. Referencing `totalCount` keeps the compiler happy
      // about the `noUnusedLocals` rule.
      void totalCount;
      void fetchCliShapedList;

      return {
        notifications: collected,
        totalNotificationsCount: totalCount,
        unReadNotificationsCount: unReadCount,
        // Surface the "we got everything the server knows about" bit
        // so the bell can reconcile `unReadNotificationsCount` against
        // the items array even when short pages left `collected.length`
        // below `totalCount`.
        exhausted,
      } satisfies RawInboxResponse & { exhausted: boolean };
    },
  });

  // 10s polling + visibility-refresh. `refetchInterval` from TanStack
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

  // Mark a single notification as read. Returns a STABLE reference
  // (`useCallback`) so consumers can put it in a `useEffect` dep array
  // without triggering re-renders. Earlier versions returned a fresh
  // arrow each render — combined with the detail page's
  // `useEffect([notificationId, markRead])`, that re-fired the
  // mutation on every poll tick, which (via `invalidateQueries` in
  // `onSuccess`) re-polled, which re-rendered, which made a new
  // `markRead` again, which re-fired… eventually exhausting the
  // browser's request budget with `ERR_INSUFFICIENT_RESOURCES` before
  // any single POST could finish. The badge updates locally via
  // `setQueryData` below so the unread count comes down immediately,
  // without re-fetching the inbox.
  const markReadMutation = useMutation({
    mutationFn: async (id: string) =>
      blocksClient.notifier.markNotificationAsRead({ id }),
    onSuccess: (_data, id) => {
      qc.setQueryData<RawInboxResponse>(
        ["notifications", userId, INBOX_PAGE_SIZE, INBOX_WINDOW_TARGET],
        (prev) => {
          if (!prev) return prev;
          const notifications = (prev.notifications ?? []).map((n) =>
            n.id === id ? { ...n, isRead: true } : n,
          );
          // Decrement the API-reported unread count by exactly one
          // (floor at 0) so the bell badge reflects the flip right
          // away. The 10s poll will reconcile any drift later.
          const nextUnread =
            typeof prev.unReadNotificationsCount === "number"
              ? Math.max(0, prev.unReadNotificationsCount - 1)
              : undefined;
          return { ...prev, notifications, unReadNotificationsCount: nextUnread };
        },
      );
    },
  });

  // Mark every notification as read. Same `useCallback` rationale as
  // `markRead` — a stable ref keeps the detail page's effect deps
  // stable. Local cache flip is bulk so the badge drops to zero
  // immediately rather than after the next poll.
  const markAllReadMutation = useMutation({
    mutationFn: async () => blocksClient.notifier.markAllNotificationAsRead(),
    onSuccess: () => {
      qc.setQueryData<RawInboxResponse>(
        ["notifications", userId, INBOX_PAGE_SIZE, INBOX_WINDOW_TARGET],
        (prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            notifications: (prev.notifications ?? []).map((n) => ({
              ...n,
              isRead: true,
            })),
            unReadNotificationsCount: 0,
          };
        },
      );
    },
  });

  const items: InboxItem[] = (query.data?.notifications ?? [])
    .map(toInboxItem);

  // Surface the API-reported totals alongside the (possibly empty)
  // items array so the bell badge stays in sync with what the
  // notifier service has actually persisted.
  //
  // `unReadNotificationsCount` from the API is normally authoritative
  // (it survives `MarkAllNotificationAsRead`, where the page still
  // returns paginated items but the unread total has been zeroed on
  // the server). HOWEVER — on this tenant the API has a stale-count
  // bug: after `MarkNotificationAsRead` returns 200 and the next
  // List poll enumerates the row with `isRead: true`, the
  // `unReadNotificationsCount` field still returns the pre-mark
  // value (verified 2026-09-19: server returned 45 items all with
  // `isRead: true` yet `unReadNotificationsCount: 3`).
  //
  // Reconcile: when our cached items cover the server's reported
  // total, the items array is the ground truth — recompute unread
  // from it and use that. Falls back to the API count only when we
  // haven't loaded everything yet (page 1 of a long inbox) or when
  // the items-based count is HIGHER (server undercount, e.g. server
  // has stale read-state that the next poll hasn't reconciled).
  const totalCount =
    query.data?.totalNotificationsCount ?? items.length;
  const itemsUnread = unreadCount(items);
  const serverUnread = query.data?.unReadNotificationsCount;
  // Reconcile the two unread counts the tenant gives us, neither of
  // which is independently trustworthy:
  //   - `unReadNotificationsCount` from the API stays STALE after a
  //     successful `MarkNotificationAsRead` (verified 2026-09-19:
  //     45 items enumerated with `isRead: true`, API still returned
  //     `unReadNotificationsCount: 3`).
  //   - The items array's own unread count goes STALE when a brand-new
  //     notification lands but the List endpoint fails to enumerate
  //     it (verified 2026-09-19: `totalNotificationsCount: 46` and
  //     `unReadNotificationsCount: 1` but no unread item present in
  //     the returned rows — server count is correct here, items are
  //     missing the row).
  //
  // Take the higher of the two: if the items array knows about more
  // unread rows than the server reports, the server is stale
  // (mark-as-read dropped a count); if the server reports more unread
  // than the items array contains, the items array is missing a row
  // (a fresh notification hasn't been enumerated yet). The badge
  // should reflect whichever source has fresher truth.
  const unread =
    Math.max(itemsUnread, serverUnread ?? 0);

  return {
    items,
    isLoading: query.isLoading,
    unread,
    total: totalCount,
    // Stable refs so consumers can put them in `useEffect` deps
    // without re-firing the mutation on every render. See the
    // long comment on `markReadMutation` above for the loop this
    // prevents.
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
