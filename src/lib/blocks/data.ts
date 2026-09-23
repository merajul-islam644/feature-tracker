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
  // OIDC `sub`s of users assigned to develop this feature. Populated
  // from the "Assign Developers" multi-select on the Add Feature modal.
  // A feature can be co-developed by any number of developers — empty
  // array (or omitted) means unassigned. Per-env — different teams own
  // different envs, so dev assignments do NOT cascade to cloned
  // siblings in stg/uat/prod. The FeatureDetailsDrawer renders "—" when
  // the array is empty or every entry is unrecognised.
  developerIds?: string[];
  // OIDC `sub`s of users assigned to QA this feature. Same array
  // shape + per-env semantics as `developerIds`. Populated from the
  // "Assign QAs" multi-select, which sources from users with the
  // `tester` IAM role.
  qaIds?: string[];
  // Optional GitHub URL — issue, PR, or repo path — associated with
  // this feature. Free-form string; no validation enforced at the
  // data layer (the AddFeatureModal adds an `https://` prefix when
  // the user omits the scheme). Rendered as a clickable external
  // link in `FeatureDetailsDrawer`.
  githubLink?: string;
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

// Direct (member-to-member) messages. Unlike ChatMessage (a user's private
// thread with the AI assistant), these rows are WRITTEN by the sender but
// READ by the recipient — so the list hooks filter on `senderId` /
// `recipientId` columns instead of the platform's CreatedBy. `readAt` rides
// as a plain string ("" while unread) because Blocks Data fields are
// primitives.
export interface CloudDirectMessage {
  ItemId: string;
  senderId: string;
  recipientId: string;
  content: string;
  readAt?: string;
  attachmentFileId?: string;
  CreatedDate: string;
  LastUpdatedDate: string;
  CreatedBy?: string;
}

// Manager announcements shown on the Dashboard. Written by a manager,
// read by EVERY workspace member — no per-user filter on the read path.
// Posting is gated client-side (manager role), mirroring the tester
// guards on the project mutations.
export interface CloudAnnouncement {
  ItemId: string;
  authorId: string;
  content: string;
  CreatedDate: string;
  LastUpdatedDate: string;
  CreatedBy?: string;
}

// --- Issue Tracker cloud shapes --------------------------------------------
//
// The Issue Tracker feature keeps its per-user data in three separate
// collections so each row can be filtered, mutated, and permission-gated
// independently. Targets (configured URLs) and secrets (credentials) are
// each their own collection because their mutating hooks carry different
// role gates; issues are their own collection so per-run provenance and
// per-row status edits stay atomic.
//
// `enabled` rides the wire as `"true"` / `"false"` (Blocks Data fields are
// primitives — there's no native boolean), and `evidence` /
// `reproductionSteps` ride as JSON-encoded strings for the same reason.
// The adapter functions on the UI side handle the coercion.

export interface CloudVerificationTarget {
  ItemId: string;
  applicationName: string;
  url: string;
  environment: string;
  credentialId?: string;
  // `String` of "true" | "false" — see the adapter for the boolean rehydrate.
  enabled: string;
  lastVerifiedAt?: string;
  lastStatus?: string;
  CreatedDate: string;
  LastUpdatedDate: string;
  CreatedBy?: string;
}

export interface CloudSecret {
  ItemId: string;
  name: string;
  email: string;
  passwordMasked: string;
  CreatedDate: string;
  LastUpdatedDate: string;
  CreatedBy?: string;
}

export interface CloudIssue {
  ItemId: string;
  title: string;
  applicationName: string;
  url: string;
  category: string;
  severity: string;
  status: string;
  description?: string;
  expected?: string;
  actual?: string;
  reproductionStepsJson?: string;
  evidenceJson?: string;
  detectedAt: string;
  verificationRunId?: string;
  // Dedup identity + recurrence stats (numeric strings on the wire —
  // Blocks Data only stores primitives). Absent on pre-fingerprint rows.
  fingerprint?: string;
  occurrenceCount?: string;
  lastSeenAt?: string;
  seenInRunIdsJson?: string;
  // Developer triage (multi-assign) — set from the issue-group dropdown.
  // Empty while unassigned; absent on rows created before the field existed.
  assignedDeveloperIdsJson?: string;
  // Tester approval — OIDC sub of the tester who re-tested and approved.
  // Empty while unapproved; absent on rows created before the field existed.
  approvedById?: string;
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
  // OIDC `sub`s of the assigned developers. See CloudFeature.developerIds
  // for the per-env semantics and how empty / other-user arrays render in
  // the details drawer. Replaces the single-value `developerId` field.
  developerIds?: string[];
  // OIDC `sub`s of the assigned QAs. See CloudFeature.qaIds for the
  // per-env semantics and the "tester" role the multi-select is
  // populated from. Replaces the single-value `qaId` field.
  qaIds?: string[];
  // Optional GitHub URL the manager attached to this feature in the
  // AddFeatureModal. Empty/undefined → drawer hides the row entirely
  // rather than rendering a broken-link placeholder.
  githubLink?: string;
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
    developerIds: f.developerIds,
    qaIds: f.qaIds,
    // `githubLink` is optional on the cloud record (the schema marks
    // `requiredOn: 0`). Normalize empty strings to `undefined` so the
    // Feature Details drawer doesn't render an empty row + a broken
    // `https://` link.
    githubLink: typeof f.githubLink === "string" && f.githubLink.trim() !== ""
      ? f.githubLink.trim()
      : undefined,
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

// --- Issue Tracker adapters -------------------------------------------------
//
// These take a Cloud-shape record (camelCase platform fields + JSON-string
// blobs) and return the matching UI `Issue` / `Secret` / `VerificationTarget`
// shapes from `src/types/issue-tracker.ts`. Keeping the wire ↔ UI translation
// in one place means call sites never have to know about the
// `"true"/"false"` boolean-as-string quirk or the JSON encoding.

import type {
  Evidence,
  Issue,
  IssueCategory,
  IssueSeverity,
  IssueStatus,
  Secret,
  TargetEnvironment,
  TargetStatus,
  VerificationTarget,
} from "@/types/issue-tracker";

// Narrow union helpers — used by the adapters to safely coerce free-form
// `String` cloud fields into the typed enums the UI consumes. Unknown
// values fall through to the documented defaults so legacy or
// hand-edited rows don't break the page.
const TARGET_ENV_VALUES: readonly TargetEnvironment[] = [
  "production",
  "staging",
  "development",
  "preview",
];
const TARGET_STATUS_VALUES: readonly TargetStatus[] = [
  "not_verified",
  "queued",
  "verifying",
  "healthy",
  "issues_found",
  "verification_failed",
  "authentication_failed",
  "unreachable",
  "completed",
];
const ISSUE_SEVERITY_VALUES: readonly IssueSeverity[] = [
  "critical",
  "high",
  "medium",
  "low",
];
const ISSUE_STATUS_VALUES: readonly IssueStatus[] = [
  "open",
  "investigating",
  "confirmed",
  "fixed",
  "resolved",
  "wont_fix",
  "ignored",
  "reopened",
];
const ISSUE_CATEGORY_VALUES: readonly IssueCategory[] = [
  "authentication",
  "authorization",
  "navigation",
  "ui",
  "functional",
  "forms",
  "api",
  "performance",
  "accessibility",
  "other",
];

function narrowOr<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function narrowOrUndefined<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

// Reparse a JSON-encoded blob into a narrow shape; corrupt / missing
// payloads surface as `undefined` so the UI side keeps the field empty
// instead of throwing. Mirrors the `toChatMessage` `actionsJson` and
// `toProject` `customEnvs` graceful fallbacks.
function parseJsonArray<T>(raw: string | undefined): T[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as T[];
  } catch {
    // Corrupt blob — drop it but keep the parent record.
  }
  return undefined;
}

export function toVerificationTarget(
  t: CloudVerificationTarget,
): VerificationTarget {
  return {
    id: t.ItemId,
    applicationName: t.applicationName ?? "",
    url: t.url ?? "",
    environment: narrowOr<TargetEnvironment>(
      t.environment,
      TARGET_ENV_VALUES,
      "production",
    ),
    credentialId: t.credentialId ?? null,
    // `enabled` rides the wire as `"true"/"false"` — coerce so the UI
    // gets a real boolean without the consumer knowing the wire quirk.
    enabled: String(t.enabled ?? "true").toLowerCase() !== "false",
    lastVerifiedAt: t.lastVerifiedAt ?? null,
    lastStatus: narrowOrUndefined<TargetStatus>(t.lastStatus, TARGET_STATUS_VALUES) ?? null,
    createdAt: t.CreatedDate,
    updatedAt: t.LastUpdatedDate,
  };
}

export function toSecret(s: CloudSecret): Secret {
  return {
    id: s.ItemId,
    name: s.name ?? "",
    email: s.email ?? "",
    passwordMasked: s.passwordMasked ?? "••••••••••",
    createdAt: s.CreatedDate,
    updatedAt: s.LastUpdatedDate,
  };
}

export function toIssue(i: CloudIssue): Issue {
  // Evidence + reproductionSteps stay independent — losing one (corrupt
  // blob) shouldn't blank the other. `optional` fields fall back to
  // undefined so the optional typing on `Issue` is preserved.
  const evidence = parseJsonArray<Evidence>(i.evidenceJson);
  const reproductionSteps = parseJsonArray<string>(i.reproductionStepsJson);
  const seenInRunIds = parseJsonArray<string>(i.seenInRunIdsJson);
  return {
    id: i.ItemId,
    title: i.title ?? "",
    applicationName: i.applicationName ?? "",
    url: i.url ?? "",
    category: narrowOr<IssueCategory>(
      i.category,
      ISSUE_CATEGORY_VALUES,
      "other",
    ),
    severity: narrowOr<IssueSeverity>(
      i.severity,
      ISSUE_SEVERITY_VALUES,
      "low",
    ),
    status: narrowOr<IssueStatus>(
      i.status,
      ISSUE_STATUS_VALUES,
      "open",
    ),
    description: i.description ?? "",
    expected: i.expected,
    actual: i.actual,
    reproductionSteps,
    evidence,
    detectedAt: i.detectedAt ?? i.CreatedDate,
    verificationRunId: i.verificationRunId,
    fingerprint: i.fingerprint,
    // Numeric-on-the-wire → number; absent stays undefined so
    // `occurrenceCount ?? 1` reads correctly for legacy rows.
    occurrenceCount: i.occurrenceCount
      ? Number(i.occurrenceCount) || undefined
      : undefined,
    lastSeenAt: i.lastSeenAt,
    seenInRunIds,
    assignedDeveloperIds: parseJsonArray<string>(i.assignedDeveloperIdsJson),
    // Absent/empty stays undefined so `!!issue.approvedById` gates cleanly.
    approvedById: i.approvedById || undefined,
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

// --- Direct message adapter ---------------------------------------------------

export interface DirectMessage {
  id: string;
  senderId: string;
  recipientId: string;
  content: string;
  sentAt: string;
  /** ISO timestamp once the recipient has seen it; null while unread. */
  readAt: string | null;
  /** Blocks Data Storage file id of an optional image attachment. Null when
   * the message is text-only — receivers render an inline thumb via
   * useFileDownloadUrl(fileId) only when this is a non-empty string. */
  attachmentFileId: string | null;
}

export function toDirectMessage(c: CloudDirectMessage): DirectMessage {
  return {
    id: c.ItemId,
    senderId: c.senderId ?? "",
    recipientId: c.recipientId ?? "",
    content: c.content ?? "",
    sentAt: c.CreatedDate,
    readAt: c.readAt || null,
    attachmentFileId: c.attachmentFileId || null,
  };
}

// --- Announcement adapter -----------------------------------------------------

export interface Announcement {
  id: string;
  authorId: string;
  content: string;
  postedAt: string;
}

export function toAnnouncement(c: CloudAnnouncement): Announcement {
  return {
    id: c.ItemId,
    authorId: c.authorId ?? "",
    content: c.content ?? "",
    postedAt: c.CreatedDate,
  };
}

// --- Profile picture adapter --------------------------------------------------
//
// The user's profile picture bytes live in Blocks Data Storage (files); this
// row only maps an IAM user id to the uploaded file's id, so every avatar
// surface (chat roster, thread header, announcements, members grid, topbar)
// can resolve userId → picture with a single workspace-wide list call.
export interface CloudUserProfile {
  ItemId: string;
  userId: string;
  imageFileId?: string;
  CreatedDate: string;
  LastUpdatedDate: string;
  CreatedBy?: string;
}

export interface UserProfilePic {
  /** Row id — needed for the update leg of the upload upsert. */
  id: string;
  userId: string;
  /** Blocks Data Storage file id of the picture; null while unset. */
  imageFileId: string | null;
}

export function toUserProfilePic(c: CloudUserProfile): UserProfilePic {
  return {
    id: c.ItemId,
    userId: c.userId ?? "",
    imageFileId: c.imageFileId || null,
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
  // `developerIds` / `qaIds` are the optional assignment arrays added by
  // the "Assign Developers / Assign QAs" multi-selects on the Add Feature
  // modal. They MUST be in the selector — same reason as CreatedBy:
  // omitted fields are dropped from the read response AND from any
  // filter the gateway might receive later. These are the multi-value
  // replacements for the old `developerId` / `qaId` singular fields.
  fields: ["title", "description", "status", "priority", "projectId", "tags", "envSlug", "clonedFromFeatureId", "developerIds", "qaIds", "githubLink", "CreatedBy", "CreatedDate", "LastUpdatedBy", "LastUpdatedDate"],
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
// `senderId` / `recipientId` MUST both be in the selector: the inbox and
// outbox reads filter on them, and the gateway drops filter clauses whose
// field isn't selected (the same silent no-op that caused the duplicate-
// rows bug on Issue). `readAt` feeds the unread badges / read ticks.
export const directMessagesCollection = blocksClient.data.collection<CloudDirectMessage>("DirectMessage", {
  fields: ["senderId", "recipientId", "content", "readAt", "attachmentFileId", "CreatedBy", "CreatedDate", "LastUpdatedBy", "LastUpdatedDate"],
});
// `authorId` in the selector for the same filter-gating reason as the DM
// columns; `CreatedBy` rides along for the audit-style "posted by" render.
export const announcementsCollection = blocksClient.data.collection<CloudAnnouncement>("Announcement", {
  fields: ["authorId", "content", "CreatedBy", "CreatedDate", "LastUpdatedBy", "LastUpdatedDate"],
});
// `userId` MUST be selected: the read path filters on it when looking up the
// caller's own row for the upload upsert (an unselected filter column is
// silently dropped by the gateway — the duplicate-rows lesson from Issue).
export const userProfilesCollection = blocksClient.data.collection<CloudUserProfile>("UserProfile", {
  fields: ["userId", "imageFileId", "CreatedBy", "CreatedDate", "LastUpdatedBy", "LastUpdatedDate"],
});

// --- Issue Tracker collection accessors -------------------------------------
//
// Each accessor lists every field a hook might read or filter by. Missing
// fields are dropped from the response AND from any filter the gateway
// receives later — that's why `enabled` (the boolean-encoded-string) and
// the JSON-encoded `reproductionStepsJson` / `evidenceJson` ride along
// even though the UI only consumes them through the adapter.

export const verificationTargetsCollection = blocksClient.data.collection<CloudVerificationTarget>(
  "VerificationTarget",
  {
    fields: [
      "applicationName",
      "url",
      "environment",
      "credentialId",
      "enabled",
      "lastVerifiedAt",
      "lastStatus",
      "CreatedBy",
      "CreatedDate",
      "LastUpdatedBy",
      "LastUpdatedDate",
    ],
  },
);
export const secretsCollection = blocksClient.data.collection<CloudSecret>(
  "Secret",
  {
    fields: [
      "name",
      "email",
      "passwordMasked",
      "CreatedBy",
      "CreatedDate",
      "LastUpdatedBy",
      "LastUpdatedDate",
    ],
  },
);
export const issuesCollection = blocksClient.data.collection<CloudIssue>(
  "Issue",
  {
    fields: [
      "title",
      "applicationName",
      "url",
      "category",
      "severity",
      "status",
      "description",
      "expected",
      "actual",
      "reproductionStepsJson",
      "evidenceJson",
      "detectedAt",
      "verificationRunId",
      // Dedup identity + recurrence stats — MUST stay in the selection:
      // persistDetectedIssue matches loaded rows by fingerprint, and a
      // missing column here maps to `undefined` on every row, so every
      // re-detection files a duplicate instead of merging.
      "fingerprint",
      "occurrenceCount",
      "lastSeenAt",
      "seenInRunIdsJson",
      "assignedDeveloperIdsJson",
      "approvedById",
      "CreatedBy",
      "CreatedDate",
      "LastUpdatedBy",
      "LastUpdatedDate",
    ],
  },
);

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