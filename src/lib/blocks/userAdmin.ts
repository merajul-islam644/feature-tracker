// IAM user-administration hooks — the `/users` admin surface (invite,
// activate/deactivate, role changes). Every call here goes through the
// single SDK instance (`blocksClient.iam.users.*` / `iam.roles.*`) —
// never raw fetch (see the blocks-iam-users skill).
//
// Why a separate file from `users.ts`: that file serves the *roster*
// consumers (feature-assignment dropdowns, chat roster, Members page)
// and owns the hardcoded safety-net roster. This file is the *admin*
// surface — it mutates IAM records (`users.create` / `activate` /
// `deactivate` / `updateAccess`), so it has different risk properties:
//   - every mutation is manager-gated at runtime (belt) on top of the
//     UI gate (suspenders) — same discipline as
//     `useSetMemberProjectAssignments`;
//   - there is deliberately NO hardcoded fallback for the admin list —
//     an admin screen that fakes its data would invite destructive
//     actions against stale records. If IAM fails, the page shows its
//     error state with a retry.
//
// Response shapes are defensively parsed (the SDK types every IAM
// payload as `Record<string, unknown>`), following the same unwrap
// pattern as `users.ts` — `data.items` / flat `items` / bare array.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
// `useAuth` (src/hooks) wraps this context, but lib modules must not
// import from the hooks layer (the dependency direction is hooks →
// lib), so the manager gate reads `AuthProvider`'s context directly —
// the same source `useAuth` fronts.
import { useAuthContext } from "@/components/blocks/AuthProvider";
import { blocksClient } from "./client";

// --- Types -------------------------------------------------------------------

export interface IamAdminUser {
  id: string;
  name: string;
  email: string;
  displayName: string;
  /** Every role slug readable off the record (e.g. ["manager"]). */
  roles: string[];
  /** Best-effort account-state read; `true` when IAM reports nothing. */
  active: boolean;
}

export interface AssignableRole {
  slug: string;
  name: string;
}

// --- Defensive parsing -------------------------------------------------------

interface RawAdminUser {
  id?: string;
  userId?: string;
  sub?: string;
  itemId?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  roles?: unknown;
  active?: boolean;
  status?: number;
}

interface RawListResponse {
  data?: { items?: RawAdminUser[] } | RawAdminUser[];
  items?: RawAdminUser[];
}

function unwrapList(raw: unknown): RawAdminUser[] {
  const r = raw as RawListResponse | undefined;
  if (!r) return [];
  if (Array.isArray(r)) return r;
  if (Array.isArray(r.items)) return r.items;
  if (Array.isArray(r.data)) return r.data;
  if (r.data && Array.isArray(r.data.items)) return r.data.items;
  return [];
}

// IAM role payloads vary by tenant — `roles: { default: ["developer"] }`
// here, plain string arrays or name-keyed objects elsewhere. Recurse any
// mix and collect EVERY readable role slug (unlike `pickRole` in
// users.ts, which takes only the first — the admin table shows all).
function collectRoleStrings(v: unknown, out: string[]): void {
  if (typeof v === "string") {
    const s = v.trim();
    if (s && !out.includes(s)) out.push(s);
    return;
  }
  if (Array.isArray(v)) {
    for (const entry of v) collectRoleStrings(entry, out);
    return;
  }
  if (v && typeof v === "object") {
    for (const value of Object.values(v)) collectRoleStrings(value, out);
  }
}

function toAdminUser(u: RawAdminUser): IamAdminUser | null {
  const id =
    (typeof u.itemId === "string" && u.itemId) ||
    (typeof u.id === "string" && u.id) ||
    (typeof u.userId === "string" && u.userId) ||
    (typeof u.sub === "string" && u.sub) ||
    null;
  if (!id) return null;
  const first = typeof u.firstName === "string" ? u.firstName.trim() : "";
  const last = typeof u.lastName === "string" ? u.lastName.trim() : "";
  const name =
    (first && last && `${first} ${last}`) ||
    first ||
    (typeof u.name === "string" && u.name.trim()) ||
    "";
  const email = typeof u.email === "string" ? u.email : "";
  const roles: string[] = [];
  collectRoleStrings(u.roles, roles);
  return {
    id,
    name: name || email || id,
    email,
    displayName: name || email || id,
    roles,
    // IAM omits `active` on some tenants; absent + absent status reads
    // as active (the dominant state) rather than alarming the admin.
    active:
      typeof u.active === "boolean"
        ? u.active
        : typeof u.status === "number"
          ? u.status !== 0
          : true,
  };
}

// IAM mutations return `BlocksBaseResponse` — `{ isSuccess, message,
// errors }`. The SDK resolves non-2xx as thrown errors, but some
// tenant gateways resolve 200-with-`isSuccess:false` for permission
// denials, so BOTH failure modes must surface the API's message.
function assertSuccess(res: unknown, fallbackMessage: string): void {
  const r = res as { isSuccess?: boolean; message?: string } | undefined;
  if (r && r.isSuccess === false) {
    throw new Error(r.message || fallbackMessage);
  }
}

// --- Query keys --------------------------------------------------------------

// Exported so the mutation hooks below and future callers invalidate
// with the same keys instead of hand-typing strings.
export const userAdminKeys = {
  all: ["iam-users-admin"] as const,
  assignableRoles: ["iam-roles-assignable"] as const,
};

// The non-admin roster caches built in `users.ts` — an invite or role
// change must flush these too, or the feature-assignment dropdowns and
// the Members page keep serving the pre-change roster for up to 5 min.
const ROSTER_CACHE_KEYS = [
  ["iam-users-all"],
  ["iam-users-by-role"],
] as const;

// --- Reads -------------------------------------------------------------------

/**
 * The full IAM roster for the admin table — unfiltered list, single
 * page of 200 (matches `useAllJoinedUsers`; the tenant roster is well
 * under this today). Client-side search filters this in the page —
 * the POST-read `search` contract isn't worth a server round-trip per
 * keystroke at this scale.
 */
export function useIamAdminUsers() {
  return useQuery<IamAdminUser[]>({
    queryKey: userAdminKeys.all,
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    queryFn: async () => {
      const raw = (await blocksClient.iam.users.list({
        pageNo: 1,
        pageSize: 200,
      })) as unknown;
      return unwrapList(raw)
        .map(toAdminUser)
        .filter((u): u is IamAdminUser => u !== null)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

/**
 * The roles the signed-in admin may assign — `iam.roles.assignable()`
 * (GET) is the SDK-documented source for user-access UIs. Tenant
 * implementations vary, so the parse accepts objects (`{slug, name}`,
 * `{name, itemId}`) and bare strings. Fallback chain when the call
 * 403s or returns an unreadable shape: `roles.list()` (POST-read),
 * then the three project roles this app actually gates on. The
 * system-default `clouduser` role is filtered out of the picker — it
 * is IAM's fallback bucket, not something an admin assigns here.
 */
export function useAssignableRoles() {
  return useQuery<AssignableRole[]>({
    queryKey: userAdminKeys.assignableRoles,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    queryFn: async () => {
      const parse = (raw: unknown): AssignableRole[] => {
        const entries: unknown[] = Array.isArray(raw)
          ? raw
          : Array.isArray((raw as { data?: unknown })?.data)
            ? ((raw as { data: unknown[] }).data)
            : [];
        const out: AssignableRole[] = [];
        for (const entry of entries) {
          if (typeof entry === "string") {
            if (entry.trim()) out.push({ slug: entry.trim(), name: entry.trim() });
            continue;
          }
          const e = entry as { slug?: unknown; name?: unknown; itemId?: unknown };
          const slug =
            (typeof e?.slug === "string" && e.slug) ||
            (typeof e?.name === "string" && e.name) ||
            (typeof e?.itemId === "string" && e.itemId) ||
            "";
          if (slug) out.push({ slug, name: (typeof e?.name === "string" && e.name) || slug });
        }
        return out.filter((r) => r.slug !== "clouduser");
      };
      try {
        const assignable = await blocksClient.iam.roles.assignable();
        const parsed = parse(assignable);
        if (parsed.length > 0) return parsed;
      } catch {
        // 403 / unreadable shape — fall through to roles.list().
      }
      try {
        const listed = await blocksClient.iam.roles.list({
          pageNo: 1,
          pageSize: 100,
        });
        const parsed = parse(listed);
        if (parsed.length > 0) return parsed;
      } catch {
        // fall through to the static project roles.
      }
      return [
        { slug: "manager", name: "Manager" },
        { slug: "developer", name: "Developer" },
        { slug: "tester", name: "Tester" },
      ];
    },
  });
}

// --- Mutations ----------------------------------------------------------------

function useInvalidateUserCaches() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: userAdminKeys.all });
    qc.invalidateQueries({ queryKey: userAdminKeys.assignableRoles });
    // Prefix invalidation catches both `["iam-users-all"]` and every
    // `["iam-users-by-role", role]` entry (React Query matches by
    // prefix), so the roster consumers refetch on their next mount.
    for (const key of ROSTER_CACHE_KEYS) {
      qc.invalidateQueries({ queryKey: key });
    }
  };
}

function useManagerGate() {
  // Runtime re-check of the UI gate — the context's `user.roles` are
  // populated by `AuthProvider` from `iam.me()`. A non-manager who
  // reaches a mutation through devtools gets a thrown Error instead of
  // a silent IAM 403.
  const { user } = useAuthContext();
  return user?.roles?.includes("manager") ?? false;
}

export interface InviteUserInput {
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
}

/**
 * Invite/provision a user (`iam.users.create`). Runs the public
 * duplicate-email check first so the admin gets a friendly inline
 * error instead of an IAM rejection. Roles are slugs
 * (`["developer"]`), per the IAM contract.
 */
export function useInviteIamUser() {
  const invalidate = useInvalidateUserCaches();
  const isManager = useManagerGate();
  return useMutation<void, Error, InviteUserInput>({
    mutationFn: async (input) => {
      if (!isManager) {
        throw new Error("Only managers can invite users.");
      }
      const availability = (await blocksClient.iam.users.emailAvailable({
        email: input.email,
      })) as { isAvailable?: boolean; IsAvailable?: boolean };
      const available = availability.isAvailable ?? availability.IsAvailable;
      if (available === false) {
        throw new Error(
          `${input.email} is already registered in this workspace.`,
        );
      }
      const res = await blocksClient.iam.users.create({
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        roles: input.roles,
      });
      assertSuccess(res, "IAM rejected the invite.");
    },
    onSuccess: invalidate,
  });
}

/**
 * Activate or deactivate an account (`iam.users.activate` /
 * `users.deactivate`). Deactivation removes access without deleting
 * the record — the reversible counterpart of invite.
 */
export function useSetIamUserActive() {
  const invalidate = useInvalidateUserCaches();
  const isManager = useManagerGate();
  return useMutation<
    void,
    Error,
    { userId: string; active: boolean; name: string }
  >({
    mutationFn: async ({ userId, active }) => {
      if (!isManager) {
        throw new Error("Only managers can change account state.");
      }
      const payload = { userId };
      const res = active
        ? await blocksClient.iam.users.activate(payload)
        : await blocksClient.iam.users.deactivate(payload);
      assertSuccess(
        res,
        active
          ? "IAM rejected the activation."
          : "IAM rejected the deactivation.",
      );
    },
    onSuccess: invalidate,
  });
}

/**
 * Replace a user's role set (`iam.users.updateAccess`). Sends the full
 * desired slug list — IAM treats it as the new access set, so the
 * dialog always submits the complete checked list, never a delta.
 */
export function useUpdateIamUserAccess() {
  const invalidate = useInvalidateUserCaches();
  const isManager = useManagerGate();
  return useMutation<
    void,
    Error,
    { userId: string; roles: string[]; name: string }
  >({
    mutationFn: async ({ userId, roles }) => {
      if (!isManager) {
        throw new Error("Only managers can change user roles.");
      }
      const res = await blocksClient.iam.users.updateAccess({
        userId,
        roles,
      });
      assertSuccess(res, "IAM rejected the role change.");
    },
    onSuccess: invalidate,
  });
}
