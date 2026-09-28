// One flow row inside an expanded feature.
//
// The visible card chrome (border, padding, hover) is owned by the parent
// `<li>` in `FeatureItem.tsx`, so the kebab menu sits inside the same
// bordered row. This component only renders the row's content (icon +
// name + stack chip + status chip + comments chip + relative time) and
// accepts a `trailing` slot for actions rendered to the right of the
// meta line.
//
// The EnvWorkflow chain diagram (Dev → Stg → Prod → UAT) was removed
// from this row per user request — flow promotion is now handled
// exclusively at the feature level via the manager's
// `ManagerFeatureEnvWorkflow`. Cross-env flow state still lives on the
// `flow.envSlug` field (set by the flow-cascade in `useCloneFeature`
// and read by the env-scoped page filters) but no UI on this row
// surfaces it.
//
// Chip role gating — only TESTERS can edit the Stack and Status chips.
// Managers (curators) and developers (feature authors) see the chips
// as inert labels so they can't accidentally overwrite QA's status /
// stack assignments on the dev source env. The role gate is added on
// top of the env-based `readOnly` prop: the chip is read-only when
// either condition holds (non-dev env OR non-tester role). The
// Comments chip stays interactive for every role — the user
// explicitly opted to keep annotations open to everyone since they
// represent team-wide discussion rather than QA-owned state.
//
// Comments are persisted to Blocks Data via the `FlowComment` schema
// (`useFlowComments` / `useAddFlowComment` / `useAddFlowCommentReply` in
// `src/lib/blocks/hooks.ts`). The wire shape is flat rows joined by
// `parentId`; `groupNested` below collapses those rows into the
// nested `comments[] + replies[]` shape that `CommentsModal` consumes.

import { useEffect, useState } from "react";
import { GitBranch } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useAuthContext } from "@/components/blocks/AuthProvider";
import { useLocale } from "@/lib/blocks/i18n";
import { useIsRole } from "@/hooks/useAuth";
import {
  useAddFlowComment,
  useAddFlowCommentReply,
  useFlowComments,
} from "@/lib/blocks/hooks";
import type { Flow } from "@/lib/blocks/data";
import type { FlowCommentRow } from "@/lib/blocks/data";
import type { ReactNode } from "react";
import { StatusChip } from "./StatusChip";
import { StackChip } from "./StackChip";
import { CommentsChip } from "./CommentsChip";
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

// Collapse the cloud's flat-row shape (one row per comment or reply,
// joined by `parentId`) into the nested `FlowComment[]` shape that
// `CommentsModal` consumes. Top-level rows carry `parentId === ""`;
// replies carry the parent's cloud ItemId. Replies whose parent didn't
// survive the list query (e.g. a rare race where the parent was just
// deleted) are dropped rather than rendered as orphans — the parent
// existence is the source of truth.
//
// Both lists are sorted oldest-first so the modal renders the thread
// in chronological reading order. `localeCompare` on ISO strings is
// equivalent to chronological sort without needing to parse the dates.
function groupNested(rows: FlowCommentRow[]): FlowComment[] {
  const top: FlowComment[] = [];
  const repliesByParent = new Map<string, FlowCommentReply[]>();
  for (const r of rows) {
    const reply: FlowCommentReply = {
      id: r.id,
      // Forward `authorId` so the modal can hide the Reply button on
      // the viewer's own rows (see `CommentsModal.isOwnComment`).
      // Spreads cleanly into the `FlowComment` shape that `top.push`
      // accepts.
      authorId: r.authorId,
      authorName: r.authorName,
      authorEmail: r.authorEmail,
      authorAvatar: r.authorAvatar,
      content: r.content,
      createdAt: r.createdAt,
    };
    if (r.parentId === "") {
      top.push({ ...reply, replies: [] });
    } else {
      const list = repliesByParent.get(r.parentId) ?? [];
      list.push(reply);
      repliesByParent.set(r.parentId, list);
    }
  }
  for (const t of top) {
    t.replies = repliesByParent.get(t.id) ?? [];
  }
  top.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const t of top) {
    t.replies.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  return top;
}

export function FlowItem({ flow, readOnly = false, trailing }: FlowItemProps) {
  const { formatRelativeTime } = useLocale();
  const { user } = useAuthContext();
  // Role gate for chip editability. The Stack / Status chips stay
  // interactive ONLY for testers on the dev source env; everyone else
  // sees them as inert labels. The Comments chip ignores this gate —
  // annotations are open to every role on every env. Combined with the
  // env-based `readOnly` prop, the effective chip `readOnly` is true
  // when either:
  //   * `readOnly` (caller passed in — true on non-dev envs) OR
  //   * `!isTester` (signed-in user is manager / developer)
  // The `readOnly` prop wins for the env dimension, the role gate
  // wins for the role dimension; either one flips the chip inert.
  const isTester = useIsRole("tester");
  const chipReadOnly = readOnly || !isTester;

  // Cloud-backed reader — flat rows, joined into threads via
  // `groupNested`. TanStack Query handles staleness, refetch-on-mount,
  // and the same in-flight guard that every other flow-scoped reader
  // uses (`enabled: Boolean(userId && flowId)` inside the hook, so no
  // empty-string fires a no-op request here).
  const { data: rows } = useFlowComments(flow.id);
  const addComment = useAddFlowComment();
  const addReply = useAddFlowCommentReply();
  const comments = groupNested(rows ?? []);

  const [commentsOpen, setCommentsOpen] = useState(false);
  // Deep-link from a notification bell "Go to flow" click carries a
  // `?comments=<flowId>` search param. When the param matches this
  // flow's id, open the comments modal straight away (and clear the
  // param so a refresh doesn't keep re-opening it). The same pattern
  // `FeatureItem.openFlowId = searchParams.get("flow")` uses for the
  // Flow Details drawer.
  const [searchParams, setSearchParams] = useSearchParams();
  const openCommentsFromParam = searchParams.get("comments");
  useEffect(() => {
    if (openCommentsFromParam !== flow.id) return;
    setCommentsOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("comments");
    setSearchParams(next, { replace: true });
    // `setSearchParams` identity changes on every render and would
    // re-trigger the effect; the early return on param mismatch is the
    // real gate. eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCommentsFromParam, flow.id]);

  const handleAddComment = (content: string) => {
    addComment.mutate({ flowId: flow.id, content });
  };

  const handleAddReply = (parentId: string, content: string) => {
    addReply.mutate({ flowId: flow.id, parentId, content });
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
      {/* Stack chip — sits to the left of the Status chip. Always
          rendered so the row has stable horizontal layout regardless
          of which values are set. Role-gated: tester-only on top of
          the env-based `readOnly` prop (see `chipReadOnly` derivation
          above). Managers and developers see it as an inert label. */}
      <StackChip flow={flow} readOnly={chipReadOnly} />
      {/* Status chip — sits to the left of the Comments chip. Same
          role gate as Stack: tester-only on top of the env-based
          `readOnly` prop. */}
      <StatusChip flow={flow} readOnly={chipReadOnly} />
      {/* Comments chip — opens the comments modal. Lives between the
          Status chip and the relative time so the chip order matches
          the natural reading order (state → annotations → time). */}
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
        // IAM sub of the signed-in viewer. The modal uses this to
        // hide the Reply button on the viewer's own comments —
        // matching the self-notify skip in
        // `useAddFlowCommentReply.onSuccess` (no notification would
        // fire, so the affordance would be a dead click). Pulled
        // from `useAuthContext` for parity with `currentUserName` /
        // `currentUserEmail`.
        currentUserId={user?.id}
      />
    </>
  );
}
