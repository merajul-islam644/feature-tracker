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
import { lookupUserById } from "@/lib/blocks/users";
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

// Render a user-reference (createdBy / updatedBy / assigned
// developer / assigned QA) so audit-style fields show a friendly
// name + email when we have it, and degrade gracefully otherwise.
//
// Resolution priority:
//   1. If `userId` matches the signed-in user we render a "You" badge
//      using `currentUserName` / `currentUserEmail` from `useAuth()`.
//   2. If `userId` resolves via `lookupUserById()` (the hardcoded IAM
//      roster — see `users.ts`) we render the friendly `resolvedName`
//      + `resolvedEmail` from the lookup result.
//   3. Otherwise we fall back to the raw OIDC `sub` in mono, so an
//      audit-style reader can still copy/paste the id when the roster
//      doesn't yet know about that user.
//
// Missing ids render "—" via the same path other optional fields use.
function UserChip({
  userId,
  youLabel,
  currentUserId,
  currentUserName,
  currentUserEmail,
  resolvedName,
  resolvedEmail,
}: {
  userId?: string;
  youLabel: string;
  currentUserId?: string;
  currentUserName?: string;
  currentUserEmail?: string;
  resolvedName?: string;
  resolvedEmail?: string;
}) {
  if (!userId) {
    return <span className="text-muted-foreground">—</span>;
  }
  const isCurrentUser = !!currentUserId && userId === currentUserId;
  // Compose the visible name/email. "You" case draws from the auth
  // context; other users draw from the hardcoded roster. Either path
  // is optional — when neither is available we fall through to the
  // mono-id fallback below.
  const visibleName = isCurrentUser ? currentUserName : resolvedName;
  const visibleEmail = isCurrentUser ? currentUserEmail : resolvedEmail;
  if (!visibleName && !visibleEmail) {
    return (
      <span className="break-all font-mono text-xs" title={userId}>
        {userId}
      </span>
    );
  }
  // Two-line name-on-top, mailto-below layout. The "You" badge rides
  // above only when the reference matches the signed-in user; for
  // any other user we drop the badge (it's redundant with the name)
  // and let the name stand alone.
  return (
    <div className="space-y-0.5">
      {isCurrentUser && (
        <span
          title={currentUserName}
          className="inline-flex items-center rounded-full border border-border bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground"
        >
          {youLabel}
        </span>
      )}
      {visibleName && (
        <div className="text-sm font-medium text-foreground">
          {visibleName}
        </div>
      )}
      {visibleEmail && (
        <a
          href={`mailto:${visibleEmail}`}
          className="block break-all text-xs text-muted-foreground hover:underline"
        >
          {visibleEmail}
        </a>
      )}
    </div>
  );
}

// Render a list of user references — used for "Assigned developers"
// / "Assigned QAs" fields which carry `string[]` (multiple co-
// developers / co-QAs per feature). Each entry resolves through the
// same `UserChip` so name + email renders identically, with one chip
// per assignee. Empty array renders the same "—" as a missing scalar
// field. Multiple chips stack vertically with a thin gap so the
// drawer doesn't widen to fit a long email address mid-row.
function UserChipList({
  userIds,
  youLabel,
  currentUserId,
  currentUserName,
  currentUserEmail,
  resolveName,
  resolveEmail,
}: {
  userIds: string[];
  youLabel: string;
  currentUserId?: string;
  currentUserName?: string;
  currentUserEmail?: string;
  /**
   * Lookup function: given an id, return the friendly name + email
   * (or `undefined`). Wired this way (instead of taking a map) so
   * callers don't have to build a per-render map and so a missing
   * UserOption falls through to the mono-id fallback inside
   * `UserChip` automatically.
   */
  resolveName: (id: string) => string | undefined;
  resolveEmail: (id: string) => string | undefined;
}) {
  if (userIds.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <div className="space-y-2">
      {userIds.map((id) => {
        const isCurrentUser = !!currentUserId && id === currentUserId;
        return (
          <UserChip
            key={id}
            userId={id}
            youLabel={youLabel}
            currentUserId={currentUserId}
            currentUserName={isCurrentUser ? currentUserName : undefined}
            currentUserEmail={isCurrentUser ? currentUserEmail : undefined}
            resolvedName={isCurrentUser ? undefined : resolveName(id)}
            resolvedEmail={isCurrentUser ? undefined : resolveEmail(id)}
          />
        );
      })}
    </div>
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
  const { currentUser } = useAuth();
  // Resolve every user-reference on the feature to a friendly
  // name + email against the hardcoded IAM roster
  // (`HARDCODED_USER_BY_ID` — see `users.ts`). When an id matches
  // the signed-in user, `UserChip` / `UserChipList` draw name/email
  // from the auth context instead so a sign-out doesn't
  // temporarily blank the field during the IAM fetch. Unknown ids
  // fall through to the raw OIDC `sub` mono-id fallback inside
  // `UserChip`.
  //
  // Assignment fields are arrays now (`developerIds` / `qaIds`) —
  // the same UserOption rosters supply per-id lookups; we expose
  // them as resolver functions to keep `UserChipList` generic.
  const developerIds = feature.developerIds ?? [];
  const qaIds = feature.qaIds ?? [];
  const developerName = (id: string) => lookupUserById(id)?.name;
  const developerEmail = (id: string) => lookupUserById(id)?.email;
  const qaName = (id: string) => lookupUserById(id)?.name;
  const qaEmail = (id: string) => lookupUserById(id)?.email;
  // Single-id audit lookups (Created by / Updated by) still go
  // through the same mapper — both audit fields are single ids,
  // not arrays.
  const createdByUser = lookupUserById(feature.createdBy);
  const updatedByUser = lookupUserById(feature.updatedBy);

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
                currentUserEmail={currentUser?.email}
                resolvedName={createdByUser?.name}
                resolvedEmail={createdByUser?.email}
              />
            </Field>
            <Field label={t("featureItem.details.updatedBy", "Updated by")}>
              <UserChip
                userId={feature.updatedBy}
                youLabel={t("featureItem.details.you", "You")}
                currentUserId={currentUser?.id}
                currentUserName={currentUser?.name}
                currentUserEmail={currentUser?.email}
                resolvedName={updatedByUser?.name}
                resolvedEmail={updatedByUser?.email}
              />
            </Field>
            {/* Assignment fields — populated by the Assign-a-Developer
                and Assign-a-QA dropdowns on the Add Feature modal.
                Render the same UserChip pattern as Created/Updated by
                so a manager assigned to their own feature sees "You"
                with their name + email below, and any other assignee
                resolves to friendly name + email from the hardcoded
                IAM roster. Unknown ids fall back to the mono id. */}
            <Field
              label={t("featureItem.details.developer", "Assigned developers")}
            >
              <UserChipList
                userIds={developerIds}
                youLabel={t("featureItem.details.you", "You")}
                currentUserId={currentUser?.id}
                currentUserName={currentUser?.name}
                currentUserEmail={currentUser?.email}
                resolveName={developerName}
                resolveEmail={developerEmail}
              />
            </Field>
            <Field label={t("featureItem.details.qa", "Assigned QAs")}>
              <UserChipList
                userIds={qaIds}
                youLabel={t("featureItem.details.you", "You")}
                currentUserId={currentUser?.id}
                currentUserName={currentUser?.name}
                currentUserEmail={currentUser?.email}
                resolveName={qaName}
                resolveEmail={qaEmail}
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
