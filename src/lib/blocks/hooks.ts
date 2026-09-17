// TanStack Query bindings on top of the Blocks data collections. Consumers
// call these hooks; the hooks own the cache and the network call. Mutations
// invalidate the relevant query keys so lists/detail views refresh in place.
//
// All reads are scoped to the signed-in user via the platform-managed
// `CreatedBy` field; all writes are auto-attributed by IAM from the OIDC
// session, so callers never have to pass `userId` themselves.

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import {
  createdByFilter,
  featuresCollection,
  flowsCollection,
  projectsCollection,
  chatMessagesCollection,
  toChatMessage,
  toFeature,
  toFlow,
  toProject,
  type CloudFeature,
  type CloudFlow,
  type CloudProject,
  type Feature,
  type Flow,
  type FlowStack,
  type FlowStatus,
  type FlowTestStatus,
  type PersistedChatMessage,
  type Project,
  type ProjectCustomEnv,
} from "./data";
import { notifyRole } from "./notifier";
import type { ChatSessionSummary } from "@/types/issue-tracker";

// Pull the newly-created ItemId out of an `insert<Schema>` mutation envelope.
//
// Wire shape: `{ data: { insert<Schema>: { acknowledged, itemId, message, totalImpactedData } } }`.
// (Lowercase `itemId` nested under `insert<Schema>` — distinct from the read-shape
// `ItemId` at the top of `get<Plural>` responses.) Returns `null` if the cloud
// didn't acknowledge the create; callers should treat that as a hard failure
// because subsequent calls (e.g. the flow insert in `useCloneFlow`) depend on
// having a real feature id to attach to.
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
// links set by `useCloneFlow` when it stamps a clone. The cascade hooks
// (`useUpdateFlow`, `useDeleteFlow`, `useUpdateFeature`, `useDeleteFeature`)
// look up siblings by these fields so deletes/renames in dev fan out to
// every env where the same flow/feature was cloned.
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

// Returns the set of `envSlug` values where this flow already has a
// sibling clone (records with `clonedFromFlowId === flowId`). Used by
// the EnvironmentChip to disable env options that would otherwise create
// a duplicate clone — the user can still pick a currently-uncloned env.
// TanStack Query keeps the result keyed per source flow + user, so
// toggling chips across rows doesn't refetch the same data repeatedly.
export function useClonedEnvs(flowId: string | undefined): UseQueryResult<Set<string>> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  return useQuery({
    queryKey: [...queryKeys.flows(userId, flowId ?? "_none"), "clonedEnvs"] as const,
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

// Sibling of `useClonedEnvs` for the feature level — returns the set
// of `envSlug` values where this feature already has a sibling feature
// (records with `clonedFromFeatureId === featureId`). Used by the
// feature row's read-only environment workflow diagram to mark each
// sibling env as "cloned" vs "available". Same shape + cache model as
// `useClonedEnvs` so consumers don't have to special-case the row.
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

async function findSiblingFeatures(
  sourceFeatureId: string,
  projectId: string,
  userId: string,
): Promise<{ id: string; envSlug?: string }[]> {
  const raw = await featuresCollection.list({
    filter: {
      ...createdByFilter(userId),
      projectId,
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
};

// --- Reads ------------------------------------------------------------------

export function useProjects(): UseQueryResult<Project[]> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  return useQuery({
    queryKey: queryKeys.projects(userId),
    enabled: Boolean(userId),
    queryFn: async () => {
      const raw = await projectsCollection.list({
        filter: createdByFilter(userId),
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
      // exist or the caller isn't allowed to see it.
      const paged = unwrapPaged<{ ItemId: string; CreatedBy?: string; name: string; CreatedDate: string; LastUpdatedDate: string }>(raw);
      const p = paged.items[0];
      if (!p) return null;
      // Guard against reading another user's record (the platform may
      // already enforce this through access policies; this is a UX layer).
      if (userId && p.CreatedBy && p.CreatedBy !== userId) return null;
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
        filter: {
          ...createdByFilter(userId),
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
        filter: { ...createdByFilter(userId), featureId },
        pageNo: 1,
        pageSize: 200,
        sort: { CreatedDate: -1 },
      });
      // Forward the parent feature's `projectId` so `toFlow` can populate
      // the UI `Flow.projectId`. The cloud Flow schema doesn't carry
      // `projectId` (it's a joinable via featureId), so the UI value was
      // "" before — which is fine for chips that only mutate by ItemId,
      // but breaks any cloud call that filters on projectId (notably
      // `useCloneFlow`'s destination-feature lookup and auto-create).
      // Pass `projectId` from the caller (FeatureItem has the feature
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
      // pageSize 1000 covers typical workspaces — same bound as
      // `useProjectFlows`. Going wider would mask genuine "the user's
      // recent N is not in the first 1000" bugs by silently truncating.
      const flowsRaw = await flowsCollection.list({
        filter: createdByFilter(userId),
        pageNo: 1,
        pageSize: 1000,
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
          filter: createdByFilter(userId),
          pageNo: 1,
          pageSize: 1000,
        }),
        flowsCollection.list({
          filter: createdByFilter(userId),
          pageNo: 1,
          pageSize: 1000,
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
function useAliveScope(userId: string): UseQueryResult<{
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
        filter: createdByFilter(userId),
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
        filter: createdByFilter(userId),
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
        filter: {
          ...createdByFilter(userId),
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
        filter: {
          ...createdByFilter(userId),
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

// --- Mutations --------------------------------------------------------------

export function useCreateProject(): UseMutationResult<
  Project,
  Error,
  { name: string; status?: string; description?: string; color?: string }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
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

      // Notify managers. Fire-and-forget — a notifier hiccup never blocks
      // a successful project create (the cache is already settled, the
      // user already navigated). `context` + `actionName` are the
      // subscription filter the manager's inbox can group by.
      void notifyRole("manager", {
        context: "project",
        actionName: "created",
        value: project.id,
        projectId: project.id,
        projectName: project.name,
        createdBy: userId,
      }).catch(() => {
        /* notifier failures are non-fatal — see hook doc */
      });
    },
    mutationFn: async (input) => {
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
  { projectId: string; name: string; envSlug?: string }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async (input) => {
      const created = await featuresCollection.create({
        title: input.name,
        projectId: input.projectId,
        status: "backlog",
        // envSlug is optional — on the env-less project page it's omitted
        // and the record is created without one (legacy-compatible shape).
        ...(input.envSlug ? { envSlug: input.envSlug } : {}),
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

      // Notify managers. `feature.id` (the server-issued id) is what the
      // inbox uses as the subscription-filter `value` so future reads
      // can pivot on it. Same fire-and-forget discipline as
      // `useCreateProject` — a notifier hiccup never blocks the create.
      void notifyRole("manager", {
        context: "feature",
        actionName: "created",
        value: feature.id,
        projectId: vars.projectId,
        featureName: vars.name,
        envSlug: vars.envSlug,
        createdBy: userId,
      }).catch(() => {
        /* notifier failures are non-fatal */
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
    onSuccess: (_flow, vars) => {
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
    },
  });
}

export function useDeleteProject(): UseMutationResult<void, Error, string> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async (projectId) => {
      await projectsCollection.delete(projectId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projects(userId) });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard(userId) });
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
  return useMutation({
    mutationFn: async ({ id, projectId, patch }) => {
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
    onSuccess: (_feature, vars) => {
      qc.invalidateQueries({ queryKey: ["features", userId, vars.projectId] });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard(userId) });
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
  return useMutation({
    mutationFn: async ({ id, projectId }) => {
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
    onSuccess: (_flow, vars) => {
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
  return useMutation({
    mutationFn: async ({ id, patch }) => {
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
    onSuccess: (project) => {
      qc.invalidateQueries({ queryKey: queryKeys.projects(userId) });
      qc.invalidateQueries({ queryKey: queryKeys.project(userId, project.id) });
    },
  });
}

/**
 * Clone a flow into a different environment on the same project.
 *
 * Triggered by the per-row Environment chip on [EnvironmentChip.tsx](src/components/flow/EnvironmentChip.tsx).
 * The chip carries the source `flow` and a `targetEnvSlug`; this hook
 * orchestrates three cloud calls in one mutationFn so the UI sees a single
 * pending → success transition:
 *
 *   1. Read the source feature to get its name (so we know what to look
 *      for — or create — in the destination env).
 *   2. Find-or-create a feature in the destination env with the same name.
 *      The destination feature is not auto-cloned (that would need a separate
 *      user decision); the source feature name is the lookup key.
 *   3. Insert a new flow under that feature, copying the content fields
 *      (`title`, `description`, `steps`) and resetting every chip value
 *      (`status: "draft"`, stack omitted so the placeholder renders).
 *
 * The destination feature is allowed to be auto-created because the
 * user's mental model — confirmed during planning — is "click an env to
 * make it visible there", not "find an existing feature or stop".
 *
 * Invalidations match `useCreateFlow` so the destination env's page picks
 * up the new flow without a manual refetch, and so the source env's row
 * counts stay accurate.
 */
export function useCloneFlow(): UseMutationResult<
  Flow,
  Error,
  { flow: Flow; targetEnvSlug: string }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async ({ flow, targetEnvSlug }) => {
      // 1. Source feature — needs its title for the destination lookup.
      const sourceRaw = await featuresCollection.get(flow.featureId);
      const sourceItems = unwrapPaged<{ ItemId: string; title: string }>(
        sourceRaw,
      ).items;
      const sourceFeature = sourceItems[0];
      if (!sourceFeature) {
        // The flow's parent feature has been deleted underneath it; the
        // gateway returns an empty page rather than 404. Refusing to clone
        // here is safer than hallucinating a new feature with no source
        // name to copy from.
        throw new Error(`Source feature ${flow.featureId} no longer exists.`);
      }
      const sourceFeatureName = sourceFeature.title;

      // 2. Destination feature — find or create.
      const destRaw = await featuresCollection.list({
        filter: {
          ...createdByFilter(userId),
          projectId: flow.projectId,
          envSlug: targetEnvSlug,
        },
        pageNo: 1,
        pageSize: 500,
      });
      const destItems = unwrapPaged<{ ItemId: string; title: string }>(
        destRaw,
      ).items;
      const foundDestId = destItems.find(
        (f) => f.title === sourceFeatureName,
      )?.ItemId;
      let destFeatureId: string;
      if (foundDestId) {
        destFeatureId = foundDestId;
      } else {
        // Stamp `clonedFromFeatureId` so the cross-env sync feature can
        // find this auto-created feature when the source dev feature is
        // later renamed or deleted. Pre-existing destination features
        // (those created before this feature shipped) are missing the
        // link and stay frozen — that's by design, per the user's
        // "no backfill" decision.
        const created = await featuresCollection.create({
          title: sourceFeatureName,
          projectId: flow.projectId,
          status: "backlog",
          envSlug: targetEnvSlug,
          clonedFromFeatureId: sourceFeature.ItemId,
        });
        const newId = extractInsertedItemId(created, "insertFeature");
        if (!newId) {
          throw new Error(
            "Could not create destination feature — no itemId in response.",
          );
        }
        destFeatureId = newId;
      }

      // 3. New flow — content forward, chip values reset, sibling link stamped.
      const createdFlowRaw = await flowsCollection.create({
        title: flow.name,
        featureId: destFeatureId,
        status: "draft",
        envSlug: targetEnvSlug,
        // `clonedFromFlowId` is the sibling link that makes the
        // cross-env sync cascade work — without it, dev deletes and
        // renames can't find this clone. Every clone made via this hook
        // gets the link; pre-existing clones (made before this feature
        // shipped) won't have it and won't participate in cascade.
        clonedFromFlowId: flow.id,
        // Stack is intentionally absent from the payload — leaving it off
        // produces a record whose `stack` field is undefined, which the
        // StackChip renders as the neutral "Stack" placeholder. Matches
        // the user's "every chip's value resets" requirement.
        ...(flow.description !== undefined
          ? { description: flow.description }
          : {}),
        ...(flow.steps && flow.steps.length > 0
          ? { steps: flow.steps }
          : {}),
      });
      const newFlowItemId = extractInsertedItemId(createdFlowRaw, "insertFlow");
      if (!newFlowItemId) {
        throw new Error("Could not create flow — no itemId in response.");
      }
      // The insert response only carries `itemId` + ack metadata; assemble
      // a CloudFlow-shaped record from what we already know so `toFlow`
      // produces a complete Flow (the toFlow adapter expects the read-
      // shape field names — `ItemId`, `CreatedDate`, etc.).
      const now = new Date().toISOString();
      const flowRecord: CloudFlow = {
        ItemId: newFlowItemId,
        title: flow.name,
        featureId: destFeatureId,
        status: "draft",
        envSlug: targetEnvSlug,
        // Optional content fields — forward only when present so legacy
        // (pre-description) flows stay pre-description.
        description: flow.description,
        steps: flow.steps,
        clonedFromFlowId: flow.id,
        CreatedDate: now,
        LastUpdatedDate: now,
      };
      return toFlow(flowRecord, flow.projectId);
    },
    onSuccess: (_flow, vars) => {
      // Refresh every cached view of this project's features and flows so
      // the destination env's page reflects the new flow/feature and the
      // source env's row counts remain accurate.
      qc.invalidateQueries({
        queryKey: ["features", userId, vars.flow.projectId],
      });
      // Re-fetch the source flow's "cloned envs" set so the chip on the
      // row immediately disables the env we just cloned to. Without
      // this, `useClonedEnvs` would keep the previous answer cached and
      // the user could spam-clone by clicking the same env twice.
      qc.invalidateQueries({
        queryKey: [
          ...queryKeys.flows(userId, vars.flow.id),
          "clonedEnvs",
        ],
      });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard(userId) });
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
  return useMutation({
    mutationFn: async ({ projectId, env }) => {
      const cacheKey = queryKeys.project(userId, projectId);
      const cached = qc.getQueryData<Project>(cacheKey);
      const existing = cached?.customEnvs ?? [];
      const next: ProjectCustomEnv[] = [...existing, env];
      return updateProject.mutateAsync({
        id: projectId,
        patch: { customEnvs: next },
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
  return useMutation({
    mutationFn: async (input) => {
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