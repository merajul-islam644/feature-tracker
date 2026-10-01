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
  // Owning Environment.ItemId — the env *identity*. envSlug is only the
  // display/URL cache (renameable); scoping keys off this id so env
  // renames never orphan rows. Optional until the migration backfills,
  // then stamped from the resolved env row on every create.
  environmentId?: string;
  // ItemId of the dev feature this record was cloned from. Stamped on
  // insert by the sibling-create in `useCloneFeature` — the cross-env
  // sync feature (delete + rename on dev) uses this to find sibling
  // features in other envs. Undefined for source records and
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
  // Owning Environment.ItemId — ALWAYS copied from the parent Feature's
  // environmentId by the create hook (same rule as envSlug). No code path
  // may set it independently; the flow lives where its feature lives.
  environmentId?: string;
  // ItemId of the dev flow this record was cloned from. Stamped on insert
  // by the flow-cascade in `useCloneFeature` — the cross-env sync feature
  // (delete + rename on dev) uses this to find sibling flows in other envs.
  // Undefined for source records and pre-existing clones made before this
  // feature shipped.
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
//
// Reactions + edit + delete are all in-band on the row itself: each is a
// String field carrying either an empty string or the relevant payload.
// The client-side `DirectMessageReaction` type widens `reactions` into a
// real `MessageReaction[]` array for type safety.
export interface CloudDirectMessage {
  ItemId: string;
  senderId: string;
  recipientId: string;
  content: string;
  readAt?: string;
  attachmentFileId?: string;
  reactions?: string;
  editedAt?: string;
  deletedAt?: string;
  /** `'call_log'` for system rows that summarize a voice/video call; empty
   * string for regular text/attachment rows. Renderer branches on this to
   * swap the bubble for a centered pill. See `messageType` on the UI side
   * for the narrowing. */
  messageType?: string;
  /** Localized human-readable summary string the thread pill + roster
   * preview render (e.g. "Voice call · 5:32", "Missed voice call"). Empty
   * string for regular messages. */
  callSummary?: string;
  CreatedDate: string;
  LastUpdatedDate: string;
  CreatedBy?: string;
}

// --- Call signaling (WebRTC) --------------------------------------------------
//
// One row per WebRTC call attempt. Created by the caller with status
// 'ringing' and the SDP offer; mutated by both sides as the call
// progresses (SDP answer from the recipient, ICE candidates trickled by
// both via the 2s poll, status transitioning through the lifecycle).
// Workspace-readable so both peers can read the same row — matches the
// DirectMessage precedent (no per-row rules.json gate).
export interface CloudCallSignal {
  ItemId: string;
  callerId: string;
  recipientId: string;
  kind: string;
  status: string;
  sdpOffer?: string;
  sdpAnswer?: string;
  iceCandidatesJson?: string;
  endedAt?: string;
  endReason?: string;
  CreatedDate: string;
  LastUpdatedDate: string;
  CreatedBy?: string;
}

// One ICE candidate as it rides the wire (JSON-string column) and as it
// surfaces on the RTCPeerConnection's icecandidate event. Matches the
// standard RTCIceCandidateInit shape (sdpMid/sdpMLineIndex may be null
// for some candidates).
export interface CallSignalIceCandidate {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

// UI-facing shape: status narrowed to the state-machine union, SDP
// blobs parsed into RTCSessionDescriptionInit, ICE candidates parsed
// into a real array. The on-wire `requiredOn: 3` columns (callerId /
// recipientId / kind / status) are echoed as required strings here
// because every PATCH has to send them — narrowing them to optional
// would let a sloppy mutation silently drop them.
export interface CallSignal {
  id: string;
  callerId: string;
  recipientId: string;
  kind: "voice" | "video";
  status: "ringing" | "accepted" | "declined" | "ended" | "missed";
  /** Caller's SDP offer (parsed from the JSON-encoded `sdpOffer` column). */
  sdpOffer: RTCSessionDescriptionInit | null;
  /** Recipient's SDP answer (parsed from the JSON-encoded `sdpAnswer` column). */
  sdpAnswer: RTCSessionDescriptionInit | null;
  /** Trickled ICE candidates accumulated from both sides. Deduped by the
   * `candidate` string so a 2s poll that re-reads the same blob doesn't
   * apply the same candidate twice. */
  iceCandidates: CallSignalIceCandidate[];
  /** ISO timestamp set by whichever side ended the call; null while live. */
  endedAt: string | null;
  /** Why the call ended — drives the localized closing toast. */
  endReason: "hangup" | "declined" | "missed" | "error" | null;
  createdAt: string;
  updatedAt: string;
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

// --- Flow comment ------------------------------------------------------------
//
// One row per comment OR reply attached to a flow. The wire shape is flat —
// a reply is just a row whose `parentId` points at the parent's `ItemId` —
// because Blocks Data only supports primitive fields (no nested objects /
// arrays). The CommentsModal re-groups rows by `parentId` to build the
// nested thread it renders, but every row carries the same six custom
// fields + the platform-managed audit timestamps.
//
// Workspace-readable by every role: a manager, a developer, and a tester all
// see the same comments on the same flow. There is no per-user filter on
// the read path — annotations are a cross-role discussion surface, not a
// private inbox (matches `Announcement` / `Issue` / `TestCase`, all of which
// are workspace-wide reads without a `createdByFilter`).
//
// `parentId` is the parent's `ItemId` for replies, and is OMITTED (or
// carried as "") for top-level comments. Empty string is allowed on the
// wire (legacy rows use it); new top-level writes skip the field
// entirely because the gateway's strict Required validator rejects
// empty strings on insert ("Field 'parentId' is required for insert",
// verified 2026-09-27). The schema field is `requiredOn: "None"`.
export interface CloudFlowComment {
  ItemId: string;
  flowId: string;
  parentId?: string;
  authorId: string;
  authorName: string;
  authorEmail?: string;
  authorAvatar?: string;
  content: string;
  CreatedDate: string;
  LastUpdatedDate: string;
  CreatedBy?: string;
}

// Flat row shape — every comment AND every reply is one of these. The
// `parentId` field is what groups rows into threads; consumers either use
// it directly (the row-grouping logic in `FlowItem`) or drop it
// (the threaded view in `CommentsModal`).
//
// `authorId` is the IAM sub of the commenter; surfaced on the row so the
// reply-side notification fan-out can look up the parent comment's author
// (the user who owns the conversation being replied to) without a
// follow-up read. Without it the notifier would have to treat every
// reply as "reply to nothing" and skip the notification entirely.
export interface FlowCommentRow {
  id: string;
  /** Empty string for top-level rows; the parent's row id for replies. */
  parentId: string;
  authorId: string;
  authorName: string;
  authorEmail: string;
  authorAvatar?: string;
  content: string;
  createdAt: string;
}

// --- Notification ----------------------------------------------------------
//
// One row per (recipient, action) pair. The recipient is `userId`; the
// sender's hooks write one row per user they target. The inbox reads with
// `filter: { userId: <me> }` so each user only sees their own rows —
// same per-user filter pattern as `CloudDirectMessage.recipientId` and
// `CloudCallSignal.recipientId`. Replaces the previous path through the
// platform's `GetNotifications` endpoint, which on this tenant returns
// an empty `notifications` array for app-sent records (see
// `docs/platform-bug-notifier-enumeration.md`).
//
// The denormalized display fields (projectName / featureName / flowName /
// envSlug / oldName / newName / status / stack) are captured at write
// time so the inbox renderer can build a sentence without a follow-up
// read — they may go stale if the underlying resource is renamed later,
// but the title/body only need to reflect what was true at the moment
// of the action.
export interface CloudNotification {
  ItemId: string;
  userId: string;
  context: string;
  actionName: string;
  actorId: string;
  value?: string;
  actorName?: string;
  projectId?: string;
  projectName?: string;
  featureId?: string;
  featureName?: string;
  flowId?: string;
  flowName?: string;
  envSlug?: string;
  oldName?: string;
  newName?: string;
  status?: string;
  stack?: string;
  readAt?: string;
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
  // Per-environment scoping — see VerificationTarget (UI type) for the
  // rationale. Legacy rows absent these fields are dropped by the
  // filter in `useIssueTracker`.
  projectId?: string;
  envSlug?: string;
  // Owning Environment.ItemId — env identity; envSlug stays the display
  // cache. Stamped from the resolved env row at creation; empty on
  // pre-migration rows.
  environmentId?: string;
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
  // Per-environment scoping — see Secret (UI type) for the rationale.
  projectId?: string;
  envSlug?: string;
  // Owning Environment.ItemId — env identity; envSlug stays the display
  // cache. Stamped from the resolved env row at creation.
  environmentId?: string;
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
  // Per-environment scoping — see Issue (UI type) for the rationale.
  // Set by the verification agent at detection time.
  projectId?: string;
  envSlug?: string;
  // Owning Environment.ItemId — env identity; envSlug stays the display
  // cache. Stamped by the verification agent from the resolved env row.
  environmentId?: string;
  // VerificationTarget.ItemId the defect was found on — a hard link that
  // survives URL edits (the `url` string is display-only). Empty on
  // legacy rows, which match by url text instead.
  targetId?: string;
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
  // Owning Environment.ItemId — env identity; envSlug is only the
  // display/URL cache. Optional until migration backfills.
  environmentId?: string;
  // ItemId of the dev feature this was cloned from. Set by the
  // sibling-create in `useCloneFeature`; the cross-env sync feature uses
  // it to find sibling features when the dev feature is renamed or
  // deleted. Optional — undefined for source records and pre-existing
  // clones.
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
  // Owning Environment.ItemId — env identity; mirrors the parent feature's
  // environmentId (the create hook copies it alongside envSlug).
  environmentId?: string;
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
   *  the flow-cascade in `useCloneFeature`; the cross-env sync feature
   *  uses it to find sibling flows when the dev flow is renamed or
   *  deleted. Optional — undefined for source records and pre-existing
   *  clones. */
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
    environmentId: f.environmentId,
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
    environmentId: fl.environmentId,
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
    // `projectId` / `envSlug` are required at the UI layer for env-
    // scoped Issue Tracker. Legacy rows missing them are filtered out
    // by `useIssueTracker` before they reach the UI; the `?? ""`
    // fallback here just keeps the type-check honest for the rare
    // unfiltered read.
    projectId: t.projectId ?? "",
    envSlug: t.envSlug ?? "",
    environmentId: t.environmentId ?? "",
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
    // Same scoping story as VerificationTarget above.
    projectId: s.projectId ?? "",
    envSlug: s.envSlug ?? "",
    environmentId: s.environmentId ?? "",
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
    // Per-environment scoping — see VerificationTarget for the same
    // story. The verification agent stamps these at detection time;
    // legacy rows without them are dropped by `useIssueTracker`.
    projectId: i.projectId ?? "",
    envSlug: i.envSlug ?? "",
    environmentId: i.environmentId ?? "",
    targetId: i.targetId,
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
  /** Decoded reactions payload (was JSON in the cloud row's `reactions`
   * field). Empty array when nobody has reacted. Each reaction is one
   * `{userId, emoji}` pair; the same user reacting twice with the same
   * emoji is deduped on the way out so the bubble pill renders "👍 ×1"
   * not "👍 ×2". */
  reactions: MessageReaction[];
  /** ISO timestamp set by the sender the last time they edited
   * `content`; null while the message is unedited. The bubble appends
   * "(edited)" to the footer when this is non-null. */
  editedAt: string | null;
  /** ISO timestamp set by the sender when they soft-deleted the
   * message; null while live. The bubble renders a tombstone in that
   * state (no text, no attachment, no reactions, no footer). */
  deletedAt: string | null;
  /** `'call_log'` for system rows that summarize a voice/video call;
   * `null` for regular text/attachment rows. The renderer branches on
   * this to swap the bubble for a centered pill. Mirrors the
   * empty-string → null coercion that `editedAt` / `deletedAt` use so
   * the type is exact (no "undefined" leaks from the cloud row). */
  messageType: "call_log" | null;
  /** Localized human-readable summary rendered by the thread pill and
   * the roster preview (`"Voice call · 5:32"`, `"Missed voice call"`,
   * etc.). `null` for regular messages. */
  callSummary: string | null;
}

export interface MessageReaction {
  userId: string;
  emoji: string;
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
    reactions: parseReactions(c.reactions),
    editedAt: c.editedAt || null,
    deletedAt: c.deletedAt || null,
    // Narrow the wire string to the single known value. Anything else
    // (empty string, legacy rows, hand-edited records) reads as the
    // regular message branch — exactly the empty-string → null
    // coercion the `editedAt` / `deletedAt` precedent uses.
    messageType: c.messageType === "call_log" ? "call_log" : null,
    callSummary: c.callSummary || null,
  };
}

// Parse the cloud row's `reactions` string into a real array. Returns
// an empty array on any parse failure so a malformed write (manual
// row patch, mid-migration read) never throws inside the thread
// renderer.
function parseReactions(raw: string | undefined): MessageReaction[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (r): r is MessageReaction =>
          typeof r?.userId === "string" &&
          typeof r?.emoji === "string" &&
          r.emoji.length > 0,
      )
      // Dedupe — same user / same emoji collapsed to one entry. The
      // toggle mutation enforces this on the write path; this is the
      // belt-and-braces for legacy rows.
      .reduce<MessageReaction[]>((acc, r) => {
        if (
          !acc.some(
            (existing) =>
              existing.userId === r.userId && existing.emoji === r.emoji,
          )
        ) {
          acc.push(r);
        }
        return acc;
      }, []);
  } catch {
    return [];
  }
}

// --- CallSignal adapter -------------------------------------------------------
//
// Cloud shape → UI shape for the WebRTC signaling row. The on-wire blobs
// (sdpOffer / sdpAnswer / iceCandidatesJson) are JSON strings — they
// round-trip through String-only Blocks Data fields. Parsing failures
// degrade to safe defaults (null SDP, empty ICE array) so a malformed
// row never throws inside the call renderer.

const CALL_KIND_VALUES = ["voice", "video"] as const;
const CALL_STATUS_VALUES = [
  "ringing",
  "accepted",
  "declined",
  "ended",
  "missed",
] as const;
const CALL_END_REASON_VALUES = [
  "hangup",
  "declined",
  "missed",
  "error",
] as const;

function parseSdp(raw: string | undefined): RTCSessionDescriptionInit | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.type === "string" &&
      typeof parsed.sdp === "string"
    ) {
      return parsed as RTCSessionDescriptionInit;
    }
  } catch {
    // Corrupt blob — drop it but keep the row.
  }
  return null;
}

function parseIceCandidates(
  raw: string | undefined,
): CallSignalIceCandidate[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (c): c is CallSignalIceCandidate =>
          c &&
          typeof c === "object" &&
          typeof c.candidate === "string" &&
          (c.sdpMid === null || typeof c.sdpMid === "string") &&
          (c.sdpMLineIndex === null ||
            typeof c.sdpMLineIndex === "number"),
      )
      // Dedupe by `candidate` string — both sides write into the same
      // JSON blob, so the trickle loop would otherwise append the
      // peer's own candidates back into its own queue.
      .reduce<CallSignalIceCandidate[]>((acc, c) => {
        if (!acc.some((existing) => existing.candidate === c.candidate)) {
          acc.push(c);
        }
        return acc;
      }, []);
  } catch {
    // Corrupt blob — return an empty array so the PC doesn't try to
    // add candidates that no longer exist on the wire.
  }
  return [];
}

export function toCallSignal(c: CloudCallSignal): CallSignal {
  const kind = (CALL_KIND_VALUES as readonly string[]).includes(c.kind)
    ? (c.kind as CallSignal["kind"])
    : "voice";
  const status = (CALL_STATUS_VALUES as readonly string[]).includes(c.status)
    ? (c.status as CallSignal["status"])
    : "ringing";
  const endReason =
    c.endReason &&
    (CALL_END_REASON_VALUES as readonly string[]).includes(c.endReason)
      ? (c.endReason as CallSignal["endReason"])
      : null;
  return {
    id: c.ItemId,
    callerId: c.callerId ?? "",
    recipientId: c.recipientId ?? "",
    kind,
    status,
    sdpOffer: parseSdp(c.sdpOffer),
    sdpAnswer: parseSdp(c.sdpAnswer),
    iceCandidates: parseIceCandidates(c.iceCandidatesJson),
    endedAt: c.endedAt || null,
    endReason,
    createdAt: c.CreatedDate,
    updatedAt: c.LastUpdatedDate,
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
    // `postedAt` reflects the most recent activity the user is
    // looking at — a brand-new post is `CreatedDate`, and an edit
    // or repost advances `LastUpdatedDate`. Sorting the list by
    // `LastUpdatedDate` (see `useAnnouncements`) keeps the
    // "Latest" card in sync with this displayed time.
    postedAt: c.LastUpdatedDate ?? c.CreatedDate,
  };
}

// --- Flow comment adapter ----------------------------------------------------
//
// Cloud row → flat row shape used by `useFlowComments`. Threads are
// reconstructed in `FlowItem` by grouping rows by `parentId`. The adapter
// intentionally drops nothing — every cloud field maps to a UI field —
// because the threaded view builder in `FlowItem` re-reads `parentId`
// later, and silently degrading it to undefined (the same way other
// optional-string fields degrade) would lose the threading link.
export function toFlowCommentRow(c: CloudFlowComment): FlowCommentRow {
  return {
    id: c.ItemId,
    // Defensive default to "" — top-level comments either omit the field
    // (new writes, since `parentId.requiredOn: "None"`) or carry "" on the
    // wire (legacy rows). Either way the grouping logic in `FlowItem`
    // treats `parentId === ""` as "no parent" and renders the row as a
    // top-level comment, so normalising both shapes to "" keeps the
    // thread builder symmetric.
    parentId: c.parentId ?? "",
    // `authorId` drives the reply-side notification fan-out (see
    // `useAddFlowCommentReply.onSuccess`); legacy rows written before
    // the column was required may carry no value, so degrade to "" and
    // let the notifier skip self-notify prompts when the identity is
    // unknown (matches the same defensive default `parentId` uses).
    authorId: c.authorId ?? "",
    authorName: c.authorName ?? "",
    authorEmail: c.authorEmail ?? "",
    // `authorAvatar` is optional on the wire (a user without a profile
    // picture posts without one). Degrade to undefined so the avatar
    // fallback in `CommentsModal.Avatar` renders the colored initial.
    authorAvatar: c.authorAvatar || undefined,
    content: c.content ?? "",
    createdAt: c.CreatedDate,
  };
}

// --- Notification adapter ----------------------------------------------------
//
// Cloud row → UI shape used by the inbox hooks in
// `src/lib/blocks/notifier.ts`. The UI shape is intentionally narrow —
// every optional field becomes `undefined` (not empty string) so the
// inbox renderer's `body ?? undefined` checks collapse cleanly.
//
// `id` is required: rows missing `ItemId` are skipped by
// `toInboxItem` upstream, so by the time we reach this adapter the id
// is always a string.
export interface Notification {
  id: string;
  userId: string;
  context: string;
  actionName: string;
  actorId: string;
  actorName: string;
  value?: string;
  projectId?: string;
  projectName?: string;
  featureId?: string;
  featureName?: string;
  flowId?: string;
  flowName?: string;
  envSlug?: string;
  oldName?: string;
  newName?: string;
  status?: string;
  stack?: string;
  /** ISO timestamp once the recipient has read the row; null while unread. */
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toNotification(c: CloudNotification): Notification {
  return {
    id: c.ItemId,
    userId: c.userId ?? "",
    context: c.context ?? "",
    actionName: c.actionName ?? "",
    actorId: c.actorId ?? "",
    actorName: c.actorName ?? "A manager",
    value: c.value || undefined,
    projectId: c.projectId || undefined,
    projectName: c.projectName || undefined,
    featureId: c.featureId || undefined,
    featureName: c.featureName || undefined,
    flowId: c.flowId || undefined,
    flowName: c.flowName || undefined,
    envSlug: c.envSlug || undefined,
    oldName: c.oldName || undefined,
    newName: c.newName || undefined,
    status: c.status || undefined,
    stack: c.stack || undefined,
    // Empty string on the wire maps to null in the UI — same shape as
    // `DirectMessage.readAt`. A row with no readAt field also reads as
    // null so `!!notification.readAt` gates cleanly.
    readAt: c.readAt ? c.readAt : null,
    createdAt: c.CreatedDate,
    updatedAt: c.LastUpdatedDate ?? c.CreatedDate,
  };
}

// --- Mail --------------------------------------------------------------------
//
// The in-app mailbox behind `/mail`. One row per (sender, recipient)
// pair on the `MailMessage` schema (blocks/data/schemas/MailMessage.json):
// the recipient's inbox filters `userId === me`, the sender's Sent view
// filters on CreatedBy. Blocks' outbound `mail.send()` has no inbox SDK
// (mailbox reads are CLI-only — see .codex/skills/blocks-mail), so this
// custom collection is the message store, justified like the custom
// Notification schema above.

export interface CloudMailMessage {
  ItemId: string;
  /** Recipient user id — the inbox filter target. */
  userId?: string;
  /** Sender user id. Duplicates CreatedBy so the Sent folder can filter explicitly. */
  fromId?: string;
  fromName?: string;
  fromEmail?: string;
  /** Denormalized recipient display name for the sender's Sent folder. */
  toName?: string;
  subject?: string;
  body?: string;
  /** Empty string while unread; ISO timestamp once marked read. */
  readAt?: string;
  CreatedDate: string;
  LastUpdatedDate?: string;
  CreatedBy?: string;
}

export interface MailMessage {
  id: string;
  userId: string;
  fromId: string;
  fromName: string;
  fromEmail: string;
  toName: string;
  subject: string;
  body: string;
  /** Null while unread — same shape as Notification.readAt. */
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toMailMessage(c: CloudMailMessage): MailMessage {
  return {
    id: c.ItemId,
    userId: c.userId ?? "",
    fromId: c.fromId ?? "",
    fromName: c.fromName ?? "Unknown sender",
    fromEmail: c.fromEmail ?? "",
    toName: c.toName ?? "",
    subject: c.subject ?? "(no subject)",
    body: c.body ?? "",
    // Same empty-string-while-unread convention as `toNotification`.
    readAt: c.readAt ? c.readAt : null,
    createdAt: c.CreatedDate,
    updatedAt: c.LastUpdatedDate ?? c.CreatedDate,
  };
}

// --- Test cases --------------------------------------------------------------
//
// A `TestCase` is a row in the test-case spreadsheet attached to a Feature.
// Each case carries the QA-side inputs (steps, expected, actual) and the
// outcome (status + priority). Rows are owned by a single Feature — the
// project + env are derivable via `useFeature(featureId)` when the
// spreadsheet needs to filter or colour by environment. `order` is a
// sparse stringified integer ("0", "10", "20") so future reorder inserts
// can slot rows between existing entries without a full re-numbering pass.
export type TestCaseStatus = "untested" | "pass" | "fail" | "blocked" | "skipped";
export const TEST_CASE_STATUS_VALUES: readonly TestCaseStatus[] = [
  "untested",
  "pass",
  "fail",
  "blocked",
  "skipped",
];
export type TestCasePriority = "low" | "medium" | "high";
export const TEST_CASE_PRIORITY_VALUES: readonly TestCasePriority[] = [
  "low",
  "medium",
  "high",
];

export interface CloudTestCase {
  ItemId: string;
  featureId: string;
  flowId: string;
  title: string;
  steps?: string;
  expectedResult?: string;
  actualResult?: string;
  status: string;
  priority?: string;
  assignedTo?: string;
  order?: string;
  tags?: string[];
  isDeletable?: boolean;
  CreatedDate: string;
  LastUpdatedDate: string;
  CreatedBy?: string;
  UpdatedBy?: string;
}

export interface TestCase {
  id: string;
  featureId: string;
  flowId: string;
  title: string;
  steps: string;
  expectedResult: string;
  actualResult: string;
  status: TestCaseStatus;
  priority: TestCasePriority;
  assignedTo: string;
  /** Sparse stringified integer ("0", "10", "20", ...). Smaller sorts first. */
  order: string;
  tags: string[];
  /**
   * Whether the row can be deleted from the spreadsheet UI. The 10
   * placeholder rows the spreadsheet auto-creates when a feature
   * first opens its test sheet are stamped `false` so the Delete
   * option disappears and `handleDeleteRow` refuses the API call.
   * Defaults to `true` for any row missing the field (existing
   * rows, user-inserted rows, future migrations).
   */
  isDeletable: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

export function toTestCase(t: CloudTestCase): TestCase {
  return {
    id: t.ItemId,
    featureId: t.featureId ?? "",
    // Legacy rows predating the flow-scope migration have no `flowId`
    // column on the wire — default to empty string. Such rows have
    // no parent flow in `flowsCollection` and will not match any
    // spreadsheet's filter — they're effectively orphaned data but
    // the feature-keyed Test Cases tab no longer exists to surface
    // them, so they're invisible.
    flowId: t.flowId ?? "",
    title: t.title ?? "",
    steps: t.steps ?? "",
    expectedResult: t.expectedResult ?? "",
    actualResult: t.actualResult ?? "",
    status: narrowOr<TestCaseStatus>(
      t.status,
      TEST_CASE_STATUS_VALUES,
      "untested",
    ),
    priority: narrowOr<TestCasePriority>(
      t.priority,
      TEST_CASE_PRIORITY_VALUES,
      "medium",
    ),
    assignedTo: t.assignedTo ?? "",
    order: t.order ?? "",
    tags: Array.isArray(t.tags) ? t.tags : [],
    // `isDeletable` defaults to `true` when missing. This is a
    // forward-compat choice: rows written before the field existed
    // (or by integrations that never stamp it) stay editable, and
    // the spreadsheet explicitly opts rows *out* of deletion by
    // setting it to `false` on the 10 auto-created defaults.
    isDeletable: t.isDeletable !== false,
    createdAt: t.CreatedDate,
    updatedAt: t.LastUpdatedDate,
    createdBy: t.CreatedBy ?? "",
    updatedBy: t.UpdatedBy ?? "",
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
  /** Origin of the current picture — "original" (raw upload) or "ai"
   *  (Replicate-stylized). Optional so legacy rows keep parsing. */
  source?: string;
  /** Style preset the AI avatar was generated with. Only meaningful when
   *  `source === "ai"`. */
  style?: string;
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
  /** Origin of the current picture. Defaults to `"original"` when the
   *  field is missing on legacy rows (see `toUserProfilePic`). */
  source: "original" | "ai";
  /** Style preset — only meaningful when `source === "ai"`. */
  style: string | null;
}

export function toUserProfilePic(c: CloudUserProfile): UserProfilePic {
  // Defensive parse: legacy rows pre-dating the `source` field come back
  // with `source: undefined`. Default to `"original"` so existing UI
  // paths (and any future "is this an AI avatar?" filter) keep working
  // without a backfill migration.
  const rawSource = c.source;
  const source: "original" | "ai" =
    rawSource === "ai" ? "ai" : "original";
  return {
    id: c.ItemId,
    userId: c.userId ?? "",
    imageFileId: c.imageFileId || null,
    source,
    style: c.style || null,
  };
}

// --- Per-user AI gateway config --------------------------------------------
//
// The Issue Tracker AI Assistant chat panel routes through the server-side
// `/api/ai/chat` proxy. By default the proxy uses `AI_GATEWAY_URL` /
// `AI_GATEWAY_MODEL` / `AI_GATEWAY_TOKEN` from the server process's `.env`,
// but each user can override all three from the Settings page so the same
// config follows them across browsers/devices. The browser sends the saved
// values as `x-ai-gateway-{url,model,token}` request headers; an empty string
// in any field tells the proxy to fall back to the server default.
//
// One row per user (upsert by `userId`). Ownership is enforced at the app
// layer via the read+write hooks (`useUserAiConfig` / `useSaveUserAiConfig`)
// that always filter by `currentUser.id` — same pattern as every other
// per-user collection in this project (UserProfile, MemberProject, etc.),
// none of which use cloud-side row policies.
/**
 * Provider id for the Issue Tracker AI chat gateway. Lives on `UserAiConfig`
 * (per-user, persisted in Blocks Data) so each user can pick their own
 * Anthropic vs OpenAI wiring without affecting anyone else.
 *
 * The server-side proxy (`vite.config.ts → aiChatProxy` in dev,
 * `server/prod-backend.mjs → proxyAiChat` in prod) reads `x-ai-chat-provider`
 * on every chat request; an unknown / missing id falls back to `"anthropic"`
 * so rows saved before this field existed keep working.
 */
export type ChatProviderId = "anthropic" | "openai";

export interface CloudUserAiConfig {
  ItemId: string;
  userId: string;
  /**
   * NEW: which provider to use. Missing on rows saved before this migration
   * — see `toUserAiConfig` for the "anthropic" fallback.
   */
  provider?: string;
  gatewayUrl?: string;
  model?: string;
  token?: string;
  CreatedDate: string;
  LastUpdatedDate: string;
  CreatedBy?: string;
}

export interface UserAiConfig {
  /** Row id — needed for the update leg of the upsert. */
  id: string;
  userId: string;
  /** Defaults to "anthropic" for rows without the new field. */
  provider: ChatProviderId;
  /** Empty string when not set; UI treats that as "use server default". */
  gatewayUrl: string;
  model: string;
  token: string;
}

export function toUserAiConfig(c: CloudUserAiConfig): UserAiConfig {
  // Any unknown / missing value (including null from a partial API response)
  // is treated as "anthropic" — matches the user's chosen migration: don't
  // need to re-save Settings for existing rows to keep working.
  const provider: ChatProviderId = c.provider === "openai" ? "openai" : "anthropic";
  return {
    id: c.ItemId,
    userId: c.userId ?? "",
    provider,
    gatewayUrl: c.gatewayUrl ?? "",
    model: c.model ?? "",
    token: c.token ?? "",
  };
}

/**
 * Provider id for the AI-generated profile picture flow. Lives on
 * `UserAvatarConfig` (per-user, persisted in Blocks Data). Completely
 * separate from `UserAiConfig` — the chat proxy and the avatar proxy read
 * different header sets and never fall back to each other.
 *
 * Currently only `replicate` is supported (we ship the `fofr/face-to-many`
 * styles). Adding a new vendor here means adding an entry to
 * `AVATAR_PROVIDERS` in `vite.config.ts` and `server/prod-backend.mjs`.
 */
export type AvatarProviderId = "replicate";

export interface CloudUserAvatarConfig {
  ItemId: string;
  userId: string;
  provider?: string;
  token?: string;
  model?: string;
  CreatedDate: string;
  LastUpdatedDate: string;
  CreatedBy?: string;
}

export interface UserAvatarConfig {
  id: string;
  userId: string;
  provider: AvatarProviderId;
  /** Empty string when not set; the avatar button is hidden until set. */
  token: string;
  model: string;
}

export function toUserAvatarConfig(c: CloudUserAvatarConfig): UserAvatarConfig {
  // Provider defaults to "replicate" — the only vendor we ship today. A
  // missing/empty provider on a legacy row lands here too.
  const provider: AvatarProviderId =
    c.provider === "replicate" ? "replicate" : "replicate";
  return {
    id: c.ItemId,
    userId: c.userId ?? "",
    provider,
    token: c.token ?? "",
    model: c.model ?? "",
  };
}

// --- Member ↔ Project assignment -------------------------------------------
//
// Multi-select project assignment per member, edited from the Members page
// drop-down. One row per user (upsert by userId), with the project-id list
// stored as a JSON-encoded string field — same primitive-only-fields
// pattern as Issue.assignedDeveloperIdsJson / Issue.evidenceJson /
// Project.customEnvs.
//
// The cloud's `userId` and `projectIdsJson` columns are required for the
// hook to read OR filter by them. They MUST be in the collection's
// `fields` array or the gateway silently drops them — the same lesson
// that caused the duplicate-rows bug on Issue.

export interface CloudMemberProject {
  ItemId: string;
  userId: string;
  projectIdsJson?: string;
  updatedBy?: string;
  CreatedDate: string;
  LastUpdatedDate: string;
  CreatedBy?: string;
}

export interface MemberProjectAssignment {
  /** Row id — needed for the update leg of the upsert. */
  id: string;
  userId: string;
  /** Parsed project-id list. Empty array when none assigned. */
  projectIds: string[];
  /** IAM user id of the last manager who edited this row, or null. */
  updatedBy: string | null;
}

export function toMemberProjectAssignment(
  c: CloudMemberProject,
): MemberProjectAssignment {
  // Fail-closed parse: a corrupt or non-array JSON value reads as no
  // assignments so a single broken row doesn't poison the whole page.
  let projectIds: string[] = [];
  const raw = c.projectIdsJson;
  if (raw && raw.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        projectIds = parsed.filter((v): v is string => typeof v === "string");
      }
    } catch {
      // Corrupt JSON — empty list. Will be overwritten on the next save
      // by the manager; until then we render the row as "no assignments"
      // rather than crashing the dropdown.
    }
  }
  return {
    id: c.ItemId,
    userId: c.userId ?? "",
    projectIds,
    updatedBy: c.updatedBy || null,
  };
}

// --- Secret ↔ VerificationTarget binding ------------------------------------
//
// One row per (projectId, envSlug). Stores the binding relationship the
// VerificationTarget ruleGroup currently strips from cloud PATCHes — see
// memory `verification-target-credentialid-rulegroup-strip`. The UI
// (SecretCard chip, TargetSelect dropdown, runModelTurn credential
// resolution) reads through here, never off the row's stripped
// `credentialId` column. Same env-scoping shape as Secret /
// VerificationTarget.
//
// Active-env selection is also routed through this collection with the
// sentinel `projectId === "__active__" && envSlug === "__active__"` so we
// avoid a fifth schema. The `_active_` choice is in the row's
// `bindingsJson` as `JSON.stringify({ projectId, envSlug })`.
export interface CloudSecretBinding {
  ItemId: string;
  projectId: string;
  envSlug: string;
  /** Owning Environment.ItemId — env identity; empty on legacy rows. */
  environmentId?: string;
  /** JSON-encoded Record<secretId, targetId[]>. */
  bindingsJson?: string;
  updatedBy?: string;
  CreatedDate: string;
  LastUpdatedDate: string;
  CreatedBy?: string;
  LastUpdatedBy?: string;
}

export interface SecretBindings {
  /** Row id — needed for the update leg of the upsert. */
  id: string;
  projectId: string;
  envSlug: string;
  /** Owning Environment.ItemId; "" on legacy rows. */
  environmentId: string;
  /** Parsed map; empty object when none. */
  bindings: Record<string, string[]>;
  updatedBy: string | null;
}

export function toSecretBinding(c: CloudSecretBinding): SecretBindings {
  let bindings: Record<string, string[]> = {};
  const raw = c.bindingsJson;
  if (raw && raw.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const out: Record<string, string[]> = {};
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (Array.isArray(v)) {
            out[k] = v.filter((x): x is string => typeof x === "string");
          }
        }
        bindings = out;
      }
    } catch {
      // Corrupt JSON — empty map. Will be overwritten on next save; the
      // page renders "no bindings" instead of crashing.
    }
  }
  return {
    id: c.ItemId,
    projectId: c.projectId ?? "",
    envSlug: c.envSlug ?? "",
    environmentId: c.environmentId ?? "",
    bindings,
    updatedBy: c.updatedBy || null,
  };
}

// --- UserPreference ----------------------------------------------------------
//
// One row per user, multi-purpose. Holds the per-user Issue Tracker
// preferences (scope / device), the last-active chat session id, custom
// verification scopes, the GitHub repo-browser current path, and the
// MCP /api/secrets id for the GitHub PAT. Sibling of UserAiConfig —
// separate collection + cache key so a chat proxy change can never flush
// preferences and vice versa.
export interface CloudUserPreference {
  ItemId: string;
  userId: string;
  /** `'all' | 'mine' | 'assigned'`. Empty string when unset. */
  scope?: string;
  /** `'web' | 'ios' | 'android'`. Empty string when unset. */
  device?: string;
  /** Last-active chat session id. Empty string when none. */
  activeSession?: string;
  /** JSON-encoded Array<CustomVerificationCheck>. */
  customChecksJson?: string;
  /** GitHub repo-browser current path. Empty string when none. */
  repoBrowserPath?: string;
  /** MCP /api/secrets id for the GitHub PAT. Empty string when none. */
  githubCredentialId?: string;
  /** Environment.ItemId the user is currently working in. Empty string
   *  when off-env. Replaces the SecretBinding `__active__::` sentinel row
   *  and the lattice.mirror.active-env.v1 mirror. */
  activeEnvironmentId?: string;
  CreatedDate: string;
  LastUpdatedDate: string;
  CreatedBy?: string;
  LastUpdatedBy?: string;
}

export interface UserPreference {
  id: string;
  userId: string;
  scope: string;
  device: string;
  activeSession: string;
  /** Parsed array of user-defined verification checks; `[]` when none. */
  customChecks: unknown[];
  repoBrowserPath: string;
  githubCredentialId: string;
  /** Environment.ItemId the user is currently working in; "" when off-env. */
  activeEnvironmentId: string;
}

export function toUserPreference(c: CloudUserPreference): UserPreference {
  let customChecks: unknown[] = [];
  const raw = c.customChecksJson;
  if (raw && raw.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) customChecks = parsed;
    } catch {
      // Corrupt JSON — empty list. Will be overwritten on next save.
    }
  }
  return {
    id: c.ItemId,
    userId: c.userId ?? "",
    scope: c.scope ?? "",
    device: c.device ?? "",
    activeSession: c.activeSession ?? "",
    customChecks,
    repoBrowserPath: c.repoBrowserPath ?? "",
    githubCredentialId: c.githubCredentialId ?? "",
    activeEnvironmentId: c.activeEnvironmentId ?? "",
  };
}

// --- HiddenAnnouncement ------------------------------------------------------
//
// One row per (userId, announcementId). The read path filters by
// `userId` so each user only sees their own hide rows. Same per-user
// inbox-style pattern as Notification. Replaces the
// `hiddenAnnouncements:v1:<userId>` localStorage key — the userId suffix
// on the old key becomes a `userId` column on the row.
export interface CloudHiddenAnnouncement {
  ItemId: string;
  userId: string;
  announcementId: string;
  /** ISO timestamp stamped when the user hid it. Audit only. */
  hiddenAt?: string;
  CreatedDate: string;
  LastUpdatedDate: string;
  CreatedBy?: string;
  LastUpdatedBy?: string;
}

export interface HiddenAnnouncementEntry {
  id: string;
  userId: string;
  announcementId: string;
  hiddenAt: string;
}

export function toHiddenAnnouncement(
  c: CloudHiddenAnnouncement,
): HiddenAnnouncementEntry {
  return {
    id: c.ItemId,
    userId: c.userId ?? "",
    announcementId: c.announcementId ?? "",
    hiddenAt: c.hiddenAt ?? "",
  };
}

// --- UserNote (per-user notepad) --------------------------------------------
//
// One row per (userId, padType). `padType` is `"text" | "excel"`. The
// full pad array rides as a JSON-encoded blob in `rowsJson` — same
// `*Json` primitive-string convention as MemberProject.projectIdsJson.
// Replaces both `lattice.notepad.text.v1` and `lattice.notepad.excel.v1`.
export interface CloudUserNote {
  ItemId: string;
  userId: string;
  padType: string;
  /** JSON-encoded Array<NotepadRow>. */
  rowsJson?: string;
  /** ISO timestamp of last write. Audit only. */
  updatedAt?: string;
  CreatedDate: string;
  LastUpdatedDate: string;
  CreatedBy?: string;
  LastUpdatedBy?: string;
}

export interface UserNoteRow {
  id: string;
  userId: string;
  /** `'text' | 'excel'`. The hook narrows further via description. */
  padType: string;
  /** Parsed rows; empty array when pad is empty. */
  rows: unknown[];
  updatedAt: string;
}

export function toUserNote(c: CloudUserNote): UserNoteRow {
  let rows: unknown[] = [];
  const raw = c.rowsJson;
  if (raw && raw.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) rows = parsed;
    } catch {
      // Corrupt JSON — empty array. Will be overwritten on next save.
    }
  }
  return {
    id: c.ItemId,
    userId: c.userId ?? "",
    padType: c.padType ?? "",
    rows,
    updatedAt: c.updatedAt ?? "",
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
// Exported so non-collection helpers (e.g. `notifier.useNotificationInbox`)
// can reuse the same envelope-shape shim instead of re-parsing it.
export function unwrapPaged<T>(raw: unknown): { items: T[]; totalCount: number } {
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
  fields: ["title", "description", "status", "priority", "projectId", "tags", "envSlug", "environmentId", "clonedFromFeatureId", "developerIds", "qaIds", "githubLink", "CreatedBy", "CreatedDate", "LastUpdatedBy", "LastUpdatedDate"],
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
  fields: ["title", "description", "steps", "status", "stack", "featureId", "envSlug", "environmentId", "clonedFromFlowId", "CreatedBy", "CreatedDate", "LastUpdatedBy", "LastUpdatedDate"],
});
export const chatMessagesCollection = blocksClient.data.collection<CloudChatMessage>("ChatMessage", {
  fields: ["sessionId", "role", "content", "actionsJson", "CreatedDate", "LastUpdatedDate"],
});
// `senderId` / `recipientId` MUST both be in the selector: the inbox and
// outbox reads filter on them, and the gateway drops filter clauses whose
// field isn't selected (the same silent no-op that caused the duplicate-
// rows bug on Issue). `readAt` feeds the unread badges / read ticks.
// `messageType` + `callSummary` ride along so the toDirectMessage adapter
// can populate the system-row shape — omitted selector columns silently
// degrade to `undefined` per the project memory rule, which would lose
// every call-log pill.
export const directMessagesCollection = blocksClient.data.collection<CloudDirectMessage>("DirectMessage", {
  fields: ["senderId", "recipientId", "content", "readAt", "attachmentFileId", "reactions", "editedAt", "deletedAt", "messageType", "callSummary", "CreatedBy", "CreatedDate", "LastUpdatedBy", "LastUpdatedDate"],
});
// `callerId` AND `recipientId` MUST both be in the selector — the active-
// signal read uses two list calls (outbox `callerId: me` + inbox
// `recipientId: me`) and the incoming-call auto-open reads with
// `recipientId: me`. An unselected filter column is silently dropped by
// the gateway, so omitting either would either lose rows on the active-
// signal read or fail to surface any incoming call. The lifecycle columns
// (status / endedAt / endReason) and SDP/ICE blobs are selected so the
// toCallSignal adapter can populate the full UI shape — same lesson as
// DirectMessage: read-side parse failures silently degrade if these are
// missing, so we select them up front.
export const callSignalsCollection = blocksClient.data.collection<CloudCallSignal>("CallSignal", {
  fields: ["callerId", "recipientId", "kind", "status", "sdpOffer", "sdpAnswer", "iceCandidatesJson", "endedAt", "endReason", "CreatedBy", "CreatedDate", "LastUpdatedBy", "LastUpdatedDate"],
});
// `authorId` in the selector for the same filter-gating reason as the DM
// columns; `CreatedBy` rides along for the audit-style "posted by" render.
export const announcementsCollection = blocksClient.data.collection<CloudAnnouncement>("Announcement", {
  fields: ["authorId", "content", "CreatedBy", "CreatedDate", "LastUpdatedBy", "LastUpdatedDate"],
});
// `userId` MUST be in the selector — the inbox reads with
// `filter: { userId: <me> }`, and the gateway silently drops unselected
// filter columns (the same lesson as every other per-user collection).
// Every other column is selected because `toNotification` reads it; an
// unselected column would silently arrive as `undefined` and the inbox
// renderer would lose that field's display value.
export const notificationsCollection = blocksClient.data.collection<CloudNotification>("Notification", {
  fields: ["userId", "context", "actionName", "actorId", "value", "actorName", "projectId", "projectName", "featureId", "featureName", "flowId", "flowName", "envSlug", "oldName", "newName", "status", "stack", "readAt", "CreatedBy", "CreatedDate", "LastUpdatedBy", "LastUpdatedDate"],
});
// `userId` MUST be selected: the inbox read filters on it
// (`filter: { userId: <me> }`), and the gateway silently drops
// unselected filter columns — the same lesson as every other
// per-resource collection above. Until the MailMessage schema is
// pushed to the gateway every call 400s; the hooks degrade to the
// `lattice.mirror.mail.v1` localStorage mirror (see `useMailInbox`).
export const mailMessagesCollection = blocksClient.data.collection<CloudMailMessage>("MailMessage", {
  fields: ["userId", "fromId", "fromName", "fromEmail", "toName", "subject", "body", "readAt", "CreatedBy", "CreatedDate", "LastUpdatedBy", "LastUpdatedDate"],
});

// --- Inbound mail addresses ----------------------------------------------------
//
// Per-user inbound addresses behind the "Get Your Email" dialog. One row
// per user on the `MailAddress` schema (blocks/data/schemas/MailAddress.json):
// `address → userId`. The mail-server resolves an arriving message's To
// against this registry and writes the MailMessage with the owner's userId —
// so anyone a user shares their address with can mail them, and each user's
// address is theirs alone. A row only exists once the user has opened the
// dialog once (registration is idempotent query-then-create).

export interface CloudMailAddress {
  ItemId?: string;
  address?: string;
  userId?: string;
  userName?: string;
  CreatedDate?: string;
}

export interface MailAddressRecord {
  id: string;
  address: string;
  userId: string;
  userName: string;
}

export function toMailAddress(c: CloudMailAddress): MailAddressRecord | null {
  if (!c.ItemId || !c.address || !c.userId) return null;
  return {
    id: c.ItemId,
    address: c.address,
    userId: c.userId,
    userName: c.userName ?? "",
  };
}

// `address` MUST be selected: the mail-server filters the registry on it
// (`filter: { address: <to> }`), and the gateway silently drops unselected
// filter columns — the same rule as every collection above.
export const mailAddressesCollection = blocksClient.data.collection<CloudMailAddress>("MailAddress", {
  fields: ["address", "userId", "userName", "CreatedBy", "CreatedDate", "LastUpdatedBy", "LastUpdatedDate"],
});

/** Lowercase, diacritic-free dot-separated slug safe for an email local part. */
export function mailSlug(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 32);
  return slug || "user";
}

/**
 * The inbound address for a user: `<name>.<first-6-of-uid>@<domain>`.
 * Deterministic (same user → same address on every device), unique even
 * between users who share a name, and readable enough to share. The
 * domain comes from build-time config (`VITE_MAIL_INBOUND_DOMAIN`) — it
 * must match the domain the Cloudflare Email Routing catch-all serves.
 */
export function inboundAddressFor(
  userId: string | null | undefined,
  userName: string | null | undefined,
  domain: string = import.meta.env.VITE_MAIL_INBOUND_DOMAIN ?? "dbeegi.slsblx.com",
): string | null {
  if (!userId) return null;
  return `${mailSlug(userName ?? "")}.${userId.slice(0, 6)}@${domain}`;
}
// `flowId` MUST be selected: the read path (`useFlowComments`) filters
// on it (`filter: { flowId: <id> }`), and the gateway silently drops
// unselected filter columns — the same lesson as every other
// per-resource collection above. `parentId` is selected so the
// thread-grouping logic in `FlowItem` can pair replies to their
// parent. Every other column is selected because `toFlowCommentRow`
// reads it; an unselected column would silently arrive as `undefined`
// and the comment header would lose that field's display value
// (matching the same pattern as `notificationsCollection` above).
export const flowCommentsCollection = blocksClient.data.collection<CloudFlowComment>("FlowComment", {
  fields: ["flowId", "parentId", "authorId", "authorName", "authorEmail", "authorAvatar", "content", "CreatedBy", "CreatedDate", "LastUpdatedBy", "LastUpdatedDate"],
});
// `userId` MUST be selected: the read path filters on it when looking up the
// caller's own row for the upload upsert (an unselected filter column is
// silently dropped by the gateway — the duplicate-rows lesson from Issue).
export const userProfilesCollection = blocksClient.data.collection<CloudUserProfile>("UserProfile", {
  // NOTE: `source` and `style` columns are NOT in the deployed `UserProfile`
  // schema yet — the AI avatar feature (commit b21051e) assumed a schema
  // migration that was never applied, so requesting/writing them returns
  // "Field `source` does not exist on type `UserProfile`" (HTTP 400) on
  // every read AND every upsert. Until the migration lands, keep them out
  // of both `fields` (this selector) and the upsert payload
  // (`useUploadProfilePic` in hooks.ts). The `toUserProfilePic` adapter
  // already defaults `source` to `"original"` when the field is missing,
  // so the UI keeps working unchanged; only the AI badge is suppressed.
  fields: ["userId", "imageFileId", "CreatedBy", "CreatedDate", "LastUpdatedBy", "LastUpdatedDate"],
});
// `userId` MUST be selected for the same filter-gating reason as
// `userProfiles` / `memberProjects` above — the read leg of the upsert
// (`useUserAiConfig`) and the save hook (`useSaveUserAiConfig`) both filter
// by `userId`, and the gateway silently drops unselected filter columns,
// which would either read the wrong row or insert duplicates.
export const userAiConfigsCollection = blocksClient.data.collection<CloudUserAiConfig>("UserAiConfig", {
  // `provider` is selected so the Settings page can populate the dropdown
  // on load and so it round-trips through the upsert. Rows written before
  // the schema migration don't have it — `toUserAiConfig` defaults the
  // value to "anthropic", matching the user's chosen migration.
  fields: ["userId", "provider", "gatewayUrl", "model", "token", "CreatedBy", "CreatedDate", "LastUpdatedBy", "LastUpdatedDate"],
});
// `userId` is selected for the same filter-gating reason as every other
// per-user collection above — `useUserAvatarConfig` reads the row by
// `userId` and the upsert in `useSaveUserAvatarConfig` filters on it too.
// Deliberately a separate collection from `userAiConfigsCollection` so the
// chat proxy key and the avatar proxy key can never collide.
export const userAvatarConfigsCollection = blocksClient.data.collection<CloudUserAvatarConfig>("UserAvatarConfig", {
  fields: ["userId", "provider", "token", "model", "CreatedBy", "CreatedDate", "LastUpdatedBy", "LastUpdatedDate"],
});
// `userId` is in `fields` for the same filter reason as `userProfiles` —
// the upsert looks up the member's row by `userId`. `projectIdsJson` is
// selected because the read path parses it (an unselected column would
// silently read as `undefined`, which the `toMemberProjectAssignment`
// adapter treats as "no assignments" — losing the manager's saved
// selection on the next render).
export const memberProjectsCollection = blocksClient.data.collection<CloudMemberProject>("MemberProject", {
  fields: ["userId", "projectIdsJson", "updatedBy", "CreatedBy", "CreatedDate", "LastUpdatedBy", "LastUpdatedDate"],
});

// `projectId` + `envSlug` MUST be in the selector: the read leg of the upsert
// (`useSecretBindings`) filters on them, and the gateway silently drops
// unselected filter columns — same lesson as every other env-scoped
// collection. `bindingsJson` rides along because `toSecretBinding` parses
// it; `updatedBy` is selected so the audit column round-trips.
export const secretBindingsCollection = blocksClient.data.collection<CloudSecretBinding>("SecretBinding", {
  fields: ["projectId", "envSlug", "environmentId", "bindingsJson", "updatedBy", "CreatedBy", "CreatedDate", "LastUpdatedBy", "LastUpdatedDate"],
});
// `userId` MUST be selected — `useUserPreference` reads + upserts by
// `filter: { userId }`, and an unselected filter column is silently
// dropped. Every other column is selected because `toUserPreference`
// reads it; an unselected column would silently arrive as `undefined` and
// the consumer would lose that preference's saved value.
export const userPreferencesCollection = blocksClient.data.collection<CloudUserPreference>("UserPreference", {
  fields: ["userId", "scope", "device", "activeSession", "customChecksJson", "repoBrowserPath", "githubCredentialId", "activeEnvironmentId", "CreatedBy", "CreatedDate", "LastUpdatedBy", "LastUpdatedDate"],
});
// `userId` MUST be selected — the inbox read filters on
// `filter: { userId: <me> }`, same as Notification. `announcementId`
// rides along because the un/hide write hooks also filter on it.
export const hiddenAnnouncementsCollection = blocksClient.data.collection<CloudHiddenAnnouncement>("HiddenAnnouncement", {
  fields: ["userId", "announcementId", "hiddenAt", "CreatedBy", "CreatedDate", "LastUpdatedBy", "LastUpdatedDate"],
});
// `userId` + `padType` MUST be selected: the read leg (`useUserNote`)
// filters on both, and the upsert in `useSaveUserNote` echoes both on
// PATCH (both are `requiredOn: "Both"`). An unselected filter column is
// silently dropped — same lesson as every other env-scoped collection.
export const userNotesCollection = blocksClient.data.collection<CloudUserNote>("UserNote", {
  fields: ["userId", "padType", "rowsJson", "updatedAt", "CreatedBy", "CreatedDate", "LastUpdatedBy", "LastUpdatedDate"],
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
      // Per-environment scoping — MUST stay in the selection: the
      // env filter in `useIssueTracker` matches loaded rows by
      // (projectId, envSlug), and a missing column here maps to
      // `undefined` on every row, so every row would silently drop
      // out of the scoped view.
      "projectId",
      "envSlug",
      // Owning Environment.ItemId — MUST stay selected: once the Scope
      // page and walker filter by environmentId, an unselected column
      // would silently drop every row out of the scoped view (the
      // recurring selector-gating lesson).
      "environmentId",
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
      // Per-environment scoping — same rule as VerificationTarget.
      "projectId",
      "envSlug",
      "environmentId",
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
      // Per-environment scoping — same rule as VerificationTarget.
      // `targetId` rides along for the hard target link (survives URL
      // edits); empty on legacy rows.
      "projectId",
      "envSlug",
      "environmentId",
      "targetId",
      "CreatedBy",
      "CreatedDate",
      "LastUpdatedBy",
      "LastUpdatedDate",
    ],
  },
);
export const testCasesCollection = blocksClient.data.collection<CloudTestCase>(
  "TestCase",
  {
    // Field list mirrors the schema in
    // `blocks/data/schemas/TestCase.json`. The SDK fetch projection
    // trims the row to just these columns; a column missing here
    // arrives as `undefined` on every row, which would make every
    // existing test case appear blank in the spreadsheet.
    fields: [
      "featureId",
      "flowId",
      "title",
      "steps",
      "expectedResult",
      "actualResult",
      "status",
      "priority",
      "assignedTo",
      "order",
      "tags",
      "isDeletable",
      "CreatedBy",
      "CreatedDate",
      "LastUpdatedBy",
      "LastUpdatedDate",
    ],
  },
);

// --- Environments -------------------------------------------------------------
//
// Env identity entity (schema v2.1). One row per env per project: projects
// start with ZERO envs and the user adds every row themselves (canonical
// kinds dev/stg/prod/uat or `custom`) through the Add Environment modal.
// `slug` is the URL segment + display cache
// and IS renameable; `ItemId` is the identity every env-scoped row points at
// via its `environmentId` column, so a rename never orphans data. Replaces
// the Project.customEnvs + Project.envLabelOverrides JSON blobs.
export type EnvironmentKind = "dev" | "stg" | "prod" | "uat" | "custom";

export const ENVIRONMENT_KINDS: EnvironmentKind[] = [
  "dev",
  "stg",
  "prod",
  "uat",
  "custom",
];

export interface CloudEnvironment {
  ItemId: string;
  projectId: string;
  /** URL segment + display cache — renameable, never an identity. */
  slug: string;
  label: string;
  color?: string;
  /** Sparse ordering key — "0"/"10"/"20"; absent rows sort last. */
  order?: string;
  /** dev | stg | prod | uat | custom — drives the env badge treatment. */
  kind: string;
  CreatedBy?: string;
  CreatedDate: string;
  LastUpdatedBy?: string;
  LastUpdatedDate: string;
}

export interface Environment {
  id: string;
  projectId: string;
  slug: string;
  label: string;
  color?: string;
  order: number;
  kind: EnvironmentKind;
  createdAt: string;
  updatedAt: string;
}

export function toEnvironment(e: CloudEnvironment): Environment {
  // Unknown kind (hand-edited row) falls back to "custom" so the badge
  // renders the generic treatment instead of crashing the switch.
  const kind = (ENVIRONMENT_KINDS as readonly string[]).includes(e.kind ?? "")
    ? (e.kind as EnvironmentKind)
    : "custom";
  return {
    id: e.ItemId,
    projectId: e.projectId ?? "",
    slug: e.slug ?? "",
    label: e.label ?? e.slug ?? "",
    color: e.color || undefined,
    order: e.order ? Number(e.order) || 0 : 0,
    kind,
    createdAt: e.CreatedDate,
    updatedAt: e.LastUpdatedDate,
  };
}

// `projectId` MUST be selected — every env page filters with a flat
// `{ projectId }` and the gateway silently drops unselected filter columns
// (the recurring selector-gating lesson). `slug` rides along as the
// display/URL cache during the transition; `kind` + `order` drive the badge
// and sort order.
export const environmentsCollection = blocksClient.data.collection<CloudEnvironment>(
  "Environment",
  {
    fields: [
      "projectId",
      "slug",
      "label",
      "color",
      "order",
      "kind",
      "CreatedBy",
      "CreatedDate",
      "LastUpdatedBy",
      "LastUpdatedDate",
    ],
  },
);

// --- Verification checks (env-scoped) -----------------------------------------
//
// One row per check per environment (blx_VerificationChecks). `source:
// "builtin"` rows mirror the 11-id catalog in src/types/issue-tracker.ts —
// the catalog's labels/descriptions stay code constants and only `enabled`
// round-trips. `source: "custom"` rows carry a `custom_`-prefixed `checkId`
// and are the user-defined scopes formerly stored as definitions in
// UserPreference.customChecksJson. Identity for dedup/lookup is
// (environmentId, checkId) — never the editable label.
export interface CloudVerificationCheck {
  ItemId: string;
  projectId: string;
  environmentId: string;
  /** builtin | custom. */
  source: string;
  /** Catalog id (builtin) or `custom_<slug>` (custom) — the match key. */
  checkId: string;
  label: string;
  description?: string;
  /** "true"/"false" on the wire — seeding default for `enabled`. */
  recommended?: string;
  /** "true"/"false" on the wire — the per-env selection. */
  enabled: string;
  CreatedBy?: string;
  CreatedDate: string;
  LastUpdatedBy?: string;
  LastUpdatedDate: string;
}

export interface EnvVerificationCheck {
  id: string;
  projectId: string;
  environmentId: string;
  source: "builtin" | "custom";
  checkId: string;
  label: string;
  description: string;
  recommended: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toVerificationCheck(
  c: CloudVerificationCheck,
): EnvVerificationCheck {
  return {
    id: c.ItemId,
    projectId: c.projectId ?? "",
    environmentId: c.environmentId ?? "",
    source: c.source === "custom" ? "custom" : "builtin",
    checkId: c.checkId ?? "",
    label: c.label ?? "",
    description: c.description ?? "",
    recommended: String(c.recommended ?? "false").toLowerCase() === "true",
    // Anything but an explicit "false" reads enabled — a missing flag must
    // not silently disable a seeded builtin check.
    enabled: String(c.enabled ?? "true").toLowerCase() !== "false",
    createdAt: c.CreatedDate,
    updatedAt: c.LastUpdatedDate,
  };
}

// `projectId` + `environmentId` MUST be selected — the Scope page filters
// with the flat `{ projectId, environmentId }` pair and unselected filter
// columns are silently dropped by the gateway. `checkId` is the identity
// the migration and the toggle hook match on.
export const verificationChecksCollection = blocksClient.data.collection<CloudVerificationCheck>(
  "VerificationCheck",
  {
    fields: [
      "projectId",
      "environmentId",
      "source",
      "checkId",
      "label",
      "description",
      "recommended",
      "enabled",
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