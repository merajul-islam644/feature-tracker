// Dialogs for the `/users` admin surface. Three flows, one file:
//
//   1. InviteUserDialog    — provision a new IAM user (email + names +
//      role). The duplicate-email check already runs inside
//      `useInviteIamUser` (public `emailAvailable`), so the dialog
//      only adds client-side required-field validation and surfaces
//      the mutation's error message inline.
//   2. EditRolesDialog     — checkbox picker over `useAssignableRoles`,
//      submitting the FULL desired role list via `users.updateAccess`
//      (IAM treats the payload as the new access set — no deltas).
//   3. ConfirmUserStateDialog — activate/deactivate confirmation.
//
// All three are manager-only in practice: the page hides the triggers,
// and every mutation re-gates at runtime (see `userAdmin.ts`).

import { useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
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
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/hooks/useToast";
import { useT } from "@/lib/blocks/i18n";
import {
  useAssignableRoles,
  useInviteIamUser,
  useSetIamUserActive,
  useUpdateIamUserAccess,
  type IamAdminUser,
} from "@/lib/blocks/userAdmin";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// --- Invite ------------------------------------------------------------------

export interface InviteUserDialogProps {
  open: boolean;
  onClose: () => void;
}

export function InviteUserDialog({ open, onClose }: InviteUserDialogProps) {
  const t = useT();
  const toast = useToast();
  const invite = useInviteIamUser();
  const rolesQuery = useAssignableRoles();

  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState("");
  const [formError, setFormError] = useState("");

  // Fresh form on every open — a stale half-typed invite from the last
  // session must not leak into the next one (same reset discipline as
  // BootstrapDialog's copied flag).
  useEffect(() => {
    if (open) {
      setEmail("");
      setFirstName("");
      setLastName("");
      setRole("");
      setFormError("");
    }
  }, [open]);

  // Default the role picker to the first assignable role once roles
  // resolve — the common case is inviting into the project's primary
  // role, and a pre-selected value stops accidental "no role" invites.
  useEffect(() => {
    if (open && !role && rolesQuery.data && rolesQuery.data.length > 0) {
      setRole(rolesQuery.data[0].slug);
    }
  }, [open, role, rolesQuery.data]);

  const submit = () => {
    setFormError("");
    if (!EMAIL_RE.test(email.trim())) {
      setFormError(t("users.inviteErrEmail", "Enter a valid email address."));
      return;
    }
    if (!firstName.trim()) {
      setFormError(t("users.inviteErrFirst", "First name is required."));
      return;
    }
    if (!role) {
      setFormError(t("users.inviteErrRole", "Pick a role for this user."));
      return;
    }
    invite.mutate(
      {
        email: email.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        roles: [role],
      },
      {
        onSuccess: () => {
          toast.success(
            t(
              "users.inviteSuccess",
              `Invite sent to ${email.trim()}.`,
            ),
          );
          onClose();
        },
        onError: (err) => {
          setFormError(err.message);
        },
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
          <DialogTitle>{t("users.inviteTitle", "Invite a user")}</DialogTitle>
          <DialogDescription>
            {t(
              "users.inviteDesc",
              "Provisions a new IAM account in this workspace with the picked role. The user gets access immediately.",
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Input
                label={t("users.inviteEmailLabel", "Email")}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                required
                autoComplete="off"
              />
            </div>
            <Input
              label={t("users.inviteFirstLabel", "First name")}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              autoComplete="off"
            />
            <Input
              label={t("users.inviteLastLabel", "Last name")}
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              autoComplete="off"
            />
            <div className="sm:col-span-2">
              <Select
                label={t("users.inviteRoleLabel", "Role")}
                value={role}
                onChange={(e) => setRole(e.target.value)}
                options={(rolesQuery.data ?? []).map((r) => ({
                  value: r.slug,
                  label: r.name,
                }))}
                required
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
            {t("users.cancel", "Cancel")}
          </Button>
          <Button
            onClick={submit}
            disabled={invite.isPending}
            leftIcon={
              invite.isPending ? (
                <Spinner size="sm" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )
            }
          >
            {t("users.inviteSubmit", "Send invite")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Role edit ---------------------------------------------------------------

export interface EditRolesDialogProps {
  open: boolean;
  onClose: () => void;
  user: IamAdminUser | null;
  /** The signed-in manager's own id — their own `manager` checkbox is
   *  locked so a lone manager can't demote themselves out of this
   *  screen (with one manager in the tenant there is nobody left to
   *  undo it). */
  currentUserId: string;
}

export function EditRolesDialog({
  open,
  onClose,
  user,
  currentUserId,
}: EditRolesDialogProps) {
  const t = useT();
  const toast = useToast();
  const updateAccess = useUpdateIamUserAccess();
  const rolesQuery = useAssignableRoles();

  const [selected, setSelected] = useState<string[]>([]);
  const [formError, setFormError] = useState("");

  // Seed the checkboxes from the row under edit on each open. Copy —
  // not reference — so cancelling never half-mutates the row's list.
  useEffect(() => {
    if (open && user) {
      setSelected([...user.roles]);
      setFormError("");
    }
  }, [open, user]);

  if (!user) return null;

  const isSelf = user.id === currentUserId;
  const toggle = (slug: string) => {
    setSelected((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug],
    );
  };

  const submit = () => {
    setFormError("");
    if (selected.length === 0) {
      setFormError(
        t("users.rolesErrEmpty", "Pick at least one role for this user."),
      );
      return;
    }
    updateAccess.mutate(
      { userId: user.id, roles: selected, name: user.name },
      {
        onSuccess: () => {
          toast.success(
            t(
              "users.rolesSuccess",
              `Roles updated for ${user.name}.`,
            ),
          );
          onClose();
        },
        onError: (err) => {
          setFormError(err.message);
        },
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
      <DialogContent>
        <DialogCloseButton />
        <DialogHeader>
          <DialogTitle>
            {t("users.rolesTitle", "Manage roles — {name}").replace(
              "{name}",
              user.name,
            )}
          </DialogTitle>
          <DialogDescription>
            {t(
              "users.rolesDesc",
              "Saves the checked set as the user's complete role list — roles unchecked here are removed.",
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-2">
            {(rolesQuery.data ?? []).map((r) => {
              const locked = isSelf && r.slug === "manager";
              const checked = selected.includes(r.slug);
              return (
                <label
                  key={r.slug}
                  className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <Checkbox
                    checked={checked}
                    disabled={locked}
                    onCheckedChange={() => toggle(r.slug)}
                  />
                  <span className="font-medium">{r.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {r.slug}
                  </span>
                  {locked && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      {t(
                        "users.rolesSelfLock",
                        "Locked — can't remove your own manager role",
                      )}
                    </span>
                  )}
                </label>
              );
            })}
            {rolesQuery.isLoading && (
              <p className="text-sm text-muted-foreground">
                {t("users.rolesLoading", "Loading assignable roles…")}
              </p>
            )}
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
            {t("users.cancel", "Cancel")}
          </Button>
          <Button
            onClick={submit}
            disabled={updateAccess.isPending}
            leftIcon={updateAccess.isPending ? <Spinner size="sm" /> : undefined}
          >
            {t("users.rolesSubmit", "Save roles")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Activate / deactivate ---------------------------------------------------

export interface ConfirmUserStateDialogProps {
  open: boolean;
  onClose: () => void;
  user: IamAdminUser | null;
  /** Target state after the action — `false` = deactivate (default). */
  targetActive: boolean;
}

export function ConfirmUserStateDialog({
  open,
  onClose,
  user,
  targetActive,
}: ConfirmUserStateDialogProps) {
  const t = useT();
  const toast = useToast();
  const setUserActive = useSetIamUserActive();

  const submit = () => {
    if (!user) return;
    setUserActive.mutate(
      { userId: user.id, active: targetActive, name: user.name },
      {
        onSuccess: () => {
          toast.success(
            targetActive
              ? t("users.activatedSuccess", `${user.name} reactivated.`)
              : t("users.deactivatedSuccess", `${user.name} deactivated.`),
          );
          onClose();
        },
        onError: (err) => {
          toast.error(err.message);
        },
      },
    );
  };

  if (!user) return null;

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
            {targetActive
              ? t("users.activateTitle", "Reactivate this account?")
              : t("users.deactivateTitle", "Deactivate this account?")}
          </DialogTitle>
          <DialogDescription>
            {targetActive
              ? t(
                  "users.activateDesc",
                  `${user.name} (${user.email}) regains access immediately. Their record and history are untouched.`,
                )
              : t(
                  "users.deactivateDesc",
                  `${user.name} (${user.email}) loses access immediately, but the record and history stay intact — reactivate any time.`,
                )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("users.cancel", "Cancel")}
          </Button>
          <Button
            onClick={submit}
            disabled={setUserActive.isPending}
            leftIcon={setUserActive.isPending ? <Spinner size="sm" /> : undefined}
            variant={targetActive ? "default" : "destructive"}
          >
            {targetActive
              ? t("users.activateSubmit", "Reactivate")
              : t("users.deactivateSubmit", "Deactivate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
