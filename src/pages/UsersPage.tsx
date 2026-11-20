// `/users` — IAM user administration.
//
// Distinct from `/members` (the directory + project-assignment roster):
// this page manages the IAM RECORDS themselves — invite, activate /
// deactivate, role grants. All mutations are manager-only: the page
// hides the controls for other roles AND every mutation re-gates at
// runtime in `userAdmin.ts` (defense-in-depth, per the house rule that
// a UI hide is a UX nicety, the hook guard is the actual enforcement).
//
// Data comes from `useIamAdminUsers` (live IAM only, no fallback) — an
// admin screen that renders a stale safety-net roster would invite
// destructive actions against wrong records, so failures surface as
// an error state with a retry instead.

import { useMemo, useState } from "react";
import { Search, UserCog, UserPlus, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/shared/ui/PageHeader";
import { ActionButton } from "@/shared/ui/ActionButton";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { MoreVertical, Pencil, UserX, UserCheck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useT } from "@/lib/blocks/i18n";
import {
  useIamAdminUsers,
  type IamAdminUser,
} from "@/lib/blocks/userAdmin";
import {
  ConfirmUserStateDialog,
  EditRolesDialog,
  InviteUserDialog,
} from "@/components/users/UserAdminDialogs";

// Role chip colors — same vocabulary as MembersPage's rail colors so
// the two user surfaces read as one system:
//   manager → primary (brand indigo), developer → violet, tester → sky,
//   anything else → muted. Chip styling, not rails, because a row can
//   carry multiple roles and chips stack horizontally.
const ROLE_CHIP_CLASS: Record<string, string> = {
  manager: "bg-primary/10 text-primary border-primary/20",
  developer: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20",
  tester: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
};
const DEFAULT_ROLE_CHIP_CLASS =
  "bg-muted text-muted-foreground border-border";

type StatusFilter = "all" | "active" | "deactivated";

export function UsersPage() {
  const t = useT();
  const { currentUser } = useAuth();
  const isManager = currentUser?.roles?.includes("manager") ?? false;

  const usersQuery = useIamAdminUsers();
  const users = usersQuery.data ?? [];

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Dialog state — one row under edit at a time, one dialog open at a
  // time. `rolesUser` / `stateUser` / `stateTarget` travel together so
  // the confirm dialog can re-render its copy for the right action.
  const [inviteOpen, setInviteOpen] = useState(false);
  const [rolesUser, setRolesUser] = useState<IamAdminUser | null>(null);
  const [stateUser, setStateUser] = useState<IamAdminUser | null>(null);
  const [stateTarget, setStateTarget] = useState(false);

  const activeCount = users.filter((u) => u.active).length;
  const deactivatedCount = users.length - activeCount;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (statusFilter === "active" && !u.active) return false;
      if (statusFilter === "deactivated" && u.active) return false;
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
      );
    });
  }, [users, search, statusFilter]);

  const STATUS_TABS: Array<{ key: StatusFilter; label: string; count: number }> = [
    { key: "all", label: t("users.filterAll", "All"), count: users.length },
    { key: "active", label: t("users.filterActive", "Active"), count: activeCount },
    {
      key: "deactivated",
      label: t("users.filterDeactivated", "Deactivated"),
      count: deactivatedCount,
    },
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title={t("users.title", "Users")}
        subtitle={t(
          "users.subtitle",
          "Workspace accounts — invite teammates, manage roles, and suspend access.",
        )}
        actions={
          isManager ? (
            <ActionButton
              icon={<UserPlus className="h-4 w-4" />}
              onClick={() => setInviteOpen(true)}
            >
              {t("users.invite", "Invite user")}
            </ActionButton>
          ) : undefined
        }
      />

      {usersQuery.isError ? (
        <ErrorState
          title={t("users.errorTitle", "Couldn't load the user list.")}
          message={
            usersQuery.error?.message ||
            t(
              "users.errorMessage",
              "IAM refused the request. If this persists, your role may be missing the View Users permission.",
            )
          }
          onRetry={() => usersQuery.refetch()}
        />
      ) : (
        <>
          {/* Toolbar — search + status tabs. Deemed worth the row even
              though the tenant roster is small today: this page is the
              surface that grows first as the workspace onboards. */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="w-full max-w-sm">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("users.searchPlaceholder", "Search by name or email…")}
                aria-label={t("users.searchLabel", "Search users")}
              />
            </div>
            <div className="flex items-center gap-1.5">
              {STATUS_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setStatusFilter(tab.key)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    statusFilter === tab.key
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {tab.label}
                  <span className="ml-1.5 tabular-nums opacity-70">
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <Card>
            <CardContent className="p-2 sm:p-3">
              {usersQuery.isLoading ? (
                <div className="flex flex-col gap-2 p-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <Skeleton className="h-9 w-9 rounded-full" />
                      <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-3.5 w-48" />
                        <Skeleton className="h-3 w-64" />
                      </div>
                      <Skeleton className="h-6 w-20 rounded-full" />
                    </div>
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <EmptyState
                  title={
                    search || statusFilter !== "all"
                      ? t(
                          "users.noMatchTitle",
                          "No users match the current filter.",
                        )
                      : t("users.emptyTitle", "No users yet.")
                  }
                  description={
                    search || statusFilter !== "all"
                      ? t(
                          "users.noMatchDesc",
                          "Try a different search term or switch the status tab.",
                        )
                      : t(
                          "users.emptyDesc",
                          "Invite the first teammate to give them access to this workspace.",
                        )
                  }
                  icon={<UserCog className="h-5 w-5" aria-hidden="true" />}
                  action={
                    isManager && users.length === 0 ? (
                      <ActionButton
                        icon={<UserPlus className="h-4 w-4" />}
                        onClick={() => setInviteOpen(true)}
                      >
                        {t("users.invite", "Invite user")}
                      </ActionButton>
                    ) : undefined
                  }
                />
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {filtered.map((u) => {
                    const isSelf = u.id === currentUser?.id;
                    return (
                      <li
                        key={u.id}
                        className="flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-muted/40"
                      >
                        <UserAvatar
                          userId={u.id}
                          name={u.name}
                          size="md"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-foreground">
                              {u.name}
                            </span>
                            {isSelf && (
                              <span className="shrink-0 text-xs text-muted-foreground">
                                ({t("users.you", "you")})
                              </span>
                            )}
                          </div>
                          <p className="truncate text-xs text-muted-foreground">
                            {u.email || u.id}
                          </p>
                        </div>
                        <div className="hidden flex-wrap items-center justify-end gap-1.5 sm:flex">
                          {u.roles.length > 0 ? (
                            u.roles.map((r) => (
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
                        <div className="w-28 shrink-0 text-right sm:w-32">
                          {u.active ? (
                            <StatusChip
                              status="success"
                              hideIcon
                              label={t("users.active", "Active")}
                            />
                          ) : (
                            <StatusChip
                              status="neutral"
                              hideIcon
                              label={t("users.deactivated", "Deactivated")}
                            />
                          )}
                        </div>
                        {isManager && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                aria-label={t(
                                  "users.rowActionsLabel",
                                  `Actions for ${u.name}`,
                                )}
                                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent"
                              >
                                <MoreVertical
                                  className="h-4 w-4"
                                  aria-hidden="true"
                                />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuItem
                                onSelect={() => setRolesUser(u)}
                              >
                                <Pencil className="h-4 w-4" aria-hidden="true" />
                                <span>
                                  {t("users.manageRoles", "Manage roles")}
                                </span>
                              </DropdownMenuItem>
                              {u.active ? (
                                <DropdownMenuItem
                                  onSelect={() => {
                                    setStateUser(u);
                                    setStateTarget(false);
                                  }}
                                  className="text-red-600 focus:bg-red-50 focus:text-red-700"
                                >
                                  <UserX className="h-4 w-4" aria-hidden="true" />
                                  <span>{t("users.deactivate", "Deactivate")}</span>
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem
                                  onSelect={() => {
                                    setStateUser(u);
                                    setStateTarget(true);
                                  }}
                                >
                                  <UserCheck
                                    className="h-4 w-4"
                                    aria-hidden="true"
                                  />
                                  <span>{t("users.reactivate", "Reactivate")}</span>
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Permission footnote — sets the expectation that the rows
              render because the signed-in role holds View Users, and
              that mutations need more than that. Mirrors the tenant
              caveat documented in `users.ts`. */}
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {isManager
              ? t(
                  "users.managerFootnote",
                  "You're a manager — invites, role changes, and account state apply immediately.",
                )
              : t(
                  "users.viewerFootnote",
                  "Read-only view. Invites and role changes are manager actions.",
                )}
          </p>
        </>
      )}

      <InviteUserDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />
      <EditRolesDialog
        open={rolesUser !== null}
        onClose={() => setRolesUser(null)}
        user={rolesUser}
        currentUserId={currentUser?.id ?? ""}
      />
      <ConfirmUserStateDialog
        open={stateUser !== null}
        onClose={() => setStateUser(null)}
        user={stateUser}
        targetActive={stateTarget}
      />
    </div>
  );
}
