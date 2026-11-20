// Dialogs for the `/roles` admin surface — create/edit role, and the
// assign-permissions grid (searchable, grouped by resource namespace,
// delta-submitted). This is RBAC-definer territory: the dialogs only
// fire on explicit form submits, and every mutation re-gates manager
// at runtime in `roleAdmin.ts`.

import { useEffect, useMemo, useState } from "react";
import { Search, ShieldCheck } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/useToast";
import { useT } from "@/lib/blocks/i18n";
import {
  useAssignRolePermissions,
  useCreateRole,
  useUpdateRole,
  type PermissionRecord,
  type RoleRecord,
} from "@/lib/blocks/roleAdmin";
import { cn } from "@/lib/utils";

// --- Create / edit -----------------------------------------------------------

export interface RoleFormDialogProps {
  open: boolean;
  onClose: () => void;
  /** Present → edit mode (pre-filled); absent → create mode. */
  role?: RoleRecord | null;
}

export function RoleFormDialog({ open, onClose, role }: RoleFormDialogProps) {
  const t = useT();
  const toast = useToast();
  const create = useCreateRole();
  const update = useUpdateRole();
  const editing = Boolean(role);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (open) {
      setName(role?.name ?? "");
      setSlug(role?.slug ?? "");
      setDescription(role?.description ?? "");
      setFormError("");
    }
  }, [open, role]);

  const pending = create.isPending || update.isPending;
  const SLUG_RE = /^[a-z][a-z0-9_-]*$/;

  const submit = () => {
    setFormError("");
    if (!name.trim()) {
      setFormError(t("roles.formErrName", "Role name is required."));
      return;
    }
    if (!editing && !SLUG_RE.test(slug.trim())) {
      setFormError(
        t(
          "roles.formErrSlug",
          "Slug must be lowercase letters/digits/-/_ and start with a letter.",
        ),
      );
      return;
    }
    if (editing && role) {
      update.mutate(
        { itemId: role.itemId, name: name.trim(), description: description.trim() },
        {
          onSuccess: () => {
            toast.success(t("roles.updateSuccess", `Role "${name.trim()}" updated.`));
            onClose();
          },
          onError: (err) => setFormError(err.message),
        },
      );
    } else {
      create.mutate(
        { name: name.trim(), slug: slug.trim(), description: description.trim() },
        {
          onSuccess: () => {
            toast.success(t("roles.createSuccess", `Role "${slug.trim()}" created.`));
            onClose();
          },
          onError: (err) => setFormError(err.message),
        },
      );
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent size="lg">
        <DialogCloseButton />
        <DialogHeader>
          <DialogTitle>
            {editing
              ? t("roles.editTitle", "Edit role")
              : t("roles.createTitle", "Create role")}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? t(
                  "roles.editDesc",
                  "Edits the role's profile. Its permission set is managed from Assign permissions.",
                )
              : t(
                  "roles.createDesc",
                  "A role is a named bundle of permissions users can be assigned. Start empty, then wire its permissions.",
                )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Input
                label={t("roles.nameLabel", "Name")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("roles.namePlaceholder", "e.g. Content Editor")}
                required
                autoComplete="off"
              />
            </div>
            {!editing && (
              <div className="sm:col-span-2">
                <Input
                  label={t("roles.slugLabel", "Slug")}
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase())}
                  placeholder={t("roles.slugPlaceholder", "content-editor")}
                  hint={t(
                    "roles.slugHint",
                    "Lowercase identifier users are assigned by — immutable after creation.",
                  )}
                  required
                  autoComplete="off"
                />
              </div>
            )}
            {editing && (
              <div className="sm:col-span-2">
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  {t("roles.slugReadonly", "Slug")}: <span className="font-mono text-foreground">{role?.slug}</span>
                </div>
              </div>
            )}
            <div className="sm:col-span-2">
              <Input
                label={t("roles.descLabel", "Description")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("roles.descPlaceholder", "What this role is for")}
                autoComplete="off"
              />
            </div>
          </div>
          {formError && (
            <p
              role="alert"
              className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {formError}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("roles.cancel", "Cancel")}
          </Button>
          <Button
            onClick={submit}
            disabled={pending}
            leftIcon={
              pending ? <Spinner size="sm" /> : <ShieldCheck className="h-4 w-4" />
            }
          >
            {editing ? t("roles.saveChanges", "Save changes") : t("roles.createSubmit", "Create role")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Assign permissions --------------------------------------------------------

export interface AssignPermissionsDialogProps {
  open: boolean;
  onClose: () => void;
  role: RoleRecord | null;
  /** The full permission inventory with current role assignments. */
  permissions: PermissionRecord[];
  loading: boolean;
}

export function AssignPermissionsDialog({
  open,
  onClose,
  role,
  permissions,
  loading,
}: AssignPermissionsDialogProps) {
  const t = useT();
  const toast = useToast();
  const assign = useAssignRolePermissions();

  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [formError, setFormError] = useState("");

  // Seed the checkbox set from the role's current grants on open.
  useEffect(() => {
    if (open && role) {
      setChecked(new Set(permissions.filter((p) => p.roles.includes(role.slug)).map((p) => p.resource)));
      setSearch("");
      setFormError("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, role?.slug]);

  // Group the filtered inventory by namespace (`blocks-x::group`) so
  // 256 rows read as ~20 labeled sections instead of one wall.
  // All hooks run unconditionally — the early return for a missing
  // role comes AFTER them (rules of hooks).
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = permissions.filter(
      (p) =>
        !q ||
        p.resource.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q),
    );
    const map = new Map<string, PermissionRecord[]>();
    for (const p of filtered) {
      const key = p.resource.split("::").slice(0, 2).join("::");
      const list = map.get(key) ?? (map.set(key, []), map.get(key)!);
      list.push(p);
    }
    return [...map.entries()];
  }, [permissions, search]);

  const original = useMemo(
    () =>
      role
        ? new Set(permissions.filter((p) => p.roles.includes(role.slug)).map((p) => p.resource))
        : new Set<string>(),
    [permissions, role],
  );

  if (!role) return null;

  const toggle = (resource: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(resource)) next.delete(resource);
      else next.add(resource);
      return next;
    });

  const submit = () => {
    setFormError("");
    const addPermissions = [...checked].filter((r) => !original.has(r));
    const removePermissions = [...original].filter((r) => !checked.has(r));
    assign.mutate(
      { slug: role.slug, addPermissions, removePermissions, roleName: role.name },
      {
        onSuccess: () => {
          toast.success(
            t(
              "roles.assignSuccess",
              `Permissions updated for "${role.slug}" (+${addPermissions.length} / −${removePermissions.length}).`,
            ),
          );
          onClose();
        },
        onError: (err) => setFormError(err.message),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent size="lg">
        <DialogCloseButton />
        <DialogHeader>
          <DialogTitle>
            {t("roles.assignTitle", "Assign permissions — {name}").replace("{name}", role.slug)}
          </DialogTitle>
          <DialogDescription>
            {t(
              "roles.assignDesc",
              "Checked = this role holds the permission. Saving applies only the added/removed delta.",
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="mb-3">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("roles.assignSearch", "Search permissions…")}
                aria-label={t("roles.assignSearch", "Search permissions…")}
                className="pl-9"
              />
            </div>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner label={t("roles.assignLoading", "Loading permissions…")} />
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto rounded-md border border-border">
              {groups.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {t("roles.assignNoMatch", "No permissions match the search.")}
                </p>
              ) : (
                groups.map(([namespace, perms]) => (
                  <div key={namespace}>
                    <div className="sticky top-0 border-b border-border bg-muted/70 px-3 py-1.5 text-xs font-semibold text-muted-foreground backdrop-blur">
                      {namespace}
                    </div>
                    {perms.map((p) => {
                      const isChecked = checked.has(p.resource);
                      // Highlight rows whose state differs from the
                      // server's view — the delta is visible before save.
                      const changed = isChecked !== original.has(p.resource);
                      return (
                        <label
                          key={p.resource}
                          className={cn(
                            "flex items-start gap-2.5 border-b border-border px-3 py-2 text-sm last:border-b-0",
                            changed && "bg-primary/5",
                          )}
                        >
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={() => toggle(p.resource)}
                            className="mt-0.5"
                          />
                          <span className="min-w-0">
                            <span className="block font-medium text-foreground">{p.name}</span>
                            <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">
                              {p.resource}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          )}
          {formError && (
            <p
              role="alert"
              className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {formError}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("roles.cancel", "Cancel")}
          </Button>
          <Button
            onClick={submit}
            disabled={assign.isPending || loading}
            leftIcon={assign.isPending ? <Spinner size="sm" /> : <ShieldCheck className="h-4 w-4" />}
          >
            {t("roles.assignSubmit", "Apply changes")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Small shared chip for role slugs on the permissions tab.
export function RoleChip({ slug }: { slug: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[11px]",
        slug === "manager"
          ? "border-primary/20 bg-primary/10 text-primary"
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      {slug}
    </Badge>
  );
}
