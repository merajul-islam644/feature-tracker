// Read-only "Feature Details" drawer opened from the feature row's
// 3-dot kebab menu. Surfaces the fields the row itself can't show in
// one line: opaque IDs, env slug, clone origin, timestamps, and the
// per-status flow tally the kebab's +5 dropdown already references.
// No mutations here — this is the inspection counterpart to Rename /
// Delete. Implemented as a right-side Sheet rather than a Dialog so
// the user keeps the list context behind it (the row stays in view
// while details are open). Sheet already ships its own top-right X
// via SheetContent, so we don't need a separate close button there.

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuth } from "@/hooks/useAuth";
import { useT } from "@/lib/blocks/i18n";
import type { Feature } from "@/lib/blocks/data";

interface FeatureDetailsDrawerProps {
  open: boolean;
  onClose: () => void;
  feature: Feature;
  /** Total flows visible on the parent page (already env-filtered). */
  visibleFlowCount: number;
  /** Passed / failed / pending counts — same source as the row's pills. */
  statusCounts: { passed: number; failed: number; pending: number };
}

// Render a labeled field the way ProfilePage does — small uppercase
// caption with the value below. Keeps the drawer visually consistent
// with the rest of the app's "account info" read-only screens.
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm text-foreground">{children}</dd>
    </div>
  );
}

// Render a user-reference (createdBy / updatedBy) in a way that scales:
// when the id matches the signed-in user we render a friendly "You"
// chip with the user's display name as a tooltip; otherwise we fall
// back to the raw subject id in mono so any audit-style consumer can
// still read it. Missing ids render "—" via the same path other
// optional fields use.
function UserChip({
  userId,
  youLabel,
  currentUserId,
  currentUserName,
}: {
  userId?: string;
  youLabel: string;
  currentUserId?: string;
  currentUserName?: string;
}) {
  if (!userId) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (currentUserId && userId === currentUserId) {
    return (
      <span
        title={currentUserName}
        className="inline-flex items-center rounded-full border border-border bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground"
      >
        {youLabel}
      </span>
    );
  }
  return (
    <span className="break-all font-mono text-xs" title={userId}>
      {userId}
    </span>
  );
}

export function FeatureDetailsDrawer({
  open,
  onClose,
  feature,
  visibleFlowCount,
  statusCounts,
}: FeatureDetailsDrawerProps) {
  const t = useT();
  // We don't have a user directory to look up other authors by id, so
  // the "Created by / Updated by" fields render the raw IAM subject
  // (OIDC `sub`) in mono — except when the id matches the signed-in
  // user, in which case we swap in a friendly "You" label with the
  // user's display name as a tooltip. The fallback "—" kicks in for
  // pre-audit records where the cloud returned neither field.
  const { currentUser } = useAuth();

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      {/* Right-side drawer, wider than Sheet's stock sm:max-w-sm so the
          id-style mono fields and the two-column grid breathe. */}
      <SheetContent side="right" className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>
            {t("featureItem.detailsTitle", "Feature Details")}
          </SheetTitle>
          <SheetDescription>
            {t(
              "featureItem.detailsDescription",
              "Read-only summary of this feature.",
            )}
          </SheetDescription>
        </SheetHeader>

        {/* SheetContent renders `p-6` already; the body scrolls if the
            feature has a long clone id or many nested fields. Pull the
            sections off the bottom so the footer stays anchored. */}
        <div className="flex-1 overflow-y-auto py-2">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Field label={t("featureItem.details.name", "Name")}>
              <span className="font-semibold">{feature.name}</span>
            </Field>
            <Field label={t("featureItem.details.env", "Environment")}>
              {feature.envSlug ? (
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  {feature.envSlug}
                </code>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </Field>
            <Field label={t("featureItem.details.id", "Feature ID")}>
              <span className="break-all font-mono text-xs">
                {feature.id}
              </span>
            </Field>
            <Field label={t("featureItem.details.projectId", "Project ID")}>
              <span className="break-all font-mono text-xs">
                {feature.projectId}
              </span>
            </Field>
            {/* Clone origin only shows when present — most features are
                source rows that have nothing to point at. */}
            {feature.clonedFromFeatureId && (
              <Field
                label={t(
                  "featureItem.details.clonedFrom",
                  "Cloned from feature",
                )}
              >
                <span className="break-all font-mono text-xs">
                  {feature.clonedFromFeatureId}
                </span>
              </Field>
            )}
            <Field label={t("featureItem.details.created", "Created")}>
              {new Date(feature.createdAt).toLocaleString()}
            </Field>
            <Field label={t("featureItem.details.updated", "Last updated")}>
              {new Date(feature.updatedAt).toLocaleString()}
            </Field>
            <Field label={t("featureItem.details.createdBy", "Created by")}>
              <UserChip
                userId={feature.createdBy}
                youLabel={t("featureItem.details.you", "You")}
                currentUserId={currentUser?.id}
                currentUserName={currentUser?.name}
              />
            </Field>
            <Field label={t("featureItem.details.updatedBy", "Updated by")}>
              <UserChip
                userId={feature.updatedBy}
                youLabel={t("featureItem.details.you", "You")}
                currentUserId={currentUser?.id}
                currentUserName={currentUser?.name}
              />
            </Field>
          </dl>

          <Separator className="my-5" />

          <div>
            <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("featureItem.details.flowsHeading", "Flows")}
            </h4>
            <p className="mt-2 text-sm text-foreground">
              <span className="font-semibold">{visibleFlowCount}</span>{" "}
              {t(
                "featureItem.details.flowsTotal",
                "visible in this environment",
              )}
            </p>
            <ul className="mt-3 flex flex-wrap gap-2 text-xs">
              <li className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 font-medium text-muted-foreground">
                {t("flowStatus.passed", "passed")}
                <span className="font-semibold text-foreground">
                  {statusCounts.passed}
                </span>
              </li>
              <li className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 font-medium text-muted-foreground">
                {t("flowStatus.failed", "failed")}
                <span className="font-semibold text-foreground">
                  {statusCounts.failed}
                </span>
              </li>
              <li className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 font-medium text-muted-foreground">
                {t("flowStatus.pending", "pending")}
                <span className="font-semibold text-foreground">
                  {statusCounts.pending}
                </span>
              </li>
            </ul>
          </div>
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={onClose}>
            {t("close", "Close")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
