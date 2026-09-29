// TanStack Query bindings on top of the Blocks data collections. Consumers
// call these hooks; the hooks own the cache and the network call. Mutations
// invalidate the relevant query keys so lists/detail views refresh in place.
//
// All reads are scoped to the signed-in user via the platform-managed
// `CreatedBy` field; all writes are auto-attributed by IAM from the OIDC
// session, so callers never have to pass `userId` themselves.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useActiveEnv } from "@/contexts/ActiveEnvContext";
import { blocksClient } from "./client";
import {
  createdByFilter,
  featuresCollection,
  flowsCollection,
  projectsCollection,
  chatMessagesCollection,
  directMessagesCollection,
  callSignalsCollection,
  announcementsCollection,
  issuesCollection,
  secretsCollection,
  flowCommentsCollection,
  notificationsCollection,
  testCasesCollection,
  userProfilesCollection,
  memberProjectsCollection,
  userAiConfigsCollection,
  userAvatarConfigsCollection,
  verificationTargetsCollection,
  secretBindingsCollection,
  userPreferencesCollection,
  hiddenAnnouncementsCollection,
  userNotesCollection,
  toAnnouncement,
  toCallSignal,
  toChatMessage,
  toDirectMessage,
  toFeature,
  toFlow,
  toFlowCommentRow,
  toIssue,
  toMemberProjectAssignment,
  toProject,
  toSecret,
  toSecretBinding,
  toTestCase,
  toUserAiConfig,
  toUserAvatarConfig,
  toUserNote,
  toUserPreference,
  toUserProfilePic,
  toVerificationTarget,
  type Announcement,
  type CallSignal,
  type CallSignalIceCandidate,
  type ChatProviderId,
  type CloudAnnouncement,
  type CloudCallSignal,
  type CloudDirectMessage,
  type CloudFeature,
  type CloudFlow,
  type CloudFlowComment,
  type CloudHiddenAnnouncement,
  type CloudMemberProject,
  type CloudProject,
  type CloudSecretBinding,
  type CloudTestCase,
  type CloudUserAiConfig,
  type CloudUserAvatarConfig,
  type CloudUserNote,
  type CloudUserPreference,
  type CloudUserProfile,
  type DirectMessage,
  type Feature,
  type Flow,
  type FlowCommentRow,
  type FlowStack,
  type FlowStatus,
  type FlowTestStatus,
  type MemberProjectAssignment,
  type PersistedChatMessage,
  type Project,
  type ProjectCustomEnv,
  type SecretBindings,
  type TestCase,
  type TestCaseStatus,
  type UserAiConfig,
  type UserAvatarConfig,
  type UserNoteRow,
  type UserPreference,
  type UserProfilePic,
} from "./data";
import {
  fetchFileDownloadUrl,
  presignUpload,
  uploadToPresignedUrl,
} from "./files";
import { notifyAssignedFeature, notifyRole } from "./notifier";
import {
  useHiddenAnnouncementIds,
  useUnhideAnnouncement,
} from "./hiddenAnnouncements";
import type {
  ChatSessionSummary,
  Issue,
  IssueStatus,
  Secret,
  VerificationTarget,
} from "@/types/issue-tracker";

// Pull the newly-created ItemId out of an `insert<Schema>` mutation envelope.
//
// Wire shape: `{ data: { insert<Schema>: { acknowledged, itemId, message, totalImpactedData } } }`.
// (Lowercase `itemId` nested under `insert<Schema>` — distinct from the read-shape
// `ItemId` at the top of `get<Plural>` responses.) Returns `null` if the cloud
// didn't acknowledge the create; callers should treat that as a hard failure
// because subsequent calls (e.g. the flow cascade in `useCloneFeature`) depend
// on having a real feature id to attach the sibling flows to.
function extractInsertedItemId(
  response: unknown,
  operationName: string,
): string | null {
  const data = (response as { data?: Record<string, { itemId?: string }> })
    ?.data;
  const inner = data?.[operationName];
  if (!inner?.itemId) return null;
  return inner.itemId;
}

// Collection responses come back either as `{ data: { items, totalCount } }`
// or directly as `{ items, totalCount }` depending on the endpoint shape.
// Normalise to a flat `{ items, totalCount }`.
function unwrapPaged<T>(raw: unknown): { items: T[]; totalCount: number } {
  const r = raw as
    | { data?: Record<string, { items?: T[]; totalCount?: number }> | { items?: T[]; totalCount?: number } }
    | { items?: T[]; totalCount?: number }
    | undefined;
  const dataLayer = (r && "data" in r ? r.data : r) as
    | Record<string, { items?: T[]; totalCount?: number }>
    | { items?: T[]; totalCount?: number }
    | undefined;
  let paged: { items?: T[]; totalCount?: number } | undefined;
  if (dataLayer && !Array.isArray(dataLayer)) {
    if ("items" in dataLayer || "totalCount" in dataLayer) {
      paged = dataLayer as { items?: T[]; totalCount?: number };
    } else {
      // `dataLayer` is `{ get<Plural>: { items, totalCount } }` — pick the
      // first object value that actually carries the paged payload.
      for (const v of Object.values(dataLayer as Record<string, { items?: T[]; totalCount?: number }>)) {
        if (v && typeof v === "object" && ("items" in v || "totalCount" in v)) {
          paged = v;
          break;
        }
      }
    }
  }
  return {
    items: paged?.items ?? [],
    totalCount: paged?.totalCount ?? 0,
  };
}

// --- Cross-env sync helpers ------------------------------------------------
//
// `clonedFromFlowId` and `clonedFromFeatureId` are the stable cross-env
// links stamped by the sibling create in `useCloneFeature`'s cascade.
// The cascade hooks (`useUpdateFlow`, `useDeleteFlow`, `useUpdateFeature`,
// `useDeleteFeature`) look up siblings by these fields so deletes/renames
// in dev fan out to every env where the same flow/feature was cloned.
//
// Records with no `clonedFromXxxId` set are pre-existing clones from
// before this feature shipped — they're invisible to the filter and stay
// frozen, per the user's design decision (no backfill).
async function findSiblingFlows(
  sourceFlowId: string,
  _projectId: string,
  _userId: string,
): Promise<{ id: string; featureId: string; status: string; envSlug?: string; clonedFromFlowId?: string }[]> {
  // Filter on `clonedFromFlowId` only — the source `ItemId` is a unique
  // GUID, so it's a sufficient key by itself. Earlier versions also
  // passed `createdByFilter(userId)` and `projectId`, but the gateway
  // silently drops unknown fields from the filter (Flow has no
  // `projectId` column, so that one was always a no-op). More
  // importantly: with dev environments created before the user-bound
  // tenant model, some siblings carry `CreatedBy: null` and were being
  // filtered out. Filter on the unique link and trust it.
  const raw = await flowsCollection.list({
    filter: {
      clonedFromFlowId: sourceFlowId,
    },
    pageNo: 1,
    pageSize: 50,
  });
  return unwrapPaged<{
    ItemId: string;
    featureId: string;
    status: string;
    envSlug?: string;
    clonedFromFlowId?: string;
  }>(raw).items.map((f) => ({
    id: f.ItemId,
    featureId: f.featureId,
    status: f.status,
    envSlug: f.envSlug,
    clonedFromFlowId: f.clonedFromFlowId,
  }));
}

// Sibling of the (removed) flow-level lookup — returns the set of
// `envSlug` values where this feature already has a sibling feature
// (records with `clonedFromFeatureId === featureId`). Used by the
// feature row's read-only environment workflow diagram to mark each
// sibling env as "cloned" vs "available".
//
// We deliberately do NOT apply `createdByFilter(userId)` — a sibling
// feature can legitimately be created by another team member (e.g. a
// colleague cloned the feature earlier) and the diagram still needs to
// show that env as "cloned". The cascade hooks (`useUpdateFeature` /
// `useDeleteFeature`) DO filter by createdBy because they only act on
// rows the current user can mutate; the read-only diagram has no such
// constraint.
export function useClonedFeatureEnvs(
  featureId: string | undefined,
  projectId: string | undefined,
): UseQueryResult<Set<string>> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  return useQuery({
    // Keyed per feature (and project for invalidation symmetry with the
    // features list query). The "_none" sentinel keeps the key stable
    // when the feature is unmounted — TanStack would otherwise treat a
    // `undefined` as a fresh query each mount.
    queryKey: [
      ...queryKeys.features(userId, projectId ?? "_none"),
      "clonedEnvs",
      featureId ?? "_none",
    ] as const,
    enabled: Boolean(userId && featureId),
    queryFn: async () => {
      if (!featureId) return new Set<string>();
      const raw = await featuresCollection.list({
        filter: { clonedFromFeatureId: featureId },
        pageNo: 1,
        pageSize: 50,
      });
      const slugs = unwrapPaged<{ envSlug?: string }>(raw).items
        .map((f) => f.envSlug)
        .filter((s): s is string => typeof s === "string" && s.length > 0);
      return new Set(slugs);
    },
  });
}

// Flow-side counterpart of `useClonedFeatureEnvs`. Returns the set of
// `envSlug` values where this source flow already has a sibling record
// (records with `clonedFromFlowId === flowId`). Used by the flow row's
// read-only environment workflow diagram to mark each sibling env as
// "cloned" vs "available".
//
// Like the feature variant, we deliberately do NOT apply
// `createdByFilter(userId)` — a sibling flow can legitimately be
// created by another team member (e.g. a colleague cloned the flow
// earlier) and the diagram still needs to show that env as "cloned".
//
// Independent of the feature's env chain — per the user's request, each
// flow row's environment workflow is independent of its parent
// feature's workflow. Promoting a flow to stg / prod / uat doesn't
// require the feature to be promoted to that env first; the flow
// carries its own `clonedFromFlowId` link that the read-only mirror
// picks up. Filter on `clonedFromFlowId` only — every clone (direct
// or transitive, e.g. prod clone of a stg clone) is stamped with
// `clonedFromFlowId === <root dev source flow id>` by
// `useCloneFlow`, mirroring the feature cascade's "all descendants
// link to the root source" convention. This keeps the env set
// accurate regardless of which env the manager clicked from.
export function useClonedFlowEnvs(
  flowId: string | undefined,
): UseQueryResult<Set<string>> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  return useQuery({
    // Per-flow key. The root source flow's "clonedEnvs" set drives the
    // persistent marker on its row; siblings in stg / prod / uat each
    // have their OWN (empty) lookup, which renders the standard
    // "available" pill on every sibling row's chain — by design, since
    // the sibling already IS in that env (its source chain rendered on
    // the row whose `flow.id` matches `flow.clonedFromFlowId === undef`).
    // The "_none" sentinel keeps the key stable when the flow is
    // unmounted.
    queryKey: ["flows", userId, "clonedEnvs", flowId ?? "_none"] as const,
    enabled: Boolean(userId && flowId),
    queryFn: async () => {
      if (!flowId) return new Set<string>();
      const raw = await flowsCollection.list({
        filter: { clonedFromFlowId: flowId },
        pageNo: 1,
        pageSize: 50,
      });
      const slugs = unwrapPaged<{ envSlug?: string }>(raw).items
        .map((f) => f.envSlug)
        .filter((s): s is string => typeof s === "string" && s.length > 0);
      return new Set(slugs);
    },
  });
}

async function findSiblingFeatures(
  sourceFeatureId: string,
  _projectId: string,
  _userId: string,
): Promise<{ id: string; envSlug?: string }[]> {
  // Filter on `clonedFromFeatureId` only — the source `ItemId` is a
  // unique GUID, so it's a sufficient key by itself. Earlier versions
  // also passed `createdByFilter(userId)` and `projectId`, but the
  // gateway silently drops unknown / owner-scoping fields from the
  // filter. More importantly: with dev environments created before the
  // user-bound tenant model, some siblings carry `CreatedBy: null` and
  // were being filtered out — so a delete / rename on the dev source
  // missed those siblings, leaving orphan rows in stg / prod / uat.
  // This was the cross-env delete bug: deleting a dev-source feature
  // removed only the siblings the current user had cloned themselves,
  // not the ones a colleague had cloned in a previous session. Filter
  // on the unique link and trust it — the same fix `findSiblingFlows`
  // applies on the flow side.
  //
  // Caller still passes `projectId` and `userId` (kept in the
  // signature for minimal blast radius against the rename + delete
  // cascades); they're unused here, hence the underscore prefix.
  const raw = await featuresCollection.list({
    filter: {
      clonedFromFeatureId: sourceFeatureId,
    },
    pageNo: 1,
    pageSize: 50,
  });
  return unwrapPaged<{ ItemId: string; envSlug?: string }>(raw).items.map(
    (f) => ({ id: f.ItemId, envSlug: f.envSlug }),
  );
}

// True when the source record is the dev env (or has no envSlug at all —
// legacy records created before env-scoped features/flows). Cross-env
// cascade is dev-only; non-dev edits stay local.
function isDevSource(envSlug: string | undefined): boolean {
  return envSlug === "dev" || envSlug === undefined;
}

// --- Query keys -------------------------------------------------------------
//
// Centralised so invalidations stay consistent across hooks. Use the helper
// `queryKeys.*` factories instead of typing strings by hand.

export const queryKeys = {
  projects: (userId: string) => ["projects", userId] as const,
  project: (userId: string, id: string) =>
    ["projects", userId, id] as const,
  features: (userId: string, projectId: string, envSlug?: string) =>
    ["features", userId, projectId, envSlug ?? "_all"] as const,
  flows: (userId: string, featureId: string) =>
    ["flows", userId, featureId] as const,
  dashboard: (userId: string) => ["dashboard", userId] as const,
  chatHistory: (userId: string, sessionId: string) =>
    ["chat", userId, sessionId] as const,
  chatSessions: (userId: string) => ["chat-sessions", userId] as const,
  // Member-to-member direct messages — the /chat page's inbox+outbox feed.
  directMessages: (userId: string) => ["direct-messages", userId] as const,
  // WebRTC call signaling rows addressed to/from the current user. Two-call
  // read (callerId outbox + recipientId inbox) — same OR-filter workaround
  // the directMessages query uses. Rows are kept until the call terminates
  // (status flips to ended/declined/missed + endedAt is stamped), so the
  // key is per-user, not per-call.
  callSignals: (userId: string) => ["call-signals", userId] as const,
  // Manager announcements — workspace-wide, so no user scoping in the key.
  announcements: ["announcements"] as const,
  // Inbox rows for the bell + detail page. One row per recipient, so
  // the key is per-user; same shape as `directMessages` / `callSignals`.
  notifications: (userId: string) => ["notifications", userId] as const,
  // Per-member project assignments — workspace-wide read; one row per user.
  memberProjects: ["member-projects"] as const,
  // Profile pictures — the userId → fileId map is workspace-wide (every
  // member's row, so any avatar can render); the caller id in the key only
  // keeps one session's cache from bleeding into the next.
  profilePics: (userId: string) => ["profile-pics", userId] as const,
  // Per-user AI gateway config (URL / model / token) — one row per user,
  // read+write filtered by the caller's own `userId`. Keyed per-user so a
  // sign-out / sign-in cycle doesn't bleed one user's overrides into
  // another's cache.
  userAiConfig: (userId: string) => ["user-ai-config", userId] as const,
  // Personal AI key for the AI-generated profile picture flow. Different
  // cache key from `userAiConfig` so an invalidation of the chat proxy
  // config never flushes the avatar config (or vice versa).
  userAvatarConfig: (userId: string) => ["user-avatar-config", userId] as const,
  // Provider-signed download URL for one Blocks Data Storage file. Cached
  // per file id — every UserAvatar showing the same picture shares it.
  fileDownloadUrl: (fileId: string) => ["file-download-url", fileId] as const,
  // Issue Tracker — keyed per-user so a sign-out / sign-in cycle doesn't
  // bleed one user's targets / secrets / issues into another's caches.
  issueTrackerTargets: (userId: string) =>
    ["issue-tracker-targets", userId] as const,
  issueTrackerSecrets: (userId: string) =>
    ["issue-tracker-secrets", userId] as const,
  issueTrackerIssues: (userId: string) =>
    ["issue-tracker-issues", userId] as const,
  // Test cases — one spreadsheet per Feature. Keyed per-feature so the
  // spreadsheet inside FeatureDetailsDrawer caches against the row set
  // it actually renders, and a switch between two features doesn't
  // share a stale array. Workspace-wide read (no `createdBy` filter)
  // because every QA needs to see the case list for features they're
  // not the author of.
  testCases: (flowId: string) => ["test-cases", flowId] as const,
  // Flow comments — one thread per flow. Keyed per-flow so opening a
  // different flow doesn't share a stale array. Workspace-wide read
  // (`filter: { flowId: <id> }` scopes the thread) — comments are team-
  // wide discussion, so every role on every env reads the same set of
  // rows (no `createdByFilter`). The flat-row reader in `useFlowComments`
  // is the canonical reader; `useAddFlowComment` and
  // `useAddFlowCommentReply` invalidate this key in their `onSuccess`.
  flowComments: (flowId: string) => ["flow-comments", flowId] as const,
  // Per-(project, env) secret-binding map. Keyed per-scope so two open
  // projects never share a stale map; per-user prefix keeps a sign-out
  // / sign-in cycle from bleeding one user's bindings into another's
  // cache. See `useSecretBindings` / `useSaveSecretBindings`.
  secretBindings: (userId: string, projectId: string, envSlug: string) =>
    ["secret-bindings", userId, projectId, envSlug] as const,
  // Per-user preference row (scope/device/activeSession/customChecks/
  // repoBrowserPath/githubCredentialId). Mirrors `userAiConfig`'s keying
  // — different cache key so an invalidation of the AI config never
  // flushes the preferences and vice versa.
  userPreference: (userId: string) => ["user-preference", userId] as const,
  // Per-user hidden-announcement inbox — list of announcement ids the
  // user dismissed. Keyed per-user, same shape as `notifications` /
  // `directMessages`.
  hiddenAnnouncements: (userId: string) =>
    ["hidden-announcements", userId] as const,
  // Per-(user, padType) notepad row. Keyed per-user + per-pad so the
  // text pad and excel pad caches never collide.
  userNote: (userId: string, padType: string) =>
    ["user-note", userId, padType] as const,
};

// --- Reads ------------------------------------------------------------------

export function useProjects(): UseQueryResult<Project[]> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  return useQuery({
    queryKey: queryKeys.projects(userId),
    enabled: Boolean(userId),
    // 60 s matches `useAliveScope` — they cover the same row set with
    // different page sizes, so a single stale window keeps the two
    // calls in lockstep (one read goes fresh, then the next read in
    // either hook is a cache hit until 60 s elapse). Project
    // create/update/delete mutations invalidate the key directly, so
    // the user always sees fresh state after a write.
    staleTime: 60_000,
    queryFn: async () => {
      // Workspace-wide listing — testers need to browse every project in
      // the workspace (read-only). Mutating hooks still gate on `isTester`
      // so they can't author/delete. We deliberately dropped
      // `createdByFilter(userId)` here: with it on, a tester who didn't
      // author the seed projects saw an empty workspace.
      const raw = await projectsCollection.list({
        pageNo: 1,
        pageSize: 100,
        // Server expects sort direction as a numeric (`-1` desc, `1` asc);
        // a string direction (`"desc"`) triggers "Unexpected Execution Error".
        sort: { LastUpdatedDate: -1 },
      });
      return unwrapPaged<unknown>(raw).items.map((p) =>
        toProject(p as Parameters<typeof toProject>[0]),
      );
    },
  });
}

export function useProject(
  projectId: string | undefined,
): UseQueryResult<Project | null> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  return useQuery({
    queryKey: queryKeys.project(userId, projectId ?? ""),
    enabled: Boolean(userId && projectId),
    queryFn: async () => {
      if (!projectId) return null;
      const raw = await projectsCollection.get(projectId);
      // `projectsCollection.get` is implemented as a list query filtered by
      // `ItemId`, so the response is the same paged envelope as `list`:
      //   { data: { getProjects: { items: [...], totalCount } } }.
      // Drill through both layers; a missing item means the record doesn't
      // exist. We deliberately dropped the `CreatedBy` ownership guard:
      // a tester should be able to open a project they didn't author so
      // they can browse it read-only. Mutations still gate on `isTester`.
      const paged = unwrapPaged<{ ItemId: string; CreatedBy?: string; name: string; CreatedDate: string; LastUpdatedDate: string }>(raw);
      const p = paged.items[0];
      if (!p) return null;
      return toProject(p as Parameters<typeof toProject>[0]);
    },
  });
}

export function useProjectFeatures(
  projectId: string | undefined,
  envSlug?: string,
): UseQueryResult<Feature[]> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  return useQuery({
    // Query key includes the envSlug segment so filtered (env-scoped) reads
    // don't share a cache with the unfiltered (env-less) read of the same
    // project. The "_all" sentinel keeps the unfiltered shape stable across
    // every call site that doesn't pass an env.
    queryKey: queryKeys.features(userId, projectId ?? "", envSlug),
    enabled: Boolean(userId && projectId),
    queryFn: async () => {
      if (!projectId) return [];
      const raw = await featuresCollection.list({
        // Filter is a flat key/value map — nested `{ eq: ... }` is silently
        // ignored by the gateway and the list returns empty. `envSlug` is
        // optional and only present when the caller is on an env-scoped
        // page; legacy features (no envSlug) won't match a non-empty
        // envSlug and are correctly hidden from env-scoped reads.
        //
        // Workspace-wide read: we dropped `createdByFilter(userId)` so a
        // tester can browse features authored by anyone. Mutating hooks
        // (`useUpdateFeature`, `useDeleteFeature`) still throw for testers.
        filter: {
          projectId,
          ...(envSlug ? { envSlug } : {}),
        },
        pageNo: 1,
        pageSize: 200,
        sort: { CreatedDate: -1 },
      });
      return unwrapPaged<unknown>(raw).items.map((f) =>
        toFeature(f as Parameters<typeof toFeature>[0], projectId),
      );
    },
  });
}

export function useFeatureFlows(
  featureId: string | undefined,
  projectId?: string,
): UseQueryResult<Flow[]> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  return useQuery({
    queryKey: queryKeys.flows(userId, featureId ?? ""),
    enabled: Boolean(userId && featureId),
    queryFn: async () => {
      if (!featureId) return [];
      const raw = await flowsCollection.list({
        // Workspace-wide read: dropped `createdByFilter(userId)` so a
        // tester can browse flows they didn't author. Mutations stay
        // blocked by the `isTester` guard in `useUpdateFlow` /
        // `useDeleteFlow`.
        filter: { featureId },
        pageNo: 1,
        pageSize: 200,
        sort: { CreatedDate: -1 },
      });
      // Forward the parent feature's `projectId` so `toFlow` can populate
      // the UI `Flow.projectId`. The cloud Flow schema doesn't carry
      // `projectId` (it's a joinable via featureId), so the UI value was
      // "" before — which is fine for chips that only mutate by ItemId,
      // but breaks any cloud call that filters on projectId. Pass
      // `projectId` from the caller (FeatureItem has the feature
      // right there with `projectId` populated by `useProjectFeatures`).
      return unwrapPaged<unknown>(raw).items.map((f) =>
        toFlow(f as Parameters<typeof toFlow>[0], projectId ?? ""),
      );
    },
  });
}

// Used by the dashboard "Recent Flows" tile. Pulls the user's most recent
// flows whose parent project still exists, sorted by CreatedDate desc.
//
// Why project-existence is part of the filter: deleting a project leaves its
// features and flows behind in the collection (the gateway has no cascade
// hook on `projectsCollection.delete`), so without this narrowing the tile
// would keep rendering flows under projects the user has explicitly removed.
// Mirrors the cloud-side listing + client-side narrowing pattern in
// `useProjectFlows` — the gateway filter parser drops operator objects
// like `{ in: [...] }`, so `projectId: { in: [...] }` is silently ignored
// and the query would return empty.
// Most recent features across the workspace, narrowed to alive projects
// so a deleted project's features stop appearing in the dashboard.
// Mirrors `useRecentFlows` (just below) — same scope gate, same sort,
// same slicing. Used by the dashboard's "Recent Features" card; the
// stats card already counts the same set via `useWorkspaceTotals`.
export function useRecentFeatures(limit = 5): UseQueryResult<Feature[]> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  const scopeQuery = useAliveScope(userId);
  return useQuery({
    queryKey: [...queryKeys.dashboard(userId), "features", limit] as const,
    enabled: Boolean(userId) && scopeQuery.data !== undefined,
    queryFn: async () => {
      const scope = scopeQuery.data;
      if (!scope) return [];
      if (scope.projectIds.size === 0) return [];
      const featuresRaw = await featuresCollection.list({
        // Candidate pool: 200 most-recent features, narrowed client-side
        // to `scope.projectIds` (alive projects). Lowered from 1000 to
        // 200 — a typical workspace has well under 200 features; the
        // dashboard "Recent Features" card only displays `limit` rows
        // (default 5), so 200 candidates gives ample headroom without
        // pulling a thousand-row response just to discard 99.5% of it.
        // Going wider would mask genuine "the user's recent N is not
        // in the first 200" bugs by silently truncating — same
        // rationale as the previous 1000 bound.
        pageNo: 1,
        pageSize: 200,
        sort: { CreatedDate: -1 },
      });
      return unwrapPaged<unknown>(featuresRaw).items
        .filter((f) => {
          const pid = (f as { projectId?: string }).projectId;
          return pid !== undefined && scope.projectIds.has(pid);
        })
        .slice(0, limit)
        .map((f) =>
          toFeature(f as Parameters<typeof toFeature>[0], ""),
        );
    },
  });
}

export function useRecentFlows(limit = 5): UseQueryResult<Flow[]> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  const scopeQuery = useAliveScope(userId);
  return useQuery({
    queryKey: [...queryKeys.dashboard(userId), "flows", limit] as const,
    enabled: Boolean(userId) && scopeQuery.data !== undefined,
    queryFn: async () => {
      const scope = scopeQuery.data;
      // Defensive: `enabled` already gates this, but the non-null
      // assertion would otherwise leak through.
      if (!scope) return [];
      if (scope.featureIds.size === 0) return [];
      // pageSize 200 mirrors `useRecentFeatures` — the dashboard
      // "Recent Flows" card only displays `limit` rows (default 5),
      // so a 200-row candidate pool gives ample headroom for typical
      // workspaces while cutting the response payload by ~80% from
      // the previous 1000. Going wider would mask genuine "the user's
      // recent N is not in the first 200" bugs by silently truncating.
      const flowsRaw = await flowsCollection.list({
        // Workspace-wide read: dropped `createdByFilter(userId)` so a
        // tester can see recent workspace flows. Narrowed client-side to
        // `scope.featureIds` (alive features in alive projects) below.
        pageNo: 1,
        pageSize: 200,
        sort: { CreatedDate: -1 },
      });
      return unwrapPaged<unknown>(flowsRaw).items
        .filter((f) => {
          const fid = (f as { featureId?: string }).featureId;
          return fid !== undefined && scope.featureIds.has(fid);
        })
        .slice(0, limit)
        .map((f) =>
          toFlow(f as Parameters<typeof toFlow>[0], ""),
        );
    },
  });
}

// Aggregate totals for the dashboard stat cards.
//
// Why this can no longer read `totalCount` off the cloud envelope: the
// gateway filter parser drops operator objects (per the `useProjectFlows`
// doc comment), so `projectId: { in: [...] }` is silently ignored — meaning
// a direct `totalCount` would include features/flows whose parent project
// was deleted (the gateway has no cascade hook on `projectsCollection.delete`).
// Listing the user's features and flows and narrowing client-side against
// the alive scope keeps the count in sync with what the user actually sees
// on the projects and flows pages.
export function useWorkspaceTotals(): UseQueryResult<{
  features: number;
  flows: number;
}> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  const scopeQuery = useAliveScope(userId);
  return useQuery({
    queryKey: [...queryKeys.dashboard(userId), "totals"] as const,
    enabled: Boolean(userId) && scopeQuery.data !== undefined,
    queryFn: async () => {
      const scope = scopeQuery.data;
      if (!scope) return { features: 0, flows: 0 };
      // No live projects → no live features or flows can exist. Return
      // zero without burning a fetch.
      if (scope.projectIds.size === 0) return { features: 0, flows: 0 };
      const [featuresRaw, flowsRaw] = await Promise.all([
        featuresCollection.list({
          // Workspace-wide read: dropped `createdByFilter(userId)` so a
          // tester can see totals across the workspace. Narrowed client-
          // side to `scope.projectIds` (alive projects) below. pageSize
          // 200 is a soft cap on how many rows we scan for the dashboard
          // stat card — typical workspaces fit comfortably; huge ones
          // silently cap (the stat then undercounts but the page still
          // renders). Going to 1000 made the response ~5× heavier for a
          // card that only displays two integers.
          pageNo: 1,
          pageSize: 200,
        }),
        flowsCollection.list({
          // Workspace-wide read: dropped `createdByFilter(userId)` so a
          // tester can see totals across the workspace. Narrowed client-
          // side to `scope.featureIds` (alive features in alive projects)
          // below. Same 200 cap rationale as featuresRaw above.
          pageNo: 1,
          pageSize: 200,
        }),
      ]);
      let features = 0;
      for (const f of unwrapPaged<{ projectId?: string }>(featuresRaw).items) {
        const pid = f.projectId;
        if (pid !== undefined && scope.projectIds.has(pid)) features++;
      }
      let flows = 0;
      // No live features → no live flows can exist either.
      if (scope.featureIds.size > 0) {
        for (const f of unwrapPaged<{ featureId?: string }>(flowsRaw).items) {
          const fid = f.featureId;
          if (fid !== undefined && scope.featureIds.has(fid)) flows++;
        }
      }
      return { features, flows };
    },
  });
}

// Shared lookup: the user's "alive" project and feature ID sets. Powers
// both `useRecentFlows` and `useWorkspaceTotals` so they agree on what
// counts as live and only one set of cloud queries runs per cold-cache
// dashboard mount. Not exported — these sets are an internal detail of
// how the dashboard derives orphan-safe slices.
//
// pageSize 500 matches the upper bound on `useProjectFlows` and is more
// than enough for typical workspaces; if a single user ever has more
// than 500 projects, the silent truncation would be visible as features
// and flows under the 501st-and-onward projects failing to surface on
// the dashboard, which is preferable to an unbounded fetch.
// `useAliveScope` was previously file-local — it powers the dashboard
// totals card and the recent-feeds hooks. `useProjectsDevCounts` below
// reuses the same alive-set, so it's now exported for shared use.
export function useAliveScope(userId: string): UseQueryResult<{
  projectIds: Set<string>;
  featureIds: Set<string>;
}> {
  return useQuery({
    queryKey: [...queryKeys.dashboard(userId), "aliveScope"] as const,
    enabled: Boolean(userId),
    queryFn: async () => {
      // 1. The user's surviving projects. Empty set → no features or
      //    flows can possibly belong to a live parent, so short-circuit
      //    the features query. This is the "deleted all projects" path:
      //    the tile should render zero, not orphans.
      const projectsRaw = await projectsCollection.list({
        // Workspace-wide read: dropped `createdByFilter(userId)` so a
        // tester can see the workspace's alive project set.
        pageNo: 1,
        pageSize: 500,
      });
      const projectIds = new Set(
        unwrapPaged<{ ItemId: string }>(projectsRaw).items.map((p) => p.ItemId),
      );
      if (projectIds.size === 0) {
        return { projectIds, featureIds: new Set<string>() };
      }

      // 2. The user's features, narrowed to those whose `projectId` is
      //    in the surviving-project set. The cloud filter parser drops
      //    operator objects (see the doc comment on `useProjectFlows`),
      //    so we list everything and filter client-side.
      const featuresRaw = await featuresCollection.list({
        // Workspace-wide read: dropped `createdByFilter(userId)` so a
        // tester can see features across the workspace.
        pageNo: 1,
        pageSize: 500,
      });
      const featureIds = new Set(
        unwrapPaged<{ ItemId: string }>(featuresRaw).items
          .filter((f) => {
            const pid = (f as { projectId?: string }).projectId;
            return pid !== undefined && projectIds.has(pid);
          })
          .map((f) => f.ItemId),
      );
      return { projectIds, featureIds };
    },
    // 60-second staleness window: the dashboard is not a hot path, and
    // a project delete followed by immediate back-navigation would
    // otherwise re-fire both queries before the cache settles. (Project
    // deletes still invalidate via `queryKeys.dashboard(userId)` in
    // `useDeleteProject.onSuccess`, so the user always sees fresh
    // numbers after a delete — the stale window only affects reads
    // without an intervening mutation.)
    staleTime: 60_000,
  });
}

// Per-project feature/flow counts in the dev env (or env-less legacy
// records). Used by the Projects page card AND the list-row layout so
// both surfaces share one fetch instead of N×2 — the per-card
// `useProjectFeatures(id, "dev")` + `useProjectFlows(id, "dev")` calls
// would otherwise turn a 20-project workspace into 40 round trips on
// first paint.
//
// Dev-only scoping: matches `ProjectCardWithCounts` (formerly in
// `ProjectList.tsx`). Counting across every env would inflate totals
// because cloning a flow to stg/uat/prod produces duplicates of the
// same dev source via `clonedFromXxxId` — see the doc comment there.
//
// Cache key is rooted under `queryKeys.projects(userId)` so the same
// project mutations that invalidate the project list also invalidate
// these counts. `staleTime: 60_000` matches `useAliveScope`.
//
// Returns `Map<projectId, { features: number; flows: number }>`. A
// project with no entries simply has no entry in the map; callers
// default to zero via `counts.get(id)?.features ?? 0`.
export function useProjectsDevCounts(): UseQueryResult<
  Map<string, { features: number; flows: number }>
> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  const scopeQuery = useAliveScope(userId);
  return useQuery({
    queryKey: [...queryKeys.projects(userId), "devCounts"] as const,
    enabled: Boolean(userId) && (scopeQuery.isSuccess || scopeQuery.isError),
    queryFn: async () => {
      const scope = scopeQuery.data;
      if (!scope) return new Map();
      const { projectIds, featureIds: aliveFeatureIds } = scope;
      // Short-circuit: no alive projects → no features or flows can
      // belong to a live parent. Skips the two feature/flow list
      // round trips entirely.
      if (projectIds.size === 0) return new Map();

      // Pass 1 — features. Workspace-wide list, narrowed client-side
      // because the gateway filter parser drops operator objects (see
      // `createdByFilter`). We collect three things:
      //   - `featureProjectById` for the flows pass to look up parents,
      //   - the feature counts per project,
      //   - a Set of featureIds scoped to dev sources (so the flows
      //     pass knows which features belong to the dev env).
      const featuresRaw = await featuresCollection.list({
        pageNo: 1,
        pageSize: 1000,
      });
      const featureItems = unwrapPaged<{
        ItemId: string;
        projectId?: string;
        envSlug?: string;
      }>(featuresRaw).items;
      const featureProjectById = new Map<string, string>();
      const devFeatureIds = new Set<string>();
      const featureCounts = new Map<string, number>();
      for (const f of featureItems) {
        const pid = f.projectId;
        if (!pid || !projectIds.has(pid)) continue;
        if (!isDevSource(f.envSlug)) continue;
        featureProjectById.set(f.ItemId, pid);
        devFeatureIds.add(f.ItemId);
        featureCounts.set(pid, (featureCounts.get(pid) ?? 0) + 1);
      }

      // Pass 2 — flows. Workspace-wide list, narrowed to dev-source
      // flows whose `featureId` is in our dev-feature set. A flow
      // without a known dev feature has no parent to count under and
      // is skipped — that catches orphans from deletes or migrations.
      if (devFeatureIds.size === 0) {
        return new Map(
          Array.from(featureCounts.entries()).map(([pid, features]) => [
            pid,
            { features, flows: 0 },
          ]),
        );
      }
      const flowsRaw = await flowsCollection.list({
        // Workspace-wide read, narrowed to dev-source flows whose
        // `featureId` is in our dev-feature set (orphans skipped).
        // pageSize 200 mirrors the totals/recents trim — typical
        // workspaces fit comfortably; the per-project flow count then
        // undercounts on huge workspaces rather than pulling a
        // thousand-row response just to bucket them. The Projects list
        // renders a feature/flow badge per project, so a soft cap is
        // acceptable as long as it's documented.
        pageNo: 1,
        pageSize: 200,
      });
      const flowItems = unwrapPaged<{
        ItemId: string;
        featureId?: string;
        envSlug?: string;
      }>(flowsRaw).items;
      const flowCounts = new Map<string, number>();
      for (const fl of flowItems) {
        const fid = fl.featureId;
        if (!fid || !devFeatureIds.has(fid)) continue;
        if (!isDevSource(fl.envSlug)) continue;
        const pid = featureProjectById.get(fid);
        if (!pid) continue;
        flowCounts.set(pid, (flowCounts.get(pid) ?? 0) + 1);
      }

      // Merge: every project with features or flows gets an entry.
      const merged = new Map<string, { features: number; flows: number }>();
      const allPids = new Set<string>([
        ...featureCounts.keys(),
        ...flowCounts.keys(),
      ]);
      for (const pid of allPids) {
        merged.set(pid, {
          features: featureCounts.get(pid) ?? 0,
          flows: flowCounts.get(pid) ?? 0,
        });
      }
      return merged;
    },
    staleTime: 60_000,
  });
}

// All flows under any feature of one project.
//
// Flow records belong to a feature by `featureId`, but the gateway's
// filter parser drops operator objects (per the `createdByFilter`
// comment) — so `featureId: { in: [...] }` is silently ignored and the
// query returns empty. The workaround:
//   1. Cloud-side: list the project's features (env-scoped on cloud when
//      `envSlug` is set) to gather their `ItemId`s — flat key/value, fine.
//   2. Cloud-side: list the user's flows (env-scoped on cloud when
//      `envSlug` is set) — flat key/value, fine.
//   3. Client-side: narrow to flows whose `featureId` is in the project's
//      feature set. Bounded by the user's total flow count, not the
//      project's — pageSize 1000 keeps the worst case reachable for
//      typical workspaces.
//
// Pass `envSlug` to scope the result to one environment. With no
// `envSlug` the count is the aggregation across every env (legacy
// records without envSlug included).
export function useProjectFlows(
  projectId: string | undefined,
  envSlug?: string,
): UseQueryResult<Flow[]> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  return useQuery({
    queryKey: [
      ...queryKeys.features(userId, projectId ?? "", envSlug),
      "flows",
    ] as const,
    enabled: Boolean(userId && projectId),
    queryFn: async () => {
      if (!projectId) return [];
      const featuresRaw = await featuresCollection.list({
        // Workspace-wide read: dropped `createdByFilter(userId)` so a
        // tester can browse flows they didn't author.
        filter: {
          projectId,
          ...(envSlug ? { envSlug } : {}),
        },
        pageNo: 1,
        pageSize: 500,
      });
      const featureItems = unwrapPaged<{ ItemId: string }>(featuresRaw).items;
      if (featureItems.length === 0) return [];
      const featureIds = new Set(featureItems.map((f) => f.ItemId));
      const flowsRaw = await flowsCollection.list({
        // Workspace-wide read: dropped `createdByFilter(userId)` so a
        // tester can browse flows they didn't author.
        filter: {
          ...(envSlug ? { envSlug } : {}),
        },
        pageNo: 1,
        pageSize: 1000,
      });
      return unwrapPaged<unknown>(flowsRaw).items
        .filter((f) => {
          const fid = (f as { featureId?: string }).featureId;
          return fid !== undefined && featureIds.has(fid);
        })
        .map((f) =>
          toFlow(f as Parameters<typeof toFlow>[0], projectId),
        );
    },
  });
}

// Plain (non-hook) fetcher for imperative callers — the Issue Tracker chat
// tool dispatch uses it to list a project's features/flows and resolve ids
// by name without mounting the project page's hooks. Same two-query shape
// as `useProjectFlows` (features by projectId [+ envSlug], then flows
// filtered by envSlug + client-side against the feature-id set) so the
// results can never drift from what the project page renders.
//
// `envSlug` is optional: callers that already know the active env pass it
// to push the filter server-side (saves pulling flows from sibling envs
// just to discard them client-side). When omitted, falls back to the old
// workspace-wide read so dashboard / no-active-env callers still work.
export async function fetchProjectContents(
  projectId: string,
  envSlug?: string,
): Promise<{ features: Feature[]; flows: Flow[] }> {
  const featuresRaw = await featuresCollection.list({
    filter: {
      projectId,
      ...(envSlug ? { envSlug } : {}),
    },
    pageNo: 1,
    pageSize: 500,
  });
  const features = unwrapPaged<unknown>(featuresRaw).items.map((f) =>
    toFeature(f as Parameters<typeof toFeature>[0], projectId),
  );
  if (features.length === 0) return { features, flows: [] };
  const featureIds = new Set(features.map((f) => f.id));
  const flowsRaw = await flowsCollection.list({
    filter: {
      ...(envSlug ? { envSlug } : {}),
    },
    pageNo: 1,
    pageSize: 1000,
  });
  const flows = unwrapPaged<unknown>(flowsRaw).items
    .filter((f) => {
      const fid = (f as { featureId?: string }).featureId;
      return fid !== undefined && featureIds.has(fid);
    })
    .map((f) => toFlow(f as Parameters<typeof toFlow>[0], projectId));
  return { features, flows };
}

// Loads every persisted chat message for one session in CreatedDate order.
// Greeting / seed messages are not in the store — the caller prepends them
// when the result is empty.
export function useChatHistory(
  sessionId: string,
): UseQueryResult<PersistedChatMessage[]> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  return useQuery({
    queryKey: queryKeys.chatHistory(userId, sessionId),
    enabled: Boolean(userId && sessionId),
    queryFn: async () => {
      const raw = await chatMessagesCollection.list({
        filter: { ...createdByFilter(userId), sessionId },
        pageNo: 1,
        pageSize: 500,
        sort: { CreatedDate: 1 },
      });
      return unwrapPaged<unknown>(raw).items.map((m) =>
        toChatMessage(m as Parameters<typeof toChatMessage>[0]),
      );
    },
  });
}

// List every chat session the user has stored messages under. We don't keep
// a separate Session collection, so this pulls the user's persisted chat
// rows (pageSize 200 is plenty — anyone running more than that is unusual)
// and reduces them client-side into one summary per sessionId. Sessions with
// zero saved messages are intentionally absent — a brand-new session exists
// in localStorage but never had a message persisted yet, so it shows up
// only after the first user turn.
export function useChatSessions(): UseQueryResult<ChatSessionSummary[]> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  return useQuery({
    queryKey: queryKeys.chatSessions(userId),
    enabled: Boolean(userId),
    queryFn: async () => {
      const raw = await chatMessagesCollection.list({
        filter: createdByFilter(userId),
        pageNo: 1,
        pageSize: 200,
        // Newest first so the reduce passes through the most-recent message
        // for each sessionId — its `CreatedDate` is the session's
        // `lastActivity`. Sessions are sorted desc again below.
        sort: { CreatedDate: -1 },
      });
      const messages = unwrapPaged<unknown>(raw).items.map((m) =>
        toChatMessage(m as Parameters<typeof toChatMessage>[0]),
      );
      const summaries = new Map<string, ChatSessionSummary>();
      for (const m of messages) {
        const existing = summaries.get(m.sessionId);
        // Newest-first sort: the first row we see for a session is its most
        // recent message. We use that as the session's `lastActivity` and
        // seed the title with the most recent user turn — when you scan
        // History you want to recognise a conversation by what's happening
        // now, not what you asked an hour ago. If the most recent message
        // is assistant-only, we fall back to the latest user turn we see
        // as we walk backward in time.
        const isUser = m.role === "user";
        const titleCandidate = isUser ? m.content.trim() : null;
        if (!existing) {
          summaries.set(m.sessionId, {
            sessionId: m.sessionId,
            title: truncate(titleCandidate ?? "New conversation", 60),
            lastActivity: m.timestamp,
            messageCount: 1,
          });
          continue;
        }
        existing.messageCount += 1;
        if (m.timestamp < existing.lastActivity) {
          existing.lastActivity = m.timestamp;
        }
        if (titleCandidate && existing.title === "New conversation") {
          existing.title = truncate(titleCandidate, 60);
        }
      }
      return Array.from(summaries.values()).sort(
        (a, b) => +new Date(b.lastActivity) - +new Date(a.lastActivity),
      );
    },
  });
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ");
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

// Delete every persisted message for one chat session. We don't keep a
// Session collection — sessions are derived from message rows sharing a
// `sessionId`, so a session delete is "delete all messages where
// sessionId = X". The list call paginates at 500 (one conversation rarely
// has more) and the deletes run serially so the gateway's per-request
// rate-limit window isn't exhausted by a fan-out. Errors on individual
// row deletes are swallowed so a single 403 doesn't leave the user with
// half-deleted history visible.
//
// If a row's delete fails we still consider the session removed from
// the user's perspective once the list has been repulled — the worst
// case is a stale ghost message that reappears on next refresh, which
// is preferable to blocking the whole delete on one transient failure.
export function useDeleteChatSession(): UseMutationResult<
  { sessionId: string; deleted: number },
  Error,
  string
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const raw = await chatMessagesCollection.list({
        filter: { ...createdByFilter(userId), sessionId },
        pageNo: 1,
        pageSize: 500,
      });
      const messages = unwrapPaged<unknown>(raw).items;
      let deleted = 0;
      for (const m of messages) {
        const id = (m as { ItemId?: string }).ItemId;
        if (!id) continue;
        try {
          await chatMessagesCollection.delete(id);
          deleted += 1;
        } catch (err) {
          console.warn(
            `Failed to delete chat message ${id} while removing session ${sessionId}:`,
            err,
          );
        }
      }
      return { sessionId, deleted };
    },
    onSuccess: (_res, sessionId) => {
      // The current session's history is now empty — invalidate it so the
      // greeting rehydrates. Same for the sessions list (the row should
      // disappear); user-scoped key so it works across users.
      qc.invalidateQueries({
        queryKey: queryKeys.chatHistory(userId, sessionId),
      });
      qc.invalidateQueries({ queryKey: queryKeys.chatSessions(userId) });
    },
  });
}

// Rename a chat session. The session title is *derived* from the most
// recent user message (`useChatSessions` walks messages to build titles),
// so "rename" actually rewrites that message's content. We update the
// first user-authored row we find — walking backward in the (CreatedDate
// desc) list so we prefer the latest user turn.
//
// Updates only the `content` field; role/sessionId/createdAt pass through
// unchanged. `requiredOn: 3` on the schema means echo is mandatory, and
// the gateway revalidates every required field on each PATCH.
export function useRenameChatSession(): UseMutationResult<
  { sessionId: string; newTitle: string },
  Error,
  { sessionId: string; newTitle: string }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async ({ sessionId, newTitle }) => {
      const trimmed = newTitle.trim();
      if (!trimmed) throw new Error("Title cannot be empty.");
      const raw = await chatMessagesCollection.list({
        filter: { ...createdByFilter(userId), sessionId },
        pageNo: 1,
        pageSize: 500,
        sort: { CreatedDate: -1 },
      });
      const messages = unwrapPaged<unknown>(raw).items;
      // Walk forward in the list until we find a user-authored message —
      // messages are newest-first, so the latest user turn is the row we
      // want to rewrite. If we can't find one (a session that has only
      // assistant / system turns), we throw — the caller should surface
      // a friendly message.
      const target = messages.find(
        (m) => (m as { role?: string }).role === "user",
      );
      if (!target) throw new Error("Cannot rename: no user turn in this session.");
      const id = (target as { ItemId?: string }).ItemId;
      const role = (target as { role?: string }).role ?? "user";
      const actionsJson = (target as { actionsJson?: string }).actionsJson ?? "";
      if (!id) throw new Error("Cannot rename: target message missing id.");
      await chatMessagesCollection.update(id, {
        sessionId,
        role,
        content: trimmed,
        actionsJson,
      });
      return { sessionId, newTitle: trimmed };
    },
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({
        queryKey: queryKeys.chatHistory(userId, vars.sessionId),
      });
      qc.invalidateQueries({ queryKey: queryKeys.chatSessions(userId) });
    },
  });
}

export function useAppendChatMessage(): UseMutationResult<
  PersistedChatMessage,
  Error,
  {
    sessionId: string;
    role: "user" | "assistant" | "system";
    content: string;
    actions?: PersistedChatMessage["actions"];
  }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async (input) => {
      const created = (await chatMessagesCollection.create({
        sessionId: input.sessionId,
        role: input.role,
        content: input.content,
        // JSON-stringify ChatAction[] because the schema's field types are
        // primitives; toChatMessage parses it back on read.
        actionsJson: input.actions ? JSON.stringify(input.actions) : "",
      })) as {
        data?: {
          ItemId: string;
          sessionId: string;
          role: string;
          content: string;
          actionsJson?: string;
          CreatedDate: string;
          LastUpdatedDate: string;
        };
      };
      const item = created.data ?? (created as unknown as {
        ItemId: string;
        sessionId: string;
        role: string;
        content: string;
        actionsJson?: string;
        CreatedDate: string;
        LastUpdatedDate: string;
      });
      return toChatMessage(item as Parameters<typeof toChatMessage>[0]);
    },
    onSuccess: (_msg, vars) => {
      qc.invalidateQueries({
        queryKey: queryKeys.chatHistory(userId, vars.sessionId),
      });
      // Refresh the user's session list too — a brand-new session surfaces
      // for the first time after this mutation, and an existing one's
      // title/lastActivity/messageCount may have changed.
      qc.invalidateQueries({ queryKey: queryKeys.chatSessions(userId) });
    },
  });
}

// --- Direct messages (member chat) ------------------------------------------
//
// The /chat page's data feed. One row per message; the sender writes it,
// the recipient reads it back through `recipientId`. The gateway's flat
// AND-filters can't express "senderId = me OR recipientId = me", so the
// read is two list calls (outbox + inbox) merged and deduped by ItemId.
// There's no push channel for Blocks Data, so the query polls every 5s
// while the page is mounted — WhatsApp-ish liveness without websockets.

export function useDirectMessages(): UseQueryResult<DirectMessage[]> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  return useQuery({
    queryKey: queryKeys.directMessages(userId),
    enabled: Boolean(userId),
    refetchInterval: 5000,
    queryFn: async () => {
      const [sent, received] = await Promise.all([
        directMessagesCollection.list({
          filter: { senderId: userId },
          pageNo: 1,
          pageSize: 500,
          sort: { CreatedDate: 1 },
        }),
        directMessagesCollection.list({
          filter: { recipientId: userId },
          pageNo: 1,
          pageSize: 500,
          sort: { CreatedDate: 1 },
        }),
      ]);
      const merged = new Map<string, DirectMessage>();
      for (const raw of [
        ...unwrapPaged<CloudDirectMessage>(sent).items,
        ...unwrapPaged<CloudDirectMessage>(received).items,
      ]) {
        merged.set(raw.ItemId, toDirectMessage(raw));
      }
      return [...merged.values()].sort((a, b) => a.sentAt.localeCompare(b.sentAt));
    },
  });
}

export function useSendDirectMessage(): UseMutationResult<
  DirectMessage,
  Error,
  { recipientId: string; content: string }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async (input) => {
      const created = (await directMessagesCollection.create({
        senderId: userId,
        recipientId: input.recipientId,
        content: input.content,
        readAt: "",
      })) as { data?: CloudDirectMessage } | CloudDirectMessage;
      const item =
        "data" in created && created.data
          ? created.data
          : (created as CloudDirectMessage);
      return toDirectMessage(item as Parameters<typeof toDirectMessage>[0]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.directMessages(userId) });
    },
  });
}

// Stamps `readAt` on the given received messages (the caller passes the
// unread rows of the conversation being opened). Updates run one-by-one —
// the SDK exposes no bulk update — each carrying the full required field
// set, mirroring the rename-chat-session patch shape.
export function useMarkDirectMessagesRead(): UseMutationResult<
  void,
  Error,
  DirectMessage[]
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async (messages) => {
      const now = new Date().toISOString();
      for (const m of messages) {
        await directMessagesCollection.update(m.id, {
          senderId: m.senderId,
          recipientId: m.recipientId,
          content: m.content,
          readAt: now,
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.directMessages(userId) });
    },
  });
}

// --- Chat image attachment ---------------------------------------------------
//
// Send a direct message that carries an optional image attachment. Mirrors
// `useUploadProfilePic`'s three-step flow (presign → PUT → row create) but
// drives the `directMessages` collection instead of `userProfiles`.
//
// Why a separate hook rather than widening `useSendDirectMessage`:
//   - Different async shape — three round-trips, two of them with distinct
//     failure modes the caller needs to surface (presign denied, PUT 4xx,
//     row create 400). Collapsing into one mutation hides those from the
//     toast layer.
//   - Different UX state — the composer mounts a paperclip + removable
//     preview chip and needs its own `isPending` for the spinner + button
//     disable. `useSendDirectMessage`'s `isPending` should stay scoped to
//     the text-only path so a stalled attachment upload doesn't grey out
//     text sends.
//   - Presigned URLs are single-use — `retry: false` is mandatory below so
//     a transient row-create failure doesn't re-PUT duplicate bytes.
//
// Orphan files: if `presignUpload` + `uploadToPresignedUrl` succeed but the
// row create fails, the bytes are left in storage (no compensating delete).
// Acceptable for v1; `files.delete` is the manual escape hatch.

const CHAT_ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024;

export function useSendChatAttachment(): UseMutationResult<
  { message: DirectMessage; fileId: string },
  Error,
  { recipientId: string; content: string; file: File }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    retry: false,
    mutationFn: async ({ recipientId, content, file }) => {
      if (!userId) {
        throw new Error("You must be signed in to send attachments.");
      }
      if (!file.type.startsWith("image/")) {
        throw new Error("Please pick an image file.");
      }
      if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
        throw new Error("Image must be 4 MB or smaller.");
      }
      // Unique filename per send — same shape as profile pics so the storage
      // layout is predictable, but `tags` lets admins distinguish the two.
      const ext =
        (file.name.split(".").pop() ?? "").toLowerCase() ||
        file.type.replace("image/", "") ||
        "png";
      const fileName = `chat-${userId}-${Date.now()}.${ext}`;
      const presign = await presignUpload({
        fileName,
        contentType: file.type,
        tags: "chat-attachment",
      });
      await uploadToPresignedUrl(presign.uploadUrl, file, file.type);
      const created = (await directMessagesCollection.create({
        senderId: userId,
        recipientId,
        content: content || "",
        readAt: "",
        attachmentFileId: presign.fileId,
      })) as { data?: CloudDirectMessage } | CloudDirectMessage;
      const item =
        "data" in created && created.data
          ? created.data
          : (created as CloudDirectMessage);
      return {
        message: toDirectMessage(item as Parameters<typeof toDirectMessage>[0]),
        fileId: presign.fileId,
      };
    },
    onSuccess: ({ fileId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.directMessages(userId) });
      // Prefill the URL cache so the new bubble's <img> renders immediately
      // without waiting for the bubble component to mount the query.
      qc.prefetchQuery({
        queryKey: queryKeys.fileDownloadUrl(fileId),
        queryFn: () => fetchFileDownloadUrl(fileId),
      });
    },
  });
}

// --- Direct message: edit / delete / react ------------------------------------
//
// The composer handles "send new" (useSendDirectMessage +
// useSendChatAttachment above). These three hooks cover the per-row
// lifecycle after a message exists:
//
//   useEditDirectMessage      — sender-only. Updates `content` and
//                              stamps `editedAt`. Permission check is
//                              client-side (the message's `senderId`
//                              must equal the current user).
//   useDeleteDirectMessage    — sender-only. Soft delete: stamps
//                              `deletedAt` and blanks the content +
//                              attachment. The bubble renders a
//                              tombstone instead of the original.
//   useToggleDirectMessageReaction — open to BOTH sender and recipient
//                              (any workspace member can react to any
//                              message they're a party to). Toggles
//                              one `{userId, emoji}` pair: adds it if
//                              missing, removes it if already present.
//
// All three invalidate the same `directMessages` query so the roster
// previews + thread + unread badges all refresh in lockstep.

export function useEditDirectMessage(): UseMutationResult<
  DirectMessage,
  Error,
  { id: string; senderId: string; recipientId: string; content: string }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async ({ id, senderId, recipientId, content }) => {
      const now = new Date().toISOString();
      const updated = (await directMessagesCollection.update(id, {
        senderId,
        recipientId,
        content,
        editedAt: now,
      })) as { data?: CloudDirectMessage } | CloudDirectMessage;
      const item =
        "data" in updated && updated.data
          ? updated.data
          : (updated as CloudDirectMessage);
      return toDirectMessage(item as Parameters<typeof toDirectMessage>[0]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.directMessages(userId) });
    },
  });
}

export function useDeleteDirectMessage(): UseMutationResult<
  void,
  Error,
  { id: string; senderId: string; recipientId: string }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async ({ id, senderId, recipientId }) => {
      const now = new Date().toISOString();
      // Soft delete: blank content + attachment, stamp deletedAt.
      // `reactions` is also wiped so the tombstone doesn't show ghost
      // emojis. The row stays so the recipient's read/unread state
      // remains auditable.
      await directMessagesCollection.update(id, {
        senderId,
        recipientId,
        content: "",
        attachmentFileId: "",
        reactions: "[]",
        editedAt: "",
        deletedAt: now,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.directMessages(userId) });
    },
  });
}

export function useToggleDirectMessageReaction(): UseMutationResult<
  void,
  Error,
  { id: string; senderId: string; recipientId: string; reactions: { userId: string; emoji: string }[] }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async ({ id, senderId, recipientId, reactions }) => {
      await directMessagesCollection.update(id, {
        senderId,
        recipientId,
        reactions: JSON.stringify(reactions),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.directMessages(userId) });
    },
  });
}

// --- Call-log system message ------------------------------------------------
//
// Writes a DirectMessage row whose `messageType === "call_log"` and whose
// `callSummary` is the localized human-readable string the thread pill +
// roster preview render (e.g. "Voice call · 0:32", "Missed voice call").
// The row's `senderId` is me (the side that ended the call) and
// `recipientId` is the peer — both sides see it via the same two-call
// `useDirectMessages` read because each side is named in one of the two
// filters.
//
// The "who writes the row" rule is "the side whose user action ended the
// call" — caller for hangup/missed/ICE-failure, recipient for decline. A
// double-fire is rare but possible (e.g. both sides hit End within the
// 5s poll window); the dedupe key `callSignalId` (passed in via
// `endedAtIso`'s shape — caller-supplied) gives both sides a stable
// token to check before writing. For v1 we trust the caller/recipient
// asymmetry to keep double-writes rare and accept the occasional
// duplicate pill if it ever happens.
//
// No retry — if the log mutation fails, the closing toast already
// covered the outcome; the thread just won't have the system row.
export function useLogCallOutcome(): UseMutationResult<
  DirectMessage,
  Error,
  {
    recipientId: string;
    kind: "voice" | "video";
    outcome: "ended" | "missed" | "declined" | "error";
    durationSec?: number;
    /** ISO timestamp from CallSignal.endedAt — the row's `sentAt`. */
    endedAtIso: string;
  }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async (input) => {
      // Build the localized summary client-side so a single `callSummary`
      // string rides the row (the renderer doesn't have to know about the
      // outcome/kind/durationSec tuple). Reuses the chat.* translation
      // keys the in-call dialog already defines.
      const kindLabel =
        input.kind === "video"
          ? blocksClient.localization.t("chat.callVideo", "video")
          : blocksClient.localization.t("chat.callVoice", "voice");
      let summary: string;
      if (input.outcome === "ended") {
        const baseLabel =
          input.kind === "video"
            ? blocksClient.localization.t("chat.callVideo", "video call")
            : blocksClient.localization.t("chat.callVoice", "voice call");
        if (input.durationSec && input.durationSec > 0) {
          const formatted = formatCallDuration(input.durationSec);
          summary = `${baseLabel} · ${formatted}`;
        } else {
          summary = baseLabel;
        }
      } else if (input.outcome === "missed") {
        summary = blocksClient.localization.t(
          "chat.callLogMissed",
          `Missed ${kindLabel} call`,
        );
      } else if (input.outcome === "declined") {
        summary = blocksClient.localization.t(
          "chat.callLogDeclined",
          `Declined ${kindLabel} call`,
        );
      } else {
        summary = blocksClient.localization.t(
          "chat.callLogError",
          "Call failed to connect",
        );
      }
      const created = (await directMessagesCollection.create({
        senderId: userId,
        recipientId: input.recipientId,
        content: "",
        readAt: "",
        messageType: "call_log",
        callSummary: summary,
      })) as { data?: CloudDirectMessage } | CloudDirectMessage;
      const item =
        "data" in created && created.data
          ? created.data
          : (created as CloudDirectMessage);
      return toDirectMessage(item as Parameters<typeof toDirectMessage>[0]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.directMessages(userId) });
    },
  });
}

// Format a duration in seconds as `M:SS` (or `H:MM:SS` past 60 minutes).
// Pure math — no locale dependency because the `M:SS` shape is the same
// universal compact format WhatsApp/Telegram/iMessage use for call
// durations. Centralized so the thread pill + roster preview produce
// identical strings.
function formatCallDuration(sec: number): string {
  const safe = Math.max(0, Math.round(sec));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0
    ? `${h}:${pad(m)}:${pad(s)}`
    : `${m}:${pad(s)}`;
}

// --- WebRTC call signaling ---------------------------------------------------
//
// One CallSignal row per call attempt — caller writes it with status='ringing'
// and the SDP offer, both sides mutate it as the call progresses (SDP
// answer from the recipient, ICE candidates trickled by both via a 2s poll,
// status transitions to accepted/declined/ended/missed). Workspace-readable
// so both peers read the same row, matching the DirectMessage "no rules.json
// gate" precedent.
//
// All reads are scoped to "me as caller OR me as recipient" — the gateway's
// flat-key filter can't express that OR in one query, so we issue two list
// calls (outbox + inbox) and dedupe by ItemId, mirroring useDirectMessages.
//
// Polling cadence:
//   - 5s when no live row, matching useDirectMessages.
//   - 2s when a call is `ringing` / `accepted` so ICE candidates trickle
//     responsively. Implemented as a function-form `refetchInterval` so
//     TanStack Query re-evaluates on every data change.

// Read every CallSignal row where `callerId === me` OR `recipientId === me`,
// then return the one that's currently active (not yet in a terminal state).
// `null` when there's no live call against `counterpartId`.
export function useActiveCallSignal(
  counterpartId: string | undefined,
): UseQueryResult<CallSignal | null> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  return useQuery({
    queryKey: [...queryKeys.callSignals(userId), counterpartId ?? "_none"],
    enabled: Boolean(userId && counterpartId),
    refetchInterval: (query) => {
      const data = query.state.data as CallSignal | null | undefined;
      const live = data && data.status !== "ended" && data.status !== "declined" && data.status !== "missed";
      return live ? 2_000 : 5_000;
    },
    queryFn: async () => {
      // Two-call read: caller-side outbox + recipient-side inbox. The
      // gateway filter is flat key/value, so an OR has to be expressed
      // as two queries merged + deduped client-side.
      const [asCaller, asRecipient] = await Promise.all([
        callSignalsCollection.list({
          filter: { callerId: userId, recipientId: counterpartId },
          pageNo: 1,
          pageSize: 50,
          sort: { LastUpdatedDate: -1 },
        }),
        callSignalsCollection.list({
          filter: { callerId: counterpartId, recipientId: userId },
          pageNo: 1,
          pageSize: 50,
          sort: { LastUpdatedDate: -1 },
        }),
      ]);
      const merged = new Map<string, CallSignal>();
      for (const raw of [
        ...unwrapPaged<CloudCallSignal>(asCaller).items,
        ...unwrapPaged<CloudCallSignal>(asRecipient).items,
      ]) {
        merged.set(raw.ItemId, toCallSignal(raw));
      }
      // Pick the most-recently-updated row that isn't terminal. If no
      // live row exists, fall back to the most recent terminal row so
      // the caller can still read the endReason for the closing toast.
      const all = [...merged.values()].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      );
      const live = all.find(
        (s) => s.status !== "ended" && s.status !== "declined" && s.status !== "missed",
      );
      if (live) return live;
      return all[0] ?? null;
    },
  });
}

// Subscribe to every CallSignal where `recipientId === me` so the global
// IncomingCallDialog can auto-pop on a fresh ringing call. The shape +
// baseline-capture pattern mirrors useAnnouncementsAutoOpen — capture every
// (id → updatedAt) on first resolve, then surface a new id whose caller is
// not me. The seen map key is `updatedAt` (not `createdAt`) because the
// row mutates many times during a call (accepted, ICE appends, ended) and
// any of those transitions is a meaningful "fresh" signal for the dialog.
export function useIncomingCallSignals(): UseQueryResult<CallSignal[]> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  return useQuery({
    queryKey: [...queryKeys.callSignals(userId), "incoming"],
    enabled: Boolean(userId),
    refetchInterval: 5_000,
    refetchIntervalInBackground: true,
    queryFn: async () => {
      const raw = await callSignalsCollection.list({
        filter: { recipientId: userId },
        pageNo: 1,
        pageSize: 50,
        sort: { LastUpdatedDate: -1 },
      });
      return unwrapPaged<CloudCallSignal>(raw).items.map((c) =>
        toCallSignal(c),
      );
    },
  });
}

// Auto-pop the IncomingCallDialog when a fresh ringing call arrives for
// the current user. Same `seenRef` baseline pattern as
// useAnnouncementsAutoOpen — pre-existing rows on first resolve are not
// considered fresh arrivals. Returns the standard [open, setOpen] pair
// so the dialog owns its visibility state but the auto-open effect lives
// here.
export function useIncomingCallAutoOpen(): [
  boolean,
  Dispatch<SetStateAction<boolean>>,
] {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  const incoming = useIncomingCallSignals();
  const [open, setOpen] = useState(false);

  // Per-session baseline of `(id → updatedAt)`. Rebuilt when the user
  // changes so a logout/login cycle doesn't replay the previous
  // session's history as fresh arrivals.
  const seenRef = useRef<Map<string, string> | null>(null);
  const lastUserIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!userId) return;
    if (incoming.data === undefined) return;
    const rows = incoming.data;

    // First resolution: snapshot everything; nothing is "fresh".
    if (seenRef.current === null) {
      seenRef.current = new Map(rows.map((r) => [r.id, r.updatedAt]));
      lastUserIdRef.current = userId;
      return;
    }
    // Identity change: rebuild baseline.
    if (lastUserIdRef.current !== userId) {
      seenRef.current = new Map(rows.map((r) => [r.id, r.updatedAt]));
      lastUserIdRef.current = userId;
      return;
    }

    // Fresh delivery = new id, OR known id whose `updatedAt` advanced.
    // Skip rows where I'm the caller (those are my own outbound calls —
    // the caller-side CallDialog already handles them) and skip rows in
    // terminal states (no point auto-popping a call that's already
    // ended/declined/missed).
    const seen = seenRef.current;
    let shouldOpen = false;
    for (const r of rows) {
      const prev = seen.get(r.id);
      if (prev === r.updatedAt) continue;
      seen.set(r.id, r.updatedAt);
      if (r.callerId === userId) continue;
      if (
        r.status === "ended" ||
        r.status === "declined" ||
        r.status === "missed"
      ) {
        continue;
      }
      shouldOpen = true;
    }
    if (shouldOpen) setOpen(true);
  }, [incoming.data, userId]);

  return [open, setOpen];
}

// Read a single CallSignal row by id. Used by useAcceptCall / useEndCall /
// useAppendIceCandidates to refresh the row before mutating (so the new
// PATCH has fresh sdpAnswer / iceCandidates / endedAt to merge in).
export function useCallSignalById(
  signalId: string | undefined,
): UseQueryResult<CallSignal | null> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  return useQuery({
    queryKey: [...queryKeys.callSignals(userId), "id", signalId ?? "_none"],
    enabled: Boolean(userId && signalId),
    refetchInterval: 2_000,
    queryFn: async () => {
      if (!signalId) return null;
      const raw = await callSignalsCollection.list({
        filter: { ItemId: signalId } as Record<string, string>,
        pageNo: 1,
        pageSize: 1,
      });
      const items = unwrapPaged<CloudCallSignal>(raw).items;
      return items[0] ? toCallSignal(items[0]) : null;
    },
  });
}

// Insert a new CallSignal row in `ringing` with the caller's SDP offer.
// Caller side of `useStartCall`. Returns the created row so the caller's
// CallDialog can store `signalId` and start polling.
export function useStartCall(): UseMutationResult<
  CallSignal,
  Error,
  {
    recipientId: string;
    kind: "voice" | "video";
    sdpOffer: RTCSessionDescriptionInit;
  }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async ({ recipientId, kind, sdpOffer }) => {
      const response = await callSignalsCollection.create({
        callerId: userId,
        recipientId,
        kind,
        status: "ringing",
        sdpOffer: JSON.stringify(sdpOffer),
        sdpAnswer: "",
        iceCandidatesJson: "[]",
        endedAt: "",
        endReason: "",
      });
      const id = extractInsertedItemId(response, "insertCallSignal");
      if (!id) throw new Error("Failed to create call signal");
      // Read back the row we just inserted so the caller has the full
      // UI shape (id, createdAt, updatedAt, etc.) populated.
      const fresh = await callSignalsCollection.list({
        filter: { ItemId: id } as Record<string, string>,
        pageNo: 1,
        pageSize: 1,
      });
      const items = unwrapPaged<CloudCallSignal>(fresh).items;
      if (!items[0]) throw new Error("Call signal not found after insert");
      return toCallSignal(items[0]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.callSignals(userId) });
    },
  });
}

// Recipient side of accept. PATCHes the row with status='accepted' + the
// recipient's SDP answer. Every requiredOn:3 field rides the patch.
export function useAcceptCall(): UseMutationResult<
  CallSignal,
  Error,
  {
    signalId: string;
    callerId: string;
    recipientId: string;
    kind: "voice" | "video";
    sdpAnswer: RTCSessionDescriptionInit;
  }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async ({ signalId, callerId, recipientId, kind, sdpAnswer }) => {
      const updated = (await callSignalsCollection.update(signalId, {
        callerId,
        recipientId,
        kind,
        status: "accepted",
        sdpAnswer: JSON.stringify(sdpAnswer),
        endedAt: "",
        endReason: "",
      })) as { data?: CloudCallSignal } | CloudCallSignal;
      const item =
        "data" in updated && updated.data
          ? updated.data
          : (updated as CloudCallSignal);
      return toCallSignal(item as Parameters<typeof toCallSignal>[0]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.callSignals(userId) });
    },
  });
}

// Recipient declines. PATCHes status='declined' + endedAt + endReason.
export function useDeclineCall(): UseMutationResult<
  void,
  Error,
  { signalId: string; callerId: string; recipientId: string; kind: string }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async ({ signalId, callerId, recipientId, kind }) => {
      const now = new Date().toISOString();
      await callSignalsCollection.update(signalId, {
        callerId,
        recipientId,
        kind,
        status: "declined",
        endedAt: now,
        endReason: "declined",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.callSignals(userId) });
    },
  });
}

// Either side ends the call. Idempotent — a second useEndCall against an
// already-terminal row is a no-op (the row's endedAt is already non-empty).
export function useEndCall(): UseMutationResult<
  void,
  Error,
  {
    signalId: string;
    callerId: string;
    recipientId: string;
    kind: string;
    reason?: "hangup" | "error" | "missed";
  }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async ({ signalId, callerId, recipientId, kind, reason = "hangup" }) => {
      const now = new Date().toISOString();
      await callSignalsCollection.update(signalId, {
        callerId,
        recipientId,
        kind,
        status: "ended",
        endedAt: now,
        endReason: reason,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.callSignals(userId) });
    },
  });
}

// Append newly-generated local ICE candidates to the shared JSON blob.
// Read-then-write so the dedupe happens against the latest blob (the
// other side may have appended their own candidates since our last
// read). The merge set is bounded by the small number of ICE candidates
// per peer (typically <20), so the read-then-write is cheap.
export function useAppendIceCandidates(): UseMutationResult<
  void,
  Error,
  {
    signalId: string;
    callerId: string;
    recipientId: string;
    kind: string;
    newCandidates: CallSignalIceCandidate[];
  }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async ({ signalId, callerId, recipientId, kind, newCandidates }) => {
      if (newCandidates.length === 0) return;
      // Read the latest blob so the merge dedupes against both sides' latest.
      const fresh = await callSignalsCollection.list({
        filter: { ItemId: signalId } as Record<string, string>,
        pageNo: 1,
        pageSize: 1,
      });
      const items = unwrapPaged<CloudCallSignal>(fresh).items;
      const existing = items[0];
      let merged: CallSignalIceCandidate[] = [];
      if (existing?.iceCandidatesJson) {
        try {
          const parsed = JSON.parse(existing.iceCandidatesJson);
          if (Array.isArray(parsed)) {
            merged = parsed.filter(
              (c): c is CallSignalIceCandidate =>
                c &&
                typeof c === "object" &&
                typeof c.candidate === "string",
            );
          }
        } catch {
          // Corrupt blob — replace with just our new ones.
        }
      }
      for (const c of newCandidates) {
        if (!merged.some((existing) => existing.candidate === c.candidate)) {
          merged.push(c);
        }
      }
      // Echo requiredOn:3 fields with the current status so we don't
      // accidentally clobber an `accepted` flip with the default `ringing`.
      await callSignalsCollection.update(signalId, {
        callerId,
        recipientId,
        kind,
        status: existing?.status ?? "accepted",
        iceCandidatesJson: JSON.stringify(merged),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.callSignals(userId) });
    },
  });
}

// --- Announcements (manager broadcast) ---------------------------------------
//
// Dashboard section: a manager posts a workspace-wide message ("today we
// are going to prod") and every invited member reads it. The read has NO
// per-user filter — the collection is intentionally public to the
// workspace. The write paths gate on the manager role client-side, the
// same defense-in-depth pattern as the tester guards on project
// mutations (the composer doesn't even render for non-managers).

export function useAnnouncements(): UseQueryResult<Announcement[]> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  return useQuery({
    // `userId` in the key only so a sign-out / sign-in cycle doesn't
    // serve one session's cache into the next; the rows themselves are
    // workspace-wide.
    queryKey: [...queryKeys.announcements, userId],
    enabled: Boolean(userId),
    // Polls every 5 s, matching `useDirectMessages` so a freshly posted
    // announcement surfaces on other members' dashboards with the same
    // WhatsApp-ish liveness as a chat message. The query is mounted by
    // `useAnnouncementsAutoOpen` in `Topbar`, so this fires on every
    // authenticated page — no need to navigate back to /dashboard for
    // the cache to catch up. `refetchIntervalInBackground: true` keeps
    // the poll running even when the tab is hidden, so a member who
    // parked the app in a background tab still sees the announcement
    // surface (and the auto-open dialog pop) when they refocus.
    refetchInterval: 5_000,
    refetchIntervalInBackground: true,
    queryFn: async () => {
      const raw = await announcementsCollection.list({
        pageNo: 1,
        pageSize: 50,
        // Sort by `LastUpdatedDate` (NOT `CreatedDate`) so a Repost or
        // Edit bubbles the row back to "Latest" without creating a
        // duplicate. The platform auto-stamps both timestamps on
        // create, so a brand-new row has the same value for both
        // and still appears first.
        sort: { LastUpdatedDate: -1 },
      });
      return unwrapPaged<CloudAnnouncement>(raw).items.map((a) =>
        toAnnouncement(a),
      );
    },
  });
}

export function usePostAnnouncement(): UseMutationResult<
  Announcement,
  Error,
  { content: string }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  const isManager = currentUser?.roles?.includes("manager") ?? false;
  return useMutation({
    mutationFn: async (input) => {
      if (!isManager) {
        throw new Error("Only managers can post announcements.");
      }
      const created = (await announcementsCollection.create({
        authorId: userId,
        content: input.content,
      })) as { data?: CloudAnnouncement } | CloudAnnouncement;
      const item =
        "data" in created && created.data
          ? created.data
          : (created as CloudAnnouncement);
      return toAnnouncement(item as Parameters<typeof toAnnouncement>[0]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.announcements });
    },
  });
}

// Editing keeps the ORIGINAL authorId: an edit by another manager must
// not rewrite authorship (the row still shows who first posted it).
// `authorId` re-sent unchanged because requiredOn:3 fields must all ride
// the update patch — same full-patch shape as the DM readAt stamp.
export function useUpdateAnnouncement(): UseMutationResult<
  Announcement,
  Error,
  { id: string; authorId: string; content: string }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const isManager = currentUser?.roles?.includes("manager") ?? false;
  return useMutation({
    mutationFn: async (input) => {
      if (!isManager) {
        throw new Error("Only managers can edit announcements.");
      }
      const updated = (await announcementsCollection.update(input.id, {
        authorId: input.authorId,
        content: input.content,
      })) as { data?: CloudAnnouncement } | CloudAnnouncement;
      const item =
        "data" in updated && updated.data
          ? updated.data
          : (updated as CloudAnnouncement);
      return toAnnouncement(item as Parameters<typeof toAnnouncement>[0]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.announcements });
    },
  });
}

// Repost an existing announcement — bumps the SAME row back to the
// top of the list. We `update` (not `create`) so the platform's
// auto-managed `LastUpdatedDate` advances and the announcement
// surfaces as "Latest" again, with no duplicate row added to the
// collection. `authorId` rides along because requiredOn:3 fields
// must all ride the update patch (same full-patch shape as
// `useUpdateAnnouncement`).
export function useRepostAnnouncement(): UseMutationResult<
  Announcement,
  Error,
  Announcement
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const isManager = currentUser?.roles?.includes("manager") ?? false;
  return useMutation({
    mutationFn: async (source) => {
      if (!isManager) {
        throw new Error("Only managers can repost announcements.");
      }
      const updated = (await announcementsCollection.update(source.id, {
        authorId: source.authorId,
        content: source.content,
      })) as { data?: CloudAnnouncement } | CloudAnnouncement;
      const item =
        "data" in updated && updated.data
          ? updated.data
          : (updated as CloudAnnouncement);
      return toAnnouncement(item as Parameters<typeof toAnnouncement>[0]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.announcements });
    },
  });
}

// --- Test cases --------------------------------------------------------------
//
// Test cases are rows in a Feature's spreadsheet. The list hook returns
// all rows for one feature sorted by the sparse `order` field (smaller
// first, missing sorts to the end). Mutations are feature-scoped —
// every add / update / delete invalidates only the feature's key so
// adjacent features' sheets don't flicker.

/**
 * List all test cases attached to a single feature. Empty array when
 * `featureId` is missing (defensive — the hook is called before the
 * feature row has resolved). Sorted by `order` ascending (lex on the
 * stringified integer, which matches numeric order for the "0", "10",
 * "20" sparse scheme).
 */
export function useTestCases(flowId: string): UseQueryResult<TestCase[]> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  return useQuery<TestCase[]>({
    queryKey: queryKeys.testCases(flowId),
    // Disable until we actually have a flow id — otherwise an
    // empty-string key fires a no-op request that 400s.
    enabled: Boolean(userId && flowId),
    queryFn: async () => {
      const raw = await testCasesCollection.list({
        pageNo: 1,
        pageSize: 500,
        filter: { flowId },
      });
      // Blocks SDK `list()` returns a paged payload
      // `{ data: { getTestCases: { items, totalCount, ... } } }` —
      // `unwrapPaged` walks past either wrapper shape and lands on
      // the bare `{ items, totalCount }` so the rest of the hook
      // can treat it like every other list hook does.
      const rows = unwrapPaged<CloudTestCase>(raw).items;
      return rows
        .map((r) => toTestCase(r))
        .sort((a, b) => {
          if (!a.order && !b.order) return 0;
          if (!a.order) return 1;
          if (!b.order) return -1;
          return a.order.localeCompare(b.order, undefined, { numeric: true });
        });
    },
  });
}

// --- Flow comments ----------------------------------------------------------
//
// Per-flow thread of comments + replies, persisted to the Blocks Data
// gateway via the `FlowComment` schema. Comments are team-wide discussion
// (open to every role on every env — see `CommentsChip.tsx` and the
// `chipReadOnly` rationale in `FlowItem`), so the read is workspace-wide
// with `filter: { flowId }` doing the per-thread scoping. The wire shape
// is one flat row per comment or reply (`parentId` groups replies under
// their top-level); the threaded view in `CommentsModal` is reconstructed
// by the consumer (`FlowItem.groupNested`).

/**
 * Read all comments + replies for a single flow. Returns the flat
 * `FlowCommentRow[]` shape (one row per comment or reply, joined by
 * `parentId`) — the consumer groups rows into the nested
 * `comments[] + replies[]` shape that `CommentsModal` takes.
 *
 * Workspace-wide read; no `createdBy` filter so every team member sees
 * the same thread regardless of author. Sorted by `createdAt` ascending
 * so the threaded view renders the thread in oldest-first order.
 */
export function useFlowComments(
  flowId: string,
): UseQueryResult<FlowCommentRow[]> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  return useQuery<FlowCommentRow[]>({
    queryKey: queryKeys.flowComments(flowId),
    // Disable until we actually have a flow id — otherwise an
    // empty-string key fires a no-op request that 400s. Same gating as
    // `useTestCases` (line 2150) so the two flow-scoped readers stay
    // symmetric.
    enabled: Boolean(userId && flowId),
    queryFn: async () => {
      const raw = await flowCommentsCollection.list({
        pageNo: 1,
        pageSize: 500,
        filter: { flowId },
      });
      const rows = unwrapPaged<CloudFlowComment>(raw).items;
      return rows
        .map((r) => toFlowCommentRow(r))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
  });
}

export interface AddFlowCommentInput {
  flowId: string;
  content: string;
}

/**
 * Add a top-level comment to a flow. No role gate — comments are open to
 * every role on every env (see `comments-chip-always-open` memory); only
 * UI affordances (chip / modal) change per role, not the underlying
 * mutation surface.
 *
 * Returns the constructed `FlowCommentRow` (synthesised from the input
 * because the Blocks SDK's insert response only echoes
 * `{ acknowledged, itemId, message, totalImpactedData }` — same pattern
 * as `useAddTestCase` at line 2204). On success both invalidates AND
 * refetches the flow's comments query — the explicit refetch is the
 * belt-and-braces that removes the "I clicked but nothing happened"
 * foot-gun if the query is currently disabled or has a stale cache.
 */
export function useAddFlowComment(): UseMutationResult<
  FlowCommentRow,
  Error,
  AddFlowCommentInput
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async (input) => {
      const nowIso = new Date().toISOString();
      await flowCommentsCollection.create({
        flowId: input.flowId,
        // Top-level comments intentionally OMIT `parentId` rather than
        // sending "" — the gateway's strict 'Required' validator rejects
        // empty strings on insert with
        // "Field 'parentId' is required for insert"
        // (verified 2026-09-27). The schema field is `requiredOn: "None"`
        // so omitting it is the model; the read path (`toFlowCommentRow`)
        // defaults missing `parentId` to "" and `FlowItem.groupNested`
        // treats `parentId === ""` as a top-level row.
        authorId: userId,
        authorName: currentUser?.name ?? "",
        authorEmail: currentUser?.email ?? "",
        authorAvatar: currentUser?.avatarUrl ?? "",
        content: input.content,
      });
      // Reconstruct the row from what we know — same "SDK insert only
      // echoes `{itemId, ...}`" pattern as `useAddTestCase` (line 2235).
      // `id` stays empty because the cloud's UUID isn't echoed in the
      // insert response; the explicit `refetchQueries` below repopulates
      // the real id on the next read pass.
      return {
        id: "",
        parentId: "",
        authorId: userId,
        authorName: currentUser?.name ?? "",
        authorEmail: currentUser?.email ?? "",
        authorAvatar: currentUser?.avatarUrl,
        content: input.content,
        createdAt: nowIso,
      };
    },
    onSuccess: (_row, input) => {
      qc.invalidateQueries({
        queryKey: queryKeys.flowComments(input.flowId),
      });
      // Belt-and-braces — see `useAddTestCase`'s matching comment at
      // line 2262. Removes the class of "I clicked Add comment and the
      // thread didn't refresh" foot-guns.
      qc.refetchQueries({
        queryKey: queryKeys.flowComments(input.flowId),
      });
    },
  });
}

export interface AddFlowCommentReplyInput {
  flowId: string;
  /** Parent comment's cloud ItemId (the UUID returned on read). */
  parentId: string;
  content: string;
}

/**
 * Add a reply under an existing top-level comment. Same shape and
 * invalidation as `useAddFlowComment` — only difference is the
 * `parentId` field on the cloud row (the parent's UUID, never empty).
 *
 * `parentId` here is the parent's *cloud* ItemId, NOT a stable logical
 * id — that's the only identifier the gateway carries between reads
 * (which is also why the parent's local-only `id` from a partial cache
 * must never be used as the link; the modal renders the cloud ids
 * surfaced by `groupNested`).
 *
 * Reply-side notification fan-out: on success we look up the parent
 * row in the React Query cache and write one `Notification` row to the
 * parent's `authorId` (the user who wrote the comment being replied
 * to). Reasons this lives here, not in `FlowItem` or a modal-callback:
 *
 *   * The mutation hook is the single place every reply is created
 *     regardless of caller — wiring notify from the modal would risk
 *     a future entry point (e.g. an inline reply from the inbox)
 *     forgetting the fan-out.
 *   * The mutation sees the *input* `parentId` directly, so it never
 *     has to dedupe against stale cache rows or race with the
 *     `invalidateQueries` refetch.
 *   * Failures are swallowed (best-effort `Promise.allSettled`) — the
 *     reply write itself is independent of the notification write, so
 *     a cloud outage on notifications doesn't drop the comment.
 *
 * Skip rules (all early-return; they never throw):
 *   * No signed-in actor: no one to attribute the notification to.
 *   * Parent row not found in cache / has empty `authorId`: legacy row
 *     predating the column, or the thread was just opened and the
 *     read hasn't landed yet — notification metadata would be wrong.
 *   * `parent.authorId === actor.id`: the replier IS the parent author
 *     (e.g. a comment author replying to themselves); skip the
 *     self-notification (same rationale as `RECIPIENTS_BY_ROLE`'s
 *     actor-exclusion filter).
 */
export function useAddFlowCommentReply(): UseMutationResult<
  FlowCommentRow,
  Error,
  AddFlowCommentReplyInput
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async (input) => {
      const nowIso = new Date().toISOString();
      await flowCommentsCollection.create({
        flowId: input.flowId,
        parentId: input.parentId,
        authorId: userId,
        authorName: currentUser?.name ?? "",
        authorEmail: currentUser?.email ?? "",
        authorAvatar: currentUser?.avatarUrl ?? "",
        content: input.content,
      });
      return {
        id: "",
        parentId: input.parentId,
        authorId: userId,
        authorName: currentUser?.name ?? "",
        authorEmail: currentUser?.email ?? "",
        authorAvatar: currentUser?.avatarUrl,
        content: input.content,
        createdAt: nowIso,
      };
    },
    onSuccess: (_row, input) => {
      qc.invalidateQueries({
        queryKey: queryKeys.flowComments(input.flowId),
      });
      qc.refetchQueries({
        queryKey: queryKeys.flowComments(input.flowId),
      });
      // Fire-and-forget reply notification. Wrapped in `void` so the
      // mutation's `onSuccess` returns immediately — the reply write
      // itself must never block on the notification backend. Errors
      // are soft-logged (a notification outage must never block the
      // underlying mutation — see `notifier-recipients-by-role`
      // memory).
      void notifyCommentReply({
        input,
        actorId: userId,
        actorName: currentUser?.name ?? "A teammate",
        qc,
      }).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn(
          "[useAddFlowCommentReply] reply notification failed",
          err,
        );
      });
    },
  });
}

/**
 * Write one `Notification` row to the parent comment's author when
 * someone replies to their comment. Internal helper used by
 * `useAddFlowCommentReply.onSuccess` — kept local to this file so the
 * reply-only fan-out logic stays beside the mutation that owns it.
 *
 * Returns `void`; all paths are no-ops on the unhappy ones (matching
 * the skip-rule comment on `useAddFlowCommentReply` above):
 *   * No signed-in actor → bail.
 *   * Parent row missing or has empty `authorId` → bail (legacy row or
 *     cache-not-yet-landed; we'd rather drop the notification than
 *     send a wrong-target one).
 *   * `parent.authorId === actorId` → bail (self-notify skip; same
 *     rationale as `RECIPIENTS_BY_ROLE`'s actor-exclusion filter).
 *
 * Metadata resolution: the flow / project names come from the React
 * Query cache populated by `useProjects` / `useFlows`. The notification
 * row stays denormalized so the inbox's `deriveBody` can render a
 * sentence without a follow-up read (matches the `notifyRole` /
 * `BlockPromoteModal` precedent).
 */
async function notifyCommentReply(args: {
  input: AddFlowCommentReplyInput;
  actorId: string;
  actorName: string;
  qc: ReturnType<typeof useQueryClient>;
}): Promise<void> {
  const { input, actorId, actorName, qc } = args;
  if (!actorId) return;
  // Look up the parent comment so we can find its author and skip
  // self-replies. The cache is populated by `useFlowComments`, which
  // the modal opened before the reply button was even visible.
  const threads =
    qc.getQueryData<FlowCommentRow[]>(queryKeys.flowComments(input.flowId)) ??
    [];
  const parent = threads.find((r) => r.id === input.parentId);
  // Skip when we couldn't resolve the parent — legacy row, or the
  // modal opened a context where the read hasn't landed yet. The
  // reply itself is still in the cloud; the user will see it on
  // refresh; we'd rather drop one notification than send a
  // wrong-target one.
  if (!parent || !parent.authorId) return;
  // Self-notify skip. A user replying to their own top-level comment
  // (e.g. adding context) shouldn't see "X replied to you on your
  // own comment" in their inbox.
  if (parent.authorId === actorId) return;
  // Resolve display metadata from cache. The modal opened against a
  // specific flow; the feature's `useFlows` cache populated before
  // this reply could fire. A miss falls through to empty strings; the
  // notifier then renders a generic sentence.
  const flow = findFlowInCache(qc, input.flowId);
  const project = flow ? findProjectInCache(qc, flow.projectId) : undefined;
  const rowBase = {
    context: "comment",
    actionName: "replied",
    actorId,
    actorName,
    // `value` carries the resource id (the flow id) so the inbox's
    // "Reference: <id>" fallback still has a chance to render if
    // every display field is missing.
    value: input.flowId,
    projectId: flow?.projectId ?? "",
    projectName: project?.name ?? "",
    featureId: flow?.featureId ?? "",
    featureName: flow?.name ?? "",
    flowId: input.flowId,
    flowName: flow?.name ?? "",
    envSlug: flow?.envSlug ?? "",
    oldName: "",
    newName: "",
    status: "",
    stack: "",
    readAt: "",
  };
  // Best-effort write — `notifyCommentReply` is invoked via
  // `void ... .catch(...)`, so a throw here is already swallowed. The
  // try/finally is belt-and-braces in case a future refactor moves
  // this out of `void`.
  try {
    await notificationsCollection.create({
      ...rowBase,
      userId: parent.authorId,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      "[notifyCommentReply] failed to write notification row",
      err,
    );
  }
}

/**
 * Find a flow row by id from any `useFlows(userId, featureId)` cache
 * slot. We don't know the featureId at the call site, so walk all
 * `["flows", ...]` cache entries and pick the matching row. Returns
 * `undefined` if the flow was never loaded by `useFlows` (rare — the
 * modal opened the flow row, so the feature's flows were read
 * earlier).
 */
function findFlowInCache(
  qc: ReturnType<typeof useQueryClient>,
  flowId: string,
): Flow | undefined {
  const caches = qc.getQueryCache().findAll({ queryKey: ["flows"] });
  for (const entry of caches) {
    const rows = qc.getQueryData<Flow[]>(entry.queryKey);
    if (!Array.isArray(rows)) continue;
    const hit = rows.find((f) => f.id === flowId);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Look up a project by id from any `["projects", ...]` cache slot —
 * the workspace-wide project list (`useProjects`) populates the only
 * keyed entry we expect to find at reply time.
 */
function findProjectInCache(
  qc: ReturnType<typeof useQueryClient>,
  projectId: string,
): Project | undefined {
  const caches = qc
    .getQueryCache()
    .findAll({ queryKey: ["projects"] });
  for (const entry of caches) {
    const rows = qc.getQueryData<Project[]>(entry.queryKey);
    if (!Array.isArray(rows)) continue;
    const hit = rows.find((p) => p.id === projectId);
    if (hit) return hit;
  }
  return undefined;
}

export interface AddTestCaseInput {
  featureId: string;
  flowId: string;
  title: string;
  steps?: string;
  expectedResult?: string;
  actualResult?: string;
  status?: TestCaseStatus;
  priority?: "low" | "medium" | "high";
  assignedTo?: string;
  order?: string;
  tags?: string[];
  /**
   * Whether the row can be deleted from the UI. Defaults to `true`
   * (deletable). The spreadsheet sets this to `false` when
   * auto-creating its 10 placeholder rows so the Delete option is
   * shown but rendered as disabled (greyed out, click-blocked) and
   * the delete mutation refuses the row.
   */
  isDeletable?: boolean;
}

/**
 * Add a test case row. The `order` defaults to "0" — the spreadsheet
 * panel re-numbers after every insert so the new row lands at the
 * end, but a missing field would 400 against the schema's
 * `requiredOn: "Both"` for `order`-less rows. Pass a sparse string
 * from the caller if the UI has computed a different slot.
 */
export function useAddTestCase(): UseMutationResult<
  TestCase,
  Error,
  AddTestCaseInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input) => {
      await testCasesCollection.create({
        featureId: input.featureId,
        flowId: input.flowId,
        title: input.title,
        steps: input.steps ?? "",
        expectedResult: input.expectedResult ?? "",
        actualResult: input.actualResult ?? "",
        status: input.status ?? "untested",
        priority: input.priority ?? "medium",
        assignedTo: input.assignedTo ?? "",
        order: input.order ?? "0",
        tags: input.tags ?? [],
        // Default to `true` so every existing call site (and
        // hand-written integrations) keep their current behavior;
        // only the spreadsheet's auto-create path opts rows out of
        // deletion by passing `isDeletable: false`.
        isDeletable: input.isDeletable ?? true,
      });
      // The Blocks SDK `insertTestCase` response only echoes
      // `{ acknowledged, itemId, message, totalImpactedData }` — not
      // the inserted row. Reconstruct what we know from the input so
      // callers (and `onSuccess`) have the right ids to invalidate
      // against and to push into the cache.
      return toTestCase({
        ItemId: "",
        featureId: input.featureId,
        flowId: input.flowId,
        title: input.title,
        steps: input.steps ?? "",
        expectedResult: input.expectedResult ?? "",
        actualResult: input.actualResult ?? "",
        status: input.status ?? "untested",
        priority: input.priority ?? "medium",
        assignedTo: input.assignedTo ?? "",
        order: input.order ?? "0",
        tags: input.tags ?? [],
        isDeletable: input.isDeletable ?? true,
        CreatedDate: new Date().toISOString(),
        LastUpdatedDate: new Date().toISOString(),
      });
    },
    onSuccess: (_row, input) => {
      // Invalidate the cached list using the input's flowId. The
      // SDK's `insertTestCase` response only echoes the new id (no
      // inserted fields), so `row.flowId` is "" and would hit the
      // wrong query key — the GET would never refetch and the
      // spreadsheet would stay empty even though the row exists.
      qc.invalidateQueries({
        queryKey: queryKeys.testCases(input.flowId),
      });
      // Belt-and-braces: explicitly refetch so the spreadsheet picks
      // up the new row even if the cache has `staleTime` configured
      // or the query is currently disabled for some reason. Cheap
      // (one round-trip) and removes a class of "I clicked but
      // nothing happened" foot-guns.
      qc.refetchQueries({
        queryKey: queryKeys.testCases(input.flowId),
      });
    },
  });
}

export interface UpdateTestCaseInput {
  id: string;
  /**
   * Owning feature id — `requiredOn: "Both"` in the schema, so the
   * Blocks API rejects any PATCH that omits it. Callers always have
   * `row.featureId` available so we forward it on every update even
   * when the cell being edited has nothing to do with the feature id.
   * Kept for traceability — the spreadsheet's primary lookup key is
   * now `flowId` (see below).
   */
  featureId: string;
  /**
   * Owning flow id — required because the schema marks both id
   * fields as `requiredOn: "Both"` and the Blocks API rejects any
   * PATCH that omits a required field. Test cases are now scoped
   * per-flow (the spreadsheet reads by flowId); the featureId is
   * forwarded alongside for traceability.
   */
  flowId: string;
  /**
   * Current `status` — required because the schema marks `status` as
   * `requiredOn: "Both"` and the Blocks API rejects PATCHes that omit a
   * required field, even when the caller only meant to change another
   * column. Callers editing a non-status cell pass `row.status` so the
   * server sees the unchanged value rather than treating the row as
   * status-less.
   */
  status: TestCaseStatus;
  /**
   * Current `title` — `requiredOn: "Both"` like `featureId` and
   * `status`. Callers editing a non-title cell pass `row.title` so a
   * priority / status / steps change can't be rejected for "missing
   * title" — the server treats requiredOn:"Both" fields as required
   * on PATCH too, not just on create.
   */
  title: string;
  steps?: string;
  expectedResult?: string;
  actualResult?: string;
  priority?: "low" | "medium" | "high";
  assignedTo?: string;
  order?: string;
  tags?: string[];
}

/**
 * Update a test case row. Pass the full row snapshot for the three
 * `requiredOn: "Both"` fields (`featureId`, `status`, `title`) — the
 * Blocks API treats every required field as required on PATCH too,
 * so the wire payload must include the unchanged values alongside
 * whatever the caller is actually changing. We forward the required
 * fields explicitly here and only spread the optional ones when
 * defined so a caller never accidentally blanks a column by sending
 * `undefined`.
 */
export function useUpdateTestCase(): UseMutationResult<
  TestCase,
  Error,
  UpdateTestCaseInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input) => {
      const { id, featureId, flowId, status, title, ...patch } = input;
      const updated = (await testCasesCollection.update(id, {
        featureId,
        flowId,
        status,
        title,
        ...(patch.steps !== undefined ? { steps: patch.steps } : {}),
        ...(patch.expectedResult !== undefined
          ? { expectedResult: patch.expectedResult }
          : {}),
        ...(patch.actualResult !== undefined
          ? { actualResult: patch.actualResult }
          : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(patch.assignedTo !== undefined
          ? { assignedTo: patch.assignedTo }
          : {}),
        ...(patch.order !== undefined ? { order: patch.order } : {}),
        ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      } as Partial<CloudTestCase>)) as
        | { data?: CloudTestCase }
        | CloudTestCase;
      const item =
        "data" in updated && updated.data
          ? updated.data
          : (updated as CloudTestCase);
      return toTestCase({ ...(item as CloudTestCase), featureId, flowId });
    },
    onSuccess: (_row, input) => {
      qc.invalidateQueries({
        queryKey: queryKeys.testCases(input.flowId),
      });
      // Same belt-and-braces as useAddTestCase — refetch explicitly so
      // the spreadsheet reflects edits even if the cache has a long
      // staleTime and the invalidation alone wouldn't trigger a refetch.
      qc.refetchQueries({
        queryKey: queryKeys.testCases(input.flowId),
      });
    },
  });
}

/**
 * Delete a test case row. Pass `flowId` so the invalidation can
 * target the right key — the SDK only returns the deleted id.
 * `featureId` is intentionally omitted from the contract since the
 * spreadsheet's only post-mutation concern is flushing the cached
 * list for the owning flow.
 */
export function useDeleteTestCase(): UseMutationResult<
  string,
  Error,
  { id: string; flowId: string }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }) => {
      await testCasesCollection.delete(id);
      return id;
    },
    onSuccess: (_id, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.testCases(vars.flowId) });
    },
  });
}

// --- Member ↔ Project assignment (Members page multi-select) ---------------
//
// One row per user (`userId` is the upsert key). The dropdown in
// `MembersPage` reads via `useMemberProjectAssignments()` and writes via
// `useSetMemberProjectAssignments()` — manager-only writes, every role
// reads. The shape mirrors `Issue.assignedDeveloperIdsJson` (a JSON-
// encoded list of ids stored in a primitive-string field) so the same
// `JSON.parse` / `JSON.stringify` boundary stays the only place list
// serialization lives in this codebase.

// Workspace-wide list. Roster changes are infrequent, so the 5-minute
// `staleTime` matches the rest of the user-adjacent queries and avoids
// re-fetching on every dropdown open.
export function useMemberProjectAssignments(): UseQueryResult<
  MemberProjectAssignment[]
> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  return useQuery<MemberProjectAssignment[]>({
    queryKey: queryKeys.memberProjects,
    enabled: Boolean(userId),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    queryFn: async () => {
      const raw = await memberProjectsCollection.list({
        pageNo: 1,
        pageSize: 200,
      });
      return unwrapPaged<CloudMemberProject>(raw).items.map(
        toMemberProjectAssignment,
      );
    },
  });
}

// Manager-only upsert: find the member's existing row by `userId`,
// `update` if present (full patch — `userId` is `requiredOn: 3` and
// must ride along) or `create` otherwise. An empty `projectIds` saves
// as `"[]"`, distinguishing "manager cleared this member" from
// "no row exists for this member yet" — the same shape a fresh row
// takes on first save.
//
// `useMemberProjectAssignments` is also gated indirectly: the dropdown
// renders for managers only, so non-managers can't ship a mutation from
// the UI. The runtime `isManager` check below is the belt; the UI gate
// is the suspenders — necessary because anyone with browser devtools
// could otherwise call the mutation.
export function useSetMemberProjectAssignments(): UseMutationResult<
  { userId: string; projectIds: string[] },
  Error,
  { userId: string; projectIds: string[] }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const actorId = currentUser?.id ?? "";
  const isManager = currentUser?.roles?.includes("manager") ?? false;
  return useMutation({
    mutationFn: async (input) => {
      if (!isManager) {
        throw new Error("Only managers can assign members to projects.");
      }
      const listRaw = await memberProjectsCollection.list({
        filter: { userId: input.userId },
        pageNo: 1,
        pageSize: 1,
      });
      const existing = unwrapPaged<CloudMemberProject>(listRaw).items[0];
      const projectIdsJson = JSON.stringify(input.projectIds);
      if (existing) {
        await memberProjectsCollection.update(existing.ItemId, {
          userId: input.userId,
          projectIdsJson,
          updatedBy: actorId,
        });
      } else {
        await memberProjectsCollection.create({
          userId: input.userId,
          projectIdsJson,
          updatedBy: actorId,
        });
      }
      return input;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.memberProjects });
    },
  });
}

/**
 * Auto-open the announcements dialog whenever a fresh delivery arrives.
 *
 * Returns `[open, setOpen]` so the caller can wire the Radix Dialog in
 * controlled mode. The hook subscribes to the same `useAnnouncements`
 * query key the rest of the app uses (React Query deduplicates, so
 * this costs nothing extra over the existing dashboard subscription).
 *
 * "Fresh delivery" is broader than just "new id":
 *
 *   1. A brand-new id (a manager just posted an announcement).
 *   2. An existing id whose `postedAt` (`LastUpdatedDate`) has
 *      advanced — i.e. another manager Reposted it.
 *
 * Both cases should pop the modal for every other member, since the
 * spec is "announcements should reach members quickly". A Repost keeps
 * the same row id (we `update` rather than `create` so no duplicate
 * appears), so the old id-only trigger silently missed it — members
 * saw their card's "just now" timestamp flip but the dialog didn't
 * surface. Tracking (id → postedAt) instead of just id fixes that.
 *
 * Baseline capture avoids firing on first load: a member signing in
 * sees existing rows already on screen, not as fresh arrivals. A
 * sign-out/sign-in cycle rebuilds the baseline so the new session
 * doesn't compare against the previous user's history.
 *
 * Announcements authored by the current user are not treated as a
 * trigger for the modal: the poster just hit Post, having the dialog
 * pop right back is noise. The baseline still records the row, so a
 * Repost by the same user on a row they originally authored also
 * doesn't double-fire.
 */
export function useAnnouncementsAutoOpen(): [
  boolean,
  Dispatch<SetStateAction<boolean>>,
] {
  const { currentUser } = useAuth();
  const userId = currentUser?.id;
  const announcementsQuery = useAnnouncements();
  const [open, setOpen] = useState(false);

  // Per-user hide set + the helper to remove an id from it. The
  // auto-open flow un-hides a row when a fresh delivery arrives for
  // an id the user had previously hidden: a Repost is a fresh
  // delivery, the user's old "I'm done with this" intent shouldn't
  // silence the new arrival, and the panel's filter would otherwise
  // exclude the row from the auto-opened dialog. Without this, the
  // dialog pops on the bump but the panel inside shows nothing new.
  const hiddenIds = useHiddenAnnouncementIds();
  const unhideAnnouncement = useUnhideAnnouncement();

  // `seenRef` snapshots the (id → postedAt) pairs already on screen;
  // `lastUserId` lets us rebuild the baseline when the user changes
  // (logout/login mid-session) so the new identity doesn't see the
  // old session's history as fresh arrivals.
  //
  // The Map (not Set) is the whole point of this hook's revision: a
  // Repost keeps the same id but advances `postedAt`, and we need to
  // detect that. Tracking only the id would silently miss every bump.
  const seenRef = useRef<Map<string, string> | null>(null);
  const lastUserIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!userId) return;

    // Wait for the first successful query resolution before locking
    // in a baseline. Auth resolves faster than the data fetch on
    // cold load — if we captured an empty baseline on the auth
    // render, every existing row would look "fresh" the moment data
    // lands, auto-popping the modal on every page refresh.
    if (announcementsQuery.data === undefined) return;
    const announcements = announcementsQuery.data;

    // First successful capture: snapshot every (id → postedAt) currently
    // visible and bail. Pre-existing rows are not considered fresh.
    if (seenRef.current === null) {
      seenRef.current = new Map(
        announcements.map((a) => [a.id, a.postedAt]),
      );
      lastUserIdRef.current = userId;
      return;
    }

    // Identity change: rebuild the baseline so we don't compare the
    // new session against the previous one (sign-out/sign-in cycle,
    // or tab left open while another user signed in elsewhere).
    if (lastUserIdRef.current !== userId) {
      seenRef.current = new Map(
        announcements.map((a) => [a.id, a.postedAt]),
      );
      lastUserIdRef.current = userId;
      return;
    }

    // Same identity, same session: a row counts as a fresh delivery
    // if either (a) we haven't seen its id before, or (b) we have, but
    // its `postedAt` has advanced past what we recorded. Strict
    // inequality protects against identical-timestamp refetches firing
    // the modal twice — TanStack Query re-emits the same array
    // reference when no row has actually moved, and a clock that
    // hasn't ticked at all should never be considered "new".
    //
    // We update `seen` for every fresh row before deciding whether
    // to open, so a single batched refetch (e.g. polling during a
    // manager's Post + Repost back-to-back) is treated as one event,
    // not two — even if both bumps are visible in the same payload.
    //
    // For each fresh delivery authored by someone else, also un-hide
    // the row if it was in the user's hide set — a Repost is a fresh
    // delivery and the panel's filter would otherwise strip it from
    // the auto-opened dialog. We collect ids first and apply the
    // un-hides after the loop so React 18 can batch the resulting
    // state updates (one re-render, not N) when several rows are
    // bumped in the same poll.
    let shouldOpen = false;
    const seen = seenRef.current;
    const toUnhide: string[] = [];
    for (const a of announcements) {
      const prev = seen.get(a.id);
      if (prev === a.postedAt) continue;
      seen.set(a.id, a.postedAt);
      if (a.authorId !== userId) {
        if (!shouldOpen) shouldOpen = true;
        if (hiddenIds.has(a.id)) toUnhide.push(a.id);
      }
    }
    for (const id of toUnhide) unhideAnnouncement(id);
    if (shouldOpen) setOpen(true);
  }, [announcementsQuery.data, userId, hiddenIds, unhideAnnouncement]);

  return [open, setOpen];
}

// --- Mutations --------------------------------------------------------------

export function useCreateProject(): UseMutationResult<
  Project,
  Error,
  { name: string; status?: string; description?: string; color?: string }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  // Tester guard — mirrors `useCreateFeature` / `useAddProjectEnv` /
  // `useRenameProjectEnv`. The Create Project button is hidden in the
  // UI (ProjectsPage header + ProjectEmptyState), this is defense-in-
  // depth so a tester who reaches the hook through any other path gets
  // a clear toast instead of a cloud-side 403.
  const isTester = currentUser?.roles?.includes("tester") ?? false;
  return useMutation({
    // Optimistic insert into the projects list. The mutation below
    // returns the real Project (with server-issued `id` and timestamps);
    // on success we swap the placeholder for the real record so the cache
    // matches what the server has. On error we drop the placeholder so
    // the row disappears cleanly. This avoids the full-list refetch that
    // `qc.invalidateQueries({ queryKey: queryKeys.projects(userId) })`
    // would otherwise trigger — important during multi-feature project
    // creation where one POST is followed by N feature POSTs and any
    // extra round trip on the projects list is pure overhead.
    onMutate: async (input) => {
      const key = queryKeys.projects(userId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Project[]>(key);
      const now = new Date().toISOString();
      const placeholder: Project = {
        id: `optimistic-${crypto.randomUUID()}`,
        name: input.name,
        createdAt: now,
        updatedAt: now,
        description: input.description,
        status: input.status ?? "active",
        color: input.color,
      };
      qc.setQueryData<Project[]>(key, (prev) => [placeholder, ...(prev ?? [])]);
      return { previous, placeholderId: placeholder.id };
    },
    onError: (_err, _input, ctx) => {
      // Roll back the optimistic insert so the UI returns to its
      // pre-submit state. Without this, a failed create would leave a
      // ghost row that no server fetch would ever clean up.
      if (!ctx) return;
      const key = queryKeys.projects(userId);
      qc.setQueryData<Project[]>(key, ctx.previous);
    },
    onSuccess: (project, _input, ctx) => {
      // Replace the placeholder row with the server-returned record so
      // id/createdAt/updatedAt come from the server (the placeholder's
      // synthetic id would otherwise leak into refs and break the new
      // card's `useProjectFeatures(project.id)` subscription).
      if (!ctx) {
        qc.invalidateQueries({ queryKey: queryKeys.projects(userId) });
        qc.invalidateQueries({ queryKey: queryKeys.dashboard(userId) });
        return;
      }
      const key = queryKeys.projects(userId);
      qc.setQueryData<Project[]>(key, (prev) => {
        if (!prev) return [project];
        return prev.map((p) =>
          p.id === ctx.placeholderId ? project : p,
        );
      });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard(userId) });

      // Notify testers. Fire-and-forget — a notifier hiccup never blocks
      // a successful project create (the cache is already settled, the
      // user already navigated). `context` + `actionName` are the
      // subscription filter the tester inbox can group by. We target
      // testers specifically (not managers) because the actor IS the
      // manager — telling them about their own action would just spam
      // the inbox of the very person who triggered it.
      void notifyRole(["tester", "developer"], {
        context: "project",
        actionName: "created",
        value: project.id,
        projectId: project.id,
        projectName: project.name,
        actorName: currentUser?.name ?? "A manager",
        actorId: userId,
      }).catch(() => {
        /* notifier failures are non-fatal — see hook doc */
      });
      // Refresh the actor's own inbox too — a manager who also holds a
      // recipient role (tester/developer) should see the row land without
      // waiting for the 5s poll.
      void qc.invalidateQueries({
        queryKey: queryKeys.notifications(userId),
      });
    },
    mutationFn: async (input) => {
      // Defense-in-depth: even though the UI hides the Create Project
      // CTA for testers (ProjectsPage header + ProjectEmptyState), a
      // tester can still reach this hook programmatically — through a
      // stale modal, a stale form, a bookmark, or a third-party caller.
      // Throw here so the same clear toast the user sees on feature /
      // env actions surfaces here too, instead of a generic
      // 403 from the cloud.
      if (isTester) {
        throw new Error(
          "Testers cannot create projects. Ask a manager for access.",
        );
      }
      const created = await projectsCollection.create({
        name: input.name,
        status: input.status ?? "active",
        description: input.description ?? "",
        color: input.color ?? "",
      });
      // The cloud's `insert<Schema>` envelope is
      // `{ data: { insertProject: { acknowledged, itemId, ... } } }` —
      // distinct from the read-shape `ItemId` at the top of get/list
      // responses. Earlier this cast unwrapped `created.data` as
      // `{ ItemId, CreatedDate, ... }` and fed it to `toProject`, which
      // produced a Project with `id: undefined`. Downstream callers
      // (`useCreateFeature` in CreateProjectModal, the optimistic
      // placeholder swap in `onSuccess`) then forwarded `undefined` as
      // `projectId`, and the cloud rejected the next insert with
      // VALIDATION_ERROR "Field 'projectId' is required for insert".
      // Extract the real id and synthesize the read-shape fields so
      // `toProject` produces a complete Project record.
      const itemId = extractInsertedItemId(created, "insertProject");
      if (!itemId) {
        throw new Error(
          "Could not create project — no itemId in response.",
        );
      }
      const now = new Date().toISOString();
      const item = {
        ItemId: itemId,
        name: input.name,
        status: input.status ?? "active",
        description: input.description,
        color: input.color,
        CreatedDate: now,
        LastUpdatedDate: now,
      };
      return toProject(item);
    },
  });
}

export function useCreateFeature(): UseMutationResult<
  Feature,
  Error,
  {
    projectId: string;
    name: string;
    envSlug?: string;
    // OIDC `sub`s of the assigned developers. A feature can be
    // co-developed by any number of users — empty array (or omitted)
    // means unassigned. Forwarded verbatim to the cloud; the multi-
    // select modal sends `undefined` when nothing is picked. Schema
    // marks the field `requiredOn: 0` so absence is safe.
    developerIds?: string[];
    // OIDC `sub`s of the assigned QAs. Same array semantics as
    // `developerIds`. Populated from the "Assign QAs" multi-select,
    // which sources from users with the `tester` IAM role.
    qaIds?: string[];
    // Optional GitHub URL — issue, PR, or repo path. The Add
    // Feature modal normalizes missing schemes (`github.com/...`
    // → `https://github.com/...`) before forwarding. `undefined`
    // means the user left the field blank; the mutation handler
    // below strips it from the wire payload so the cloud record
    // doesn't store an empty string.
    githubLink?: string;
  }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  // `tester` role is read-only on the feature surface: testers can browse
  // features and flows but must not be able to author them. The UI also
  // hides the entry points (see ProjectDetailPage + FeatureEmptyState),
  // but we guard here too — a UI hide is a UX nicety, this is the actual
  // enforcement. The captured value is the latest one because `mutationFn`
  // closes over the hook body each render and React Query picks up the
  // freshest closure when the mutation actually fires.
  const isTester = currentUser?.roles?.includes("tester") ?? false;
  return useMutation({
    mutationFn: async (input) => {
      if (isTester) {
        throw new Error(
          "Testers cannot create features. Ask a manager for access.",
        );
      }
      // Build the assignment arrays. Empty arrays are sent through
      // verbatim so the cloud stores an explicit "no one assigned"
      // signal (the schema marks the field `requiredOn: 0` so
      // absence and empty are both safe, but having them on the row
      // makes the FeatureDetailsDrawer render "—" without a
      // separate check).
      const assignments: Record<string, string[]> = {};
      if (input.developerIds !== undefined) {
        assignments.developerIds = input.developerIds;
      }
      if (input.qaIds !== undefined) {
        assignments.qaIds = input.qaIds;
      }
      const created = await featuresCollection.create({
        title: input.name,
        projectId: input.projectId,
        status: "backlog",
        // envSlug is optional — on the env-less project page it's omitted
        // and the record is created without one (legacy-compatible shape).
        ...(input.envSlug ? { envSlug: input.envSlug } : {}),
        ...assignments,
        // githubLink: only forwarded when the user actually typed
        // something. The modal normalizes missing schemes; this
        // hook just gates inclusion on `input.githubLink` being a
        // non-empty string so a stale empty-state on an existing
        // feature never accidentally clears a link.
        ...(input.githubLink && input.githubLink.trim() !== ""
          ? { githubLink: input.githubLink.trim() }
          : {}),
      });
      // Same wire-shape fix as `useCreateProject` — see that hook's
      // comment for why the old `created.data ?? ...` cast was wrong.
      const itemId = extractInsertedItemId(created, "insertFeature");
      if (!itemId) {
        throw new Error(
          "Could not create feature — no itemId in response.",
        );
      }
      const now = new Date().toISOString();
      const item = {
        ItemId: itemId,
        title: input.name,
        projectId: input.projectId,
        status: "backlog",
        envSlug: input.envSlug,
        // Echo the assignment arrays onto the read-shape record so
        // the optimistic placeholder + subsequent renders carry the
        // same developer/QA list the cloud has.
        developerIds: input.developerIds,
        qaIds: input.qaIds,
        // Same echo for githubLink — `toFeature` normalizes empty
        // strings to `undefined`, so `input.githubLink` undefined
        // here is fine; the drawer just won't render the row.
        githubLink: input.githubLink && input.githubLink.trim() !== ""
          ? input.githubLink.trim()
          : undefined,
        CreatedDate: now,
        LastUpdatedDate: now,
      };
      return toFeature(item, input.projectId);
    },
    onSuccess: (feature, vars) => {
      // Invalidate every cached view of this project's features — the
      // env-scoped and env-less pages both need to refresh, and they
      // live at distinct query keys. `queryKeys.features.default`
      // (no envSlug) is the unfiltered "_all" branch.
      qc.invalidateQueries({ queryKey: ["features", userId, vars.projectId] });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard(userId) });

      // Notify the SPECIFIC users assigned to this feature — every
      // entry in `developerIds` and every entry in `qaIds`. Targeted,
      // not a role broadcast: a tester who wasn't picked for this
      // feature does NOT receive a row in their inbox (the role-
      // targeted `notifyRole("tester")` shape from the old path
      // would have reached every user holding the tester role).
      // `feature.id` (the server-issued id) is what the inbox uses as
      // the subscription-filter `value` so future reads can pivot on
      // it. Same fire-and-forget discipline as `useCreateProject` — a
      // notifier hiccup never blocks the create.
      const projects = qc.getQueryData<Project[]>(
        queryKeys.projects(userId),
      );
      const project = projects?.find((p) => p.id === vars.projectId);
      void notifyAssignedFeature({
        featureId: feature.id,
        featureName: vars.name,
        projectId: vars.projectId,
        projectName: project?.name,
        envSlug: vars.envSlug,
        developerIds: vars.developerIds ?? [],
        qaIds: vars.qaIds ?? [],
        actorName: currentUser?.name ?? "A manager",
        actorId: userId,
      }).catch(() => {
        /* notifier failures are non-fatal */
      });
      // Refresh the actor's own inbox too — same rationale as
      // `useCreateProject`: a manager who is also a recipient (e.g.
      // holds a developer role) should see the row land in their bell
      // without waiting for the next 5s poll.
      void qc.invalidateQueries({
        queryKey: queryKeys.notifications(userId),
      });
    },
  });
}

export function useCreateFlow(): UseMutationResult<
  Flow,
  Error,
  {
    projectId: string;
    featureId: string;
    name: string;
    envSlug?: string;
    description?: string;
    steps?: string[];
  }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async (input) => {
      const created = await flowsCollection.create({
        title: input.name,
        featureId: input.featureId,
        status: "draft",
        // envSlug inherits from the parent feature on creation; same
        // optional-key rule as useCreateFeature.
        ...(input.envSlug ? { envSlug: input.envSlug } : {}),
        // Optional content fields — only forward them when defined so a
        // legacy call site keeps producing records without these fields
        // (matches the schema's `requiredOn: 0` rule).
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.steps ? { steps: input.steps } : {}),
      });
      // Same wire-shape fix as `useCreateProject` / `useCreateFeature` —
      // see those hooks for the full explanation.
      const itemId = extractInsertedItemId(created, "insertFlow");
      if (!itemId) {
        throw new Error("Could not create flow — no itemId in response.");
      }
      const now = new Date().toISOString();
      const item = {
        ItemId: itemId,
        title: input.name,
        featureId: input.featureId,
        projectId: input.projectId,
        envSlug: input.envSlug,
        status: "draft",
        description: input.description,
        steps: input.steps,
        CreatedDate: now,
        LastUpdatedDate: now,
      };
      return toFlow(item, input.projectId);
    },
    onSuccess: (flow, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.flows(userId, vars.featureId) });
      // Mirror useCreateFeature: invalidate every project-scoped
      // feature/flow cache so the `/projects` page card counts (which
      // key off `useProjectFeatures` / `useProjectFlows`) refresh in
      // place — not just on next mount. The queryKey prefix
      // `["features", userId, projectId]` matches both feature lists
      // (`..., "dev"`, `..., "_all"`) and flow lists
      // (`..., "dev", "flows"`, `..., "_all", "flows"`).
      qc.invalidateQueries({ queryKey: ["features", userId, vars.projectId] });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard(userId) });

      const projects = qc.getQueryData<Project[]>(
        queryKeys.projects(userId),
      );
      const project = projects?.find((p) => p.id === vars.projectId);
      // Broadcast to manager + developer roles (NOT tester) — the
      // user request dated 2026-09-27 was explicit: when a tester
      // creates a flow, manager + developers get notified, tester
      // does NOT. The actor-exclusion filter inside `notifyRole`
      // drops the actor's own uid regardless of which role they hold,
      // so:
      //   - tester creates → manager (1) + developers (3) receive,
      //     tester is dropped (was the bug — previously they self-
      //     notified because the only tester uid was the actor).
      //   - manager creates → 3 developers receive, manager dropped.
      //   - developer creates → manager (1) + 2 other developers
      //     receive, the creating developer dropped.
      // We exclude tester entirely from the broadcast because the
      // only tester is the actor in the bug scenario; including
      // "tester" would re-introduce the self-notify after the dedupe
      // (the actor-exclusion filter would still drop them, but
      // listing the role here would be misleading — testers don't
      // need to be notified about other testers' flow creation).
      void notifyRole(["manager", "developer"], {
        context: "flow",
        actionName: "created",
        value: flow.id,
        projectId: vars.projectId,
        projectName: project?.name,
        flowName: flow.name,
        actorName: currentUser?.name ?? "A teammate",
        actorId: userId,
      }).catch(() => {});
      void qc.invalidateQueries({
        queryKey: queryKeys.notifications(userId),
      });
    },
  });
}

export function useDeleteProject(): UseMutationResult<void, Error, string> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  // Tester guard — mirrors the pattern in `useCreateFeature` /
  // `useAddProjectEnv` / `useRenameProjectEnv` / `useCreateProject`.
  // The Delete item is hidden on the ProjectCard kebab menu for
  // testers, this throws the same error for any other path.
  const isTester = currentUser?.roles?.includes("tester") ?? false;
  return useMutation({
    mutationFn: async (projectId) => {
      if (isTester) {
        throw new Error(
          "Testers cannot delete projects. Ask a manager for access.",
        );
      }
      await projectsCollection.delete(projectId);
    },
    onSuccess: (_void, projectId) => {
      qc.invalidateQueries({ queryKey: queryKeys.projects(userId) });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard(userId) });

      // Capture the name before cache invalidation drops the row. The
      // list is the source of truth — a single project may be in many
      // query caches but the list always has it.
      const projects = qc.getQueryData<Project[]>(
        queryKeys.projects(userId),
      );
      const project = projects?.find((p) => p.id === projectId);
      // Broadcast to tester + developer (the actor-exclusion filter
      // drops the actor's own uid regardless of role — see
      // `notifier.ts:154-157`). User request 2026-09-27: project
      // delete must reach developers, not just testers, since
      // developers' active branches/casacde-cloned features live
      // under the project and they need to know the workspace is
      // gone. Actor exclusion handles the "manager deletes → manager
      // not notified" case even though manager isn't currently in
      // the recipient set for project mutations.
      void notifyRole(["tester", "developer"], {
        context: "project",
        actionName: "deleted",
        value: projectId,
        projectId,
        projectName: project?.name,
        actorName: currentUser?.name ?? "A manager",
        actorId: userId,
      }).catch(() => {});
      void qc.invalidateQueries({
        queryKey: queryKeys.notifications(userId),
      });
    },
  });
}

// --- Feature / Flow row mutations ------------------------------------------
//
// Each FeatureItem and FlowItem has a kebab menu that lets the user rename
// or delete the row in place. The mutation hooks below back those actions.
// All four invalidate the same `["features", userId, projectId]` prefix that
// `useCreateFeature` / `useCreateFlow` already use, so env-scoped pages,
// the env-less page, the project-card counts, and the workspace totals all
// refresh in place after a rename or delete.

export function useUpdateFeature(): UseMutationResult<
  Feature,
  Error,
  { id: string; projectId: string; patch: Partial<Pick<Feature, "name">> }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  // Tester guard — mirrors `useCreateFeature` / `useDeleteFeature`
  // / `useAddProjectEnv` / `useRenameProjectEnv` / `useCreateProject`
  // / `useDeleteProject` / `useUpdateProject`. The Rename item is hidden
  // on the FeatureItem kebab for testers, this throws the same error
  // if reached programmatically.
  const isTester = currentUser?.roles?.includes("tester") ?? false;
  return useMutation({
    mutationFn: async ({ id, projectId, patch }) => {
      if (isTester) {
        throw new Error(
          "Testers cannot rename features. Ask a manager for access.",
        );
      }
      // Cloud field name for the feature title is `title`; map UI `name`
      // → cloud `title` here so callers don't have to remember.
      //
      // The Feature schema marks `title`, `status`, and `projectId` as
      // `requiredOn: 3` — required on every update. Echoing `status`
      // and `projectId` along with the new title is what stops the cloud
      // from rejecting the partial PATCH as "missing required field".
      // `status` is hard-coded to "backlog" because the UI doesn't yet
      // surface Feature status — `useCreateFeature` stamps the same
      // value on insert (see hooks.ts:701), so every existing record is
      // "backlog".
      const cloudPatch: Record<string, unknown> = {
        projectId,
        status: "backlog",
      };
      if (patch.name !== undefined) cloudPatch.title = patch.name;

      // Cascade rename to sibling features in other envs (dev source only).
      // Only fires when the patch contains `name`; status edits don't fan
      // out. Sibling features are records where `clonedFromFeatureId`
      // points back at the source — pre-existing clones without the link
      // are invisible to the filter and stay frozen. Cascade errors are
      // swallowed so a partial-fan-out still leaves the local edit applied;
      // the user's other envs would be re-syncable by deleting and re-cloning.
      if (patch.name !== undefined) {
        const sourceRaw = await featuresCollection.get(id);
        const sourceItem = unwrapPaged<{ envSlug?: string }>(sourceRaw)
          .items[0];
        if (sourceItem && isDevSource(sourceItem.envSlug)) {
          const siblings = await findSiblingFeatures(id, projectId, userId);
          for (const s of siblings) {
            try {
              await featuresCollection.update(s.id, cloudPatch);
            } catch {
              // Swallow sibling cascade failures — the local edit already
              // succeeded and the rest of the cascade should keep going.
            }
          }
        }
      }

      const updated = (await featuresCollection.update(id, cloudPatch)) as {
        data?: CloudFeature;
      } | CloudFeature;
      const raw =
        "data" in updated && updated.data
          ? updated.data
          : (updated as CloudFeature);
      return toFeature(raw as Parameters<typeof toFeature>[0], "");
    },
    onSuccess: (feature, vars) => {
      qc.invalidateQueries({ queryKey: ["features", userId, vars.projectId] });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard(userId) });

      // Notify testers on rename. `feature.name` is the post-rename
      // value the server echoed back — `vars.patch.name` is what the
      // caller submitted. They're equal on success; we keep both so the
      // inbox can show "X renamed F to G" without re-querying.
      if (vars.patch.name !== undefined) {
        void notifyRole(["tester", "developer"], {
          context: "feature",
          actionName: "renamed",
          value: vars.id,
          projectId: vars.projectId,
          featureName: feature.name,
          oldName: vars.patch.name,
          newName: feature.name,
          actorName: currentUser?.name ?? "A manager",
          actorId: userId,
        }).catch(() => {});
        void qc.invalidateQueries({
          queryKey: queryKeys.notifications(userId),
        });
      }
    },
  });
}

export function useDeleteFeature(): UseMutationResult<
  void,
  Error,
  { id: string; projectId: string }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  // Tester guard — mirrors `useUpdateFeature` and the other role-gated
  // mutation hooks. The Delete item is hidden on the FeatureItem kebab
  // for testers, this throws the same error if reached any other way.
  const isTester = currentUser?.roles?.includes("tester") ?? false;
  return useMutation({
    mutationFn: async ({ id, projectId }) => {
      if (isTester) {
        throw new Error(
          "Testers cannot delete features. Ask a manager for access.",
        );
      }
      // Cascade delete: every sibling feature (one whose
      // `clonedFromFeatureId` points at the source) goes too. Only fires
      // for dev sources. Orphan flows under the deleted sibling features
      // become invisible because `useProjectFlows` filters client-side
      // against the current feature set, so no extra flow cleanup is
      // needed.
      const sourceRaw = await featuresCollection.get(id);
      const sourceItem = unwrapPaged<{ envSlug?: string }>(sourceRaw).items[0];
      if (sourceItem && isDevSource(sourceItem.envSlug)) {
        const siblings = await findSiblingFeatures(id, projectId, userId);
        for (const s of siblings) {
          try {
            await featuresCollection.delete(s.id);
          } catch {
            // Swallow sibling cascade failures so the local delete still
            // runs — see `useUpdateFeature` cascade for the same pattern.
          }
        }
      }
      await featuresCollection.delete(id);
    },
    onSuccess: (_void, vars) => {
      // The single-feature cache for this project's flow list lives under
      // the same `["features", userId, projectId, ...]` prefix as the
      // feature list itself, so this one invalidation also refreshes
      // every `useProjectFlows` derivation that aggregates flows under
      // the now-removed feature.
      qc.invalidateQueries({ queryKey: ["features", userId, vars.projectId] });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard(userId) });

      // Capture the feature name from the features cache before it's
      // invalidated away. We need the project name too for the body.
      const features = qc.getQueryData<Feature[]>([
        "features",
        userId,
        vars.projectId,
      ]);
      const projects = qc.getQueryData<Project[]>(
        queryKeys.projects(userId),
      );
      const project = projects?.find((p) => p.id === vars.projectId);
      const feature = features?.find((f) => f.id === vars.id);
      void notifyRole(["tester", "developer"], {
        context: "feature",
        actionName: "deleted",
        value: vars.id,
        projectId: vars.projectId,
        projectName: project?.name,
        featureName: feature?.name,
        actorName: currentUser?.name ?? "A manager",
        actorId: userId,
      }).catch(() => {});
      void qc.invalidateQueries({
        queryKey: queryKeys.notifications(userId),
      });
    },
  });
}

export function useUpdateFlow(): UseMutationResult<
  Flow,
  Error,
  {
    id: string;
    projectId: string;
    featureId: string;
    status: FlowStatus;
    patch: Partial<Pick<Flow, "name">>;
  }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  // The sibling-feature Set is captured in hook scope (rather than
  // threaded through the mutation's return type) so we keep the public
  // Flow result unchanged — callers like RenameFlowModal rely on
  // `updated.name` being a Flow. Concurrent renames on different rows
  // are theoretically possible but the kebab UI only fires one at a
  // time per row, so the cross-pollution risk is zero in practice.
  // If two-flow concurrent renames become a real scenario, switch to
  // returning `{ flow, siblingFeatureIds }` from mutationFn.
  const siblingFeatureIds = new Set<string>();
  return useMutation({
    mutationFn: async ({ id, projectId, featureId, status, patch }) => {
      // Same `requiredOn: 3` reasoning as `useUpdateFlowStatus`:
      // `title`, `featureId`, and `status` are required on every Flow
      // update. Echoing the unchanged fields is what keeps the cloud
      // from rejecting the partial PATCH as "missing required field".
      const cloudPatch: Record<string, unknown> = {
        featureId,
        status,
      };
      if (patch.name !== undefined) cloudPatch.title = patch.name;

      // Cascade rename to sibling flows in other envs (dev source only).
      // Sibling flows are records where `clonedFromFlowId` points back at
      // the source — pre-existing clones without the link stay frozen.
      // The sibling flow's parent feature keeps its own name; this
      // cascade is flow-level only. The matching feature rename (if any)
      // happens through `useUpdateFeature`'s cascade.
      //
      // Per-sibling payload: the Flow schema marks `featureId` and
      // `status` as `requiredOn: 3` so every update must include them —
      // but the values must come from the SIBLING (its own parent feature
      // and its own chip state), not the source. Echoing the source's
      // `featureId` would either move the sibling under the dev feature
      // (the gateway would accept the update) or be rejected if the
      // dev feature is in a different tenant — both outcomes silently
      // break the sibling in stg.
      //
      // Sibling feature ids land in the hook-scope Set so `onSuccess`
      // can invalidate the per-feature flow caches for those siblings
      // — otherwise the user navigates to /projects/:id/uat, opens the
      // sibling feature, and sees the old (stale) flow name until they
      // force a refetch. The siblings live under `["flows", userId,
      // siblingFeatureId]`, distinct from the source's feature cache.
      if (patch.name !== undefined) {
        const sourceRaw = await flowsCollection.get(id);
        const sourceItem = unwrapPaged<{ envSlug?: string }>(sourceRaw)
          .items[0];
        if (sourceItem && isDevSource(sourceItem.envSlug)) {
          const siblings = await findSiblingFlows(id, projectId, userId);
          for (const s of siblings) {
            siblingFeatureIds.add(s.featureId);
            try {
              await flowsCollection.update(s.id, {
                title: patch.name,
                featureId: s.featureId,
                status: s.status,
                envSlug: s.envSlug,
                clonedFromFlowId: s.clonedFromFlowId,
              });
            } catch {
              // Sibling cascade failure — see `useUpdateFeature` for the
              // rationale on swallowing here. The user gets a renamed
              // toast for the source; a sibling-env failure should be
              // surfaced more visibly than a silent no-op.
            }
          }
        }
      }

      const updated = (await flowsCollection.update(id, cloudPatch)) as {
        data?: CloudFlow;
      } | CloudFlow;
      const raw =
        "data" in updated && updated.data
          ? updated.data
          : (updated as CloudFlow);
      return toFlow(raw as Parameters<typeof toFlow>[0], "");
    },
    onSuccess: (flow, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.flows(userId, vars.featureId) });
      // Invalidate every sibling feature's flow cache too. The source
      // rename only refreshed `vars.featureId`; sibling feature caches
      // (e.g. the matching uat feature) would otherwise keep showing
      // the old flow name until manual refetch. The sibling features
      // sit under `["flows", userId, siblingFeatureId]`, distinct from
      // the source's key, so a per-feature invalidation catches them
      // all.
      for (const fid of siblingFeatureIds) {
        qc.invalidateQueries({ queryKey: queryKeys.flows(userId, fid) });
      }
      // Reset for the next rename — keeps the Set from growing across
      // calls.
      siblingFeatureIds.clear();
      qc.invalidateQueries({ queryKey: ["features", userId, vars.projectId] });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard(userId) });

      if (vars.patch.name !== undefined) {
        const projects = qc.getQueryData<Project[]>(
          queryKeys.projects(userId),
        );
        const project = projects?.find((p) => p.id === vars.projectId);
        void notifyRole(["tester", "developer"], {
          context: "flow",
          actionName: "renamed",
          value: vars.id,
          projectId: vars.projectId,
          projectName: project?.name,
          flowName: flow.name,
          oldName: vars.patch.name,
          newName: flow.name,
          actorName: currentUser?.name ?? "A manager",
          actorId: userId,
        }).catch(() => {});
        void qc.invalidateQueries({
          queryKey: queryKeys.notifications(userId),
        });
      }
    },
  });
}

export function useDeleteFlow(): UseMutationResult<
  void,
  Error,
  { id: string; projectId: string; featureId: string }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  // Sibling-feature Set captured in hook scope — see useUpdateFlow for
  // the same pattern and the concurrent-rename caveat (single-row kebab
  // UI means concurrent calls are not a real risk).
  const siblingFeatureIds = new Set<string>();
  return useMutation({
    mutationFn: async ({ id, projectId }) => {
      // Cascade delete: every sibling flow (one whose `clonedFromFlowId`
      // points at the source) goes too. Only fires for dev sources. The
      // parent feature of each deleted sibling is NOT touched — other
      // flows under the same feature may have been edited locally and
      // shouldn't be cleaned up just because one of them was a clone.
      //
      // We collect sibling feature ids so `onSuccess` can invalidate
      // every sibling feature's flow cache — see `useUpdateFlow` for
      // the full rationale (the sibling features live at distinct
      // query keys from the source's feature, so without this the
      // user sees stale flow lists in non-dev envs until a refetch).
      const sourceRaw = await flowsCollection.get(id);
      const sourceItem = unwrapPaged<{ envSlug?: string }>(sourceRaw).items[0];
      if (sourceItem && isDevSource(sourceItem.envSlug)) {
        const siblings = await findSiblingFlows(id, projectId, userId);
        for (const s of siblings) {
          siblingFeatureIds.add(s.featureId);
          try {
            await flowsCollection.delete(s.id);
          } catch {
            // Swallow sibling cascade failures so the local delete still
            // runs — see `useUpdateFeature` cascade for the same pattern.
          }
        }
      }
      await flowsCollection.delete(id);
    },
    onSuccess: (_result, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.flows(userId, vars.featureId) });
      for (const fid of siblingFeatureIds) {
        qc.invalidateQueries({ queryKey: queryKeys.flows(userId, fid) });
      }
      // Reset for the next delete — keeps the Set from growing across
      // calls.
      siblingFeatureIds.clear();
      qc.invalidateQueries({ queryKey: ["features", userId, vars.projectId] });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard(userId) });

      // Capture flow + project names from caches before invalidation
      // wipes the row. The flow name is the row the user just deleted;
      // without this we'd notify with a blank body.
      const flows = qc.getQueryData<Flow[]>(
        queryKeys.flows(userId, vars.featureId),
      );
      const projects = qc.getQueryData<Project[]>(
        queryKeys.projects(userId),
      );
      const flow = flows?.find((f) => f.id === vars.id);
      const project = projects?.find((p) => p.id === vars.projectId);
      void notifyRole(["tester", "developer"], {
        context: "flow",
        actionName: "deleted",
        value: vars.id,
        projectId: vars.projectId,
        projectName: project?.name,
        flowName: flow?.name,
        actorName: currentUser?.name ?? "A manager",
        actorId: userId,
      }).catch(() => {});
      void qc.invalidateQueries({
        queryKey: queryKeys.notifications(userId),
      });
    },
  });
}

/**
 * Set the test-result status on a single flow. Triggered by the
 * per-row Status chip; only valid test statuses are accepted.
 * Same invalidation footprint as useUpdateFlow so any view that
 * shows the flow picks up the new status without a manual refetch.
 *
 * Why we also send `name` and `featureId` (even though the chip is
 * only changing `status`): the Flow schema marks `title`, `status`,
 * and `featureId` as `requiredOn: 3` (required on every insert AND
 * every update). A partial PATCH like `{ status }` is rejected by the
 * gateway with a "Required fields are missing or empty" error, which
 * is why changing status used to be a no-op. We have `name` (UI's
 * `title`) and `featureId` on the flow object already, so we just
 * forward them with every update — the cloud will echo the same
 * values back unchanged.
 */
export function useUpdateFlowStatus(): UseMutationResult<
  Flow,
  Error,
  {
    id: string;
    projectId: string;
    featureId: string;
    name: string;
    status: FlowTestStatus;
  }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async ({ id, name, featureId, status }) => {
      const updated = (await flowsCollection.update(id, {
        // Echo unchanged required fields so the cloud accepts the
        // partial PATCH (see hook doc).
        title: name,
        featureId,
        status,
      })) as { data?: CloudFlow } | CloudFlow;
      const raw =
        "data" in updated && updated.data
          ? updated.data
          : (updated as CloudFlow);
      return toFlow(raw as Parameters<typeof toFlow>[0], "");
    },
    onSuccess: (_flow, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.flows(userId, vars.featureId) });
      qc.invalidateQueries({ queryKey: ["features", userId, vars.projectId] });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard(userId) });

      // Notify testers on status chip change (Option C). The chip is
      // the user's "what state is this test in?" surface, so a flip is
      // exactly the kind of state change testers want to learn about.
      // `vars.status` is the new value the cloud echoed back; `vars.name`
      // is the flow title. Project name comes from the projects cache
      // — we read it before invalidation runs in the next mutation.
      const projects = qc.getQueryData<Project[]>(
        queryKeys.projects(userId),
      );
      const project = projects?.find((p) => p.id === vars.projectId);
      void notifyRole(["tester", "developer"], {
        context: "flow",
        actionName: "status_changed",
        value: vars.id,
        projectId: vars.projectId,
        projectName: project?.name,
        flowName: vars.name,
        status: vars.status,
        actorName: currentUser?.name ?? "A manager",
        actorId: userId,
      }).catch(() => {});
      void qc.invalidateQueries({
        queryKey: queryKeys.notifications(userId),
      });
    },
  });
}

/**
 * Set the stack classification on a single flow (Frontend / Backend /
 * Investigating). Triggered by the per-row Stack chip; mirrors
 * `useUpdateFlowStatus` exactly — same payload, same invalidation set —
 * but writes the `stack` field instead of `status`.
 *
 * Same `requiredOn: 3` reasoning as `useUpdateFlowStatus`: `title`,
 * `featureId`, and `status` are all required on every update. Stack
 * is being changed here, so the other three are echoed through.
 */
export function useUpdateFlowStack(): UseMutationResult<
  Flow,
  Error,
  {
    id: string;
    projectId: string;
    featureId: string;
    name: string;
    status: FlowStatus;
    stack: FlowStack;
  }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async ({ id, name, featureId, status, stack }) => {
      const updated = (await flowsCollection.update(id, {
        title: name,
        featureId,
        status,
        stack,
      })) as { data?: CloudFlow } | CloudFlow;
      const raw =
        "data" in updated && updated.data
          ? updated.data
          : (updated as CloudFlow);
      return toFlow(raw as Parameters<typeof toFlow>[0], "");
    },
    onSuccess: (_flow, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.flows(userId, vars.featureId) });
      qc.invalidateQueries({ queryKey: ["features", userId, vars.projectId] });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard(userId) });

      // Notify testers on stack chip change (Option C). Same shape as
      // the status notification above; the `stack` field replaces
      // `status` in the payload and the body builder picks it up
      // because we discriminate on `actionName`.
      const projects = qc.getQueryData<Project[]>(
        queryKeys.projects(userId),
      );
      const project = projects?.find((p) => p.id === vars.projectId);
      void notifyRole(["tester", "developer"], {
        context: "flow",
        actionName: "stack_changed",
        value: vars.id,
        projectId: vars.projectId,
        projectName: project?.name,
        flowName: vars.name,
        stack: vars.stack,
        actorName: currentUser?.name ?? "A manager",
        actorId: userId,
      }).catch(() => {});
      void qc.invalidateQueries({
        queryKey: queryKeys.notifications(userId),
      });
    },
  });
}

// Partial update — callers pass only the fields they're changing. Invalidates
// the list AND the single-project cache so the working page and info page
// both pick up the change without a manual refetch.
//
// `envLabelOverrides` rides along here so `useRenameProjectEnv` can write
// canonical-env label changes through the same hook. Encoded as JSON
// string on the wire, identical to `customEnvs`.
export function useUpdateProject(): UseMutationResult<
  Project,
  Error,
  {
    id: string;
    patch: Partial<
      Pick<
        Project,
        | "name"
        | "description"
        | "status"
        | "color"
        | "customEnvs"
        | "envLabelOverrides"
      >
    >;
  }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  // Tester guard — mirrors `useCreateProject` and `useDeleteProject`.
  // The Rename item is hidden on the ProjectCard kebab menu for testers,
  // this throws the same error for any other path (stale modal,
  // programmatic call, etc.).
  const isTester = currentUser?.roles?.includes("tester") ?? false;
  return useMutation({
    mutationFn: async ({ id, patch }) => {
      if (isTester) {
        throw new Error(
          "Testers cannot rename projects. Ask a manager for access.",
        );
      }
      // The cloud schema's `customEnvs` + `envLabelOverrides` are Strings
      // holding JSON. Translate the parsed UI shapes on the way out so the
      // rest of the file doesn't have to remember the encoding.
      const cloudPatch: Record<string, unknown> = { ...patch };
      if (patch.customEnvs) {
        cloudPatch.customEnvs = JSON.stringify(patch.customEnvs);
      }
      if (patch.envLabelOverrides) {
        cloudPatch.envLabelOverrides = JSON.stringify(
          patch.envLabelOverrides,
        );
      }
      const updated = (await projectsCollection.update(id, cloudPatch)) as {
        data?: CloudProject;
      } | CloudProject;
      const raw = "data" in updated && updated.data ? updated.data : (updated as CloudProject);
      return toProject(raw as Parameters<typeof toProject>[0]);
    },
    onSuccess: (project, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.projects(userId) });
      qc.invalidateQueries({ queryKey: queryKeys.project(userId, project.id) });

      // Fan-out notifications by what the patch actually changed.
      // `useUpdateProject` carries multiple shapes (rename, env add,
      // env rename) on the same hook, so we discriminate on which
      // fields were present in the patch — testers should learn about
      // every state change, not just renames.
      const actorName = currentUser?.name ?? "A manager";
      if (vars.patch.name !== undefined) {
        // Pull the prior name out of the cache so the rename payload
        // actually carries `oldName !== newName`. Without this we were
        // emitting `oldName: vars.patch.name` which is *the new name*
        // — a no-op rename showed up in the inbox as a rename with
        // identical from/to, and a real rename carried only the new
        // name once the server's required-field strip kicked in.
        const cached = qc.getQueryData<Project>(
          queryKeys.project(userId, project.id),
        );
        const oldName =
          typeof cached?.name === "string" ? cached.name : vars.patch.name;
        void notifyRole(["tester", "developer"], {
          context: "project",
          actionName: "renamed",
          value: project.id,
          projectId: project.id,
          projectName: project.name,
          oldName,
          newName: project.name,
          actorName,
          actorId: userId,
        }).catch(() => {});
        void qc.invalidateQueries({
          queryKey: queryKeys.notifications(userId),
        });
      }
      if (vars.patch.envLabelOverrides !== undefined) {
        // Env rename — `envLabelOverrides` is `{ [slug]: label }`. We
        // don't get old/new labels in the patch (only the new map), so
        // we emit one notification per changed slug against the
        // post-state keys. Testers see "X renamed env A to B".
        const newLabels = vars.patch.envLabelOverrides;
        for (const slug of Object.keys(newLabels)) {
          void notifyRole(["tester", "developer"], {
            context: "environment",
            actionName: "renamed",
            value: `${project.id}:${slug}`,
            projectId: project.id,
            projectName: project.name,
            envSlug: slug,
            actorName,
            actorId: userId,
          }).catch(() => {});
          void qc.invalidateQueries({
            queryKey: queryKeys.notifications(userId),
          });
        }
      }
      if (vars.patch.customEnvs !== undefined) {
        // Env add — `customEnvs` is the new full list. Anything that
        // wasn't in the pre-state is "added". Since the hook doesn't
        // capture pre-state, we fire one event per slug in the new
        // list. The inbox groups by `value` so duplicates from
        // re-submits don't pile up.
        const newEnvs = vars.patch.customEnvs;
        for (const slug of newEnvs) {
          void notifyRole(["tester", "developer"], {
            context: "environment",
            actionName: "created",
            value: `${project.id}:${slug}`,
            projectId: project.id,
            projectName: project.name,
            envSlug: slug,
            actorName,
            actorId: userId,
          }).catch(() => {});
          void qc.invalidateQueries({
            queryKey: queryKeys.notifications(userId),
          });
        }
      }
    },
  });
}

/**
 * Promote a feature into a different environment on the same project
 * via a sibling record (clone model — source stays, new feature +
 * its flows appear in target env).
 *
 * Two-step mutation:
 *   1. Create a sibling feature record with `clonedFromFeatureId`
 *      stamped back to the source feature id, plus
 *      `envSlug: targetEnvSlug` and the source's metadata
 *      (`title` / `projectId` / `developerIds` / `qaIds` /
 *      `githubLink`). The source record is left untouched — its
 *      `envSlug` stays as "dev" and the dev-env page keeps rendering
 *      it.
 *   2. Cascade — for every flow whose `featureId` matches the source
 *      AND whose `envSlug` matches the source's `envSlug` (i.e. the
 *      dev-source flows that live alongside the feature), create a
 *      sibling flow record under the new sibling feature with
 *      `clonedFromFlowId` linking back to the source flow. The
 *      destination env page sees a brand-new sibling feature WITH
 *      its flows, not as an empty shell.
 *
 * The source row's `FeatureEnvWorkflow` chain picks up a persistent
 * "promoted to {env}" tick on the sibling env because
 * `useClonedFeatureEnvs` now finds the new sibling via
 * `clonedFromFeatureId`.
 *
 * Despite the name `useCloneFeature` (kept for diff-churn reasons —
 * the row-level `ManagerFeatureEnvWorkflow` chip fires this hook),
 * this is a clone operation: source stays, sibling is created.
 *
 * Manager-only — see the role gate below. Tester / developer roles get
 * the read-only `FeatureEnvWorkflow` mirror in `FeatureItem.tsx`
 * instead.
 */
export function useCloneFeature(): UseMutationResult<
  Feature,
  Error,
  { feature: Feature; targetEnvSlug: string }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  // Manager-only action. Promoting a feature across environments is a
  // part of the manager's lifecycle workflow (the manager owns the
  // feature and carries it up the env chain as the work lands in stg /
  // prod / uat), so only managers are allowed to call this mutation.
  // Testers and developers see the read-only `FeatureEnvWorkflow`
  // mirror in `FeatureItem.tsx` and the env pills are non-interactive
  // on their session; this throw catches programmatic / stale-modal
  // callers that bypass that UI gate.
  const isManager = currentUser?.roles?.includes("manager") ?? false;
  return useMutation({
    mutationFn: async ({ feature, targetEnvSlug }) => {
      if (!isManager) {
        throw new Error(
          "Only managers can promote features across environments.",
        );
      }
      // Build the clone-record payload. The Feature schema marks
      // `title`, `status`, and `projectId` as `requiredOn: 3` so we
      // always send them. `developerIds` / `qaIds` are forwarded
      // verbatim from the source so the sibling carries the same
      // assignment as the source (a tester assigned to dev feature X
      // is still the QA for stg feature X-clone). `githubLink` is
      // forwarded only if non-empty so the sibling never inherits a
      // stale empty string. `clonedFromFeatureId` is the cross-env
      // link the read-only `FeatureEnvWorkflow` mirror queries
      // (via `useClonedFeatureEnvs`) to paint persistent
      // "promoted to {env}" ticks for the source row.
      // Precondition — the feature must have AT LEAST ONE source-env
      // flow AND every source-env flow must be in "passed" status.
      // The team's promotion contract is explicit: a feature is
      // promotion-ready only when QA has signed off on every flow
      // under it (status === "passed"). Any non-passed status
      // (`failed`, `pending`, `draft`, `investigating`, `pause`) is
      // a block — either because the work is unfinished (draft /
      // pending / investigating / pause) or because it has hit a
      // regression (failed). Empty features are also blocked —
      // promoting a feature with zero flows would create a sibling
      // row in the destination env that has no work to verify.
      //
      // The manager-interactive `ManagerFeatureEnvWorkflow` UI also
      // gates on this — but instead of just disabling the pill, the
      // new UX opens an error modal with a "Request" button that
      // sends a `feature.promotion_requested` notification to the
      // feature's assigned QAs. This server-side check is the
      // defense-in-depth against stale-modal / programmatic callers
      // that bypass the UI gate.
      //
      // CRITICAL ordering — this query + check MUST run before
      // `featuresCollection.create()` below. The sibling create is
      // visible immediately on the destination env page once it lands
      // (TanStack Query invalidation in onSuccess refetches), so if we
      // created the sibling first and THEN threw on the precondition,
      // the user would see the error toast AND the sibling would
      // already be in the next env. Lifting the check above the
      // create makes the precondition a hard gate: when it fails, no
      // sibling row is ever written.
      //
      // Filter on envSlug mirrors the cascade filter below — only
      // flows living in the same env as the source feature are
      // considered for the precondition, because the cascade carries
      // over only those (see the cascade comment below). A flow with
      // a different envSlug already exists in a different env under
      // the source feature and shouldn't gate this promotion.
      const sourceFlowsRaw = await flowsCollection.list({
        filter: {
          featureId: feature.id,
          envSlug: feature.envSlug,
        },
        pageNo: 1,
        pageSize: 200,
      });
      const sourceFlows = unwrapPaged<CloudFlow>(sourceFlowsRaw).items;
      if (sourceFlows.length === 0) {
        throw new Error(
          "Cannot promote feature — this feature has no flows. Add at least one flow under the feature before promoting.",
        );
      }
      const nonPassedFlows = sourceFlows.filter(
        (f) => f.status !== "passed",
      );
      if (nonPassedFlows.length > 0) {
        const blockingNames = nonPassedFlows
          .map((f) => f.title ?? "(untitled)")
          .slice(0, 3);
        const more =
          nonPassedFlows.length > 3
            ? ` and ${nonPassedFlows.length - 3} more`
            : "";
        throw new Error(
          `Cannot promote feature — ${nonPassedFlows.length} flow${nonPassedFlows.length === 1 ? "" : "s"} under this feature ${nonPassedFlows.length === 1 ? "is" : "are"} not in "Passed" status: ${blockingNames.join(", ")}${more}. Mark every flow as Passed before promoting.`,
        );
      }

      const createPayload: Record<string, unknown> = {
        title: feature.name,
        projectId: feature.projectId,
        status: "backlog",
        envSlug: targetEnvSlug,
        clonedFromFeatureId: feature.id,
      };
      if (Array.isArray(feature.developerIds)) {
        createPayload.developerIds = feature.developerIds;
      }
      if (Array.isArray(feature.qaIds)) {
        createPayload.qaIds = feature.qaIds;
      }
      if (
        typeof feature.githubLink === "string" &&
        feature.githubLink.trim() !== ""
      ) {
        createPayload.githubLink = feature.githubLink.trim();
      }
      const created = (await featuresCollection.create(
        createPayload,
      )) as unknown;
      // Mirror `useCreateFeature` — the gateway can wrap the inserted
      // row in different envelopes depending on the path; use the
      // helper to pull the new sibling's `ItemId` reliably.
      const siblingId = extractInsertedItemId(created, "insertFeature");
      if (!siblingId) {
        throw new Error(
          "Could not create feature clone — no itemId in response.",
        );
      }

      // Cascade — clone every dev-source flow under the new sibling
      // feature so the destination env page shows the sibling feature
      // WITH its flows, not as an empty row. The user explicitly
      // asked for this ("not taking its flow with it"); promoting a
      // feature without its flows would leave the stg / prod / uat
      // sibling as an empty shell, forcing the manager to re-author
      // every flow in the new env.
      //
      // Filter: only flows whose `envSlug` matches the source
      // feature's `envSlug` are carried over. Reasoning — flows whose
      // `envSlug` differs from the source feature's are already living
      // in a different env under the source feature; carrying them
      // over into the sibling feature would create a duplicate of the
      // same content in the target env (one flow under the source
      // feature, one under the new sibling) — that's not what the
      // manager asked for. The cascade clones only the source-env
      // flows that "live with" the feature.
      //
      // Wire payload mirrors `useCreateFlow`'s shape:
      //   title, featureId (sibling), status (carried over from
      //   source — the audit trail of "passed in dev" stays
      //   attached to the cloned flow, the tester re-runs in stg
      //   and updates), envSlug (target), clonedFromFlowId (link
      //   back to source). Optional content fields
      //   (`description` / `steps` / `stack`) are forwarded only
      //   when non-empty so the schema's `requiredOn: 0` rule isn't
      //   tripped.
      await Promise.all(
        sourceFlows.map(async (sourceFlow) => {
          const flowPayload: Record<string, unknown> = {
            title: sourceFlow.title,
            featureId: siblingId,
            status: sourceFlow.status ?? "draft",
            envSlug: targetEnvSlug,
            clonedFromFlowId: sourceFlow.ItemId,
          };
          if (
            typeof sourceFlow.description === "string" &&
            sourceFlow.description.trim() !== ""
          ) {
            flowPayload.description = sourceFlow.description;
          }
          if (Array.isArray(sourceFlow.steps) && sourceFlow.steps.length > 0) {
            flowPayload.steps = sourceFlow.steps;
          }
          if (typeof sourceFlow.stack === "string" && sourceFlow.stack !== "") {
            flowPayload.stack = sourceFlow.stack;
          }
          await flowsCollection.create(flowPayload);
        }),
      );
      // We don't have the cloud's full row on hand (the create
      // response only carries the new id), so build a `Feature`-
      // shaped return from the source's metadata + the new envSlug +
      // the sibling id. Downstream callers (`onSuccess`) only need
      // the id + name + projectId + envSlug to construct the
      // notification payload, and TanStack Query will refetch the
      // row's full content from `["features", userId, projectId]`
      // once we invalidate it.
      const now = new Date().toISOString();
      const synthetic: CloudFeature = {
        ItemId: siblingId,
        title: feature.name,
        projectId: feature.projectId,
        status: "backlog",
        envSlug: targetEnvSlug,
        clonedFromFeatureId: feature.id,
        developerIds: feature.developerIds,
        qaIds: feature.qaIds,
        githubLink: feature.githubLink,
        CreatedDate: now,
        LastUpdatedDate: now,
      };
      return toFeature(synthetic, feature.projectId);
    },
    onSuccess: (_sibling, vars) => {
      // Refresh every cached view of this project's features — the
      // prefix match covers the env-scoped pages, the env-less
      // (legacy) page, AND the `useClonedFeatureEnvs` lookup the
      // `FeatureEnvWorkflow` mirror uses to paint persistent
      // "promoted to {env}" ticks for the source row. Invalidation
      // key: `["features", userId, projectId]` — note that
      // `queryKeys.features(userId, projectId, envSlug)` expands to
      // `["features", userId, projectId, envSlug]` so this prefix
      // invalidates every env-scoped subkey AND the clonedEnvs
      // query (`["features", userId, projectId, "_all",
      // "clonedEnvs", featureId]`). The dev-env page re-renders
      // with the source row still visible (envSlug unchanged); the
      // destination env page picks up the new sibling.
      qc.invalidateQueries({
        queryKey: ["features", userId, vars.feature.projectId],
      });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard(userId) });

      // Notify testers on cross-env feature promotion. `context:
      // "feature"` makes the body builder render the feature-shaped
      // sentence instead of the flow-shaped one. `value` carries the
      // source feature id (the
      // sibling has a fresh id and isn't tracked yet by the inbox
      // subscription filter); `featureName` carries the source's
      // pre-promote name; `envSlug` is the destination env the
      // manager picked from the chip.
      const projects = qc.getQueryData<Project[]>(
        queryKeys.projects(userId),
      );
      const project = projects?.find((p) => p.id === vars.feature.projectId);
      void notifyRole(["tester", "developer"], {
        context: "feature",
        actionName: "promoted",
        value: vars.feature.id,
        projectId: vars.feature.projectId,
        projectName: project?.name,
        featureName: vars.feature.name,
        envSlug: vars.targetEnvSlug,
        actorName: currentUser?.name ?? "A manager",
        actorId: userId,
      }).catch(() => {});
      void qc.invalidateQueries({
        queryKey: queryKeys.notifications(userId),
      });
      // Silence unused-param linter — onSuccess exists so callers
      // can `await` the cloned Feature; the row invalidations above
      // don't read it directly.
      void _sibling;
    },
  });
}

// Flow-side counterpart of `useCloneFeature`. Promotes a single flow to
// a sibling env (stg / prod / uat) by:
//   1. Resolving the target-env feature — looking up the source feature's
//      existing sibling in the target env (`clonedFromFeatureId ===
//      sourceFeature.id && envSlug === targetEnvSlug`); if none exists,
//      cascade-creating a sibling feature that mirrors
//      `useCloneFeature`'s sibling-create payload (title, projectId,
//      status, envSlug, clonedFromFeatureId, plus developerIds / qaIds /
//      githubLink when non-empty).
//   2. Creating a new flow row under that target-env feature with
//      `clonedFromFlowId` pointing back at the root dev source.
//
// Why a feature cascade is required — the env-scoped pages filter
// features by `envSlug` via `useProjectFeatures`; the cloned flow has
// to live under a feature in the target env, otherwise the target
// env's page (filtered by envSlug) can't render it. The source feature
// only appears on the source env's page, so without the cascade the
// clone would either be invisible (no home on the target env's page)
// or appear as a duplicate in the source feature on the source env's
// page (since `useFeatureFlows` returns flows by featureId alone, not
// filtered by envSlug).
//
// `clonedFromFlowId` flat-link to root — mirrors the feature-side "all
// descendants link to the root source" convention. If `flow` IS the
// dev source (`flow.clonedFromFlowId === undefined`), the new clone's
// `clonedFromFlowId` is set to `flow.id` (the root). If `flow` is
// itself a clone (`flow.clonedFromFlowId` is set to the root), the
// new clone's `clonedFromFlowId` is set to the SAME root id — NOT to
// `flow.id`. Reason: the root source's `useClonedFlowEnvs` lookup
// (`filter: { clonedFromFlowId: <root id> }`) must find every
// descendant regardless of which env chain step created it. If we
// chained link-by-link (stg → prod's `clonedFromFlowId = stg.id`),
// the root lookup would miss the prod clone because the prod row's
// `clonedFromFlowId` points at the stg clone, not the root. Flat-link
// to the root keeps the env-set accurate.
//
// Per-flow independence — per the user's request, each flow row's
// environment workflow operates on the flow alone, without requiring
// its parent feature to be promoted to the target env FIRST. The
// cascade here is structural (a sibling feature is needed so the
// cloned flow has a home on the target env's page), not a per-flow
// propagation: no other-flow auto-clone, no flow-list cascade —
// only the one flow being promoted is duplicated. The "feature has
// been promoted" check is intentionally absent — a manager promoting
// a single dev flow to stg shouldn't require promoting the whole
// feature first.
//
// Manager-only — see the role gate below. Tester / developer roles get
// the read-only `FlowEnvWorkflow` mirror in `FlowItem.tsx` instead.
export function useCloneFlow(): UseMutationResult<
  Flow,
  Error,
  { flow: Flow; targetEnvSlug: string }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  // Manager-only action. Promoting a flow across environments is part
  // of the manager's lifecycle workflow (the manager owns the env
  // chain and carries flows up as QA signs off), so only managers are
  // allowed to call this mutation. Testers and developers see the
  // read-only `FlowEnvWorkflow` mirror in `FlowItem.tsx` and the env
  // pills are non-interactive on their session; this throw catches
  // programmatic / stale-modal callers that bypass that UI gate.
  const isManager = currentUser?.roles?.includes("manager") ?? false;
  return useMutation({
    mutationFn: async ({ flow, targetEnvSlug }) => {
      if (!isManager) {
        throw new Error(
          "Only managers can promote flows across environments.",
        );
      }
      // Precondition — the source flow must be in "passed" status.
      // The team's promotion contract: a flow is promotion-ready only
      // when QA has signed off (status === "passed"). Any non-passed
      // status (`failed`, `pending`, `draft`, `investigating`,
      // `pause`) is a block — either because the work is unfinished
      // (draft / pending / investigating / pause) or because it has
      // hit a regression (failed).
      //
      // The manager-interactive `ManagerFlowEnvWorkflow` UI also gates
      // on this — but instead of just disabling the pill, the
      // manager clicks through and the mutation throws here, which
      // surfaces as an error toast. Simpler than the feature row's
      // `BlockPromoteModal` because the flow row's precondition is
      // single-dimensional (just the flow's own status); the modal's
      // multi-flow explanation doesn't apply.
      //
      // CRITICAL ordering — this check MUST run before
      // `flowsCollection.create()` below. The sibling create is
      // visible immediately on the destination env (TanStack Query
      // invalidation in onSuccess refetches), so if we created the
      // sibling first and THEN threw on the precondition, the user
      // would see the error toast AND the sibling would already be
      // in the next env. Lifting the check above the create makes
      // the precondition a hard gate: when it fails, no sibling row
      // is ever written.
      if (flow.status !== "passed") {
        throw new Error(
          `Cannot promote flow "${flow.name}" — it is not in "Passed" status. Mark the flow as Passed before promoting.`,
        );
      }

      // `clonedFromFlowId` flat-link to root. If `flow` is the dev
      // source, point at itself; if `flow` is itself a clone, point
      // at the same root it was linked from. See the comment at the
      // top of this hook for why we don't chain link-by-link.
      const rootSourceId = flow.clonedFromFlowId ?? flow.id;

      // Resolve the target-env sibling feature. The cloned flow has
      // to live under a feature in the target env, otherwise the
      // env-scoped page (filtered by `envSlug` on
      // `useProjectFeatures`) can't render it — the source feature
      // only appears on the source env's page. We cascade-create a
      // sibling feature if one doesn't already exist; this mirrors
      // `useCloneFeature`'s feature-side cascade, but stops at the
      // feature boundary (no other-flow auto-clone — that's the
      // per-flow independence the user asked for).
      //
      // Look up the source feature's existing sibling in the target
      // env. The `clonedFromFeatureId` filter is the same link
      // `useClonedFeatureEnvs` uses; the additional `envSlug` filter
      // narrows the candidate set to the row we'd attach the cloned
      // flow to. Wrapped in try/catch + a defensive page-size bound
      // — a feature typically has ≤3 siblings (stg/prod/uat), so a
      // page size of 10 is generous headroom without pulling the
      // whole feature set.
      const siblingsRaw = await featuresCollection.list({
        filter: {
          clonedFromFeatureId: flow.featureId,
          envSlug: targetEnvSlug,
        },
        pageNo: 1,
        pageSize: 10,
      });
      const existingSibling = unwrapPaged<{ ItemId: string }>(siblingsRaw)
        .items[0];

      // Read the source feature for the sibling-create payload. The
      // Feature schema forwards `title`, `developerIds`, `qaIds`,
      // and `githubLink` from the source — the destination env
      // inherits the same team ownership and code-link as the
      // source. Mirrors `useCloneFeature`'s sibling-create payload
      // verbatim. Done after the sibling lookup so an existing
      // sibling short-circuits this read entirely (avoids a wasted
      // fetch on the common case of "promoting more flows after
      // the feature is already promoted").
      let targetFeatureId: string;
      if (existingSibling) {
        targetFeatureId = existingSibling.ItemId;
      } else {
        const sourceFeatureRaw = await featuresCollection.get(flow.featureId);
        const sourceFeature = unwrapPaged<CloudFeature>(sourceFeatureRaw)
          .items[0];
        if (!sourceFeature) {
          throw new Error(
            `Cannot promote flow "${flow.name}" — parent feature (${flow.featureId}) could not be loaded.`,
          );
        }
        const siblingCreatePayload: Record<string, unknown> = {
          title: sourceFeature.title,
          projectId: sourceFeature.projectId,
          status: "backlog",
          envSlug: targetEnvSlug,
          clonedFromFeatureId: sourceFeature.ItemId,
        };
        if (Array.isArray(sourceFeature.developerIds)) {
          siblingCreatePayload.developerIds = sourceFeature.developerIds;
        }
        if (Array.isArray(sourceFeature.qaIds)) {
          siblingCreatePayload.qaIds = sourceFeature.qaIds;
        }
        if (
          typeof sourceFeature.githubLink === "string" &&
          sourceFeature.githubLink.trim() !== ""
        ) {
          siblingCreatePayload.githubLink = sourceFeature.githubLink.trim();
        }
        const createdSibling = (await featuresCollection.create(
          siblingCreatePayload,
        )) as unknown;
        const newSiblingId = extractInsertedItemId(
          createdSibling,
          "insertFeature",
        );
        if (!newSiblingId) {
          throw new Error(
            "Could not create sibling feature for flow clone — no itemId in response.",
          );
        }
        targetFeatureId = newSiblingId;
      }

      // Build the clone-record payload. The Flow schema marks
      // `title` and `featureId` as required; `featureId` is the
      // target-env sibling feature (existing or just-created) so the
      // cloned flow renders under that feature on the target env's
      // page. `status` is forwarded verbatim from the source so the
      // audit trail of "passed in <source env>" stays attached to
      // the cloned flow (the tester re-runs in the target env and
      // updates). Optional content fields (`description` / `steps` /
      // `stack`) are forwarded only when non-empty so the schema's
      // `requiredOn: 0` rule isn't tripped.
      const createPayload: Record<string, unknown> = {
        title: flow.name,
        featureId: targetFeatureId,
        status: flow.status ?? "draft",
        envSlug: targetEnvSlug,
        clonedFromFlowId: rootSourceId,
      };
      if (typeof flow.description === "string" && flow.description.trim() !== "") {
        createPayload.description = flow.description;
      }
      if (Array.isArray(flow.steps) && flow.steps.length > 0) {
        createPayload.steps = flow.steps;
      }
      if (typeof flow.stack === "string") {
        createPayload.stack = flow.stack;
      }
      const created = (await flowsCollection.create(
        createPayload,
      )) as unknown;
      // Mirror `useCloneFeature` — use the helper to pull the new
      // sibling's `ItemId` reliably across the gateway's response
      // envelopes.
      const siblingId = extractInsertedItemId(created, "insertFlow");
      if (!siblingId) {
        throw new Error(
          "Could not create flow clone — no itemId in response.",
        );
      }
      // We don't have the cloud's full row on hand (the create
      // response only carries the new id), so build a `Flow`-shaped
      // return from the source's metadata + the new envSlug +
      // sibling featureId + the sibling id. Downstream callers
      // (`onSuccess`) only need the id + name + projectId + envSlug
      // + featureId to construct the notification payload, and
      // TanStack Query will refetch the row's full content from
      // `["flows", userId, featureId]` once we invalidate it.
      const now = new Date().toISOString();
      const synthetic = {
        ItemId: siblingId,
        title: flow.name,
        featureId: targetFeatureId,
        envSlug: targetEnvSlug,
        status: flow.status ?? "draft",
        description: flow.description,
        steps: flow.steps,
        stack: flow.stack,
        CreatedDate: now,
        LastUpdatedDate: now,
      };
      return toFlow(synthetic, flow.projectId);
    },
    onSuccess: (_sibling, vars) => {
      // Refresh every cached view of this project's flows + the
      // clonedEnvs lookups the workflow mirrors use. The prefix
      // matches cover:
      //   * `["flows", userId, featureId]` — the row's own flow
      //     list (re-renders the source row + any sibling rows
      //     under the same feature). Invalidated for BOTH the
      //     source feature (so the source row's chain re-renders
      //     against the now-non-empty clonedEnvs set) AND the
      //     target-env feature (so the target env's page picks up
      //     the cloned flow on the next render);
      //   * `["flows", userId, "clonedEnvs", flowId]` — the
      //     `useClonedFlowEnvs` lookup the source row's
      //     `FlowEnvWorkflow` mirror uses to paint the persistent
      //     "promoted to {env}" tick;
      //   * `["features", userId, projectId, ...]` — the project-
      //     scoped feature list, so the target env's page picks up
      //     the new sibling feature on next render (only created if
      //     no sibling existed — covered by the prefix match either
      //     way, the env-scoped subkey just becomes a hit).
      qc.invalidateQueries({
        queryKey: ["flows", userId, vars.flow.featureId],
      });
      qc.invalidateQueries({
        queryKey: ["flows", userId, "clonedEnvs", vars.flow.clonedFromFlowId ?? vars.flow.id],
      });
      qc.invalidateQueries({
        queryKey: ["features", userId, vars.flow.projectId],
      });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard(userId) });

      // Notify testers + developers on cross-env flow promotion.
      // `context: "flow"` makes the body builder render the flow-
      // shaped sentence. `value` carries the source flow id (the
      // sibling has a fresh id and isn't tracked yet by the inbox
      // subscription filter); `flowName` carries the source's
      // pre-promote name; `envSlug` is the destination env the
      // manager picked from the chip.
      const projects = qc.getQueryData<Project[]>(
        queryKeys.projects(userId),
      );
      const project = projects?.find((p) => p.id === vars.flow.projectId);
      void notifyRole(["tester", "developer"], {
        context: "flow",
        actionName: "promoted",
        value: vars.flow.id,
        projectId: vars.flow.projectId,
        projectName: project?.name,
        flowName: vars.flow.name,
        envSlug: vars.targetEnvSlug,
        actorName: currentUser?.name ?? "A manager",
        actorId: userId,
      }).catch(() => {});
      void qc.invalidateQueries({
        queryKey: queryKeys.notifications(userId),
      });
      // Silence unused-param linter — onSuccess exists so callers
      // can `await` the cloned Flow; the row invalidations above
      // don't read it directly.
      void _sibling;
    },
  });
}

// Append a custom environment to a project's `customEnvs` list. Reads the
// current list from the query cache when available to do an honest
// merge; on cache miss it falls back to whatever the server has, using
// the returned Project to derive the post-state. The mutation underlying
// is `useUpdateProject` — we don't duplicate the encoding logic.
export function useAddProjectEnv(): UseMutationResult<
  Project,
  Error,
  { projectId: string; env: ProjectCustomEnv }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  const updateProject = useUpdateProject();
  // Tester guard — see `useCreateFeature` for the full rationale. UI
  // hides the "Add Environment" CTA on ProjectsPage so testers never
  // reach this hook through normal navigation; this is defense-in-depth.
  const isTester = currentUser?.roles?.includes("tester") ?? false;
  return useMutation({
    mutationFn: async ({ projectId, env }) => {
      if (isTester) {
        throw new Error(
          "Testers cannot create environments. Ask a manager for access.",
        );
      }
      const cacheKey = queryKeys.project(userId, projectId);
      // Pull a fresh read when the cache hasn't seen this project yet
      // (e.g. the user opened AddEnvironmentModal directly from the
      // project-list kebab menu, so `useProject(targetProjectId)` hasn't
      // been mounted yet on this page). Without this, two separate bugs
      // could fire:
      //   1. `existing` would default to `[]` and we'd PATCH
      //      `customEnvs: [env]` — wiping out any prior custom envs the
      //      project already had (silent data loss).
      //   2. The PATCH would lack the requiredOn: "Both" echoes the
      //      gateway demands on every update (`name` + `status`). The
      //      same pattern is used in `useRenameProjectEnv`'s canonical
      //      env path (see comments at line ~4371 in that hook) —
      //      the comment claiming `useAddProjectEnv` doesn't need the
      //      echo was incorrect (verified 2026-09-27 via the user
      //      report: "manager add env → notification fires but no env
      //      appears"). The cloud was silently rejecting the partial
      //      PATCH; the SDK's update() returned a stale-but-shape-ok
      //      response which fired the success path (and thus the
      //      notification) without persisting the change.
      let project = qc.getQueryData<Project>(cacheKey);
      if (!project) {
        const raw = await projectsCollection.get(projectId);
        const paged = unwrapPaged<CloudProject>(raw);
        const fresh = paged.items[0];
        if (!fresh) {
          throw new Error("Project not found.");
        }
        const hydrated = toProject(fresh);
        qc.setQueryData<Project>(cacheKey, hydrated);
        project = hydrated;
      }
      const existing = project.customEnvs ?? [];
      const next: ProjectCustomEnv[] = [...existing, env];
      return updateProject.mutateAsync({
        id: projectId,
        // Echo `name` and `status` because Project schema marks both
        // requiredOn: "Both" — gateway rejects partial PATCHes that
        // don't carry them. Same fix as `useRenameProjectEnv`.
        patch: {
          customEnvs: next,
          name: project.name,
          status: project.status ?? "active",
        },
      });
    },
  });
}

/**
 * Rename one env within a project. Handles three rename shapes that the
 * modal can't otherwise tell apart at the network layer:
 *
 *   1. Canonical env, label-only — patch `envLabelOverrides`. Slug stays
 *      reserved (dev/stg/prod/uat) so the modal disables the slug input
 *      for canonical envs; this hook throws if a caller somehow passes
 *      `newSlug` for a canonical env.
 *   2. Custom env, label-only — patch `customEnvs` in place (find by
 *      `slug`, replace `label`).
 *   3. Custom env, slug change — sequential: list every feature and
 *      flow with the old envSlug, PATCH each to the new envSlug, then
 *      patch `customEnvs` with the renamed entry. Migration runs BEFORE
 *      the project's slug rewrite so a partial failure leaves the user
 *      looking at the old slug in the chip list — they can retry the
 *      modal without orphaning records.
 *
 * The hook returns the new slug alongside the updated Project so the
 * caller can `navigate(/projects/:id/<newSlug>)` when the slug changed.
 */
export function useRenameProjectEnv(): UseMutationResult<
  {
    project: Project;
    newSlug: string;
    /** Slug the user was on before the rename. Set only when the slug
     *  changed — the page uses it to navigate from the old URL to the new
     *  one. Undefined when only the label changed. */
    oldSlug?: string;
  },
  Error,
  {
    projectId: string;
    envSlug: string;
    isCustom: boolean;
    newLabel: string;
    newSlug?: string;
  }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  const updateProject = useUpdateProject();
  // Tester guard — see `useCreateFeature` for the full rationale. The
  // pencil trigger on the env Badge (ProjectDetailPage header) is hidden
  // for testers so this hook stays unreachable from normal navigation.
  const isTester = currentUser?.roles?.includes("tester") ?? false;
  return useMutation({
    mutationFn: async (input) => {
      if (isTester) {
        throw new Error(
          "Testers cannot update environments. Ask a manager for access.",
        );
      }
      const cacheKey = queryKeys.project(userId, input.projectId);
      // Pull a fresh read when the cache hasn't seen this project yet
      // (e.g. the page just mounted). Without this, a rename kicked off
      // before `useProject` resolves would have nothing to merge into.
      let project = qc.getQueryData<Project>(cacheKey);
      if (!project) {
        const raw = await projectsCollection.get(input.projectId);
        const paged = unwrapPaged<CloudProject>(raw);
        const fresh = paged.items[0];
        if (!fresh) {
          throw new Error("Project not found.");
        }
        const hydrated = toProject(fresh);
        qc.setQueryData<Project>(cacheKey, hydrated);
        project = hydrated;
      }

      // --- 1. Canonical env, label-only ---------------------------
      // The slug stays reserved; `useRenameProjectEnv` never writes the
      // canonical env's slug. The modal's disabled input is the user-
      // facing guard; this throws if a programmatic caller passes one.
      //
      // `name` and `status` are echoed on the patch because the cloud
      // Project schema marks both as `requiredOn: 3` (required on every
      // update). The same `RenameProjectModal` workaround — see
      // `hooks.ts:useUpdateProject`'s callers — applies here: surface
      // the current values from the cached project so the gateway
      // doesn't reject the partial PATCH with "Field 'name' is required
      // for update." `useAddProjectEnv` happens to not need this today
      // because adding a custom env doesn't trigger the same gateway
      // rule when only a `requiredOn: 0` field is touched — see the
      // existing comment on `useUpdateProject`'s mutationFn.
      if (!input.isCustom) {
        if (input.newSlug && input.newSlug !== input.envSlug) {
          throw new Error("Canonical env slug cannot be changed.");
        }
        const nextOverrides: Record<string, string> = {
          ...(project.envLabelOverrides ?? {}),
        };
        nextOverrides[input.envSlug] = input.newLabel;
        const updated = await updateProject.mutateAsync({
          id: input.projectId,
          patch: {
            envLabelOverrides: nextOverrides,
            name: project.name,
            status: project.status ?? "active",
          },
        });
        return { project: updated, newSlug: input.envSlug };
      }

      // --- 2 / 3. Custom env rename -------------------------------
      const existing = project.customEnvs ?? [];
      const idx = existing.findIndex((e) => e.slug === input.envSlug);
      if (idx === -1) {
        throw new Error("Custom environment not found.");
      }

      // Label-only — single round-trip, in-place array edit.
      // Echo `name` and `status` on the patch — same requiredOn: 3
      // reasoning as the canonical-env path above.
      if (!input.newSlug || input.newSlug === input.envSlug) {
        const nextEnvs = existing.slice();
        nextEnvs[idx] = { ...nextEnvs[idx], label: input.newLabel };
        const updated = await updateProject.mutateAsync({
          id: input.projectId,
          patch: {
            customEnvs: nextEnvs,
            name: project.name,
            status: project.status ?? "active",
          },
        });
        return { project: updated, newSlug: input.envSlug };
      }

      // --- 3. Custom env, slug change — migrate dependents ----------
      //
      // The slug rewrite touches three things: Feature.envSlug,
      // Flow.envSlug, and Project.customEnvs[idx].slug. Each cloud
      // collection's `update` accepts a partial payload, but Feature +
      // Flow schemas mark `projectId` / `status` and `featureId` /
      // `status` respectively as `requiredOn: 3` — those have to be
      // echoed on every PATCH or the gateway rejects with "missing
      // required field". `useUpdateFeature` and `useUpdateFlow` don't
      // surface that pattern through their public APIs (they're shaped
      // for name-only patches), so we hit the underlying collection
      // accessor directly here. The status echo is sourced from the
      // current record so we don't accidentally flip chip state.
      const newSlug = input.newSlug;

      // Migrate features under the old slug.
      //
      // `useProjectFeatures` already filters the same shape; listing
      // directly here keeps the dependency graph flat (no useQuery
      // inside a useMutation callback). pageSize 500 is generous — a
      // single env holding >500 features is a real workload, and the
      // alternative is an unbounded scan.
      const featuresRaw = await featuresCollection.list({
        filter: {
          ...createdByFilter(userId),
          projectId: input.projectId,
          envSlug: input.envSlug,
        },
        pageNo: 1,
        pageSize: 500,
      });
      const featuresToMigrate = unwrapPaged<{
        ItemId: string;
        status: string;
      }>(featuresRaw).items;
      for (const f of featuresToMigrate) {
        try {
          await featuresCollection.update(f.ItemId, {
            projectId: input.projectId,
            status: f.status ?? "backlog",
            envSlug: newSlug,
          });
        } catch {
          // Swallow — see useUpdateFeature's sibling cascade for the
          // same pattern. The user's other records under this env still
          // migrate; the stragglers can be retried manually.
        }
      }

      // Migrate flows under the old slug. Flow collection has no
      // `projectId` column — flows are filtered through their
      // `featureId`. Filtering on `envSlug` alone catches every flow
      // whose parent feature we just migrated (the parent's envSlug was
      // rewritten atomically with the PATCH above), so the
      // feature-by-feature fan-out from useUpdateFlow isn't needed
      // here.
      const flowsRaw = await flowsCollection.list({
        filter: {
          ...createdByFilter(userId),
          envSlug: input.envSlug,
        },
        pageNo: 1,
        pageSize: 1000,
      });
      const flowsToMigrate = unwrapPaged<{
        ItemId: string;
        featureId: string;
        status: string;
      }>(flowsRaw).items;
      for (const fl of flowsToMigrate) {
        try {
          await flowsCollection.update(fl.ItemId, {
            featureId: fl.featureId,
            status: fl.status ?? "draft",
            envSlug: newSlug,
          });
        } catch {
          // Same swallow rationale as the feature loop.
        }
      }

      // Finally rewrite the customEnvs entry: new slug + new label.
      // Echo `name` and `status` on the patch — see canonical-env path
      // for the requiredOn: 3 reasoning.
      const nextEnvs = existing.slice();
      nextEnvs[idx] = {
        ...nextEnvs[idx],
        slug: newSlug,
        label: input.newLabel,
      };
      const updated = await updateProject.mutateAsync({
        id: input.projectId,
        patch: {
          customEnvs: nextEnvs,
          name: project.name,
          status: project.status ?? "active",
        },
      });
      return { project: updated, newSlug, oldSlug: input.envSlug };
    },
    onSuccess: (_result, vars) => {
      // Refresh every cached view this rename could affect: the
      // project's own record (so the header / chips redraw), the
      // workspace list (so the project card chips redraw on /projects),
      // every feature + flow cache under this project (so the
      // env-scoped pages reflect the new envSlug filter), and the
      // dashboard totals.
      qc.invalidateQueries({ queryKey: queryKeys.projects(userId) });
      qc.invalidateQueries({
        queryKey: queryKeys.project(userId, vars.projectId),
      });
      qc.invalidateQueries({
        queryKey: ["features", userId, vars.projectId],
      });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard(userId) });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Issue Tracker — per-user collections + mutations
// ─────────────────────────────────────────────────────────────────────────────
//
// The Issue Tracker's storage shapes live in `blocks/data/schemas/*.json`
// (VerificationTarget, Secret, Issue). The hooks below are the single
// place that talks to those collections: pages consuming the Issue Tracker
// pull data via `useIssueTrackerTargets` / `useIssueTrackerSecrets` /
// `useIssueTrackerIssues`, and call mutations through the matching
// `useCreate*` / `useUpdate*` / `useDelete*` hooks.
//
// Why per-user scoping: each user has their own verification surface —
// the configured URLs, the credentials, and the detected issues all belong
// to the signed-in operator. `createdByFilter(userId)` filters reads and
// the platform auto-attaches `CreatedBy` to writes, mirroring the pattern
// in `useProjects` / `useProjectFeatures`.
//
// Mutations invalidate the per-user list cache so the UI refreshes in
// place without forcing a remount. We deliberately avoid placing these
// behind any per-query-key dashboard invalidation — the Issue Tracker
// page is the only consumer, and coupling its updates to dashboard totals
// would force unnecessary refetches on every change.

// Read every configured URL for the signed-in user, scoped to the
// active project env. Sort by `LastUpdatedDate` desc so the most
// recently touched targets surface first — the `UrlInput` panel shows
// what the user just edited at the top of the list. Matches the
// Project listing's sort choice.
//
// Env scoping: a target row carries `projectId` + `envSlug` at write
// time (see `useCreateVerificationTarget`). When the user is not on
// a project env route the query is disabled so we don't leak rows
// from other envs into the panel. Outside an env the sidebar hides
// Issue Tracker entry points anyway, so this state is only briefly
// observable during the transition between routes.
export function useIssueTrackerTargets(): UseQueryResult<VerificationTarget[]> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  const activeEnv = useActiveEnv();
  return useQuery({
    queryKey: [
      ...queryKeys.issueTrackerTargets(userId),
      activeEnv?.projectId ?? "",
      activeEnv?.envSlug ?? "",
    ],
    enabled: Boolean(userId && activeEnv),
    // The store is mounted once at AppLayout root and the env context
    // is a long-lived React state. Without `staleTime` the default of 0
    // ms means every env navigation re-fires all three reads even when
    // nothing changed (the key carries env, so a fresh entry is
    // unavoidable on a real env change — but we don't need to refetch
    // on a 0-ms stale window). 30 s matches the notifier inbox and
    // keeps the panel responsive after a manual mutation, which
    // invalidates the key anyway.
    staleTime: 30_000,
    queryFn: async () => {
      const raw = await verificationTargetsCollection.list({
        filter: {
          ...createdByFilter(userId),
          projectId: activeEnv!.projectId,
          envSlug: activeEnv!.envSlug,
        },
        pageNo: 1,
        pageSize: 200,
        sort: { LastUpdatedDate: -1 },
      });
      return unwrapPaged<unknown>(raw).items.map((t) =>
        toVerificationTarget(t as Parameters<typeof toVerificationTarget>[0]),
      );
    },
  });
}

// Read every credential row for the signed-in user, scoped to the
// active project env. The page never needs the real password —
// `passwordMasked` rides alone on the wire, the form holds the value
// during the active session and clears on unmount (see the form's
// local-state treatment + spec section 12.3).
export function useIssueTrackerSecrets(): UseQueryResult<Secret[]> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  const activeEnv = useActiveEnv();
  return useQuery({
    queryKey: [
      ...queryKeys.issueTrackerSecrets(userId),
      activeEnv?.projectId ?? "",
      activeEnv?.envSlug ?? "",
    ],
    enabled: Boolean(userId && activeEnv),
    // See `useIssueTrackerTargets` — same rationale. The 30 s window
    // matches the mutation invalidation latency for create/delete
    // events on this collection.
    staleTime: 30_000,
    queryFn: async () => {
      const raw = await secretsCollection.list({
        filter: {
          ...createdByFilter(userId),
          projectId: activeEnv!.projectId,
          envSlug: activeEnv!.envSlug,
        },
        pageNo: 1,
        pageSize: 200,
        sort: { CreatedDate: -1 },
      });
      return unwrapPaged<unknown>(raw).items.map((s) =>
        toSecret(s as Parameters<typeof toSecret>[0]),
      );
    },
  });
}

// Read every issue recorded for the signed-in user. The IssueTrackerPage
// filters / sorts the returned list client-side (search is server-cheap
// but the chip-row + search composition wasn't worth a round trip), so
// the cloud-side sort here is just `detectedAt desc` — newest findings
// at the top, matching the existing UI's "newest" default sort.
//
// Role-aware scoping (the manual triage flow): verification runs execute
// as the MANAGER's session, so every row's CreatedBy is the manager — a
// CreatedBy-only scope would leave testers and developers with an empty
// tracker no matter what they're assigned. The gateway rules are open
// (blocks/data/rules.json is empty), so:
//   - manager  → wire-scoped to CreatedBy = me (their own runs' issues)
//   - tester   → fetch unscoped, keep rows ASSIGNED to me (any approval
//                state — this queue IS the work to re-test and approve)
//   - developer→ fetch unscoped, keep rows assigned to me AND approved
//                (a tester's approval is what admits an issue here)
//   - other/unknown roles fall back to the CreatedBy scope.
// The query key carries the roles signature alongside the userId:
// `AuthProvider` sets `currentUser` the moment the session claims land
// but fills `roles` one round-trip later (`iam.me()`), so a query keyed
// on the userId alone would fire its queryFn with `roles: []` — the
// CreatedBy branch — and cache an empty list that no later render ever
// refetches (same key). Keying on the roles makes the hydration flip
// `[] → ["developer"]` start a fresh query with the right branch. It is
// appended AFTER the userId so the mutation invalidations, which use the
// `queryKeys.issueTrackerIssues(userId)` prefix, still match every
// variant.
export function useIssueTrackerIssues(): UseQueryResult<Issue[]> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  const roles = currentUser?.roles ?? [];
  const isTester = roles.includes("tester");
  const isDeveloper = roles.includes("developer");
  // Only these two roles need the cross-user fetch; manager keeps the
  // tight wire filter.
  const fetchUnscoped = isTester || isDeveloper;
  // Env scoping — same shape as targets / secrets: an Issue row carries
  // its own projectId / envSlug, so the filter sits on top of the wire
  // fetch whether it's scoped by CreatedBy or unscoped. Disabled
  // outside an env context.
  const activeEnv = useActiveEnv();
  return useQuery({
    queryKey: [
      ...queryKeys.issueTrackerIssues(userId),
      roles.join(","),
      activeEnv?.projectId ?? "",
      activeEnv?.envSlug ?? "",
    ],
    enabled: Boolean(userId && activeEnv),
    // See `useIssueTrackerTargets` — same rationale. The IssueTracker
    // is the only screen that benefits from a fresher-than-30s view,
    // and it's mounted under the same provider as the rest of the
    // Issue Tracker hooks, so the panel-level mutation invalidation
    // (`queryKeys.issueTrackerIssues(userId)`) still flips the cache
    // the moment a row is added or a status changes.
    staleTime: 30_000,
    queryFn: async () => {
      const envFilter = {
        projectId: activeEnv!.projectId,
        envSlug: activeEnv!.envSlug,
      };
      const raw = fetchUnscoped
        ? await issuesCollection.list({
            filter: envFilter,
            pageNo: 1,
            pageSize: 200,
            sort: { detectedAt: -1 },
          })
        : await issuesCollection.list({
            filter: { ...createdByFilter(userId), ...envFilter },
            pageNo: 1,
            pageSize: 200,
            sort: { detectedAt: -1 },
          });
      const rows = unwrapPaged<unknown>(raw).items.map((i) =>
        toIssue(i as Parameters<typeof toIssue>[0]),
      );
      if (!fetchUnscoped) return rows;
      const assignedToMe = rows.filter((i) =>
        (i.assignedDeveloperIds ?? []).includes(userId),
      );
      return isTester ? assignedToMe : assignedToMe.filter((i) => !!i.approvedById);
    },
  });
}

// Add a configured URL + (optional) credential link. The mutation returns
// the fresh `VerificationTarget` so the page can stamp UI state without a
// refetch; on success we invalidate the per-user list cache so other
// panels (e.g. the verification summary tile) refresh in place.
//
// `enabled` rides the wire as `"true"/"false"` — see `toVerificationTarget`
// for the read-side coercion. The cloud schema marks it `requiredOn: 3`
// so the server rejects an empty value; we default to `"true"` to match
// the form's "always verify" convention.
export function useCreateVerificationTarget(): UseMutationResult<
  VerificationTarget,
  Error,
  Omit<VerificationTarget, "id" | "createdAt" | "updatedAt">
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  // Per-env scoping — the caller (useIssueTracker.addTarget / chat tool)
  // supplies projectId + envSlug with the payload, so the create site
  // has nothing else to do.
  return useMutation({
    mutationFn: async (input) => {
      // Only forward fields that have values. Empty strings against
      // `requiredOn: 0` fields are rejected by some gateway versions
      // — better to omit than to send `""` for a brand-new row.
      const created = await verificationTargetsCollection.create({
        projectId: input.projectId,
        envSlug: input.envSlug,
        applicationName: input.applicationName,
        url: input.url,
        environment: input.environment,
        // `enabled` is the only non-Cloud-native field — the cloud
        // stores it as "true"/"false" because the schema field type is
        // String. Coerce before sending so the cloud gets a real value
        // (the schema marks it `requiredOn: 3`).
        enabled: input.enabled ? "true" : "false",
        ...(input.credentialId
          ? { credentialId: input.credentialId }
          : {}),
        ...(input.lastVerifiedAt
          ? { lastVerifiedAt: input.lastVerifiedAt }
          : {}),
        ...(input.lastStatus
          ? { lastStatus: input.lastStatus }
          : {}),
      });
      const itemId = extractInsertedItemId(created, "insertVerificationTarget");
      if (!itemId) {
        throw new Error(
          "Could not create verification target — no itemId in response.",
        );
      }
      const now = new Date().toISOString();
      const item = {
        ItemId: itemId,
        ...input,
        enabled: input.enabled ? "true" : "false",
        CreatedDate: now,
        LastUpdatedDate: now,
      };
      return toVerificationTarget(item as Parameters<typeof toVerificationTarget>[0]);
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: queryKeys.issueTrackerTargets(userId),
      });
    },
  });
}

// Delete one configured URL. The mutation returns void — TanStack fires
// the onSuccess cleanup anyway, and we invalidate the list so the row
// disappears from the panel.
export function useDeleteVerificationTarget(): UseMutationResult<
  void,
  Error,
  string
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async (id) => {
      await verificationTargetsCollection.delete(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: queryKeys.issueTrackerTargets(userId),
      });
    },
  });
}

// Partial update — callers pass only the fields they're changing. The hook
// echoes the unchanged required fields so the gateway accepts the partial
// PATCH (the cloud schema marks `applicationName`, `url`, `environment`,
// and `enabled` as `requiredOn: 3` — required on every update too, not
// just on insert). Status flips from the verification panel use the same
// hook with `{ lastStatus, lastVerifiedAt }`.
export function useUpdateVerificationTarget(): UseMutationResult<
  VerificationTarget,
  Error,
  { id: string; patch: Partial<VerificationTarget> }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async ({ id, patch }) => {
      // The VerificationTarget schema marks applicationName, url,
      // environment, and enabled as `requiredOn: 3`, so every PATCH must
      // include them or the gateway rejects with VALIDATION_ERROR. Read
      // the row first and echo the stored values back, then let `patch`
      // override them — same pattern `useUpdateIssueStatus` uses. The
      // optional fields (credentialId / lastVerifiedAt / lastStatus) go
      // straight from the patch, falling back to "" so a clear value
      // doesn't accidentally keep a stale string in the cloud.
      const rawExisting = await verificationTargetsCollection.get(id);
      const existing = unwrapPaged<{
        ItemId: string;
        applicationName: string;
        url: string;
        environment: string;
        enabled: string;
        credentialId?: string;
        lastVerifiedAt?: string;
        lastStatus?: string;
      }>(rawExisting).items[0];
      const update: Record<string, unknown> = {
        applicationName: patch.applicationName ?? existing?.applicationName ?? "",
        url: patch.url ?? existing?.url ?? "",
        environment: patch.environment ?? existing?.environment ?? "production",
        enabled:
          typeof patch.enabled === "boolean"
            ? patch.enabled
              ? "true"
              : "false"
            : (existing?.enabled ?? "true"),
      };
      if (patch.credentialId !== undefined) {
        update.credentialId = patch.credentialId ?? "";
      }
      if (patch.lastVerifiedAt !== undefined) {
        update.lastVerifiedAt = patch.lastVerifiedAt ?? "";
      }
      if (patch.lastStatus !== undefined) {
        update.lastStatus = patch.lastStatus ?? "";
      }
      const updated = (await verificationTargetsCollection.update(
        id,
        update,
      )) as {
        data?: Parameters<typeof toVerificationTarget>[0];
      } | Parameters<typeof toVerificationTarget>[0];
      const raw =
        "data" in updated && updated.data
          ? updated.data
          : (updated as Parameters<typeof toVerificationTarget>[0]);
      return toVerificationTarget(raw);
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: queryKeys.issueTrackerTargets(userId),
      });
    },
  });
}

// Add a credential row. Password is masked client-side before it leaves
// the form — the cloud only ever stores the masked display string during
// the frontend phase (see spec section 12.3).
export function useCreateSecret(): UseMutationResult<
  Secret,
  Error,
  {
    name: string;
    email: string;
    passwordMasked: string;
    projectId: string;
    envSlug: string;
  }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async (input) => {
      const created = await secretsCollection.create({
        projectId: input.projectId,
        envSlug: input.envSlug,
        name: input.name,
        email: input.email,
        passwordMasked: input.passwordMasked,
      });
      const itemId = extractInsertedItemId(created, "insertSecret");
      if (!itemId) {
        throw new Error("Could not create secret — no itemId in response.");
      }
      const now = new Date().toISOString();
      const item = {
        ItemId: itemId,
        projectId: input.projectId,
        envSlug: input.envSlug,
        name: input.name,
        email: input.email,
        passwordMasked: input.passwordMasked,
        CreatedDate: now,
        LastUpdatedDate: now,
      };
      return toSecret(item as Parameters<typeof toSecret>[0]);
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: queryKeys.issueTrackerSecrets(userId),
      });
    },
  });
}

export function useDeleteSecret(): UseMutationResult<void, Error, string> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async (id) => {
      await secretsCollection.delete(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: queryKeys.issueTrackerSecrets(userId),
      });
    },
  });
}

// Edit the credential label + login email. The Secret schema marks
// `name`, `email`, and `passwordMasked` as `requiredOn: 3`, so every PATCH
// must echo all three back. The password is intentionally NOT editable
// from this hook — per spec section 12.3 the real password never reaches
// the cloud during the frontend phase, only the masked display string. If
// a credential's password needs to change, the user must delete the row
// and add a fresh one (same flow that exists today). We therefore read the
// existing row and echo `passwordMasked` back untouched, letting `name`
// and `email` be overridden by the patch.
export function useUpdateSecret(): UseMutationResult<
  Secret,
  Error,
  { id: string; patch: { name?: string; email?: string } }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async ({ id, patch }) => {
      const rawExisting = await secretsCollection.get(id);
      const existing = unwrapPaged<{
        ItemId: string;
        name: string;
        email: string;
        passwordMasked: string;
      }>(rawExisting).items[0];
      const updated = (await secretsCollection.update(id, {
        name: patch.name ?? existing?.name ?? "",
        email: patch.email ?? existing?.email ?? "",
        // Always echo the stored masked value back — never blank it out,
        // since we don't accept a new password from this codepath.
        passwordMasked: existing?.passwordMasked ?? "",
      })) as {
        data?: Parameters<typeof toSecret>[0];
      } | Parameters<typeof toSecret>[0];
      const raw =
        "data" in updated && updated.data
          ? updated.data
          : (updated as Parameters<typeof toSecret>[0]);
      return toSecret(raw);
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: queryKeys.issueTrackerSecrets(userId),
      });
    },
  });
}

// Issue insert + status updates. The status flip is the one hot path
// (the chip on every IssueCard), so it gets its own hook — combining it
// with the general-purpose create would force the IssueCard to thread
// the entire row through the mutation payload.
export function useCreateIssue(): UseMutationResult<
  Issue,
  Error,
  Omit<Issue, "id">
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async (input) => {
      const created = await issuesCollection.create({
        // Per-environment scoping — included on every persisted Issue.
        // Callers must stamp these from the active env context (the chat
        // + mock paths do so); a missing envSlug would be filtered out by
        // the scoped read, so the row would silently disappear.
        projectId: input.projectId,
        envSlug: input.envSlug,
        title: input.title,
        applicationName: input.applicationName,
        url: input.url,
        category: input.category,
        severity: input.severity,
        status: input.status,
        // Optional content fields — only forward defined values so a
        // legacy caller (or a synthetic issue from `driveMockRun`) doesn't
        // collide with the cloud's "missing required field" rule on
        // inserts that explicitly omit them.
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.expected !== undefined ? { expected: input.expected } : {}),
        ...(input.actual !== undefined ? { actual: input.actual } : {}),
        // JSON-encode the array fields before sending — the schema only
        // supports primitive String fields.
        reproductionStepsJson: input.reproductionSteps
          ? JSON.stringify(input.reproductionSteps)
          : "",
        evidenceJson: input.evidence
          ? JSON.stringify(input.evidence)
          : "",
        detectedAt: input.detectedAt,
        ...(input.verificationRunId !== undefined
          ? { verificationRunId: input.verificationRunId }
          : {}),
        // Fingerprint identity + recurrence stats — numeric values ride the
        // wire as strings (primitive-only schema). Same "only if defined"
        // spread as above so non-verification callers are unaffected.
        ...(input.fingerprint !== undefined
          ? { fingerprint: input.fingerprint }
          : {}),
        ...(input.occurrenceCount !== undefined
          ? { occurrenceCount: String(input.occurrenceCount) }
          : {}),
        ...(input.lastSeenAt !== undefined
          ? { lastSeenAt: input.lastSeenAt }
          : {}),
        seenInRunIdsJson: input.seenInRunIds
          ? JSON.stringify(input.seenInRunIds)
          : "",
      });
      const itemId = extractInsertedItemId(created, "insertIssue");
      if (!itemId) {
        throw new Error("Could not create issue — no itemId in response.");
      }
      const now = new Date().toISOString();
      const item = {
        ItemId: itemId,
        ...input,
        reproductionStepsJson: input.reproductionSteps
          ? JSON.stringify(input.reproductionSteps)
          : undefined,
        evidenceJson: input.evidence
          ? JSON.stringify(input.evidence)
          : undefined,
        // Same wire-shaping as above so the optimistic `toIssue` maps the
        // recurrence fields instead of dropping them.
        occurrenceCount:
          input.occurrenceCount !== undefined
            ? String(input.occurrenceCount)
            : undefined,
        seenInRunIdsJson: input.seenInRunIds
          ? JSON.stringify(input.seenInRunIds)
          : undefined,
        CreatedDate: now,
        LastUpdatedDate: now,
      };
      return toIssue(item as Parameters<typeof toIssue>[0]);
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: queryKeys.issueTrackerIssues(userId),
      });
    },
  });
}

export function useUpdateIssueStatus(): UseMutationResult<
  Issue,
  Error,
  { id: string; status: IssueStatus }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async ({ id, status }) => {
      // Echo required fields so the partial PATCH doesn't bounce on
      // "missing required field" — the Issue schema marks `title`,
      // `applicationName`, `url`, `category`, `severity`, `status`, and
      // `detectedAt` as `requiredOn: 3`. We read the row first to keep
      // the echo honest; without the read the cloud would reject the
      // call (the gateway echoes won't auto-fill from stored fields).
      const raw = await issuesCollection.get(id);
      const existing = unwrapPaged<{
        ItemId: string;
        title: string;
        applicationName: string;
        url: string;
        category: string;
        severity: string;
        detectedAt: string;
      }>(raw).items[0];
      const updated = (await issuesCollection.update(id, {
        title: existing?.title ?? "",
        applicationName: existing?.applicationName ?? "",
        url: existing?.url ?? "",
        category: existing?.category ?? "other",
        severity: existing?.severity ?? "low",
        detectedAt: existing?.detectedAt ?? new Date().toISOString(),
        status,
      })) as {
        data?: Parameters<typeof toIssue>[0];
      } | Parameters<typeof toIssue>[0];
      const data =
        "data" in updated && updated.data
          ? updated.data
          : (updated as Parameters<typeof toIssue>[0]);
      return toIssue(data);
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: queryKeys.issueTrackerIssues(userId),
      });
    },
  });
}

// Partial issue update for the dedup/merge path (occurrence bumps, severity
// escalations, reopen-on-regression). Follows the same read-echo contract as
// `useUpdateIssueStatus`: the cloud PATCH bounces without the requiredOn:3
// fields present, so we read the row first and echo whatever is stored.
export function useUpdateIssue(): UseMutationResult<
  Issue,
  Error,
  {
    id: string;
    patch: Partial<
      Pick<
        Issue,
        | "status"
        | "severity"
        | "fingerprint"
        | "occurrenceCount"
        | "lastSeenAt"
        | "seenInRunIds"
        | "assignedDeveloperIds"
        | "approvedById"
      >
    >;
  }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async ({ id, patch }) => {
      const raw = await issuesCollection.get(id);
      const existing = unwrapPaged<{
        ItemId: string;
        title: string;
        applicationName: string;
        url: string;
        category: string;
        severity: string;
        status: string;
        detectedAt: string;
        fingerprint?: string;
        occurrenceCount?: string;
        lastSeenAt?: string;
        seenInRunIdsJson?: string;
        assignedDeveloperIdsJson?: string;
        approvedById?: string;
      }>(raw).items[0];
      if (!existing) {
        throw new Error(`Could not update issue ${id} — row not found.`);
      }
      const updated = (await issuesCollection.update(id, {
        // Required-field echo — always the stored values, never the patch's.
        title: existing.title,
        applicationName: existing.applicationName,
        url: existing.url,
        category: existing.category,
        severity: patch.severity ?? existing.severity,
        status: patch.status ?? existing.status,
        detectedAt: existing.detectedAt,
        // Patchable fields — fall back to stored so an omitted key is a
        // no-op rather than a wipe.
        fingerprint: patch.fingerprint ?? existing.fingerprint ?? "",
        occurrenceCount: String(
          patch.occurrenceCount ??
            (existing.occurrenceCount ? Number(existing.occurrenceCount) : 1),
        ),
        lastSeenAt: patch.lastSeenAt ?? existing.lastSeenAt ?? "",
        seenInRunIdsJson: patch.seenInRunIds
          ? JSON.stringify(patch.seenInRunIds)
          : (existing.seenInRunIdsJson ?? ""),
        assignedDeveloperIdsJson: patch.assignedDeveloperIds
          ? JSON.stringify(patch.assignedDeveloperIds)
          : (existing.assignedDeveloperIdsJson ?? "[]"),
        approvedById: patch.approvedById ?? existing.approvedById ?? "",
      })) as {
        data?: Parameters<typeof toIssue>[0];
      } | Parameters<typeof toIssue>[0];
      const data =
        "data" in updated && updated.data
          ? updated.data
          : (updated as Parameters<typeof toIssue>[0]);
      return toIssue(data);
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: queryKeys.issueTrackerIssues(userId),
      });
    },
  });
}
// --- Profile pictures ---------------------------------------------------------
//
// The picture bytes live in Blocks Data Storage (files); the UserProfile
// collection only maps userId → fileId (see data.ts). Reads are workspace-
// wide so any member's avatar can render anywhere; writes are the signed-in
// user's OWN row only — an upsert found by filtering on `userId`.

export function useProfilePics(): UseQueryResult<Map<string, UserProfilePic>> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  return useQuery({
    queryKey: [...queryKeys.profilePics(userId)],
    enabled: Boolean(userId),
    // Fresh uploads by OTHER members should appear on shared surfaces (chat
    // roster, members grid) without a reload — a 30s poll mirrors the DM
    // pattern's intent at a calmer cadence.
    refetchInterval: 30_000,
    queryFn: async () => {
      const raw = await userProfilesCollection.list({
        pageNo: 1,
        pageSize: 200,
      });
      const rows = unwrapPaged<CloudUserProfile>(raw).items.map((row) =>
        toUserProfilePic(row),
      );
      const byUser = new Map<string, UserProfilePic>();
      for (const row of rows) {
        if (row.userId) byUser.set(row.userId, row);
      }
      return byUser;
    },
  });
}

// Resolve one storage file id to a provider-signed download URL. Cached
// per fileId and shared by every avatar that renders the same picture;
// staleTime keeps the presigned URL from being re-requested on every mount.
export function useFileDownloadUrl(
  fileId: string | null | undefined,
): UseQueryResult<string> {
  return useQuery({
    queryKey: queryKeys.fileDownloadUrl(fileId ?? ""),
    enabled: Boolean(fileId),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    queryFn: () => fetchFileDownloadUrl(fileId as string),
  });
}

export function useUploadProfilePic(): UseMutationResult<
  { fileId: string },
  Error,
  {
    file: File;
    /**
     * Optional metadata for AI-generated avatars. When provided, the
     * `UserProfile` row is stamped with `source: "ai"` and the chosen
     * `style` so downstream UI can branch on it. Defaults to `"original"`
     * for the plain upload flow (the file picker path).
     */
    aiMeta?: { source: "ai"; style: string };
  }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async ({ file, aiMeta }) => {
      if (!userId) {
        throw new Error("You must be signed in to upload a profile picture.");
      }
      if (!file.type.startsWith("image/")) {
        throw new Error("Profile pictures must be image files.");
      }
      // Names must be unique within a directory — stamp user + time so a
      // re-upload never collides with the previous picture.
      const ext = (file.name.split(".").pop() ?? "").toLowerCase() ||
        file.type.replace("image/", "") || "png";
      const fileName = `profile-${userId}-${Date.now()}.${ext}`;

      // Two-step cloud upload: presign (creates the file record), then PUT
      // the bytes to the provider-direct URL. A PUT failure leaves metadata
      // without bytes — surfaced as an error so the UI can say "try again".
      const presign = await presignUpload({
        fileName,
        contentType: file.type,
        tags: aiMeta ? "profile-pic-ai" : "profile-pic",
      });
      await uploadToPresignedUrl(presign.uploadUrl, file, file.type);

      // AI-stamped uploads used to persist `source` and `style` on the row
      // so the rest of the app (and any future re-render flows) knows
      // how the picture was produced. **Temporarily disabled** — the
      // deployed `UserProfile` schema doesn't include those fields yet,
      // so sending them in the upsert payload rejects the whole write
      // (`Field 'source' does not exist on type 'UserProfile'`) and
      // blocks the upload entirely. Until the schema migration lands,
      // the file-level `tags: "profile-pic-ai"` marker is the only
      // signal that an upload was AI-generated; the read-side
      // `toUserProfilePic` adapter defaults missing fields to
      // `"original"` / `null` so the existing UI is unaffected.
      // const source = aiMeta ? "ai" : "original";
      // const style = aiMeta?.style ?? "";
      // (re-enable these once the UserProfile schema gains `source` /
      // `style` columns — the tags: "profile-pic-ai" marker above is the
      // only signal that survives in the meantime.)

      // Upsert the caller's OWN row: find by userId, update if present
      // (full patch — `userId` is requiredOn 3), create otherwise.
      const existingRaw = await userProfilesCollection.list({
        filter: { userId },
        pageNo: 1,
        pageSize: 1,
      });
      const existing = unwrapPaged<CloudUserProfile>(existingRaw).items[0];
      const baseFields = {
        userId,
        imageFileId: presign.fileId,
      };
      if (existing) {
        await userProfilesCollection.update(existing.ItemId, baseFields);
      } else {
        await userProfilesCollection.create(baseFields);
      }
      return { fileId: presign.fileId };
    },
    onSuccess: ({ fileId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.profilePics(userId) });
      // Prefill the URL cache so the new picture renders immediately.
      qc.prefetchQuery({
        queryKey: queryKeys.fileDownloadUrl(fileId),
        queryFn: () => fetchFileDownloadUrl(fileId),
      });
    },
  });
}

// Per-user AI gateway config read. Returns the caller's saved `UserAiConfig`
// row (gatewayUrl / model / token) or `null` when they haven't saved one —
// `null` is the signal to the chat call site to skip the override headers
// and let the proxy fall back to its `.env` defaults. Same filter-by-userId
// pattern as `useProfilePics`; one row per user by convention.
export function useUserAiConfig(): UseQueryResult<UserAiConfig | null> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  return useQuery({
    queryKey: queryKeys.userAiConfig(userId),
    enabled: Boolean(userId),
    // Settings-page config rarely changes; keep it warm across navigations
    // so a fresh chat session doesn't trigger an extra Blocks round-trip.
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const raw = await userAiConfigsCollection.list({
        filter: { userId },
        pageNo: 1,
        pageSize: 1,
      });
      const row = unwrapPaged<CloudUserAiConfig>(raw).items[0];
      return row ? toUserAiConfig(row) : null;
    },
  });
}

// Upsert the caller's AI gateway config. Find the existing row by `userId`
// (the filter the read leg also uses), update if present, create otherwise.
// `userId` rides along on the update payload because the schema declares it
// `requiredOn: "Both"`. On success we invalidate the read key so the next
// chat call site picks up the new values from the cache.
//
// `provider` is now part of the payload so the user can pick Anthropic vs
// OpenAI from the Settings page; older rows without it default to
// "anthropic" via `toUserAiConfig`.
export function useSaveUserAiConfig(): UseMutationResult<
  UserAiConfig,
  Error,
  { provider: ChatProviderId; gatewayUrl: string; model: string; token: string }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async (input) => {
      if (!userId) {
        throw new Error("You must be signed in to save your AI config.");
      }
      const listRaw = await userAiConfigsCollection.list({
        filter: { userId },
        pageNo: 1,
        pageSize: 1,
      });
      const existing = unwrapPaged<CloudUserAiConfig>(listRaw).items[0];
      const baseFields = {
        userId,
        provider: input.provider,
        gatewayUrl: input.gatewayUrl,
        model: input.model,
        token: input.token,
      };
      if (existing) {
        await userAiConfigsCollection.update(existing.ItemId, baseFields);
      } else {
        await userAiConfigsCollection.create(baseFields);
      }
      return toUserAiConfig({
        ...baseFields,
        ItemId: existing?.ItemId ?? "",
        CreatedDate: existing?.CreatedDate ?? new Date().toISOString(),
        LastUpdatedDate: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.userAiConfig(userId) });
    },
  });
}

// Per-user Personal AI key for the AI-generated profile picture flow.
// Mirrors `useUserAiConfig` exactly — one row per user, filtered by
// `currentUser.id`, treated as `null` when unset so the avatar button
// hides cleanly. Kept as a separate hook + cache key so a chat proxy
// settings change can never accidentally clear this row.
export function useUserAvatarConfig(): UseQueryResult<UserAvatarConfig | null> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  return useQuery({
    queryKey: queryKeys.userAvatarConfig(userId),
    enabled: Boolean(userId),
    // Cache warm across navigations — Settings loads it once, the avatar
    // probe in `AIAvatarButton` reads the same cached row.
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const raw = await userAvatarConfigsCollection.list({
        filter: { userId },
        pageNo: 1,
        pageSize: 1,
      });
      const row = unwrapPaged<CloudUserAvatarConfig>(raw).items[0];
      return row ? toUserAvatarConfig(row) : null;
    },
  });
}

// Upsert the caller's Personal AI key. Same shape as `useSaveUserAiConfig`
// — find by `userId`, update if present, create otherwise. Invalidates
// only the avatar config key on success so the chat proxy cache is
// untouched.
export function useSaveUserAvatarConfig(): UseMutationResult<
  UserAvatarConfig,
  Error,
  {
    provider: import("./data").AvatarProviderId;
    token: string;
    model: string;
  }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async (input) => {
      if (!userId) {
        throw new Error(
          "You must be signed in to save your personal AI key.",
        );
      }
      const listRaw = await userAvatarConfigsCollection.list({
        filter: { userId },
        pageNo: 1,
        pageSize: 1,
      });
      const existing = unwrapPaged<CloudUserAvatarConfig>(listRaw).items[0];
      const baseFields = {
        userId,
        provider: input.provider,
        token: input.token,
        model: input.model,
      };
      if (existing) {
        await userAvatarConfigsCollection.update(existing.ItemId, baseFields);
      } else {
        await userAvatarConfigsCollection.create(baseFields);
      }
      return toUserAvatarConfig({
        ...baseFields,
        ItemId: existing?.ItemId ?? "",
        CreatedDate: existing?.CreatedDate ?? new Date().toISOString(),
        LastUpdatedDate: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.userAvatarConfig(userId) });
    },
  });
}

// --- Per-(project, env) Secret bindings ------------------------------------
//
// Stores the canonical `secretId → targetId[]` map the
// VerificationTarget ruleGroup currently strips from cloud PATCHes (see
// memory `verification-target-credentialid-rulegroup-strip`). One row per
// (projectId, envSlug). The UI (SecretCard chip, TargetSelect dropdown,
// chat runModelTurn credential resolution) reads through this row; the
// stripped `credentialId` column on VerificationTarget is intentionally
// ignored so the localStorage mirror's one-source-of-truth rule holds.
//
// The active-env row also lives in this collection with the sentinel
// `projectId = "__active__" && envSlug = "__active__"` and the actual
// selected `(projectId, envSlug)` JSON-encoded in `bindingsJson`. That
// keeps the read+write helpers shared with the bindings and avoids a
// fifth schema. See `useActiveEnv` for the thin wrapper.
export interface SecretBindingScope {
  projectId: string;
  envSlug: string;
}

export function useSecretBindings(
  scope: SecretBindingScope | null,
): UseQueryResult<SecretBindings> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  return useQuery({
    queryKey: queryKeys.secretBindings(
      userId,
      scope?.projectId ?? "",
      scope?.envSlug ?? "",
    ),
    enabled: Boolean(userId && scope),
    // Bindings are small and rarely change; cache warm across navigations
    // so the dropdown doesn't re-fetch on every SecretCard open.
    staleTime: 5 * 60_000,
    // The `blx_SecretBindings` schema is part of the deployment-gap set
    // documented in `.env` (4 of 21 collections not yet pushed to the
    // gateway). When the schema is missing the gateway returns HTTP 400,
    // which would otherwise be retried 3× by TanStack Query's default
    // retry policy AND logged to console.error on every mount. We already
    // keep the localStorage mirror in `issueTrackerBindings.ts` as the
    // source of truth — `useIssueTracker` reads it directly — so swallowing
    // the cloud read and returning the empty row is the right behaviour:
    // the consumer falls back to the mirror, the app keeps working, and
    // the console stays clean. Logged as a warning so the missing-schema
    // case is still debuggable when the rules.json deployment lands.
    retry: false,
    queryFn: async () => {
      if (!scope) {
        return {
          id: "",
          projectId: "",
          envSlug: "",
          bindings: {},
          updatedBy: null,
        };
      }
      try {
        const raw = await secretBindingsCollection.list({
          filter: { projectId: scope.projectId, envSlug: scope.envSlug },
          pageNo: 1,
          pageSize: 1,
        });
        const row = unwrapPaged<CloudSecretBinding>(raw).items[0];
        if (!row) {
          return {
            id: "",
            projectId: scope.projectId,
            envSlug: scope.envSlug,
            bindings: {},
            updatedBy: null,
          };
        }
        return toSecretBinding(row);
      } catch (err) {
        // See the `retry: false` comment above for context — the
        // consumer reads the localStorage mirror in `issueTrackerBindings.ts`
        // and treats the empty row as "no cloud data yet, use mirror".
        if (typeof console !== "undefined") {
          console.warn(
            "[useSecretBindings] cloud read failed; falling back to localStorage mirror",
            { scope: `${scope.projectId}/${scope.envSlug}`, err },
          );
        }
        return {
          id: "",
          projectId: scope.projectId,
          envSlug: scope.envSlug,
          bindings: {},
          updatedBy: null,
        };
      }
    },
  });
}

export interface SaveSecretBindingsInput {
  scope: SecretBindingScope;
  bindings: Record<string, string[]>;
  updatedBy?: string;
}

export function useSaveSecretBindings(): UseMutationResult<
  SecretBindings,
  Error,
  SaveSecretBindingsInput
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async (input) => {
      if (!userId) {
        throw new Error("You must be signed in to save secret bindings.");
      }
      const listRaw = await secretBindingsCollection.list({
        filter: {
          projectId: input.scope.projectId,
          envSlug: input.scope.envSlug,
        },
        pageNo: 1,
        pageSize: 1,
      });
      const existing = unwrapPaged<CloudSecretBinding>(listRaw).items[0];
      const baseFields = {
        projectId: input.scope.projectId,
        envSlug: input.scope.envSlug,
        bindingsJson: JSON.stringify(input.bindings),
        updatedBy: input.updatedBy ?? userId,
      };
      if (existing) {
        await secretBindingsCollection.update(existing.ItemId, baseFields);
      } else {
        await secretBindingsCollection.create(baseFields);
      }
      return {
        id: existing?.ItemId ?? "",
        projectId: input.scope.projectId,
        envSlug: input.scope.envSlug,
        bindings: input.bindings,
        updatedBy: input.updatedBy ?? userId,
      };
    },
    onSuccess: (row) => {
      qc.invalidateQueries({
        queryKey: queryKeys.secretBindings(
          userId,
          row.projectId,
          row.envSlug,
        ),
      });
    },
  });
}

// --- Per-user preference row ------------------------------------------------
//
// One row per user (upsert by userId), holding the Issue Tracker
// scope/device, the last-active chat session id, custom verification
// scopes, the GitHub repo-browser current path, and the MCP /api/secrets
// id for the GitHub PAT. Mirrors `useUserAiConfig` — different cache
// key so a chat proxy change never flushes the preferences and vice
// versa.
export function useUserPreference(): UseQueryResult<UserPreference> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  return useQuery({
    queryKey: queryKeys.userPreference(userId),
    enabled: Boolean(userId),
    // Preferences rarely change; keep warm across navigations.
    staleTime: 5 * 60_000,
    // `blx_UserPreferences` is part of the deployment-gap set documented
    // in `.env`. When the schema is missing the gateway returns HTTP 400.
    // Each consumer (`useCustomVerificationChecks`, `RepoBrowserPage`,
    // `useIssueTracker`) already seeds its own localStorage mirror
    // (`lattice.verification-checks.v1`, repo-browser path mirror, GitHub
    // PAT mirror, etc.) and only promotes the cloud value once
    // `prefQuery.data` resolves — so a missing-schema error simply means
    // the mirror keeps being the source of truth, which is the desired
    // behaviour. Same retry-off / warn-once policy as
    // `useSecretBindings`.
    retry: false,
    queryFn: async () => {
      const empty = {
        id: "",
        userId,
        scope: "",
        device: "",
        activeSession: "",
        customChecks: [],
        repoBrowserPath: "",
        githubCredentialId: "",
      };
      try {
        const raw = await userPreferencesCollection.list({
          filter: { userId },
          pageNo: 1,
          pageSize: 1,
        });
        const row = unwrapPaged<CloudUserPreference>(raw).items[0];
        if (!row) return empty;
        return toUserPreference(row);
      } catch (err) {
        if (typeof console !== "undefined") {
          console.warn(
            "[useUserPreference] cloud read failed; consumers will use their localStorage mirror",
            { userId, err },
          );
        }
        return empty;
      }
    },
  });
}

export function useSaveUserPreference(): UseMutationResult<
  UserPreference,
  Error,
  Partial<Omit<UserPreference, "id" | "userId">>
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async (input) => {
      if (!userId) {
        throw new Error("You must be signed in to save your preferences.");
      }
      const listRaw = await userPreferencesCollection.list({
        filter: { userId },
        pageNo: 1,
        pageSize: 1,
      });
      const existing = unwrapPaged<CloudUserPreference>(listRaw).items[0];
      // Merge on top of the existing row so callers can patch a single
      // field without echoing every other column.
      const current = existing
        ? toUserPreference(existing)
        : {
            id: "",
            userId,
            scope: "",
            device: "",
            activeSession: "",
            customChecks: [],
            repoBrowserPath: "",
            githubCredentialId: "",
          };
      const next = { ...current, ...input };
      const baseFields = {
        userId,
        scope: next.scope,
        device: next.device,
        activeSession: next.activeSession,
        customChecksJson: JSON.stringify(next.customChecks),
        repoBrowserPath: next.repoBrowserPath,
        githubCredentialId: next.githubCredentialId,
      };
      if (existing) {
        await userPreferencesCollection.update(existing.ItemId, baseFields);
      } else {
        await userPreferencesCollection.create(baseFields);
      }
      return { ...next, id: existing?.ItemId ?? "" };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.userPreference(userId) });
    },
  });
}

// --- Per-user hidden-announcement inbox ------------------------------------
//
// Many-rows-per-user inbox pattern (one row per `(userId,
// announcementId)`). The AnnouncementsPanel reads the set so it can hide
// dismissed cards; the hide/unhide mutations create/delete the matching
// row. `userId` and `announcementId` both ride on PATCH because the
// schema declares them `requiredOn: "Both"`.
export function useHiddenAnnouncements(): UseQueryResult<Set<string>> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  return useQuery({
    queryKey: queryKeys.hiddenAnnouncements(userId),
    enabled: Boolean(userId),
    // Inbox rarely changes; keep warm across navigations.
    staleTime: 5 * 60_000,
    // `blx_HiddenAnnouncements` is part of the deployment-gap set
    // documented in `.env`. The single consumer (`useHiddenAnnouncementIds`
    // in `hiddenAnnouncements.ts`) already keeps a per-user localStorage
    // mirror under `lattice.mirror.hiddenAnnouncements.v1:<userId>` and
    // renders from it while `cloud.data` is `undefined`. Returning an
    // empty `Set` on cloud failure means "no cloud state known, use the
    // mirror" — the panel still hides the announcements the user has
    // hidden before, and a new hide/unhide write won't persist until the
    // schema is deployed. Same retry-off policy as the other
    // deployment-gap hooks.
    retry: false,
    queryFn: async () => {
      try {
        const raw = await hiddenAnnouncementsCollection.list({
          filter: { userId },
          pageNo: 1,
          pageSize: 200,
          sort: { CreatedDate: -1 },
        });
        const ids = unwrapPaged<CloudHiddenAnnouncement>(raw).items.map(
          (r) => r.announcementId,
        );
        return new Set(ids);
      } catch (err) {
        if (typeof console !== "undefined") {
          console.warn(
            "[useHiddenAnnouncements] cloud read failed; panel will use localStorage mirror",
            { userId, err },
          );
        }
        return new Set<string>();
      }
    },
  });
}

export function useHideAnnouncementMutation(): UseMutationResult<
  void,
  Error,
  { announcementId: string }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async ({ announcementId }) => {
      if (!userId) {
        throw new Error("You must be signed in to hide an announcement.");
      }
      await hiddenAnnouncementsCollection.create({
        userId,
        announcementId,
        hiddenAt: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.hiddenAnnouncements(userId) });
    },
  });
}

export function useUnhideAnnouncementMutation(): UseMutationResult<
  void,
  Error,
  { announcementId: string }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async ({ announcementId }) => {
      if (!userId) {
        throw new Error("You must be signed in to restore an announcement.");
      }
      const raw = await hiddenAnnouncementsCollection.list({
        filter: { userId, announcementId },
        pageNo: 1,
        pageSize: 1,
      });
      const existing = unwrapPaged<CloudHiddenAnnouncement>(raw).items[0];
      if (existing) {
        await hiddenAnnouncementsCollection.delete(existing.ItemId);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.hiddenAnnouncements(userId) });
    },
  });
}

// --- Per-(user, padType) notepad row ----------------------------------------
//
// One row per (userId, padType) where padType is `"text" | "excel"`. The
// full pad array rides as a JSON-encoded blob in `rowsJson` — same
// `*Json` primitive-string convention as MemberProject.projectIdsJson.
// Both `userId` and `padType` are `requiredOn: "Both"` so they ride on
// every PATCH.
export type NotepadPadType = "text" | "excel";

export function useUserNote(
  padType: NotepadPadType,
): UseQueryResult<UserNoteRow> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  return useQuery({
    queryKey: queryKeys.userNote(userId, padType),
    enabled: Boolean(userId),
    // Notepad rarely changes; keep warm across navigations.
    staleTime: 5 * 60_000,
    // `blx_UserNotes` is part of the deployment-gap set documented in
    // `.env`. The notepad pages (`/notepad/text`, `/notepad/excel`) read
    // AND write synchronously through `loadTextPads` / `saveTextPads` /
    // `loadExcelPads` / `saveExcelPads` in `src/lib/notepad/storage.ts`
    // against the `lattice.mirror.notepad.{text,excel}.v1` localStorage
    // keys. The cloud hook only seeds the mirror once and pushes writes
    // back via `useNotepadSync` — when the cloud read fails we return the
    // empty row and the mirror keeps being the source of truth. Same
    // retry-off / warn-once policy as the other deployment-gap hooks.
    retry: false,
    queryFn: async () => {
      const empty = { id: "", userId, padType, rows: [], updatedAt: "" };
      try {
        const raw = await userNotesCollection.list({
          filter: { userId, padType },
          pageNo: 1,
          pageSize: 1,
        });
        const row = unwrapPaged<CloudUserNote>(raw).items[0];
        if (!row) return empty;
        return toUserNote(row);
      } catch (err) {
        if (typeof console !== "undefined") {
          console.warn(
            "[useUserNote] cloud read failed; notepad will use localStorage mirror",
            { userId, padType, err },
          );
        }
        return empty;
      }
    },
  });
}

export interface SaveUserNoteInput {
  padType: NotepadPadType;
  rows: unknown[];
}

export function useSaveUserNote(): UseMutationResult<
  UserNoteRow,
  Error,
  SaveUserNoteInput
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async (input) => {
      if (!userId) {
        throw new Error("You must be signed in to save your notepad.");
      }
      const listRaw = await userNotesCollection.list({
        filter: { userId, padType: input.padType },
        pageNo: 1,
        pageSize: 1,
      });
      const existing = unwrapPaged<CloudUserNote>(listRaw).items[0];
      const updatedAt = new Date().toISOString();
      const baseFields = {
        userId,
        padType: input.padType,
        rowsJson: JSON.stringify(input.rows),
        updatedAt,
      };
      if (existing) {
        await userNotesCollection.update(existing.ItemId, baseFields);
      } else {
        await userNotesCollection.create(baseFields);
      }
      return {
        id: existing?.ItemId ?? "",
        userId,
        padType: input.padType,
        rows: input.rows,
        updatedAt,
      };
    },
    onSuccess: (row) => {
      qc.invalidateQueries({
        queryKey: queryKeys.userNote(userId, row.padType),
      });
    },
  });
}

// --- Active env (per-user, lives on the SecretBinding collection) ---------
//
// The active env is per-user, NOT env-scoped. Rather than ship a fifth
// schema, it rides in `SecretBinding` with the sentinel
// `projectId = "__active__" && envSlug = "__active__"`. The actual
// selected `(projectId, envSlug)` is JSON-encoded in `bindingsJson` — the
// same JSON-map shape `useSecretBindings` parses today, so `toSecretBinding`
// does all the heavy lifting.
//
// The sentinel values are reserved names — no real project uses them —
// so the row never collides with a real env-scoped binding row.
//
// NOTE: the legacy `useActiveEnv()` from `ActiveEnvContext` reads
// through this hook (it backs the provider's state). Do not rename or
// remove without updating `ActiveEnvContext`.
const ACTIVE_ENV_PROJECT_ID = "__active__";
const ACTIVE_ENV_ENV_SLUG = "__active__";

export interface ActiveEnvSelection {
  projectId: string;
  envSlug: string;
}

export function useActiveEnvSelection(): UseQueryResult<ActiveEnvSelection | null> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  return useQuery({
    queryKey: queryKeys.secretBindings(
      userId,
      ACTIVE_ENV_PROJECT_ID,
      ACTIVE_ENV_ENV_SLUG,
    ),
    enabled: Boolean(userId),
    // Active env rarely changes; keep warm across navigations.
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const raw = await secretBindingsCollection.list({
        filter: {
          projectId: ACTIVE_ENV_PROJECT_ID,
          envSlug: ACTIVE_ENV_ENV_SLUG,
        },
        pageNo: 1,
        pageSize: 1,
      });
      const row = unwrapPaged<CloudSecretBinding>(raw).items[0];
      if (!row) return null;
      const parsed = toSecretBinding(row);
      // The "active" row stores the env in `bindingsJson` as
      // `{ "<key>": ["<projectId>::<envSlug>"] }`. Treat any of the
      // listed values as the canonical selection; fall back to null if
      // the row is malformed.
      const entries = Object.values(parsed.bindings).flat();
      const first = entries.find((v) => v.includes("::"));
      if (!first) return null;
      const [projectId, envSlug] = first.split("::");
      if (!projectId || !envSlug) return null;
      return { projectId, envSlug };
    },
  });
}

export function useSaveActiveEnvSelection(): UseMutationResult<
  ActiveEnvSelection | null,
  Error,
  ActiveEnvSelection | null
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async (input) => {
      if (!userId) {
        throw new Error("You must be signed in to change your active env.");
      }
      const listRaw = await secretBindingsCollection.list({
        filter: {
          projectId: ACTIVE_ENV_PROJECT_ID,
          envSlug: ACTIVE_ENV_ENV_SLUG,
        },
        pageNo: 1,
        pageSize: 1,
      });
      const existing = unwrapPaged<CloudSecretBinding>(listRaw).items[0];
      // Pass `null` to clear the active env (delete the row).
      if (!input) {
        if (existing) {
          await secretBindingsCollection.delete(existing.ItemId);
        }
        return null;
      }
      const baseFields = {
        projectId: ACTIVE_ENV_PROJECT_ID,
        envSlug: ACTIVE_ENV_ENV_SLUG,
        bindingsJson: JSON.stringify({
          active: [`${input.projectId}::${input.envSlug}`],
        }),
        updatedBy: userId,
      };
      if (existing) {
        await secretBindingsCollection.update(existing.ItemId, baseFields);
      } else {
        await secretBindingsCollection.create(baseFields);
      }
      return input;
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: queryKeys.secretBindings(
          userId,
          ACTIVE_ENV_PROJECT_ID,
          ACTIVE_ENV_ENV_SLUG,
        ),
      });
    },
  });
}

// --- Notepad cloud sync ----------------------------------------------------
//
// Thin wrapper that pages call once on mount to seed the cloud row into
// the localStorage mirror (read), then push subsequent writes back. The
// notepad pages still call the synchronous `loadTextPads` /
// `saveTextPads` / `loadExcelPads` / `saveExcelPads` helpers in
// `src/lib/notepad/storage.ts` — those read+write the mirror
// synchronously so first paint matches the last-known state. This hook
// is what wires that mirror to the cloud.
//
// Usage:
//   const { save } = useNotepadSync<TextPad>("text");
//   // On mount: cloud row seeds mirror; user edits write to mirror +
//   // fire-and-forget save.
//   save(pads); // also pushes to cloud

export interface NotepadSyncApi<T> {
  /** Push the current pad array to the cloud. Fire-and-forget. */
  save: (pads: T[]) => void;
}

export function useNotepadSync<T>(
  padType: NotepadPadType,
): NotepadSyncApi<T> {
  const prefQuery = useUserNote(padType);
  const savePref = useSaveUserNote();
  // Seed the localStorage mirror from the cloud row once it resolves,
  // and fire-and-forget every save. Pages still drive the in-memory
  // state via the synchronous load/save helpers in `storage.ts`.
  useEffect(() => {
    if (!prefQuery.data) return;
    const key =
      padType === "text"
        ? "lattice.mirror.notepad.text.v1"
        : "lattice.mirror.notepad.excel.v1";
    try {
      window.localStorage.setItem(
        key,
        JSON.stringify(prefQuery.data.rows),
      );
    } catch {
      // best-effort
    }
  }, [prefQuery.data, padType]);

  const save = useCallback(
    (pads: T[]) => {
      void savePref.mutateAsync({
        padType,
        rows: pads as unknown[],
      });
    },
    [padType, savePref],
  );

  return { save };
}

// --- Per-user GitHub credential --------------------------------------------
//
// The PAT itself lives only on the MCP server (`/api/secrets` route —
// the same AES-256-GCM-at-rest path `addSecret` uses for Secret
// passwords). The MCP id is stamped on `UserPreference.githubCredentialId`
// so the read path can ask for it back. Net result: the plaintext PAT
// never lands in localStorage or in Blocks Data — only the MCP
// reference id does.
//
// If the MCP server is unreachable, the hook falls back to a
// localStorage mirror under `lattice.mirror.github-token.v1` so the next
// refresh still has the token to retry the sync.
const GITHUB_TOKEN_MIRROR_KEY = "lattice.mirror.github-token.v1";
const GITHUB_CREDENTIAL_NAME = "github-pat";

function readGithubMirror(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(GITHUB_TOKEN_MIRROR_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeGithubMirror(token: string): void {
  if (typeof window === "undefined") return;
  try {
    if (token) {
      window.localStorage.setItem(GITHUB_TOKEN_MIRROR_KEY, token);
    } else {
      window.localStorage.removeItem(GITHUB_TOKEN_MIRROR_KEY);
    }
  } catch {
    // best-effort
  }
}

interface McpSecretEcho {
  id: string;
  name: string;
  email?: string;
  hasPassword?: boolean;
  passwordMasked?: string;
  passwordLength?: number;
  createdAt?: string;
  updatedAt?: string;
}

async function mcpListSecrets(): Promise<McpSecretEcho[]> {
  try {
    const res = await fetch("/api/secrets", { credentials: "include" });
    if (!res.ok) return [];
    const data = (await res.json()) as { secrets?: McpSecretEcho[] };
    return Array.isArray(data.secrets) ? data.secrets : [];
  } catch {
    return [];
  }
}

async function mcpUpsertSecret(
  payload: { id?: string; name: string; email: string; password: string },
): Promise<McpSecretEcho | null> {
  try {
    const res = await fetch("/api/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { secret?: McpSecretEcho };
    return data.secret ?? null;
  } catch {
    return null;
  }
}

async function mcpDeleteSecret(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/secrets/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "include",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface UserGitHubCredential {
  /** MCP echo — present iff the user has saved a PAT. The plaintext
   *  never rides back to the browser; `masked` is a "•••" string. */
  hasToken: boolean;
  /** Masked echo (for display); empty when none. */
  masked: string;
  /** MCP id; empty when none. */
  credentialId: string;
  /** Save the PAT — round-trips through MCP and updates
   *  `UserPreference.githubCredentialId`. */
  setToken: (token: string) => Promise<void>;
  /** Delete the MCP secret + clear `UserPreference.githubCredentialId`. */
  clear: () => Promise<void>;
  /** True while a save/clear is in flight. */
  busy: boolean;
}

export function useUserGitHubCredential(): UserGitHubCredential {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  const pref = useUserPreference();
  const savePref = useSaveUserPreference();
  const [busy, setBusy] = useState(false);

  const credentialId = pref.data?.githubCredentialId ?? "";
  const [masked, setMasked] = useState("");
  const [hasToken, setHasToken] = useState(false);

  // Read MCP echo when credentialId changes. Best-effort — the MCP
  // server may be down; in that case we fall back to the localStorage
  // mirror so the UI still shows the token is "set".
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!credentialId) {
        setMasked("");
        setHasToken(false);
        return;
      }
      const secrets = await mcpListSecrets();
      if (cancelled) return;
      const hit = secrets.find((s) => s.id === credentialId);
      if (hit) {
        setMasked(hit.passwordMasked ?? "");
        setHasToken(true);
      } else if (readGithubMirror()) {
        // MCP is down / row missing — fall back to mirror.
        setMasked("•••");
        setHasToken(true);
      } else {
        setMasked("");
        setHasToken(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [credentialId, userId]);

  const setToken = useCallback(
    async (token: string) => {
      if (!userId) throw new Error("You must be signed in to save a PAT.");
      setBusy(true);
      try {
        const echoed = await mcpUpsertSecret({
          id: credentialId || undefined,
          name: GITHUB_CREDENTIAL_NAME,
          email: GITHUB_CREDENTIAL_NAME,
          password: token,
        });
        const id = echoed?.id || credentialId;
        if (!id) {
          throw new Error("MCP server did not return a credential id.");
        }
        await savePref.mutateAsync({ githubCredentialId: id });
        writeGithubMirror(token);
      } finally {
        setBusy(false);
      }
    },
    [credentialId, savePref, userId],
  );

  const clear = useCallback(async () => {
    if (!userId) throw new Error("You must be signed in to clear a PAT.");
    setBusy(true);
    try {
      if (credentialId) {
        await mcpDeleteSecret(credentialId);
      }
      await savePref.mutateAsync({ githubCredentialId: "" });
      writeGithubMirror("");
    } finally {
      setBusy(false);
    }
  }, [credentialId, savePref, userId]);

  return { hasToken, masked, credentialId, setToken, clear, busy };
}

// Upload an AI-generated avatar blob (from the preview modal) to Blocks
// Storage and stamp the row with `source: "ai"` + the chosen style. The
// caller passes the data URL the proxy returned; we convert it to a Blob
// and reuse the existing presign+PUT pipeline via `useUploadProfilePic`.
// Kept separate from `useUploadProfilePic` so the file-picker flow stays
// a single, simple `File`-typed input — the AI blob path needs a MIME
// type and filename derived from the data URL header rather than a real
// File's metadata.
export function useUploadAiAvatar(): UseMutationResult<
  { fileId: string },
  Error,
  {
    dataUrl: string;
    style: string;
  }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const upload = useUploadProfilePic();
  const userId = currentUser?.id ?? "";
  return useMutation({
    // Delegate the storage write to `useUploadProfilePic` so the
    // presign+PUT+upsert contract lives in exactly one place.
    mutationFn: async ({ dataUrl, style }) => {
      // Parse `data:<mime>;base64,<payload>` into a real Blob the
      // mutation can upload. Mime defaults to png because Replicate
      // usually returns PNG even when the upstream model advertises
      // JPEG — matches the chat attachment path's tolerance.
      const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
      const mime = match?.[1] || "image/png";
      const b64 = match?.[2] || "";
      if (!b64) {
        throw new Error("Avatar data URL was empty.");
      }
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: mime });
      const ext = mime.split("/")[1] || "png";
      // Wrap the Blob in a File so `useUploadProfilePic`'s type check
      // (`file.type.startsWith("image/")`) accepts it. The File name is
      // stamped with user + time by the hook, but the explicit name here
      // keeps the storage record consistent with the chat-attachment
      // naming pattern if anyone inspects it later.
      const file = new File([blob], `avatar.${ext}`, { type: mime });
      return upload.mutateAsync({
        file,
        aiMeta: { source: "ai", style },
      });
    },
    onSuccess: () => {
      // `useUploadProfilePic` already invalidates `profilePics` and
      // prefills the download URL — nothing to do here. Re-invalidate
      // for symmetry in case the inner mutation ever changes shape.
      qc.invalidateQueries({ queryKey: queryKeys.profilePics(userId) });
    },
  });
}
