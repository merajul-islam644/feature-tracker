// User-listing helpers on top of `blocksClient.iam.users.*`. The dropdowns
// on `AddFeatureModal` ("Assign a Developer" / "Assign a QA") are the
// primary consumer — they need a list of users filtered by IAM role so
// the manager can pick a real person rather than typing an opaque id.
//
// Why a hook and not a direct call: the same role list is reused by
// every open of the modal, plus the details drawer's "Assigned to"
// fields. TanStack Query keeps the list cached per role for the
// lifetime of the session, and `refetchOnMount: false` keeps the second
// modal mount from triggering a redundant network call.
//
// Tenant caveat (resolved 2026-09-19 for the manager role):
// `iam.users.list({ filter: { roles } })` historically returned 403
// from a browser session because `iam:users:read` (the "View Users"
// permission, resource `blocks-iam::iam::users`) was admin-only. We
// now grant that permission to the `manager` role so the SDK call
// succeeds from the signed-in manager's browser session — new
// invitations show up in the dropdown without a rebuild. The
// hardcoded roster below is kept as a SAFETY-NET fallback only: it
// kicks in if the SDK call ever errors (network blip, role
// misconfiguration, permission revoked) so the modal still renders a
// usable picker.
//
// Maintenance when the hardcoded roster drifts from IAM (rare —
// the live call is the source of truth now):
//
//   npx blocks iam users list \
//     --project Dd333bf2f23274fb481e4f363ee44b28b \
//     --page-size 100 --json
//
// Filter the result to the roles you care about (`developer`, `tester`),
// copy the `itemId` / `firstName` / `lastName` / `email` triplet into
// `HARDCODED_USERS` below. Mirrors the maintenance pattern of
// `RECIPIENTS_BY_ROLE` in `notifier.ts` — both exist because browser-
// side callers can't *guarantee* an IAM list response, but for users
// the live API path is now the normal case.

import { useQuery } from "@tanstack/react-query";
import { blocksClient } from "./client";

// Loosely-typed user record — the SDK doesn't promise a fixed shape
// (see `blocks-iam-users` skill: every response is a defensive
// `Record<string, unknown>`). We pluck the fields we render, fall back
// to safe defaults for anything missing.
export interface UserOption {
  id: string;
  /** Best-effort display name — falls back to email then id. */
  name: string;
  email: string;
  /** `name` + email handle for disambiguation — used as the Select label. */
  displayName: string;
}

interface RawUser {
  id?: string;
  userId?: string;
  sub?: string;
  // The unfiltered tenant list (`iam.users.list` with no filter) returns
  // rows keyed by `itemId` — the same field name the Data gateway uses.
  itemId?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  /** IAM roles — shape varies by tenant (strings or objects). */
  roles?: unknown;
}

interface RawUsersResponse {
  // Some SDK versions nest under `data`, some don't — match the
  // pattern from `unwrapPaged` and unwrap both.
  data?: { items?: RawUser[]; totalCount?: number } | RawUser[];
  items?: RawUser[];
  totalCount?: number;
}

function unwrapUsers(raw: unknown): RawUser[] {
  const r = raw as RawUsersResponse | undefined;
  if (!r) return [];
  // `iam.users.list` on this tenant returns
  // `{ data: { items: [...] } }` (per the SDK skill doc), but earlier
  // sessions have also surfaced a flat `{ items: [...] }` — handle both.
  if (Array.isArray(r)) return r;
  if (Array.isArray(r.items)) return r.items;
  if (r.data) {
    if (Array.isArray(r.data)) return r.data;
    if ("items" in r.data && Array.isArray(r.data.items)) return r.data.items;
  }
  return [];
}

function pickName(u: RawUser): string {
  const first = typeof u.firstName === "string" ? u.firstName.trim() : "";
  const last = typeof u.lastName === "string" ? u.lastName.trim() : "";
  if (first && last) return `${first} ${last}`;
  if (first) return first;
  if (typeof u.name === "string" && u.name.trim()) return u.name.trim();
  return "";
}

function toUserOption(u: RawUser): UserOption | null {
  const id =
    (typeof u.id === "string" && u.id) ||
    (typeof u.itemId === "string" && u.itemId) ||
    (typeof u.userId === "string" && u.userId) ||
    (typeof u.sub === "string" && u.sub) ||
    null;
  if (!id) return null;
  const email = typeof u.email === "string" ? u.email : "";
  const name = pickName(u) || email || id;
  // Disambiguate when first+last collides with another user in the
  // roster. Append the email's local-part (the bit before @) so two
  // "Meraj Zoarder" entries render as "Meraj Zoarder (meraz-zoarder15)"
  // and "Meraj Zoarder (meraz-zoarder14)". Falls back to the bare
  // name when no email is present or the handle equals the name.
  const handle = email ? email.split("@")[0] : "";
  const displayName =
    handle && handle !== name ? `${name} (${handle})` : name;
  return { id, name, email, displayName };
}

/**
 * List users holding the given IAM role, suitable for populating a
 * `<Select>` dropdown.
 *
 * - `developer` for the Assign-a-Developer dropdown.
 * - `tester` for the Assign-a-QA dropdown (the QA role doubles as
 *   `tester` in this tenant; only the label differs).
 *
 * On failure — most commonly a 403 from the browser session per the
 * tenant caveat above — falls back to `HARDCODED_USERS_BY_ROLE` so
 * the dropdown still renders with the latest known roster. Live API
 * data ALWAYS wins when the call succeeds, even if the result is
 * empty (that's the truth: no one has the role right now).
 */
export function useUsersByRole(role: string) {
  return useQuery<UserOption[]>({
    queryKey: ["iam-users-by-role", role] as const,
    // We never need to refetch on mount within a session — the user
    // roster doesn't change at runtime. The 5-minute AuthProvider
    // visibility refresh is enough to pick up role flips.
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    queryFn: async () => {
      try {
        // The SDK's POST-shaped `list` carries the filter in the body.
        // Some tenants accept `filter: { roles: role }`, some accept
        // `filter: { role }` — sending both is harmless (the gateway
        // ignores unknown fields) but the canonical shape is `roles`.
        const raw = (await blocksClient.iam.users.list({
          pageNo: 1,
          pageSize: 200,
          filter: { roles: role },
        })) as unknown;
        const live = unwrapUsers(raw)
          .map(toUserOption)
          .filter((u): u is UserOption => u !== null)
          // Stable alphabetical order — keeps the dropdown predictable
          // across re-renders without a per-call sort.
          .sort((a, b) => a.name.localeCompare(b.name));
        if (live.length > 0) return live;
      } catch {
        // 403 / 401 / network — fall through to the hardcoded roster.
      }
      // API failed OR returned no rows for this role. Fall back to
      // the admin-CLI-derived list (filtered by the requested role).
      // The fetch above can also return `[]` legitimately (no one
      // has the role anymore), so we explicitly require `live.length
      // > 0` before declaring the live path succeeded.
      return [...(HARDCODED_USERS_BY_ROLE[role] ?? [])];
    },
  });
}

// --- All joined members (live-only) -----------------------------------------
//
// The member chat roster needs EVERY user who joined the workspace — not
// a per-role slice, and never the hardcoded safety net (mock users in a
// chat list would be undeliverable addresses). This hook lists the whole
// tenant from IAM with no filter and no fallback; the live response is
// the truth, even when it's empty.

export interface JoinedMember extends UserOption {
  /** First IAM role we can read off the record; "member" when none. */
  role: string;
}

// IAM role payloads vary by tenant — this one returns
// `roles: { default: ["developer"] }`, others return plain string arrays
// or objects keyed by name. Recurse through any mix and take the first
// readable role string.
function firstRoleString(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (Array.isArray(v)) {
    for (const entry of v) {
      const found = firstRoleString(entry);
      if (found) return found;
    }
    return null;
  }
  if (v && typeof v === "object") {
    for (const value of Object.values(v)) {
      const found = firstRoleString(value);
      if (found) return found;
    }
  }
  return null;
}

function pickRole(u: RawUser): string {
  return firstRoleString(u.roles) ?? "member";
}

export function useAllJoinedUsers() {
  return useQuery<JoinedMember[]>({
    queryKey: ["iam-users-all"] as const,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    queryFn: async () => {
      // Unfiltered list = everyone who joined the workspace. Errors
      // propagate to the query cache on purpose — the chat page shows
      // its own empty state instead of silently pretending.
      const raw = (await blocksClient.iam.users.list({
        pageNo: 1,
        pageSize: 200,
      })) as unknown;
      return unwrapUsers(raw)
        .map((u) => {
          const option = toUserOption(u);
          return option ? { ...option, role: pickRole(u) } : null;
        })
        .filter((m): m is JoinedMember => m !== null)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

// Master tenant roster — single source of truth for every user lookup
// in the app. Captured from `blocks iam users list --project
// Dd333bf2f23274fb481e4f363ee44b28b --page-size 100 --json` on
// 2026-09-19. Update this list (or re-run the CLI and paste the
// result back) whenever anyone is added or removed from the tenant.
// Used to build:
//
//   - `HARDCODED_USERS_BY_ROLE` — feeds `useUsersByRole(role)` as the
//     fallback when `iam.users.list` 403s from the browser.
//   - `HARDCODED_USER_BY_ID` — feeds `lookupUserById(id)` so any
//     user-reference field in the app (Created/Updated by, Assigned
//     Developer, Assigned QA, ...) can render the friendly name +
//     email instead of the raw OIDC `sub`.
//
// Mirrors the maintenance pattern of `RECIPIENTS_BY_ROLE` in
// `notifier.ts` — both exist because the browser session can't
// enumerate IAM users on this tenant.
//
// `role` is the IAM `roles.default` triplet folded to a single
// string for indexing; the dropdown hook only queries `developer` /
// `tester` today but the master list keeps the manager too so id→name
// resolution works for Created/Updated-by audit fields regardless of
// the actor's role.
const HARDCODED_USERS: readonly (UserOption & {
  role: "developer" | "tester" | "manager";
})[] = [
  {
    id: "9890d32d-c956-429d-88d7-cce465824fe5",
    role: "developer",
    name: "Meraj Zoarder",
    email: "meraz-zoarder15@yopmail.com",
    displayName: "Meraj Zoarder (meraz-zoarder15)",
  },
  {
    // Invited 2026-09-19 — added to the safety-net roster so the
    // dropdown still shows this user even if the live IAM call is
    // ever blocked. With "View Users" permission now granted to the
    // manager role, the SDK call is the source of truth and this
    // entry is only consulted when the API call fails.
    id: "4832284e-9219-42d5-bd2a-4d60dd30a3e8",
    role: "developer",
    name: "Meraj Zoarder",
    email: "meraz-zoarder13@yopmail.com",
    displayName: "Meraj Zoarder (meraz-zoarder13)",
  },
  {
    id: "db4bca2e-459d-4bd5-8c65-4700ca858084",
    role: "tester",
    name: "Meraj Zoarder",
    email: "meraz-zoarder14@yopmail.com",
    displayName: "Meraj Zoarder (meraz-zoarder14)",
  },
  {
    id: "41a74053-2c79-4fd5-aab3-90abce656a1d",
    role: "manager",
    name: "Meraj Zoarder",
    email: "merajzoarder6@gmail.com",
    displayName: "Meraj Zoarder (merajzoarder6)",
  },
];

// Role → users (populates the Assign-a-Developer / Assign-a-QA
// dropdowns when the API is unreachable). Derived from
// `HARDCODED_USERS` so there's no second copy to keep in sync.
const HARDCODED_USERS_BY_ROLE: Record<string, readonly UserOption[]> =
  HARDCODED_USERS.reduce<Record<string, UserOption[]>>((acc, u) => {
    const list = acc[u.role] ?? (acc[u.role] = []);
    list.push({ id: u.id, name: u.name, email: u.email, displayName: u.displayName });
    return acc;
  }, {});

// Id → user (resolves Created/Updated-by and Assigned Developer/QA in
// the Feature Details drawer to a friendly name + email instead of the
// raw OIDC `sub`). Derived from `HARDCODED_USERS` for the same
// single-source-of-truth reason.
const HARDCODED_USER_BY_ID: Record<string, UserOption> =
  HARDCODED_USERS.reduce<Record<string, UserOption>>((acc, u) => {
    acc[u.id] = {
      id: u.id,
      name: u.name,
      email: u.email,
      displayName: u.displayName,
    };
    return acc;
  }, {});

/**
 * Resolve a user reference (an OIDC `sub` from a cloud record) to a
 * friendly name + email, when the id is in our hardcoded roster.
 * Returns `undefined` for unknown ids — callers should fall back to
 * the raw mono-id display so an audit-style reader still gets
 * something they can copy.
 *
 * Synchronous and free of side effects, so it can be called directly
 * inside a render without a hook or effect.
 */
export function lookupUserById(id: string | undefined): UserOption | undefined {
  if (!id) return undefined;
  return HARDCODED_USER_BY_ID[id];
}

/**
 * Resolve a user's IAM role from the master roster. Used where behavior
 * (not just display) keys off a member's role — e.g. the developer-
 * scoped tracker page gates on approval while a tester's page must show
 * their queue in any approval state. Returns `undefined` for unknown
 * ids; callers decide their own fallback. Live rosters should be
 * preferred when available and this used only as the fallback.
 */
export function lookupRoleById(
  id: string | undefined,
): "developer" | "tester" | "manager" | undefined {
  if (!id) return undefined;
  return HARDCODED_USERS.find((u) => u.id === id)?.role;
}