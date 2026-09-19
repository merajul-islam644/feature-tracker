// One flow row inside an expanded feature.
//
// The visible card chrome (border, padding, hover) is owned by the parent
// `<li>` in `FeatureItem.tsx`, so the kebab menu sits inside the same
// bordered row. This component only renders the row's content (icon +
// name + stack chip + status chip + comments chip + relative time) and
// accepts a `trailing` slot for actions rendered to the right of the
// meta line.
//
// Comments live in local state, persisted to localStorage so a refresh
// doesn't lose the thread. Key is per-flow so different flows don't
// collide. Replace the localStorage helpers with a TanStack-Query-backed
// hook when comments move to a real backend schema — the modal/chip
// contract stays the same.

import { useEffect, useState } from "react";
import { GitBranch } from "lucide-react";
import { useAuthContext } from "@/components/blocks/AuthProvider";
import { useIsRole } from "@/hooks/useAuth";
import { useLocale } from "@/lib/blocks/i18n";
import type { Flow } from "@/lib/blocks/data";
import type { ReactNode } from "react";
import { StatusChip } from "./StatusChip";
import { StackChip } from "./StackChip";
import { CommentsChip } from "./CommentsChip";
import { EnvWorkflow } from "./EnvWorkflow";
import { FlowEnvWorkflow } from "./FlowEnvWorkflow";
import {
  CommentsModal,
  type FlowComment,
  type FlowCommentReply,
} from "./CommentsModal";

interface FlowItemProps {
  flow: Flow;
  /** Read-only mode hides the chip's interactive trigger (used on
   *  non-dev envs where status is owned by the dev env). */
  readOnly?: boolean;
  trailing?: ReactNode;
}

// localStorage key — scoped per-flow so different flows don't collide.
// Versioned (`v1`) so a future schema change can migrate rather than
// silently corrupt the user's saved comments.
const STORAGE_KEY_PREFIX = "feature-tracker:flow-comments:v1:";

function storageKey(flowId: string): string {
  return `${STORAGE_KEY_PREFIX}${flowId}`;
}

function loadComments(flowId: string): FlowComment[] {
  // SSR / non-browser safety — localStorage doesn't exist outside the
  // browser, and unit tests can mount components without a window.
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(flowId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive shape check — a corrupt row from a prior version
    // shouldn't crash the modal. Drop bad entries, keep the rest.
    return parsed.filter(isFlowComment);
  } catch {
    return [];
  }
}

function saveComments(flowId: string, comments: FlowComment[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      storageKey(flowId),
      JSON.stringify(comments),
    );
  } catch {
    // Quota exceeded / private mode — silently ignore. The UI still
    // works for the session; the next save will retry.
  }
}

// Narrow an unknown JSON-decoded value to FlowComment. Anything that
// doesn't match the shape is dropped (see loadComments above). Replies
// go through the same check, recursively.
function isFlowComment(value: unknown): value is FlowComment {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.authorName === "string" &&
    typeof v.authorEmail === "string" &&
    typeof v.content === "string" &&
    typeof v.createdAt === "string" &&
    Array.isArray(v.replies) &&
    v.replies.every(isFlowCommentReply)
  );
}

function isFlowCommentReply(value: unknown): value is FlowCommentReply {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.authorName === "string" &&
    typeof v.authorEmail === "string" &&
    typeof v.content === "string" &&
    typeof v.createdAt === "string"
  );
}

// Stable id generator — prefers crypto.randomUUID for proper UUIDs;
// falls back to a time + random combo on older browsers / tests where
// crypto isn't available.
function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function FlowItem({ flow, readOnly = false, trailing }: FlowItemProps) {
  const { formatRelativeTime } = useLocale();
  const { user } = useAuthContext();
  // Testers are read-only across the workspace — even on dev-source
  // flows where regular users can click the env-workflow to clone
  // across envs. Swap in the read-only `FlowEnvWorkflow` mirror for
  // testers so the chain still shows the chain state ("already cloned
  // to Stg / Prod / UAT") but no pill is actionable. The matching
  // `useCloneFlow` hook also throws for testers — defense in depth
  // against programmatic / stale-modal callers.
  const isTester = useIsRole("tester");

  // Comments are seeded from localStorage on first render so a reload
  // restores the thread. The lazy initializer avoids a synchronous
  // JSON parse on every render — only the first one.
  const [comments, setComments] = useState<FlowComment[]>(() =>
    loadComments(flow.id),
  );
  const [commentsOpen, setCommentsOpen] = useState(false);

  // Persist on every change. The dep on `flow.id` is harmless (the
  // key is flow-scoped) but explicit so future readers know the save
  // site is tied to a specific flow.
  useEffect(() => {
    saveComments(flow.id, comments);
  }, [flow.id, comments]);

  const handleAddComment = (content: string) => {
    const newComment: FlowComment = {
      id: newId(),
      authorName: user?.name ?? "You",
      authorEmail: user?.email ?? "",
      authorAvatar: user?.avatarUrl,
      content,
      createdAt: new Date().toISOString(),
      replies: [],
    };
    setComments((prev) => [...prev, newComment]);
  };

  const handleAddReply = (parentId: string, content: string) => {
    const newReply: FlowCommentReply = {
      id: newId(),
      authorName: user?.name ?? "You",
      authorEmail: user?.email ?? "",
      authorAvatar: user?.avatarUrl,
      content,
      createdAt: new Date().toISOString(),
    };
    setComments((prev) =>
      prev.map((c) =>
        c.id === parentId
          ? { ...c, replies: [...c.replies, newReply] }
          : c,
      ),
    );
  };

  return (
    <>
      <GitBranch
        className="h-4 w-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="flex-1 truncate font-medium text-foreground">
        {flow.name}
      </span>
      {/* Environment workflow — sits *just before* the stack chip.
          Three cases:
            * flow.envSlug === "dev"      → interactive workflow
                                            (clickable Stg/Prod/UAT
                                            nodes that fire
                                            useCloneFlow)
            * flow.envSlug set but non-dev
                                          → read-only FlowEnvWorkflow
                                            (Dev + outlined sibling
                                            pills, no pointer cursor,
                                            no click affordance — non-
                                            dev envs are read-only
                                            views per the page-level
                                            readOnly flag)
            * flow.envSlug === undefined  → nothing (legacy env-less
                                            page has no row-level env
                                            anchor)
          See EnvWorkflow.tsx (interactive) and FlowEnvWorkflow.tsx
          (read-only mirror) for state details. */}
      {flow.envSlug === "dev" && !isTester ? (
        <EnvWorkflow flow={flow} />
      ) : flow.envSlug !== undefined ? (
        <FlowEnvWorkflow flow={flow} />
      ) : null}
      {/* Stack chip — sits to the left of the Status chip. Always
          rendered so the row has stable horizontal layout regardless
          of which values are set. */}
      <StackChip flow={flow} readOnly={readOnly} />
      {/* Status chip — sits to the left of the Comments chip. */}
      <StatusChip flow={flow} readOnly={readOnly} />
      {/* Comments chip — opens the comments modal. Lives between the
          Status chip and the relative time so the chip order matches
          the natural reading order (state → annotations → time). The
          Environment chip used to live between Status and Comments,
          but the per-row interactive EnvWorkflow now handles
          cloning — so the dropdown is gone to keep the row from
          duplicating the same action. */}
      <CommentsChip
        count={comments.length}
        onOpen={() => setCommentsOpen(true)}
      />
      <span className="hidden text-xs text-muted-foreground sm:inline">
        {formatRelativeTime(flow.createdAt)}
      </span>
      {trailing}

      <CommentsModal
        open={commentsOpen}
        onClose={() => setCommentsOpen(false)}
        flowName={flow.name}
        comments={comments}
        onAddComment={handleAddComment}
        onAddReply={handleAddReply}
        currentUserName={user?.name ?? "You"}
        currentUserEmail={user?.email ?? ""}
        currentUserAvatar={user?.avatarUrl}
      />
    </>
  );
}
