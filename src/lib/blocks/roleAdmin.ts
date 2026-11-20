// Role & permission administration hooks — the `/roles` admin surface.
// This is Facet 2 of Blocks RBAC (the blocks-iam-access-control skill's
// sensitive half): defining roles and wiring permission sets to them.
// Every mutation is manager-gated at runtime AND requires the
// `mutate-roles` IAM permission (granted deliberately — this page is
// its reason to exist); reads need `permissions` (View Permissions).
//
// Role→permissions derivation: `roles.list` does NOT carry permission
// assignments — `permissions.list` does (each permission carries the
// `roles[]` holding it). The assign dialog pre-checks from that map
// and submits a DELTA (`addPermissions` / `removePermissions`),
// matching the CLI's contract.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthContext } from "@/components/blocks/AuthProvider";
import { blocksClient } from "./client";

// --- Types -------------------------------------------------------------------

export interface RoleRecord {
  itemId: string;
  slug: string;
  name: string;
  description: string;
  parentRoleSlug: string;
}

export interface PermissionRecord {
  /** Full resource string, e.g. `blocks-data::object::search-objects`. */
  resource: string;
  name: string;
  /** Role slugs currently holding this permission. */
  roles: string[];
}

// --- Defensive parsing -------------------------------------------------------

function pickString(o: Record<string, unknown>, key: string): string {
  const v = o[key];
  return typeof v === "string" ? v : "";
}

function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function unwrapList(raw: unknown, envelopeKey?: string): unknown[] {
  const r = raw as Record<string, unknown> | undefined;
  if (!r) return [];
  if (Array.isArray(r)) return r;
  if (envelopeKey && Array.isArray(r[envelopeKey])) return r[envelopeKey] as unknown[];
  if (Array.isArray(r.items)) return r.items;
  if (r.data && Array.isArray(r.data)) return r.data;
  if (r.data && typeof r.data === "object" && Array.isArray((r.data as { items?: unknown }).items)) {
    return (r.data as { items: unknown[] }).items;
  }
  return [];
}

function assertSuccess(res: unknown, fallbackMessage: string): void {
  const r = res as { isSuccess?: boolean; message?: string } | undefined;
  if (r && r.isSuccess === false) {
    throw new Error(r.message || fallbackMessage);
  }
}

function useManagerGate() {
  const { user } = useAuthContext();
  return user?.roles?.includes("manager") ?? false;
}

// --- Query keys --------------------------------------------------------------

export const roleAdminKeys = {
  roles: ["iam-roles-all"] as const,
  permissions: ["iam-permissions-all"] as const,
};

function useInvalidateRoleCaches() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: roleAdminKeys.roles });
    qc.invalidateQueries({ queryKey: roleAdminKeys.permissions });
    // The assignable-roles picker (userAdmin) caches role slugs.
    qc.invalidateQueries({ queryKey: ["iam-roles-assignable"] });
  };
}

// --- Reads -------------------------------------------------------------------

export function useRoles() {
  return useQuery<RoleRecord[]>({
    queryKey: roleAdminKeys.roles,
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    queryFn: async () => {
      const raw = (await blocksClient.iam.roles.list({
        pageNo: 1,
        pageSize: 200,
      })) as unknown;
      const roles = unwrapList(raw)
        .map((entry) => {
          const o = entry as Record<string, unknown>;
          const itemId = pickString(o, "itemId") || pickString(o, "id");
          const slug = pickString(o, "slug") || pickString(o, "name");
          if (!itemId || !slug) return null;
          return {
            itemId,
            slug,
            name: pickString(o, "name") || slug,
            description: pickString(o, "description"),
            parentRoleSlug: pickString(o, "parentRoleSlug"),
          } satisfies RoleRecord;
        })
        .filter((r): r is RoleRecord => r !== null);
      return roles.sort((a, b) => a.slug.localeCompare(b.slug));
    },
  });
}

/**
 * The full permission inventory with its role assignments — paginated
 * to exhaustion (256 across 2 pages today; the loop guards against
 * growth). This single read powers BOTH tabs: the permissions browser
 * and the assign dialog's pre-checked state.
 */
export function useAllPermissions() {
  return useQuery<PermissionRecord[]>({
    queryKey: roleAdminKeys.permissions,
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    queryFn: async () => {
      const out: PermissionRecord[] = [];
      const seen = new Set<string>();
      const pageSize = 200;
      for (let page = 1; page <= 6; page++) {
        const raw = (await blocksClient.iam.permissions.list({
          // FIELD-NAME TRAP: this endpoint paginates on zero-based
          // `page` (the CLI's `--page 2` sends `page: 1`) — `pageNo` /
          // `pageNumber` are silently ignored and every request
          // returns page 1. `filter.search` is required-and-nullable
          // server-side; "" is the unfiltered value (mirrors the CLI).
          page: page - 1,
          pageSize,
          filter: { search: "" },
        }) as unknown);
        const items = unwrapList(raw);
        if (items.length === 0) break;
        for (const entry of items) {
          const o = entry as Record<string, unknown>;
          const resource = pickString(o, "resource");
          if (!resource || seen.has(resource)) continue;
          seen.add(resource);
          out.push({
            resource,
            name: pickString(o, "name") || pickString(o, "title") || resource,
            roles: toStringArray(o.roles),
          });
        }
        if (items.length < pageSize) break;
      }
      return out.sort((a, b) => a.resource.localeCompare(b.resource));
    },
  });
}

// --- Mutations ----------------------------------------------------------------

export interface CreateRoleInput {
  name: string;
  slug: string;
  description: string;
}

export function useCreateRole() {
  const invalidate = useInvalidateRoleCaches();
  const isManager = useManagerGate();
  return useMutation<void, Error, CreateRoleInput>({
    mutationFn: async (input) => {
      if (!isManager) {
        throw new Error("Only managers can create roles.");
      }
      const res = await blocksClient.iam.roles.create({
        name: input.name,
        slug: input.slug,
        description: input.description || undefined,
      });
      assertSuccess(res, "IAM rejected the role create.");
    },
    onSuccess: invalidate,
  });
}

export interface UpdateRoleInput {
  itemId: string;
  name: string;
  description: string;
}

export function useUpdateRole() {
  const invalidate = useInvalidateRoleCaches();
  const isManager = useManagerGate();
  return useMutation<void, Error, UpdateRoleInput>({
    mutationFn: async (input) => {
      if (!isManager) {
        throw new Error("Only managers can edit roles.");
      }
      const res = await blocksClient.iam.roles.update({
        itemId: input.itemId,
        name: input.name,
        description: input.description || undefined,
      });
      assertSuccess(res, "IAM rejected the role update.");
    },
    onSuccess: invalidate,
  });
}

export interface AssignPermissionsInput {
  slug: string;
  /** Resources newly granted. */
  addPermissions: string[];
  /** Resources taken away. */
  removePermissions: string[];
  roleName: string;
}

/**
 * Apply a permission delta to a role (`roles.assignPermissions`).
 * The dialog computes the delta from its checkbox state — sending the
 * full set would work with add-only semantics but would silently
 * re-grant anything revoked elsewhere since the page loaded.
 */
export function useAssignRolePermissions() {
  const invalidate = useInvalidateRoleCaches();
  const isManager = useManagerGate();
  return useMutation<void, Error, AssignPermissionsInput>({
    mutationFn: async ({ slug, addPermissions, removePermissions }) => {
      if (!isManager) {
        throw new Error("Only managers can change role permissions.");
      }
      if (addPermissions.length === 0 && removePermissions.length === 0) {
        return; // nothing changed — skip the call entirely
      }
      const res = await blocksClient.iam.roles.assignPermissions({
        slug,
        organizationId: "default",
        addPermissions: addPermissions.length > 0 ? addPermissions : undefined,
        removePermissions: removePermissions.length > 0 ? removePermissions : undefined,
      });
      assertSuccess(res, "IAM rejected the permission assignment.");
    },
    onSuccess: invalidate,
  });
}
