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
  toFeature,
  toFlow,
  toProject,
  type Feature,
  type Flow,
  type Project,
} from "./data";

// Collection responses come back either as `{ data: { items, totalCount } }`
// or directly as `{ items, totalCount }` depending on the endpoint shape.
// Normalise to a flat `{ items, totalCount }`.
function unwrapPaged<T>(raw: unknown): { items: T[]; totalCount: number } {
  const r = raw as
    | { data?: { items?: T[]; totalCount?: number } }
    | { items?: T[]; totalCount?: number }
    | undefined;
  const paged = r && "data" in r ? r.data : (r as { items?: T[]; totalCount?: number } | undefined);
  return {
    items: paged?.items ?? [],
    totalCount: paged?.totalCount ?? 0,
  };
}

// --- Query keys -------------------------------------------------------------
//
// Centralised so invalidations stay consistent across hooks. Use the helper
// `queryKeys.*` factories instead of typing strings by hand.

export const queryKeys = {
  projects: (userId: string) => ["projects", userId] as const,
  project: (userId: string, id: string) =>
    ["projects", userId, id] as const,
  features: (userId: string, projectId: string) =>
    ["features", userId, projectId] as const,
  flows: (userId: string, featureId: string) =>
    ["flows", userId, featureId] as const,
  dashboard: (userId: string) => ["dashboard", userId] as const,
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
        sort: { LastUpdatedDate: "desc" },
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
      const item = (raw as { data?: unknown }).data ?? raw;
      if (!item) return null;
      const p = item as Parameters<typeof toProject>[0];
      // Guard against reading another user's record (the platform may
      // already enforce this through access policies; this is a UX layer).
      if (userId && p.CreatedBy && p.CreatedBy !== userId) return null;
      return toProject(p);
    },
  });
}

export function useProjectFeatures(
  projectId: string | undefined,
): UseQueryResult<Feature[]> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  return useQuery({
    queryKey: queryKeys.features(userId, projectId ?? ""),
    enabled: Boolean(userId && projectId),
    queryFn: async () => {
      if (!projectId) return [];
      const raw = await featuresCollection.list({
        filter: { ...createdByFilter(userId), projectId: { eq: projectId } },
        pageNo: 1,
        pageSize: 200,
        sort: { CreatedDate: "desc" },
      });
      return unwrapPaged<unknown>(raw).items.map((f) =>
        toFeature(f as Parameters<typeof toFeature>[0], projectId),
      );
    },
  });
}

export function useFeatureFlows(
  featureId: string | undefined,
): UseQueryResult<Flow[]> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  return useQuery({
    queryKey: queryKeys.flows(userId, featureId ?? ""),
    enabled: Boolean(userId && featureId),
    queryFn: async () => {
      if (!featureId) return [];
      const raw = await flowsCollection.list({
        filter: { ...createdByFilter(userId), featureId: { eq: featureId } },
        pageNo: 1,
        pageSize: 200,
        sort: { CreatedDate: "desc" },
      });
      return unwrapPaged<unknown>(raw).items.map((f) =>
        toFlow(f as Parameters<typeof toFlow>[0], ""),
      );
    },
  });
}

// Used by the dashboard "Recent Flows" tile. Pulls the user's most recent
// flows regardless of feature, sorted by CreatedDate desc.
export function useRecentFlows(limit = 5): UseQueryResult<Flow[]> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  return useQuery({
    queryKey: [...queryKeys.dashboard(userId), "flows", limit] as const,
    enabled: Boolean(userId),
    queryFn: async () => {
      const raw = await flowsCollection.list({
        filter: createdByFilter(userId),
        pageNo: 1,
        pageSize: limit,
        sort: { CreatedDate: "desc" },
      });
      return unwrapPaged<unknown>(raw).items.map((f) =>
        toFlow(f as Parameters<typeof toFlow>[0], ""),
      );
    },
  });
}

// Aggregate totals for the dashboard stat cards. Uses pageSize=1 with the
// user's filter so only the `totalCount` is read off the envelope — much
// cheaper than pulling every record.
export function useWorkspaceTotals(): UseQueryResult<{
  features: number;
  flows: number;
}> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  return useQuery({
    queryKey: [...queryKeys.dashboard(userId), "totals"] as const,
    enabled: Boolean(userId),
    queryFn: async () => {
      const [featuresRaw, flowsRaw] = await Promise.all([
        featuresCollection.list({
          filter: createdByFilter(userId),
          pageNo: 1,
          pageSize: 1,
        }),
        flowsCollection.list({
          filter: createdByFilter(userId),
          pageNo: 1,
          pageSize: 1,
        }),
      ]);
      return {
        features: unwrapPaged<unknown>(featuresRaw).totalCount,
        flows: unwrapPaged<unknown>(flowsRaw).totalCount,
      };
    },
  });
}

// All flows under any feature of one project. Flows are keyed by
// `featureId`, so we first list the project's features, then list flows
// whose `featureId` is in that set. Returns `[]` if the project has no
// features yet (the `in` filter would otherwise match everything).
export function useProjectFlows(
  projectId: string | undefined,
): UseQueryResult<Flow[]> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  return useQuery({
    queryKey: [...queryKeys.features(userId, projectId ?? ""), "flows"] as const,
    enabled: Boolean(userId && projectId),
    queryFn: async () => {
      if (!projectId) return [];
      const featuresRaw = await featuresCollection.list({
        filter: { ...createdByFilter(userId), projectId: { eq: projectId } },
        pageNo: 1,
        pageSize: 500,
      });
      const featureIds = unwrapPaged<{ ItemId: string }>(featuresRaw).items.map(
        (f) => f.ItemId,
      );
      if (featureIds.length === 0) return [];
      const flowsRaw = await flowsCollection.list({
        filter: {
          ...createdByFilter(userId),
          featureId: { in: featureIds },
        },
        pageNo: 1,
        pageSize: 500,
      });
      return unwrapPaged<unknown>(flowsRaw).items.map((f) =>
        toFlow(f as Parameters<typeof toFlow>[0], projectId),
      );
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
    mutationFn: async (input) => {
      const created = (await projectsCollection.create({
        name: input.name,
        status: input.status ?? "active",
        description: input.description ?? "",
        color: input.color ?? "",
      })) as { data?: { ItemId: string; CreatedDate: string; LastUpdatedDate: string; name: string } };
      const item = created.data ?? (created as unknown as { ItemId: string; CreatedDate: string; LastUpdatedDate: string; name: string });
      return toProject(item as Parameters<typeof toProject>[0]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projects(userId) });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard(userId) });
    },
  });
}

export function useCreateFeature(): UseMutationResult<
  Feature,
  Error,
  { projectId: string; name: string }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async (input) => {
      const created = (await featuresCollection.create({
        title: input.name,
        projectId: input.projectId,
        status: "backlog",
      })) as { data?: { ItemId: string; title: string; projectId: string; CreatedDate: string; LastUpdatedDate: string } };
      const item = created.data ?? (created as unknown as { ItemId: string; title: string; projectId: string; CreatedDate: string; LastUpdatedDate: string });
      return toFeature(item as Parameters<typeof toFeature>[0], input.projectId);
    },
    onSuccess: (_feature, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.features(userId, vars.projectId) });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard(userId) });
    },
  });
}

export function useCreateFlow(): UseMutationResult<
  Flow,
  Error,
  { projectId: string; featureId: string; name: string }
> {
  const { currentUser } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ?? "";
  return useMutation({
    mutationFn: async (input) => {
      const created = (await flowsCollection.create({
        title: input.name,
        featureId: input.featureId,
        status: "draft",
      })) as { data?: { ItemId: string; title: string; featureId: string; projectId?: string; CreatedDate: string; LastUpdatedDate: string } };
      const item = created.data ?? (created as unknown as { ItemId: string; title: string; featureId: string; projectId?: string; CreatedDate: string; LastUpdatedDate: string });
      return toFlow(item as Parameters<typeof toFlow>[0], input.projectId);
    },
    onSuccess: (_flow, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.flows(userId, vars.featureId) });
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