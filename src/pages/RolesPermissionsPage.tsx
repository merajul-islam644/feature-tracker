// `/roles` — RBAC definition management: the roles in this tenant and
// the permissions wired to them. This is the sensitive half of Blocks
// access control (the blocks-iam-access-control skill's Facet 2): the
// page is manager-only in the nav, every mutation re-gates manager at
// runtime, and IAM gates the calls behind `mutate-roles` +
// `permissions` (View Permissions).
//
// Two tabs:
//   - Roles — cards with the permission count (derived from the
//     permissions inventory, since roles.list doesn't carry grants);
//     kebab → Edit / Assign permissions; header → Create role.
//   - Permissions — the inventory grouped by namespace with the role
//     chips holding each. Read-only: the wiring happens through the
//     role side so the delta dialog stays in one place.

import { useMemo, useState } from "react";
import { KeyRound, MoreVertical, Pencil, Shield, ShieldPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/shared/ui/PageHeader";
import { ActionButton } from "@/shared/ui/ActionButton";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/lib/blocks/i18n";
import {
  useAllPermissions,
  useRoles,
  type RoleRecord,
} from "@/lib/blocks/roleAdmin";
import {
  AssignPermissionsDialog,
  RoleFormDialog,
  RoleChip,
} from "@/components/roles/RoleDialogs";

export function RolesPermissionsPage() {
  const t = useT();
  const rolesQuery = useRoles();
  const permsQuery = useAllPermissions();

  const roles = rolesQuery.data ?? [];
  const permissions = permsQuery.data ?? [];

  // role.slug → permission count, derived once from the inventory.
  const permCountBySlug = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of permissions) {
      for (const slug of p.roles) map.set(slug, (map.get(slug) ?? 0) + 1);
    }
    return map;
  }, [permissions]);

  // Permissions grouped by namespace for the read-only tab.
  const permGroups = useMemo(() => {
    const map = new Map<string, typeof permissions>();
    for (const p of permissions) {
      const key = p.resource.split("::").slice(0, 2).join("::");
      const list = map.get(key) ?? (map.set(key, []), map.get(key)!);
      list.push(p);
    }
    return [...map.entries()];
  }, [permissions]);

  // Dialog state — one at a time.
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<RoleRecord | null>(null);
  const [assignTarget, setAssignTarget] = useState<RoleRecord | null>(null);

  const openCreate = () => {
    setEditTarget(null);
    setFormOpen(true);
  };
  const openEdit = (role: RoleRecord) => {
    setEditTarget(role);
    setFormOpen(true);
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title={t("roles.title", "Roles & Permissions")}
        subtitle={t(
          "roles.subtitle",
          "Define roles and wire the permission sets users get with them.",
        )}
        actions={
          <ActionButton
            icon={<ShieldPlus className="h-4 w-4" />}
            onClick={openCreate}
          >
            {t("roles.create", "Create role")}
          </ActionButton>
        }
      />

      <Tabs defaultValue="roles">
        <TabsList>
          <TabsTrigger value="roles">
            {t("roles.tabRoles", "Roles")}
            <span className="ml-1.5 tabular-nums text-muted-foreground">
              {roles.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="permissions">
            {t("roles.tabPermissions", "Permissions")}
            <span className="ml-1.5 tabular-nums text-muted-foreground">
              {permissions.length}
            </span>
          </TabsTrigger>
        </TabsList>

        {/* --- Roles tab --- */}
        <TabsContent value="roles" className="mt-4">
          {rolesQuery.isError ? (
            <ErrorState
              title={t("roles.errorTitle", "Couldn't load roles.")}
              message={
                rolesQuery.error?.message ||
                t(
                  "roles.errorMessage",
                  "Your role may be missing the View Roles / View Permissions permissions.",
                )
              }
              onRetry={() => rolesQuery.refetch()}
            />
          ) : rolesQuery.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="space-y-3 p-4">
                    <Skeleton className="h-5 w-36" />
                    <Skeleton className="h-3 w-52" />
                    <Skeleton className="h-3 w-24" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : roles.length === 0 ? (
            <EmptyState
              title={t("roles.emptyTitle", "No roles yet.")}
              description={t(
                "roles.emptyDesc",
                "Create the first role, then assign it a permission set.",
              )}
              icon={<Shield className="h-5 w-5" aria-hidden="true" />}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {roles.map((role) => (
                <Card key={role.itemId}>
                  <CardContent className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <div
                          className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                            role.slug === "manager"
                              ? "bg-primary/10 text-primary"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          <Shield className="h-4 w-4" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-semibold text-foreground">
                            {role.name}
                          </h3>
                          <p className="truncate font-mono text-xs text-muted-foreground">
                            {role.slug}
                          </p>
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            aria-label={t(
                              "roles.roleActionsLabel",
                              `Actions for ${role.slug}`,
                            )}
                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent"
                          >
                            <MoreVertical className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onSelect={() => setAssignTarget(role)}>
                            <KeyRound className="h-4 w-4" aria-hidden="true" />
                            <span>{t("roles.assignMenu", "Assign permissions")}</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => openEdit(role)}>
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                            <span>{t("roles.editMenu", "Edit")}</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {role.description && (
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {role.description}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[11px]",
                          role.slug === "manager"
                            ? "border-primary/20 bg-primary/10 text-primary"
                            : "border-border bg-muted text-muted-foreground",
                        )}
                      >
                        {permCountBySlug.get(role.slug) ?? 0}{" "}
                        {t("roles.permissionsCount", "permissions")}
                      </Badge>
                      {role.slug === "clouduser" && (
                        <Badge
                          variant="outline"
                          className="text-[11px] text-muted-foreground"
                        >
                          {t("roles.systemRole", "system")}
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* --- Permissions tab (read-only browser) --- */}
        <TabsContent value="permissions" className="mt-4">
          {permsQuery.isError ? (
            <ErrorState
              title={t("roles.permErrorTitle", "Couldn't load permissions.")}
              message={permsQuery.error?.message}
              onRetry={() => permsQuery.refetch()}
            />
          ) : permsQuery.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="space-y-2 p-4">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-72" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {permGroups.map(([namespace, perms]) => (
                <Card key={namespace}>
                  <CardContent className="p-0">
                    <div className="border-b border-border bg-muted/50 px-4 py-2 text-xs font-semibold text-muted-foreground">
                      {namespace}
                      <span className="ml-2 font-normal opacity-70">
                        ({perms.length})
                      </span>
                    </div>
                    <ul className="flex flex-col divide-y divide-border">
                      {perms.map((p) => (
                        <li
                          key={p.resource}
                          className="flex flex-wrap items-center gap-2 px-4 py-2.5"
                        >
                          <div className="min-w-0 flex-1">
                            <span className="block text-sm text-foreground">
                              {p.name}
                            </span>
                            <span className="block font-mono text-[11px] text-muted-foreground">
                              {p.resource}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center justify-end gap-1">
                            {p.roles.length > 0 ? (
                              p.roles.map((slug) => <RoleChip key={slug} slug={slug} />)
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                {t("roles.noHolders", "unassigned")}
                              </span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <RoleFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        role={editTarget}
      />
      <AssignPermissionsDialog
        open={assignTarget !== null}
        onClose={() => setAssignTarget(null)}
        role={assignTarget}
        permissions={permissions}
        loading={permsQuery.isLoading}
      />
    </div>
  );
}
