// Dialogs for the `/organizations` admin surface — create/edit org,
// add-member (with per-org roles), and remove-member confirmation.
// Organizations are a tenant-isolation boundary (blocks-iam-organizations
// skill): every dialog here fires only on an explicit form submit, and
// each mutation re-gates manager at runtime in `orgAdmin.ts`.

import { useEffect, useState } from "react";
import { Building2, UserPlus } from "lucide-react";
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
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/hooks/useToast";
import { useT } from "@/lib/blocks/i18n";
import { useAssignableRoles } from "@/lib/blocks/userAdmin";
import {
  useAddOrgMember,
  useCreateOrganization,
  useRemoveOrgMember,
  useUpdateOrganization,
  type OrganizationRecord,
  type OrgMember,
} from "@/lib/blocks/orgAdmin";

// --- Create / edit -----------------------------------------------------------

export interface OrgFormDialogProps {
  open: boolean;
  onClose: () => void;
  /** Present → edit mode (pre-filled); absent → create mode. */
  organization?: OrganizationRecord | null;
}

export function OrgFormDialog({ open, onClose, organization }: OrgFormDialogProps) {
  const t = useT();
  const toast = useToast();
  const create = useCreateOrganization();
  const update = useUpdateOrganization();
  const editing = Boolean(organization);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [formError, setFormError] = useState("");

  // Fresh or pre-filled form on every open — a stale half-typed org
  // from a previous session must not leak into the next one.
  useEffect(() => {
    if (open) {
      setName(organization?.name ?? "");
      setDescription(organization?.description ?? "");
      setWebsiteUrl(organization?.websiteUrl ?? "");
      setFormError("");
    }
  }, [open, organization]);

  const pending = create.isPending || update.isPending;

  const submit = () => {
    setFormError("");
    if (!name.trim()) {
      setFormError(t("orgs.formErrName", "Organization name is required."));
      return;
    }
    if (editing && organization) {
      update.mutate(
        {
          id: organization.id,
          name: name.trim(),
          description: description.trim(),
          websiteUrl: websiteUrl.trim(),
        },
        {
          onSuccess: () => {
            toast.success(
              t("orgs.updateSuccess", `Organization "${name.trim()}" updated.`),
            );
            onClose();
          },
          onError: (err) => setFormError(err.message),
        },
      );
    } else {
      create.mutate(
        {
          name: name.trim(),
          description: description.trim(),
          websiteUrl: websiteUrl.trim(),
          defaultRoleSlugs: [],
        },
        {
          onSuccess: () => {
            toast.success(
              t("orgs.createSuccess", `Organization "${name.trim()}" created.`),
            );
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
              ? t("orgs.editTitle", "Edit organization")
              : t("orgs.createTitle", "Create organization")}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? t(
                  "orgs.editDesc",
                  "Updates the organization's profile. Membership is managed separately from the members panel.",
                )
              : t(
                  "orgs.createDesc",
                  "Organizations are this workspace's tenancy boundary — each firm or team gets its own member list and roles.",
                )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Input
                label={t("orgs.nameLabel", "Name")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("orgs.namePlaceholder", "e.g. Firm A")}
                required
                autoComplete="off"
              />
            </div>
            <div className="sm:col-span-2">
              <Input
                label={t("orgs.descLabel", "Description")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("orgs.descPlaceholder", "What this organization is for")}
                autoComplete="off"
              />
            </div>
            <div className="sm:col-span-2">
              <Input
                label={t("orgs.websiteLabel", "Website")}
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="https://…"
                type="url"
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
            {t("orgs.cancel", "Cancel")}
          </Button>
          <Button
            onClick={submit}
            disabled={pending}
            leftIcon={
              pending ? (
                <Spinner size="sm" />
              ) : (
                <Building2 className="h-4 w-4" />
              )
            }
          >
            {editing
              ? t("orgs.saveChanges", "Save changes")
              : t("orgs.createSubmit", "Create organization")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Add member ---------------------------------------------------------------

export interface AddOrgMemberDialogProps {
  open: boolean;
  onClose: () => void;
  organization: OrganizationRecord | null;
  /** Users already in this org — excluded from the picker. */
  existingMemberIds: string[];
  /** Candidate users (the admin roster). */
  candidates: Array<{ id: string; displayName: string; email: string }>;
}

export function AddOrgMemberDialog({
  open,
  onClose,
  organization,
  existingMemberIds,
  candidates,
}: AddOrgMemberDialogProps) {
  const t = useT();
  const toast = useToast();
  const addMember = useAddOrgMember();
  const rolesQuery = useAssignableRoles();

  const [userId, setUserId] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (open) {
      setUserId("");
      setRoles([]);
      setFormError("");
    }
  }, [open]);

  if (!organization) return null;

  const available = candidates.filter((c) => !existingMemberIds.includes(c.id));
  // Role options — the assignable set plus `clouduser`, which this
  // tenant uses as the full-access bucket (managers have granted it
  // deliberately when onboarding org admins).
  const roleOptions = [
    ...(rolesQuery.data ?? []),
    { slug: "clouduser", name: t("orgs.clouduserOption", "System User (clouduser — full access)") },
  ];

  const toggleRole = (slug: string) =>
    setRoles((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug],
    );

  const submit = () => {
    setFormError("");
    if (!userId) {
      setFormError(t("orgs.memberErrUser", "Pick a user to add."));
      return;
    }
    if (roles.length === 0) {
      setFormError(
        t("orgs.memberErrRoles", "Pick at least one role for this membership."),
      );
      return;
    }
    const picked = candidates.find((c) => c.id === userId);
    addMember.mutate(
      {
        orgId: organization.id,
        userId,
        roles,
        userName: picked?.displayName ?? userId,
      },
      {
        onSuccess: () => {
          toast.success(
            t(
              "orgs.memberSuccess",
              `${picked?.displayName ?? "User"} added to ${organization.name}.`,
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
            {t("orgs.addMemberTitle", "Add member — {name}").replace(
              "{name}",
              organization.name,
            )}
          </DialogTitle>
          <DialogDescription>
            {t(
              "orgs.addMemberDesc",
              "Grants the user membership in this organization with the checked roles. Users already in the org are not listed.",
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <Select
              label={t("orgs.memberUserLabel", "User")}
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              options={available.map((c) => ({
                value: c.id,
                label: c.email ? `${c.displayName} (${c.email})` : c.displayName,
              }))}
              placeholder={t("orgs.memberUserPlaceholder", "Select a user…")}
              required
            />
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-foreground">
                {t("orgs.memberRolesLabel", "Roles in this organization")}
              </span>
              {roleOptions.map((r) => (
                <label
                  key={r.slug}
                  className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <Checkbox
                    checked={roles.includes(r.slug)}
                    onCheckedChange={() => toggleRole(r.slug)}
                  />
                  <span className="font-medium">{r.name}</span>
                  <span className="text-xs text-muted-foreground">{r.slug}</span>
                </label>
              ))}
              {rolesQuery.isLoading && (
                <p className="text-sm text-muted-foreground">
                  {t("orgs.rolesLoading", "Loading roles…")}
                </p>
              )}
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
            {t("orgs.cancel", "Cancel")}
          </Button>
          <Button
            onClick={submit}
            disabled={addMember.isPending}
            leftIcon={
              addMember.isPending ? (
                <Spinner size="sm" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )
            }
          >
            {t("orgs.addMemberSubmit", "Add to organization")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Remove member -------------------------------------------------------------

export interface RemoveOrgMemberDialogProps {
  open: boolean;
  onClose: () => void;
  organization: OrganizationRecord | null;
  member: OrgMember | null;
}

export function RemoveOrgMemberDialog({
  open,
  onClose,
  organization,
  member,
}: RemoveOrgMemberDialogProps) {
  const t = useT();
  const toast = useToast();
  const removeMember = useRemoveOrgMember();

  const submit = () => {
    if (!organization || !member) return;
    removeMember.mutate(
      { orgId: organization.id, userId: member.id, userName: member.name },
      {
        onSuccess: () => {
          toast.success(
            t(
              "orgs.removeSuccess",
              `${member.name} removed from ${organization.name}.`,
            ),
          );
          onClose();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  if (!organization || !member) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogCloseButton />
        <DialogHeader>
          <DialogTitle>
            {t("orgs.removeTitle", "Remove this member?")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "orgs.removeDesc",
              `${member.name} (${member.email}) loses access to ${organization.name} and its org-scoped roles. Their account and other org memberships are untouched.`,
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("orgs.cancel", "Cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={removeMember.isPending}
            leftIcon={removeMember.isPending ? <Spinner size="sm" /> : undefined}
          >
            {t("orgs.removeSubmit", "Remove from organization")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
