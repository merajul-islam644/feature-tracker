// Cloud-shape → UI-shape adapters for the three schemas we ship. The cloud
// record uses platform-managed field names (`ItemId`, `CreatedDate`, etc.)
// plus whatever custom fields we defined (see `blocks/data/schemas/*.json`).
// UI code consumes the local shapes here so renaming a cloud field never
// ripples into every page.

import { blocksClient } from "./client";

// --- Raw cloud record shapes (only the fields we read or set) --------------

export interface CloudProject {
  ItemId: string;
  name: string;
  description?: string;
  status: string;
  color?: string;
  // JSON-encoded array of ProjectCustomEnv. Stored as a primitive String in
  // the cloud schema (Blocks Data only supports primitives); toProject
  // parses it on read and `useAddProjectEnv` serialises on write.
  customEnvs?: string;
  // JSON-encoded map of canonical-slug → label for per-project overrides
  // of the i18n-driven canonical env names. The slugs themselves stay
  // reserved (dev/stg/prod/uat), only the visible label is overridden.
  // Parsed by toProject; serialised by `useRenameProjectEnv`.
  envLabelOverrides?: string;
  CreatedDate: string;
  LastUpdatedDate: string;
  CreatedBy?: string;
  LastUpdatedBy?: string;
}

export interface CloudFeature {
  ItemId: string;
  title: string;
  description?: string;
  status: string;
  priority?: string;
  projectId: string;
  tags?: string[];
  // Owning environment slug — canonical (dev/stg/prod/uat) or per-project
  // custom env. Optional because legacy records predating env-scoped
  // features may not have this field set.
  envSlug?: string;
  // ItemId of the dev feature this record was cloned from. Stamped on
  // insert by useCloneFlow when it auto-creates the destination feature
  // — the cross-env sync feature (delete + rename on dev) uses this to
  // find sibling features in other envs. Undefined for source records and
  // pre-existing clones made before this feature shipped.
  clonedFromFeatureId?: string;
  CreatedDate: string;
  LastUpdatedDate: string;
  // Platform-managed audit fields. `CreatedBy` / `LastUpdatedBy` are the
  // IAM subject ids of the user who wrote the row (sub from the OIDC
  // session). Both are optional — the cloud returns them when the
  // collection's `fields` selector asks for them (see `featuresCollection`
  // below) and the IAM token's sub is recorded against the write. Older
  // records or records written before audit capture shipped may have
  // either (or both) missing.
  CreatedBy?: string;
  LastUpdatedBy?: string;
}

export interface CloudFlow {
  ItemId: string;
  title: string;
  description?: string;
  steps?: string[];
  status: string;
  // Stack classification: which slice of the app this flow exercises.
  // Freeform on the wire (same shape as `status`); UI narrows to
  // FlowStack and falls back to undefined for unknown values.
  stack?: string;
  featureId: string;
  // Owning environment slug — copied from the parent Feature on creation
  // so the gateway can filter flows by env without joining tables.
  envSlug?: string;
  // ItemId of the dev flow this record was cloned from. Stamped on insert
  // by useCloneFlow — the cross-env sync feature (delete + rename on dev)
  // uses this to find sibling flows in other envs. Undefined for source
  // records and pre-existing clones made before this feature shipped.
  clonedFromFlowId?: string;
  CreatedDate: string;
  LastUpdatedDate: string;
  // Audit fields — see CloudFeature for the why. Forwarded by toFlow so
  // the drawer can render "Created by / Updated by" without re-querying.
  CreatedBy?: string;
  LastUpdatedBy?: string;
}

export interface CloudChatMessage {
  ItemId: string;
  sessionId: string;
  role: string;
  content: string;
  actionsJson?: string;
  CreatedDate: string;
  LastUpdatedDate: string;
  CreatedBy?: string;
}

// --- UI-facing shapes (unchanged from the old mock store) -------------------

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  // Optional metadata fields from CloudProject. Older records may not have
  // these populated, so they're optional — callers fall back to safe defaults.
  description?: string;
  status?: string;
  color?: string;
  // Per-project user-defined envs (slug + label + color). The canonical
  // four (dev/stg/prod/uat) live separately in code; this list is *additive*
  // to those. Stored as a JSON string in the cloud schema; parsed here.
  customEnvs?: ProjectCustomEnv[];
  // Per-project label overrides for the canonical envs. Key = canonical
  // slug (`dev` / `stg` / `prod` / `uat`), value = display label the user
  // picked in the rename modal. `resolveEnvMeta` consults this map before
  // falling back to the i18n label, so a single project can call its dev
  // env "Local Dev" without affecting other projects.
  envLabelOverrides?: Record<string, string>;
}

// A single user-added environment attached to one project. Slug is the URL
// segment under `/projects/:projectId/:slug`; label is the chip/badge text;
// color is a hex used both for the chip tint and any badge accent.
export interface ProjectCustomEnv {
  slug: string;
  label: string;
  color: string;
}

export interface Feature {
  id: string;
  projectId: string;
  name: string;
  // Owning env slug. Optional so legacy records (created before env-scoped
  // features) still type-check; only the env-less project page surfaces them.
  envSlug?: string;
  // ItemId of the dev feature this was cloned from. Set by useCloneFlow on
  // auto-create; the cross-env sync feature uses it to find sibling features
  // when the dev feature is renamed or deleted. Optional — undefined for
  // source records and pre-existing clones.
  clonedFromFeatureId?: string;
  createdAt: string;
  updatedAt: string;
  // IAM subject id (OIDC `sub`) of the user who created / last updated this
  // record. Populated when the cloud response includes `CreatedBy` /
  // `LastUpdatedBy` — older records or writes predating audit capture will
  // have neither, so drawers fall back to "—". Match against
  // `useAuth().currentUser.id` to render a friendly "You" label inline.
  createdBy?: string;
  updatedBy?: string;
}

/**
 * Allowed flow status values. The lifecycle values (draft/active/done)
 * coexist with the test-result values (passed/failed/pending/investigating).
 * UI surfaces map each to its own chip color.
 */
export type FlowStatus =
  | "draft"
  | "active"
  | "done"
  | "passed"
  | "failed"
  | "pending"
  | "investigating"
  | "pause";

/** Test-result subset that can be set from the per-flow status chip. */
export type FlowTestStatus =
  | "passed"
  | "failed"
  | "pending"
  | "investigating"
  | "pause";

export const FLOW_TEST_STATUSES: FlowTestStatus[] = [
  "passed",
  "failed",
  "pending",
  "investigating",
  "pause",
];

/** Stack slice a flow belongs to (which layer of the app it touches). */
export type FlowStack = "frontend" | "backend" | "investigating";

export const FLOW_STACKS: FlowStack[] = [
  "frontend",
  "backend",
  "investigating",
];

export interface Flow {
  id: string;
  projectId: string;
  featureId: string;
  name: string;
  // Mirrors the parent feature's envSlug at creation. Optional for legacy
  // records; flows inherit the env of the feature they sit under.
  envSlug?: string;
  createdAt: string;
  updatedAt: string;
  /** Lifecycle + test-result status. Defaults to "active" for legacy records. */
  status?: FlowStatus;
  /** Stack classification — which slice of the app this flow touches.
   *  Optional; legacy records (or flows where it doesn't apply) read as
   *  unset and render the placeholder "Stack" chip. */
  stack?: FlowStack;
  /** Long-form description. Optional — the schema field is `requiredOn: 0`
   *  and legacy records (created before this field landed) carry nothing. */
  description?: string;
  /** Ordered steps in the flow. Optional — schema field is `requiredOn: 0`.
   *  Used by the EnvironmentChip "clone to another env" feature to carry
   *  the source content over. */
  steps?: string[];
  /** ItemId of the dev flow this was cloned from. Stamped on insert by
   *  useCloneFlow; the cross-env sync feature uses it to find sibling flows
   *  when the dev flow is renamed or deleted. Optional — undefined for
   *  source records and pre-existing clones. */
  clonedFromFlowId?: string;
  /** IAM subject id of the user who created / last updated this flow.
   *  Same shape + fallback rules as `Feature.createdBy`. */
  createdBy?: string;
  updatedBy?: string;
}

// --- Adapters ---------------------------------------------------------------

export function toProject(p: CloudProject): Project {
  let customEnvs: ProjectCustomEnv[] | undefined;
  if (p.customEnvs) {
    try {
      const parsed = JSON.parse(p.customEnvs);
      if (Array.isArray(parsed)) {
        customEnvs = parsed.filter(
          (e): e is ProjectCustomEnv =>
            e &&
            typeof e === "object" &&
            typeof e.slug === "string" &&
            typeof e.label === "string" &&
            typeof e.color === "string",
        );
      }
    } catch {
      // Corrupt JSON — drop the field but keep the project record intact.
      // Mirrors toChatMessage's graceful fallback for `actionsJson`.
    }
  }
  // Same JSON-as-string pattern as `customEnvs`. Validated loosely: every
  // key/value must be a string. Empty / missing object both surface as
  // undefined so `resolveEnvMeta` falls back to the i18n label cleanly.
  let envLabelOverrides: Record<string, string> | undefined;
  if (p.envLabelOverrides) {
    try {
      const parsed = JSON.parse(p.envLabelOverrides);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const filtered: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "string") filtered[k] = v;
        }
        envLabelOverrides = filtered;
      }
    } catch {
      // Corrupt JSON — drop the override map but keep the project record
      // intact. The user will see the i18n label until they re-rename.
    }
  }
  return {
    id: p.ItemId,
    name: p.name,
    createdAt: p.CreatedDate,
    updatedAt: p.LastUpdatedDate,
    description: p.description,
    status: p.status,
    color: p.color,
    customEnvs,
    envLabelOverrides,
  };
}

export function toFeature(f: CloudFeature, projectId: string): Feature {
  return {
    id: f.ItemId,
    projectId: projectId || f.projectId,
    name: f.title,
    envSlug: f.envSlug,
    clonedFromFeatureId: f.clonedFromFeatureId,
    createdAt: f.CreatedDate,
    updatedAt: f.LastUpdatedDate,
    // Forward audit fields verbatim. `f.CreatedBy` / `f.LastUpdatedBy`
    // come back from the gateway only when listed in the collection's
    // `fields` selector — see `featuresCollection` below.
    createdBy: f.CreatedBy,
    updatedBy: f.LastUpdatedBy,
  };
}

export function toFlow(fl: CloudFlow, projectId: string): Flow {
  const fallbackProjectId =
    (fl as unknown as { projectId?: string }).projectId ?? "";
  // The cloud schema's status field is a freeform string. Narrow to the
  // known union; unknown values fall back to "active" so the UI never
  // breaks on legacy or hand-edited records.
  const status: FlowStatus =
    (FLOW_TEST_STATUSES as readonly string[]).includes(fl.status) ||
    fl.status === "draft" ||
    fl.status === "active" ||
    fl.status === "done"
      ? (fl.status as FlowStatus)
      : "active";
  // Same narrowing trick for `stack` — unknown values stay undefined so
  // the chip renders its "Stack" placeholder rather than a phantom value.
  const stack: FlowStack | undefined = (
    FLOW_STACKS as readonly string[]
  ).includes(fl.stack ?? "")
    ? (fl.stack as FlowStack)
    : undefined;
  return {
    id: fl.ItemId,
    projectId: projectId || fallbackProjectId,
    featureId: fl.featureId,
    name: fl.title,
    envSlug: fl.envSlug,
    createdAt: fl.CreatedDate,
    updatedAt: fl.LastUpdatedDate,
    status,
    stack,
    // Forward the optional content fields verbatim. Cloud allows both to
    // be missing for legacy records (the schema marks them `requiredOn: 0`),
    // so the spread is intentional rather than a fallback.
    description: fl.description,
    steps: fl.steps,
    clonedFromFlowId: fl.clonedFromFlowId,
    // Forward audit fields — see CloudFlow + toFeature for the same
    // note about selector inclusion.
    createdBy: fl.CreatedBy,
    updatedBy: fl.LastUpdatedBy,
  };
}

// --- Chat adapter -----------------------------------------------------------
//
// `actionsJson` is the JSON-serialised `ChatAction[]` because the Blocks Data
// schema field types are primitives (the JSON-string trick is the same one the
// SDK uses for `filter` / `sort` parameters). Parse on read; serialise on write.
export interface ChatActionLike {
  id: string;
  label: string;
  kind: string;
  payload?: Record<string, unknown>;
}

export interface PersistedChatMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  actions?: ChatActionLike[];
}

export function toChatMessage(c: CloudChatMessage): PersistedChatMessage {
  let actions: ChatActionLike[] | undefined;
  if (c.actionsJson) {
    try {
      const parsed = JSON.parse(c.actionsJson);
      if (Array.isArray(parsed)) actions = parsed as ChatActionLike[];
    } catch {
      // Corrupt row — drop the actions but keep the message.
    }
  }
  return {
    id: c.ItemId,
    sessionId: c.sessionId ?? "",
    role: (c.role as PersistedChatMessage["role"]) ?? "assistant",
    content: c.content ?? "",
    timestamp: c.CreatedDate,
    actions,
  };
}

// --- Pagination envelope ----------------------------------------------------

interface PagedCloud<T> {
  items?: T[];
  totalCount?: number;
}

// The Blocks Data SDK returns the raw GraphQL envelope:
//   { data: { get<PluralSchema>: { items: [...], totalCount: N, ... } } }
// (or `{ data: { insert|update|delete<Schema>: { ... } }` for mutations).
// Drill through the operation field when present so the rest of the code
// can treat every response as a flat `{ items, totalCount }`.
function unwrapPaged<T>(raw: unknown): { items: T[]; totalCount: number } {
  const r = raw as
    | { data?: Record<string, PagedCloud<T>> | PagedCloud<T> }
    | PagedCloud<T>
    | undefined;
  const dataLayer = (r && "data" in r ? r.data : r) as
    | Record<string, PagedCloud<T>>
    | PagedCloud<T>
    | undefined;
  const paged: PagedCloud<T> | undefined = (() => {
    if (!dataLayer) return undefined;
    if (Array.isArray(dataLayer)) return undefined;
    if ("items" in dataLayer || "totalCount" in dataLayer) {
      return dataLayer as PagedCloud<T>;
    }
    // Otherwise `dataLayer` is `{ getXxx: { items, totalCount } }` —
    // pick the first object value.
    for (const v of Object.values(dataLayer as Record<string, PagedCloud<T>>)) {
      if (v && typeof v === "object" && ("items" in v || "totalCount" in v)) {
        return v;
      }
    }
    return undefined;
  })();
  return {
    items: paged?.items ?? [],
    totalCount: paged?.totalCount ?? 0,
  };
}

// --- Collection accessors ---------------------------------------------------

export const projectsCollection = blocksClient.data.collection<CloudProject>("Project", {
  fields: ["name", "description", "status", "color", "customEnvs", "envLabelOverrides", "CreatedBy", "CreatedDate", "LastUpdatedBy", "LastUpdatedDate"],
});
export const featuresCollection = blocksClient.data.collection<CloudFeature>("Feature", {
  // `CreatedBy` / `LastUpdatedBy` are platform-managed audit fields — not
  // declared in the Feature schema — but they ARE returned by the gateway
  // if listed in the selector. The Feature row's details drawer surfaces
  // them, and ProjectInfoPage mirrors the same. Keep them aligned across
  // the three collections so future "Created by" surfaces inherit the
  // same plumbing.
  fields: ["title", "description", "status", "priority", "projectId", "tags", "envSlug", "clonedFromFeatureId", "CreatedBy", "CreatedDate", "LastUpdatedBy", "LastUpdatedDate"],
});
export const flowsCollection = blocksClient.data.collection<CloudFlow>("Flow", {
  // `CreatedBy` is included in the field list so the per-user filter at
  // sibling-lookup time can match against it. The Flow schema doesn't
  // declare a custom `CreatedBy` — it comes from the platform — but the
  // selector list the SDK sends to the gateway gates which fields come
  // back, AND which fields the gateway will accept in a filter. If a
  // field is omitted from the list, the filter parser treats references
  // to it as no-ops, silently dropping sibling rows out of the result.
  // `LastUpdatedBy` rides along so the drawer's "Updated by" reads real
  // data rather than the "—" fallback.
  fields: ["title", "description", "steps", "status", "stack", "featureId", "envSlug", "clonedFromFlowId", "CreatedBy", "CreatedDate", "LastUpdatedBy", "LastUpdatedDate"],
});
export const chatMessagesCollection = blocksClient.data.collection<CloudChatMessage>("ChatMessage", {
  fields: ["sessionId", "role", "content", "actionsJson", "CreatedDate", "LastUpdatedDate"],
});

// --- Helpers ----------------------------------------------------------------

// Build the "current user's projects" filter. The platform stamps
// `CreatedBy` on insert from the OIDC `sub` claim, so filtering on it scopes
// list/get/delete to the signed-in caller.
//
// The Blocks Data Gateway filter parser expects a flat key/value shape
// (`{ CreatedBy: "<uid>" }`), not the Mongo/Hasura-style operator object
// (`{ CreatedBy: { eq: "<uid>" } }`) — operator objects are silently
// ignored and the query returns an empty page.
export function createdByFilter(userId: string) {
  return { CreatedBy: userId };
}