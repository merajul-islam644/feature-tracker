// Error modal shown when a manager clicks an env pill on a feature row
// but the feature is blocked from promoting — either because it has
// zero flows under it, or because at least one of its flows is not
// in "passed" status (any of `failed` / `pending` / `draft` /
// `investigating` / `pause`). The pill stays clickable (rather than
// disabled) specifically so this modal can be opened; the previous
// disabled behavior just hid the block reason from the manager.
//
// Two-button layout:
//   * "Cancel" — closes the modal without action.
//   * "Request" — sends a `feature.promotion_requested` notification
//     to every QA assigned to the feature (`feature.qaIds`). The
//     notification payload is denormalized so the inbox renders a
//     meaningful title + body without a follow-up read. A success
//     toast confirms the request landed.
//
// Why notify QA only (not devs / manager): the QA team is the
// authority on whether a feature is ready to promote — they're the
// ones who flip status chips through their lifecycle, and a
// "promotion requested" row in their inbox is the actionable signal.
// Developers see promotion events through the normal broadcast
// notification when the actual promote lands; managers see their own
// requests in their sent history (no notification needed — the
// toast on the requester's side is the confirmation).
//
// `blockReason` discriminates which message the modal shows:
//   * `"empty"`         — "no flows, add at least one"
//   * `"notAllPassed"`  — "N flow(s) not yet Passed, fix them"

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/useToast";
import { useT } from "@/lib/blocks/i18n";
import { useAuth } from "@/hooks/useAuth";
import {
  notificationsCollection,
  type Project,
  type Feature,
} from "@/lib/blocks/data";

export type BlockReason = "empty" | "notAllPassed";

interface BlockPromoteModalProps {
  open: boolean;
  onClose: () => void;
  feature: Feature;
  // `useProject` returns `Project | null | undefined` — accept the
  // full union so the caller doesn't have to coerce. The modal
  // treats `null` / `undefined` identically: the notification
  // body falls back to an empty project name string.
  project: Project | null | undefined;
  // Display name of the env the manager clicked (Stg / Prod / UAT).
  // Used to render "{env} is blocked" in the title and the
  // notification body.
  targetEnvLabel: string;
  targetEnvSlug: string;
  // How many source-env flows are blocking promotion (i.e. have a
  // status other than `"passed"`) — drives the body copy. Zero for
  // the "empty" reason.
  blockingFlowCount: number;
  blockReason: BlockReason;
  // Names of the blocking flows (max 3, with "and N more" suffix)
  // so the modal body can point at specific flows by name. Empty
  // for the "empty" reason.
  blockingFlowNames: string[];
}

// Build the inline-typed NotificationInsert shape used by the
// notifier.ts module's helpers, but inline here because the request
// flow has a single-purpose payload and reusing the generic
// `notifyRole` / `notifyAssignedFeature` helpers would also require
// importing the surrounding actor / project resolution that lives
// inside `useCreateFeature`. Direct write keeps the request flow
// self-contained and easy to read.
//
// Mirrors `notifier.ts`'s `notifyAssignedFeature` schema: every row
// carries the full denormalized payload (projectName, featureName,
// envSlug, actorName, actionName "promotion_requested") so the
// inbox's `deriveTitle` / `deriveBody` render without a follow-up
// read. `readAt: ""` marks the row unread on insert. `value`
// carries the feature id (resource reference) — matches the
// `feature.created` / `feature.assigned` pattern in `notifyRole`.
type RequestInsert = {
  userId: string;
  context: "feature";
  actionName: "promotion_requested";
  actorId: string;
  actorName: string;
  projectId: string;
  projectName: string;
  featureId: string;
  featureName: string;
  flowId: string;
  flowName: string;
  envSlug: string;
  oldName: string;
  newName: string;
  status: string;
  stack: string;
  readAt: string;
};

export function BlockPromoteModal({
  open,
  onClose,
  feature,
  project,
  targetEnvLabel,
  targetEnvSlug,
  blockingFlowCount,
  blockReason,
  blockingFlowNames,
}: BlockPromoteModalProps) {
  const t = useT();
  const toast = useToast();
  const { currentUser } = useAuth();
  const [submitting, setSubmitting] = useState(false);

  // Reset the spinner state when re-opened, so a stale "sending"
  // never blocks a fresh attempt after a previous failure.
  useEffect(() => {
    if (open) setSubmitting(false);
  }, [open]);

  // Hard guard — refuse to open when there's no QA to notify. The
  // caller (`ManagerFeatureEnvWorkflow`) shouldn't open the modal
  // in that case, but the modal is also exported standalone and a
  // future caller might forget. Render an explicit warning instead
  // of silently dropping the click.
  const qaIds = feature.qaIds ?? [];
  const noQaToNotify = qaIds.length === 0;

  const handleOpenChange = (next: boolean) => {
    if (next) return;
    if (submitting) return;
    onClose();
  };

  // Title / description / body copy. The i18n keys follow the
  // existing pattern (`featureItem.*` / `envWorkflow.*`).
  const title =
    blockReason === "empty"
      ? t(
          "envWorkflow.emptyBlockTitle",
          'Cannot promote "{feature}" — no flows yet',
          { feature: feature.name },
        )
      : t(
          "envWorkflow.notAllPassedBlockTitle",
          'Cannot promote "{feature}" — flows not in Passed status',
          { feature: feature.name },
        );

  const description =
    blockReason === "empty"
      ? t(
          "envWorkflow.emptyBlockDescription",
          "This feature has no flows under it. Add at least one flow before promoting.",
        )
      : t(
          "envWorkflow.notAllPassedBlockDescription",
          '{count} flow under this feature is not in "Passed" status. Mark every flow as Passed before promoting to {env}.',
          {
            count: blockingFlowCount,
            env: targetEnvLabel,
          },
        );

  // Body section listing the blocking flow names (max 3 + "and N
  // more"). Render only for the "notAllPassed" reason — the
  // "empty" reason is its own explanation and doesn't need a name
  // list.
  const blockingNamesLine =
    blockReason === "notAllPassed" && blockingFlowNames.length > 0
      ? blockingFlowNames.join(", ") +
        (blockingFlowCount > blockingFlowNames.length
          ? t("envWorkflow.andMore", " and {n} more", {
              n: blockingFlowCount - blockingFlowNames.length,
            })
          : "")
      : null;

  const handleRequest = async () => {
    if (noQaToNotify) return; // defensive — see guard above
    setSubmitting(true);
    try {
      const rowBase: Omit<RequestInsert, "userId"> = {
        context: "feature",
        actionName: "promotion_requested",
        actorId: currentUser?.id ?? "",
        actorName: currentUser?.name ?? "A manager",
        projectId: feature.projectId,
        projectName: project?.name ?? "",
        featureId: feature.id,
        featureName: feature.name,
        flowId: "",
        flowName: "",
        envSlug: targetEnvSlug,
        oldName: "",
        newName: "",
        status: "",
        stack: "",
        readAt: "",
      };
      // Best-effort fanout — a failure on one QA's row must not
      // drop the others, so we use `Promise.allSettled` (same shape
      // as `notifyAssignedFeature`). Errors are swallowed because
      // the request is fire-and-forget from the user's POV; a
      // partial write still leaves the action surfaced.
      const results = await Promise.allSettled(
        qaIds.map((userId) =>
          notificationsCollection.create({ ...rowBase, userId }),
        ),
      );
      const rejected = results.filter((r) => r.status === "rejected").length;
      if (rejected > 0) {
        // Partial success — surface a non-blocking warning so the
        // manager knows not every QA got the ping, but still close
        // the modal and treat the action as done.
        toast.info(
          t(
            "envWorkflow.requestPartial",
            "Request sent to {ok} of {total} QA — {failed} failed.",
            { ok: qaIds.length - rejected, total: qaIds.length, failed: rejected },
          ),
        );
      } else {
        toast.success(
          t(
            "envWorkflow.requestSent",
            "Request sent to QA.",
          ),
        );
      }
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t(
              "envWorkflow.requestError",
              "Could not send request to QA.",
            ),
      );
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="sm">
        <DialogCloseButton />
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-3">
            {/* Inline list of blocking flow names so the manager can
                jump straight to the right flow rather than hunting
                through the feature. */}
            {blockingNamesLine && (
              <p className="rounded-md border border-amber-300/50 bg-amber-50/60 px-3 py-2 text-sm font-medium text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-100">
                {blockingNamesLine}
              </p>
            )}
            {/* QA recipient summary — tells the manager who's
                actually getting the request. Falls back to a
                warning when the feature has no QA assigned. */}
            {noQaToNotify ? (
              <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {t(
                  "envWorkflow.noQaAssigned",
                  "No QA is assigned to this feature — assign one before sending a promotion request.",
                )}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t(
                  "envWorkflow.requestRecipient",
                  "Request will be sent to assigned QA.",
                )}
              </p>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
          >
            {t("cancel", "Cancel")}
          </Button>
          <Button
            variant="default"
            onClick={handleRequest}
            loading={submitting}
            disabled={noQaToNotify}
          >
            {t("envWorkflow.requestButton", "Request")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
