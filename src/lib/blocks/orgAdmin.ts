// Organization administration hooks — the `/organizations` admin surface
// (list, create, edit, and membership control). Everything goes through
// the single SDK instance (`blocksClient.iam.organizations.*` /
// `iam.users.*`) — never raw fetch (see the blocks-iam-organizations skill).
//
// Risk profile mirrors `userAdmin.ts`: every mutation is manager-gated at
// runtime (belt) on top of the manager-only nav entry (suspenders), and
// organizations are a tenant-isolation boundary — the
// blocks-iam-organizations skill requires that each create/update carries
// an explicit human instruction, which the dialogs enforce by only firing
// on a filled-in form the manager submitted.
//
// NOT in this file (deliberate scope cut, user's point-by-point flow):
// org config editor (`getConfig`/`saveConfig`), signup policy
// (`signupSettings`), and session org switching (`auth.switchOrganization`
// — SDK-only, mutates the caller's own tokens, gated on
// `isMultiOrgEnabled`). These land as follow-up points.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthContext } from "@/components/blocks/AuthProvider";
import { blocksClient } from "./client";

// --- Types -------------------------------------------------------------------

export interface OrganizationRecord {
  id: string;
  name: string;
  description: string;
  websiteUrl: string;
  timeZone: string;
  locale: string;
  isDisabled: boolean;
  /** Role slugs auto-granted to new members of this org. */
  defaultRoleSlugs: string[];
}

export interface OrgMember {
  id: string;
  name: string;
  email: string;
  displayName: string;
  /** Every role slug readable off the record (org-scoped map flattened). */
  roles: string[];
  active: boolean;
}

// --- Defensive parsing -------------------------------------------------------

// IAM returns loosely-typed envelopes (`Record<string, unknown>`) whose
// shapes have drifted across tenants — parse defensively like
// `userAdmin.ts` rather than trusting the SDK types.
function pickString(o: Record<string, unknown>, key: string): string {
  const v = o[key];
  return typeof v === "string" ? v : "";
}

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

function toOrganization(raw: unknown): OrganizationRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = pickString(o, "itemId") || pickString(o, "id") || pickString(o, "organizationId");
  if (!id) return null;
  const defaultRoles: string[] = [];
  collectRoleStrings(o.defaultRoleForMembers, defaultRoles);
  return {
    id,
    name: pickString(o, "name") || id,
    description: pickString(o, "description"),
    websiteUrl: pickString(o, "websiteUrl"),
    timeZone: pickString(o, "timeZone"),
    locale: pickString(o, "locale"),
    isDisabled: o.isDisabled === true,
    defaultRoleSlugs: defaultRoles,
  };
}

// Reuses the same unwrap discipline as `userAdmin.ts` — the IAM list
// endpoints have surfaced `data.items`, flat `items`, bare arrays, and
// (organizations list) a bare `organizations` key across SDK versions.
function unwrapList(raw: unknown): unknown[] {
  const r = raw as
    | { data?: unknown; items?: unknown; organizations?: unknown }
    | undefined;
  if (!r) return [];
  if (Array.isArray(r)) return r;
  if (Array.isArray(r.items)) return r.items;
  if (Array.isArray(r.organizations)) return r.organizations;
  if (r.data && Array.isArray(r.data)) return r.data;
  if (r.data && typeof r.data === "object" && Array.isArray((r.data as { items?: unknown }).items)) {
    return (r.data as { items: unknown[] }).items;
  }
  return [];
}

function toOrgMember(raw: unknown): OrgMember | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id =
    pickString(o, "itemId") ||
    pickString(o, "id") ||
    pickString(o, "userId") ||
    pickString(o, "sub");
  if (!id) return null;
  const first = pickString(o, "firstName").trim();
  const last = pickString(o, "lastName").trim();
  const name =
    (first && last && `${first} ${last}`) ||
    first ||
    pickString(o, "name").trim();
  const email = pickString(o, "email");
  const roles: string[] = [];
  collectRoleStrings(o.roles, roles);
  return {
    id,
    name: name || email || id,
    email,
    displayName: name || email || id,
    roles,
    active: typeof o.active === "boolean" ? o.active : o.status !== 0,
  };
}

function assertSuccess(res: unknown, fallbackMessage: string): void {
  const r = res as { isSuccess?: boolean; message?: string } | undefined;
  if (r && r.isSuccess === false) {
    throw new Error(r.message || fallbackMessage);
  }
}

// --- Query keys --------------------------------------------------------------

export const orgAdminKeys = {
  all: ["iam-orgs"] as const,
  members: (orgId: string) => ["iam-org-members", orgId] as const,
};

// Same roster caches `userAdmin.ts` flushes — membership changes must
// reach the Members page and the assignment dropdowns too.
const ROSTER_CACHE_KEYS = [
  ["iam-users-all"],
  ["iam-users-by-role"],
  ["iam-users-admin"],
] as const;

function useInvalidateOrgCaches() {
  const qc = useQueryClient();
  return (orgId?: string) => {
    qc.invalidateQueries({ queryKey: orgAdminKeys.all });
    if (orgId) qc.invalidateQueries({ queryKey: orgAdminKeys.members(orgId) });
    else qc.invalidateQueries({ queryKey: ["iam-org-members"] });
    for (const key of ROSTER_CACHE_KEYS) {
      qc.invalidateQueries({ queryKey: key });
    }
  };
}

function useManagerGate() {
  const { user } = useAuthContext();
  return user?.roles?.includes("manager") ?? false;
}

// --- Reads -------------------------------------------------------------------

/**
 * Every organization in the tenant — the admin view (`organizations.list`
 * GET), not `organizations.my` (which is the signed-in user's own
 * memberships). This is what lets a manager see and control all orgs,
 * including ones they don't personally belong to.
 */
export function useOrganizations() {
  return useQuery<OrganizationRecord[]>({
    queryKey: orgAdminKeys.all,
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    queryFn: async () => {
      const raw = (await blocksClient.iam.organizations.list({
        pageNo: 1,
        pageSize: 100,
      })) as unknown;
      const orgs = unwrapList(raw)
        .map(toOrganization)
        .filter((o): o is OrganizationRecord => o !== null);
      return orgs.sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

/**
 * Members of one organization — `iam.users.list` with the
 * `organizationId` filter (the same filter the CLI's
 * `--organization-id` flag sends; verified live: returns only users
 * holding membership in that org, with their per-org roles).
 */
export function useOrgMembers(orgId: string | null) {
  return useQuery<OrgMember[]>({
    queryKey: orgAdminKeys.members(orgId ?? "__none__"),
    enabled: Boolean(orgId),
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    queryFn: async () => {
      const raw = (await blocksClient.iam.users.list({
        organizationId: orgId ?? undefined,
        pageNo: 1,
        pageSize: 200,
      })) as unknown;
      const members = unwrapList(raw)
        .map(toOrgMember)
        .filter((m): m is OrgMember => m !== null);
      return members.sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

// --- Mutations ----------------------------------------------------------------

export interface CreateOrgInput {
  name: string;
  description: string;
  websiteUrl: string;
  defaultRoleSlugs: string[];
}

/**
 * Create an organization (`organizations.create`). Organizations are a
 * tenant-isolation boundary — the dialog only fires on an explicit
 * form submit, and the runtime gate re-checks manager.
 */
export function useCreateOrganization() {
  const invalidate = useInvalidateOrgCaches();
  const isManager = useManagerGate();
  return useMutation<OrganizationRecord | null, Error, CreateOrgInput>({
    mutationFn: async (input) => {
      if (!isManager) {
        throw new Error("Only managers can create organizations.");
      }
      const res = await blocksClient.iam.organizations.create({
        name: input.name,
        description: input.description || undefined,
        websiteUrl: input.websiteUrl || undefined,
        defaultRoles: input.defaultRoleSlugs.length > 0 ? input.defaultRoleSlugs : undefined,
      });
      assertSuccess(res, "IAM rejected the organization create.");
      // The create response is a bare success envelope — read the list
      // back through the invalidation rather than parsing an id here.
      return null;
    },
    onSuccess: () => invalidate(),
  });
}

export interface UpdateOrgInput {
  id: string;
  name: string;
  description: string;
  websiteUrl: string;
}

/**
 * Edit an organization's profile fields (`organizations.update`).
 * Scope-cut fields (config, signup policy) are not touched here.
 */
export function useUpdateOrganization() {
  const invalidate = useInvalidateOrgCaches();
  const isManager = useManagerGate();
  return useMutation<void, Error, UpdateOrgInput>({
    mutationFn: async (input) => {
      if (!isManager) {
        throw new Error("Only managers can edit organizations.");
      }
      const res = await blocksClient.iam.organizations.update(input.id, {
        name: input.name,
        description: input.description || undefined,
        websiteUrl: input.websiteUrl || undefined,
      });
      assertSuccess(res, "IAM rejected the organization update.");
    },
    onSuccess: () => invalidate(),
  });
}

export interface AddOrgMemberInput {
  orgId: string;
  userId: string;
  roles: string[];
  userName: string;
}

/**
 * Add a user to the organization (or replace their org roles) —
 * `iam.users.updateAccess` with `organizationId`. IAM treats the
 * payload as that org's complete role list for the user, so the dialog
 * submits the full checked set.
 */
export function useAddOrgMember() {
  const invalidate = useInvalidateOrgCaches();
  const isManager = useManagerGate();
  return useMutation<void, Error, AddOrgMemberInput>({
    mutationFn: async ({ orgId, userId, roles }) => {
      if (!isManager) {
        throw new Error("Only managers can manage organization members.");
      }
      const res = await blocksClient.iam.users.updateAccess({
        userId,
        roles,
        organizationId: orgId,
      });
      assertSuccess(res, "IAM rejected the membership grant.");
    },
    onSuccess: (_res, input) => invalidate(input.orgId),
  });
}

/**
 * Remove a user's membership (and that org's roles) —
 * `iam.users.revokeAccess` with `organizationId`. The user record
 * survives; only this org's access goes away.
 */
export function useRemoveOrgMember() {
  const invalidate = useInvalidateOrgCaches();
  const isManager = useManagerGate();
  return useMutation<void, Error, { orgId: string; userId: string; userName: string }>({
    mutationFn: async ({ orgId, userId }) => {
      if (!isManager) {
        throw new Error("Only managers can manage organization members.");
      }
      const res = await blocksClient.iam.users.revokeAccess({
        userId,
        organizationId: orgId,
      });
      assertSuccess(res, "IAM rejected the membership revoke.");
    },
    onSuccess: (_res, input) => invalidate(input.orgId),
  });
}

// --- Tenant policy (signup settings + organization config) -------------------
//
// These two records govern how new users enter the workspace and how
// organizations behave tenant-wide. Both saves merge the edited fields
// over the CURRENT server record before POSTing — the payloads carry
// platform fields this UI doesn't render, and IAM treats the save as
// authoritative, so a partial body could silently unset them.
//
// Permission note: reads + writes here are gated IAM-side by
// `tenant-configs` / `mutate-tenant-configs` — the manager role needs
// both granted or every call below 403s from the browser.

export interface SignupSettings {
  isSignUpEnable: boolean;
  isEmailPasswordSignUpEnabled: boolean;
  isSSoSignUpEnabled: boolean;
  defaultRolesForNewUser: string[];
  defaultPermissionsForNewUser: string[];
}

export interface OrgConfig {
  allowOrgCreationFromCloud: boolean;
  allowOrgCreationFromConstruct: boolean;
  allowOrgCreationFromPortal: boolean;
  allowOrgCreationFromSignup: boolean;
  isMultiOrgEnabled: boolean;
  consentForMultiOrgEnable: boolean;
  isOrgNameUniquenessEnabled: boolean;
  isSignupAutoJoinEnabled: boolean;
}

function boolOr(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

export const tenantPolicyKeys = {
  signup: ["iam-signup-settings"] as const,
  config: ["iam-org-config"] as const,
};

export function useSignupSettings() {
  return useQuery<SignupSettings | null>({
    queryKey: tenantPolicyKeys.signup,
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    queryFn: async () => {
      const raw = (await blocksClient.iam.signupSettings.get()) as Record<
        string,
        unknown
      >;
      if (!raw || typeof raw !== "object") return null;
      const roles: string[] = [];
      const perms: string[] = [];
      collectRoleStrings(raw.defaultRolesForNewUser, roles);
      collectRoleStrings(raw.defaultPermissionsForNewUser, perms);
      return {
        isSignUpEnable: boolOr(raw.isSignUpEnable, true),
        isEmailPasswordSignUpEnabled: boolOr(raw.isEmailPasswordSignUpEnabled, true),
        isSSoSignUpEnabled: boolOr(raw.isSSoSignUpEnabled, true),
        defaultRolesForNewUser: roles,
        defaultPermissionsForNewUser: perms,
      };
    },
  });
}

/**
 * Save signup policy — reads the live record, overlays the edited
 * fields, posts the merged result so platform fields this UI doesn't
 * render survive the round-trip.
 *
 * FIELD-NAME TRAP (cost us a wiped value once): IAM's GET returns
 * `defaultRolesForNewUser`, but the POST contract expects
 * `defaultRolesForNewUserOnSignUp` (same for permissions). Sending the
 * GET-name keys is silently ignored and IAM resets the list to [] —
 * so this mutation translates both edited lists into the OnSignUp
 * names AND refreshes the GET-name mirrors, keeping either reader
 * honest.
 */
export function useSaveSignupSettings() {
  const qc = useQueryClient();
  const isManager = useManagerGate();
  return useMutation<void, Error, SignupSettings>({
    mutationFn: async (edited) => {
      if (!isManager) {
        throw new Error("Only managers can change the signup policy.");
      }
      const current = (await blocksClient.iam.signupSettings.get()) as Record<string, unknown>;
      const merged = {
        ...current,
        isSignUpEnable: edited.isSignUpEnable,
        isEmailPasswordSignUpEnabled: edited.isEmailPasswordSignUpEnabled,
        isSSoSignUpEnabled: edited.isSSoSignUpEnabled,
        // POST-contract names (what IAM actually reads)
        defaultRolesForNewUserOnSignUp: edited.defaultRolesForNewUser,
        defaultPermissionsForNewUserOnSignUp: edited.defaultPermissionsForNewUser,
        // GET-name mirrors, kept in sync so reads agree with writes
        defaultRolesForNewUser: edited.defaultRolesForNewUser,
        defaultPermissionsForNewUser: edited.defaultPermissionsForNewUser,
      };
      const res = await blocksClient.iam.signupSettings.save(merged);
      assertSuccess(res, "IAM rejected the signup policy save.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tenantPolicyKeys.signup });
    },
  });
}

export function useOrgConfig() {
  return useQuery<OrgConfig | null>({
    queryKey: tenantPolicyKeys.config,
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    queryFn: async () => {
      const raw = (await blocksClient.iam.organizations.getConfig()) as Record<
        string,
        unknown
      >;
      if (!raw || typeof raw !== "object") return null;
      return {
        allowOrgCreationFromCloud: boolOr(raw.allowOrgCreationFromCloud, false),
        allowOrgCreationFromConstruct: boolOr(raw.allowOrgCreationFromConstruct, false),
        allowOrgCreationFromPortal: boolOr(raw.allowOrgCreationFromPortal, false),
        allowOrgCreationFromSignup: boolOr(raw.allowOrgCreationFromSignup, false),
        isMultiOrgEnabled: boolOr(raw.isMultiOrgEnabled, false),
        consentForMultiOrgEnable: boolOr(raw.consentForMultiOrgEnable, false),
        isOrgNameUniquenessEnabled: boolOr(raw.isOrgNameUniquenessEnabled, false),
        isSignupAutoJoinEnabled: boolOr(raw.isSignupAutoJoinEnabled, false),
      };
    },
  });
}

/**
 * Save organization config — same merge-over-current discipline as the
 * signup save. `isMultiOrgEnabled` can only ever flip ON (once, with
 * consent) — the UI renders it read-only once true and never sends a
 * downgrade.
 */
export function useSaveOrgConfig() {
  const qc = useQueryClient();
  const isManager = useManagerGate();
  return useMutation<void, Error, OrgConfig>({
    mutationFn: async (edited) => {
      if (!isManager) {
        throw new Error("Only managers can change organization config.");
      }
      const current = (await blocksClient.iam.organizations.getConfig()) as Record<string, unknown>;
      const merged = {
        ...current,
        allowOrgCreationFromCloud: edited.allowOrgCreationFromCloud,
        allowOrgCreationFromConstruct: edited.allowOrgCreationFromConstruct,
        allowOrgCreationFromPortal: edited.allowOrgCreationFromPortal,
        allowOrgCreationFromSignup: edited.allowOrgCreationFromSignup,
        isOrgNameUniquenessEnabled: edited.isOrgNameUniquenessEnabled,
        isSignupAutoJoinEnabled: edited.isSignupAutoJoinEnabled,
        // Multi-org is enable-once — never send a downgrade; keep the
        // server's current value untouched.
        isMultiOrgEnabled: current.isMultiOrgEnabled,
        consentForMultiOrgEnable: current.consentForMultiOrgEnable,
      };
      const res = await blocksClient.iam.organizations.saveConfig(merged);
      assertSuccess(res, "IAM rejected the organization config save.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tenantPolicyKeys.config });
    },
  });
}

// --- Session side (self-service, NOT admin) ----------------------------------
//
// The org switcher is the signed-in user acting on their OWN session —
// unlike the admin mutations above it is deliberately NOT manager-gated:
// any multi-org member may switch their own active-org context
// (`auth.switchOrganization` is SDK-only by platform design — it mutates
// the calling session's tokens, so there is no CLI equivalent).

export interface MyOrg {
  id: string;
  name: string;
}

/**
 * The signed-in user's own organization memberships
 * (`organizations.my`). The topbar switcher lists these; an empty
 * result simply hides the switcher.
 */
export function useMyOrganizations() {
  return useQuery<MyOrg[]>({
    queryKey: ["iam-orgs-my"] as const,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    queryFn: async () => {
      const raw = (await blocksClient.iam.organizations.my()) as unknown;
      const r = raw as { organizations?: unknown } | undefined;
      const entries = Array.isArray(r?.organizations)
        ? r.organizations
        : unwrapList(raw);
      return entries
        .map(toOrganization)
        .filter((o): o is OrganizationRecord => o !== null)
        .map((o) => ({ id: o.id, name: o.name }));
    },
  });
}

/**
 * The session's active organization id — read off the OIDC claims the
 * AuthProvider already holds (`org_id`, e.g. "default"; signup-created
 * accounts without an org carry "no-org"). No extra network call: the
 * claims refresh rides the existing AuthProvider polling.
 */
export function useActiveOrgId(): string {
  const { claims } = useAuthContext();
  const c = claims as Record<string, unknown> | null;
  return c && typeof c.org_id === "string" ? c.org_id : "";
}

/**
 * Switch the calling session's active organization
 * (`auth.switchOrganization` → POST /iam/v4/auth/switch-org). In this
 * app's cookie-only flow IAM rotates the session cookie server-side;
 * the caller MUST follow a successful switch with
 * `AuthProvider.refresh()` so claims + roles re-resolve against the
 * new org. Fails loudly when the tenant has multi-org disabled — the
 * API error message is surfaced to the toast.
 */
export function useSwitchOrganization() {
  const qc = useQueryClient();
  return useMutation<void, Error, { organizationId: string }>({
    mutationFn: async ({ organizationId }) => {
      const res = (await blocksClient.auth.switchOrganization({
        organizationId,
      })) as { isSuccess?: boolean; message?: string };
      if (res && res.isSuccess === false) {
        throw new Error(res.message || "IAM rejected the organization switch.");
      }
    },
    onSuccess: () => {
      // Active-org change alters every org-scoped read the session
      // makes (iam.me roles, org members) — flush the org caches so
      // nothing stale survives the switch.
      qc.invalidateQueries({ queryKey: ["iam-orgs-my"] });
      qc.invalidateQueries({ queryKey: ["iam-org-members"] });
      qc.invalidateQueries({ queryKey: ["iam-users-admin"] });
    },
  });
}
