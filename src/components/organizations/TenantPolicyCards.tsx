// Tenant policy cards for the Organizations page — the two IAM records
// that decide how new users enter the workspace and how organizations
// behave:
//
//   1. Signup policy  (`signupSettings.get/save`) — master enable,
//      login methods, and the default roles every new signup gets.
//      This is the fix for org-less signups: the default-role grant
//      fires at IAM signup time, before the user ever logs in.
//   2. Organization config (`organizations.getConfig/saveConfig`) —
//      org-creation surfaces, signup auto-join, name uniqueness, and
//      the permanent multi-org flag.
//
// Both saves merge over the live server record (see `orgAdmin.ts`) so
// platform-only fields survive. `isMultiOrgEnabled` renders read-only
// once enabled — IAM only ever allows flipping it ON, once.

import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/error-state";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/useToast";
import { useT } from "@/lib/blocks/i18n";
import { useAssignableRoles } from "@/lib/blocks/userAdmin";
import {
  useOrgConfig,
  useSaveOrgConfig,
  useSaveSignupSettings,
  useSignupSettings,
  type OrgConfig,
  type SignupSettings,
} from "@/lib/blocks/orgAdmin";
import { cn } from "@/lib/utils";

// A labeled checkbox row — the app has no Switch primitive, and this
// matches the checkbox styling used across the admin dialogs.
function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "flex items-start gap-2.5 rounded-md border border-border px-3 py-2.5 text-sm",
        disabled && "opacity-60",
      )}
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5"
      />
      <span className="min-w-0">
        <span className="block font-medium text-foreground">{label}</span>
        {description && (
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {description}
          </span>
        )}
      </span>
    </label>
  );
}

// --- Signup policy -------------------------------------------------------------

export function SignupPolicyCard() {
  const t = useT();
  const toast = useToast();
  const query = useSignupSettings();
  const save = useSaveSignupSettings();
  const rolesQuery = useAssignableRoles();

  const [draft, setDraft] = useState<SignupSettings | null>(null);

  // Re-seed the draft whenever the server record lands — edits reset
  // on refetch, which is the honest behavior for shared tenant state.
  useEffect(() => {
    if (query.data) setDraft(query.data);
  }, [query.data]);

  if (query.isLoading) {
    return (
      <Card>
        <CardContent className="space-y-3 p-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }
  if (query.isError || !query.data || !draft) {
    return (
      <Card>
        <CardContent className="p-4">
          <ErrorState
            title={t("orgs.policyErrorTitle", "Couldn't load the signup policy.")}
            message={
              query.error?.message ||
              t(
                "orgs.policyErrorMessage",
                "Your role may be missing the tenant-configuration permissions.",
              )
            }
            onRetry={() => query.refetch()}
          />
        </CardContent>
      </Card>
    );
  }

  // Role options — assignable set + clouduser (this tenant's
  // full-access bucket, deliberately grantable at signup).
  const roleOptions = [
    ...(rolesQuery.data ?? []),
    { slug: "clouduser", name: "clouduser" },
  ];
  const toggleRole = (slug: string) =>
    setDraft((d) =>
      d && {
        ...d,
        defaultRolesForNewUser: d.defaultRolesForNewUser.includes(slug)
          ? d.defaultRolesForNewUser.filter((s) => s !== slug)
          : [...d.defaultRolesForNewUser, slug],
      },
    );

  const submit = () => {
    save.mutate(draft, {
      onSuccess: () =>
        toast.success(t("orgs.policySaved", "Signup policy saved.")),
      onError: (err) => toast.error(err.message),
    });
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {t("orgs.signupPolicyTitle", "Signup policy")}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t(
              "orgs.signupPolicyDesc",
              "How new accounts join this workspace — and which roles they get at signup.",
            )}
          </p>
        </div>

        <ToggleRow
          label={t("orgs.signupEnable", "Allow signup")}
          description={t(
            "orgs.signupEnableDesc",
            "Master switch — when off, the public signup page rejects new accounts.",
          )}
          checked={draft.isSignUpEnable}
          onChange={(v) => setDraft({ ...draft, isSignUpEnable: v })}
        />
        <ToggleRow
          label={t("orgs.signupEmailPassword", "Email + password signup")}
          checked={draft.isEmailPasswordSignUpEnabled}
          onChange={(v) => setDraft({ ...draft, isEmailPasswordSignUpEnabled: v })}
        />
        <ToggleRow
          label={t("orgs.signupSso", "SSO signup")}
          checked={draft.isSSoSignUpEnabled}
          onChange={(v) => setDraft({ ...draft, isSSoSignUpEnabled: v })}
        />

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-foreground">
            {t("orgs.defaultRolesLabel", "Default roles for new users")}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {roleOptions.map((r) => {
              const active = draft.defaultRolesForNewUser.includes(r.slug);
              return (
                <button
                  key={r.slug}
                  type="button"
                  onClick={() => toggleRole(r.slug)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {r.slug}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            {t(
              "orgs.defaultRolesHint",
              "Every new signup is granted these role slugs immediately at account creation.",
            )}
          </p>
        </div>

        <div className="flex justify-end pt-1">
          <Button
            size="sm"
            onClick={submit}
            disabled={save.isPending}
            leftIcon={
              save.isPending ? <Spinner size="sm" /> : <Save className="h-4 w-4" />
            }
          >
            {t("orgs.policySave", "Save policy")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// --- Organization config -------------------------------------------------------

export function OrgConfigCard() {
  const t = useT();
  const toast = useToast();
  const query = useOrgConfig();
  const save = useSaveOrgConfig();

  const [draft, setDraft] = useState<OrgConfig | null>(null);

  useEffect(() => {
    if (query.data) setDraft(query.data);
  }, [query.data]);

  if (query.isLoading) {
    return (
      <Card>
        <CardContent className="space-y-3 p-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }
  if (query.isError || !query.data || !draft) {
    return (
      <Card>
        <CardContent className="p-4">
          <ErrorState
            title={t("orgs.configErrorTitle", "Couldn't load organization config.")}
            message={
              query.error?.message ||
              t(
                "orgs.configErrorMessage",
                "Your role may be missing the tenant-configuration permissions.",
              )
            }
            onRetry={() => query.refetch()}
          />
        </CardContent>
      </Card>
    );
  }

  const submit = () => {
    save.mutate(draft, {
      onSuccess: () =>
        toast.success(t("orgs.configSaved", "Organization config saved.")),
      onError: (err) => toast.error(err.message),
    });
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {t("orgs.configTitle", "Organization config")}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t(
              "orgs.configDesc",
              "Tenant-wide organization behavior — creation surfaces, signup auto-join, and multi-org.",
            )}
          </p>
        </div>

        <ToggleRow
          label={t("orgs.autoJoin", "Auto-join default organization at signup")}
          description={t(
            "orgs.autoJoinDesc",
            "New signups land in the tenant's default organization instead of staying org-less.",
          )}
          checked={draft.isSignupAutoJoinEnabled}
          onChange={(v) => setDraft({ ...draft, isSignupAutoJoinEnabled: v })}
        />
        <ToggleRow
          label={t("orgs.orgCreateSignup", "Allow org creation from signup")}
          checked={draft.allowOrgCreationFromSignup}
          onChange={(v) => setDraft({ ...draft, allowOrgCreationFromSignup: v })}
        />
        <ToggleRow
          label={t("orgs.orgCreatePortal", "Allow org creation from portal")}
          checked={draft.allowOrgCreationFromPortal}
          onChange={(v) => setDraft({ ...draft, allowOrgCreationFromPortal: v })}
        />
        <ToggleRow
          label={t("orgs.orgCreateCloud", "Allow org creation from cloud")}
          checked={draft.allowOrgCreationFromCloud}
          onChange={(v) => setDraft({ ...draft, allowOrgCreationFromCloud: v })}
        />
        <ToggleRow
          label={t("orgs.orgNameUniqueness", "Require unique organization names")}
          checked={draft.isOrgNameUniquenessEnabled}
          onChange={(v) => setDraft({ ...draft, isOrgNameUniquenessEnabled: v })}
        />

        {/* Multi-org is enable-once at IAM — once on, it renders as a
            permanent badge rather than an editable toggle. */}
        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
          <div>
            <span className="block text-sm font-medium text-foreground">
              {t("orgs.multiOrg", "Multi-organization")}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {t(
                "orgs.multiOrgDesc",
                "Members can hold roles in several organizations and switch context.",
              )}
            </span>
          </div>
          {draft.isMultiOrgEnabled ? (
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[11px] text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300">
              {t("orgs.multiOrgOn", "Enabled (permanent)")}
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="text-[11px] text-muted-foreground"
            >
              {t("orgs.multiOrgOff", "Disabled — enable once from IAM")}
            </Badge>
          )}
        </div>

        <div className="flex justify-end pt-1">
          <Button
            size="sm"
            onClick={submit}
            disabled={save.isPending}
            leftIcon={
              save.isPending ? <Spinner size="sm" /> : <Save className="h-4 w-4" />
            }
          >
            {t("orgs.configSave", "Save config")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
