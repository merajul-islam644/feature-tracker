// Session-scoped active organization id, synced from AuthProvider's OIDC
// claims (`org_id`) on every refresh. Lives outside React so non-hook
// modules — chiefly the org-scoped collection wrappers in `data.ts` — can
// scope reads without a component tree.
//
// "" means unknown (pre-auth boot or signed out): org-filtered reads stay
// UNFILTERED in that state rather than matching nothing, because every
// read that matters runs behind RequireAuth anyway once AuthProvider has
// resolved the session.

let activeOrgId = "";

export function setActiveOrgId(id: unknown): void {
  activeOrgId = typeof id === "string" ? id : "";
}

export function getActiveOrgId(): string {
  return activeOrgId;
}
