// `/organizations` — the workspace's tenancy boundary, manager-controlled.
//
// Master-detail: the org grid (every organization in the tenant) on
// top, the selected org's member roster below. Membership changes
// (add with per-org roles / remove) fire the same IAM surfaces the
// CLI uses — `users.updateAccess` / `users.revokeAccess` with
// `organizationId` — so what a manager does here matches what an
// operator does from a terminal.
//
// Scope cuts (deliberate, user's point-by-point flow): org config
// editor, signup policy, and per-org default-role editing are not in
// this pass.

import { useMemo, useState } from "react";
import {
  Building2,
  Globe,
  MoreVertical,
  Pencil,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/shared/ui/PageHeader";
import { ActionButton } from "@/shared/ui/ActionButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { StatusChip } from "@/components/ui/status-chip";
import { UserAvatar } from "@/components/ui/UserAvatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { useT } from "@/lib/blocks/i18n";
import { useIamAdminUsers } from "@/lib/blocks/userAdmin";
import {
  useOrgMembers,
  useOrganizations,
  type OrganizationRecord,
  type OrgMember,
} from "@/lib/blocks/orgAdmin";
import {
  AddOrgMemberDialog,
  OrgFormDialog,
  RemoveOrgMemberDialog,
} from "@/components/organizations/OrganizationDialogs";
import {
  OrgConfigCard,
  SignupPolicyCard,
} from "@/components/organizations/TenantPolicyCards";

// Same role-chip vocabulary as UsersPage/MembersPage so all three
// identity surfaces read as one system.
const ROLE_CHIP_CLASS: Record<string, string> = {
  manager: "bg-primary/10 text-primary border-primary/20",
  developer: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20",
  tester: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
};
const DEFAULT_ROLE_CHIP_CLASS = "bg-muted text-muted-foreground border-border";

export function OrganizationsPage() {
  const t = useT();
  const { currentUser } = useAuth();
  const isManager = currentUser?.roles?.includes("manager") ?? false;

  const orgsQuery = useOrganizations();
  const orgs = orgsQuery.data ?? [];

  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const selectedOrg = orgs.find((o) => o.id === selectedOrgId) ?? null;

  // Members read only for the selected org — one in-flight roster at a
  // time keeps the wire cost flat no matter how many orgs exist.
  const membersQuery = useOrgMembers(selectedOrgId);
  const members = membersQuery.data ?? [];

  // Candidate roster for the add-member picker (the same cached admin
  // read the Users page holds — no extra fetch after the first mount).
  const rosterQuery = useIamAdminUsers();
  const candidates = useMemo(
    () =>
      (rosterQuery.data ?? []).map((u) => ({
        id: u.id,
        displayName: u.name,
        email: u.email,
      })),
    [rosterQuery.data],
  );

  // Dialog state — one at a time, same discipline as UsersPage.
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<OrganizationRecord | null>(null);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<OrgMember | null>(null);

  const openCreate = () => {
    setEditTarget(null);
    setFormOpen(true);
  };
  const openEdit = (org: OrganizationRecord) => {
    setEditTarget(org);
    setFormOpen(true);
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title={t("orgs.title", "Organizations")}
        subtitle={t(
          "orgs.subtitle",
          "Tenancy boundary — give each firm or team its own members and roles.",
        )}
        actions={
          isManager ? (
            <ActionButton
              icon={<Building2 className="h-4 w-4" />}
              onClick={openCreate}
            >
              {t("orgs.create", "Create organization")}
            </ActionButton>
          ) : undefined
        }
      />

      {orgsQuery.isError ? (
        <ErrorState
          title={t("orgs.errorTitle", "Couldn't load organizations.")}
          message={
            orgsQuery.error?.message ||
            t(
              "orgs.errorMessage",
              "IAM refused the request. Your role may be missing the View Organizations permission.",
            )
          }
          onRetry={() => orgsQuery.refetch()}
        />
      ) : orgsQuery.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="space-y-3 p-4">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-3 w-56" />
                <Skeleton className="h-3 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : orgs.length === 0 ? (
        <EmptyState
          title={t("orgs.emptyTitle", "No organizations yet.")}
          description={t(
            "orgs.emptyDesc",
            "Create the first organization to give a firm or team its own isolated member list.",
          )}
          icon={<Building2 className="h-5 w-5" aria-hidden="true" />}
          action={
            isManager ? (
              <ActionButton
                icon={<Building2 className="h-4 w-4" />}
                onClick={openCreate}
              >
                {t("orgs.create", "Create organization")}
              </ActionButton>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Org grid — selected card gets the accent ring; selection
              drives the members panel below. */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {orgs.map((org) => {
              const selected = org.id === selectedOrgId;
              return (
                <Card
                  key={org.id}
                  className={cn(
                    "cursor-pointer transition-colors",
                    selected
                      ? "border-primary/60 ring-1 ring-primary/40"
                      : "hover:border-primary/30",
                  )}
                  onClick={() => setSelectedOrgId(selected ? null : org.id)}
                >
                  <CardContent className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                          <Building2 className="h-4 w-4" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-semibold text-foreground">
                            {org.name}
                          </h3>
                          <p className="truncate text-xs text-muted-foreground">
                            {org.id}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {org.isDisabled && (
                          <StatusChip
                            status="neutral"
                            hideIcon
                            label={t("orgs.disabled", "Disabled")}
                          />
                        )}
                        {isManager && (
                          <div onClick={(e) => e.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  aria-label={t(
                                    "orgs.orgActionsLabel",
                                    `Actions for ${org.name}`,
                                  )}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent"
                                >
                                  <MoreVertical
                                    className="h-4 w-4"
                                    aria-hidden="true"
                                  />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-40">
                                <DropdownMenuItem
                                  onSelect={() => openEdit(org)}
                                >
                                  <Pencil
                                    className="h-4 w-4"
                                    aria-hidden="true"
                                  />
                                  <span>{t("orgs.edit", "Edit")}</span>
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        )}
                      </div>
                    </div>
                    {org.description && (
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {org.description}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      {org.websiteUrl && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Globe className="h-3 w-3" aria-hidden="true" />
                          <span className="max-w-40 truncate">{org.websiteUrl}</span>
                        </span>
                      )}
                      {org.timeZone && (
                        <Badge
                          variant="outline"
                          className="text-[11px] text-muted-foreground"
                        >
                          {org.timeZone}
                        </Badge>
                      )}
                      {org.defaultRoleSlugs.map((r) => (
                        <Badge
                          key={r}
                          variant="outline"
                          className={cn(
                            "text-[11px]",
                            ROLE_CHIP_CLASS[r] ?? DEFAULT_ROLE_CHIP_CLASS,
                          )}
                        >
                          {r}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Members panel — the selected org's roster with add/remove. */}
          {selectedOrg && (
            <Card>
              <CardContent className="p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">
                      {t("orgs.membersTitle", "Members — {name}").replace(
                        "{name}",
                        selectedOrg.name,
                      )}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {membersQuery.isLoading
                        ? t("orgs.membersLoading", "Loading roster…")
                        : t(
                            "orgs.membersCount",
                            `${members.length} member${members.length === 1 ? "" : "s"} in this organization`,
                          )}
                    </p>
                  </div>
                  {isManager && (
                    <ActionButton
                      icon={<UserPlus className="h-4 w-4" />}
                      onClick={() => setAddMemberOpen(true)}
                    >
                      {t("orgs.addMember", "Add member")}
                    </ActionButton>
                  )}
                </div>

                {membersQuery.isError ? (
                  <ErrorState
                    title={t("orgs.membersErrorTitle", "Couldn't load members.")}
                    message={membersQuery.error?.message}
                    onRetry={() => membersQuery.refetch()}
                  />
                ) : membersQuery.isLoading ? (
                  <div className="flex flex-col gap-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <Skeleton className="h-9 w-9 rounded-full" />
                        <div className="flex-1 space-y-1.5">
                          <Skeleton className="h-3.5 w-40" />
                          <Skeleton className="h-3 w-56" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : members.length === 0 ? (
                  <EmptyState
                    title={t(
                      "orgs.membersEmptyTitle",
                      "No members in this organization yet.",
                    )}
                    description={t(
                      "orgs.membersEmptyDesc",
                      "Add a user to give them membership and org-scoped roles.",
                    )}
                    icon={<Building2 className="h-5 w-5" aria-hidden="true" />}
                  />
                ) : (
                  <ul className="flex flex-col divide-y divide-border">
                    {members.map((m) => {
                      const isSelf = m.id === currentUser?.id;
                      return (
                        <li
                          key={m.id}
                          className="flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-muted/40"
                        >
                          <UserAvatar userId={m.id} name={m.name} size="md" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium text-foreground">
                                {m.name}
                              </span>
                              {isSelf && (
                                <span className="shrink-0 text-xs text-muted-foreground">
                                  ({t("users.you", "you")})
                                </span>
                              )}
                            </div>
                            <p className="truncate text-xs text-muted-foreground">
                              {m.email || m.id}
                            </p>
                          </div>
                          <div className="hidden flex-wrap items-center justify-end gap-1.5 sm:flex">
                            {m.roles.length > 0 ? (
                              m.roles.map((r) => (
                                <Badge
                                  key={r}
                                  variant="outline"
                                  className={cn(
                                    "text-[11px]",
                                    ROLE_CHIP_CLASS[r] ?? DEFAULT_ROLE_CHIP_CLASS,
                                  )}
                                >
                                  {r}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                {t("users.noRoles", "no roles")}
                              </span>
                            )}
                          </div>
                          {isManager && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => setRemoveTarget(m)}
                              title={t(
                                "orgs.removeMemberTitle",
                                "Remove from organization",
                              )}
                            >
                              <UserMinus className="h-4 w-4" aria-hidden="true" />
                              <span className="hidden sm:inline">
                                {t("orgs.removeMember", "Remove")}
                              </span>
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Tenant policy — the two IAM records that decide how new
          users enter the workspace (signup policy) and how
          organizations behave tenant-wide (org config). These sit
          BELOW the membership panel: the day-to-day work (who's in
          which org) reads first; the policy controls are the rarer,
          bigger lever. */}
      <div className="grid gap-3 lg:grid-cols-2">
        <SignupPolicyCard />
        <OrgConfigCard />
      </div>

      <OrgFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        organization={editTarget}
      />
      <AddOrgMemberDialog
        open={addMemberOpen}
        onClose={() => setAddMemberOpen(false)}
        organization={selectedOrg}
        existingMemberIds={members.map((m) => m.id)}
        candidates={candidates}
      />
      <RemoveOrgMemberDialog
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        organization={selectedOrg}
        member={removeTarget}
      />
    </div>
  );
}
