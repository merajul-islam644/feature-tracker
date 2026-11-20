// Topbar org switcher — the signed-in user's own organization context.
//
// Session-scoped self-service (NOT manager-gated): any member with more
// than one org membership can switch their own active org via
// `auth.switchOrganization`. IAM answers with a fresh auth response for the
// new org context — tokens are applied client-side (`applyAuthOverlay`) and
// afterwards `AuthProvider.refresh()` re-pulls claims + roles so every
// org-scoped surface (menus, data reads) re-resolves against the new
// context.
//
// Behavior:
//   - 0 orgs or the query failed → render nothing (silent — the
//     switcher is chrome, not an error surface).
//   - 1 org → a passive indicator chip (shows WHERE you are; no menu).
//   - ≥2 orgs → a dropdown; the active one is checked, picking another
//     fires the switch mutation with a spinner + success toast.

import { Building2, Check, ChevronsUpDown, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useAuthContext,
} from "@/components/blocks/AuthProvider";
import { useToast } from "@/hooks/useToast";
import { useT } from "@/lib/blocks/i18n";
import {
  useActiveOrgId,
  useMyOrganizations,
  useSwitchOrganization,
} from "@/lib/blocks/orgAdmin";
import { cn } from "@/lib/utils";

export function OrgSwitcher() {
  const t = useT();
  const toast = useToast();
  // The context directly (not the `useAuth` wrapper) because the
  // switch flow needs `refresh()` — re-pulling claims + roles under
  // the rotated session cookie after a successful switch.
  const { refresh } = useAuthContext();
  const orgsQuery = useMyOrganizations();
  const activeOrgId = useActiveOrgId();
  const switchOrg = useSwitchOrganization();

  const orgs = orgsQuery.data ?? [];
  if (orgsQuery.isError || orgs.length === 0) return null;

  // The active id may be a logical id ("default") that doesn't match
  // any listed org's itemId verbatim (e.g. "no-org" for orgless
  // accounts) — fall back to a readable placeholder instead of a
  // wrong name.
  const active = orgs.find((o) => o.id === activeOrgId);
  const activeName =
    active?.name ??
    (activeOrgId
      ? t("orgSwitcher.activeUnknown", `Active org: ${activeOrgId}`)
      : t("orgSwitcher.noOrg", "No organization"));

  const pick = (orgId: string) => {
    if (orgId === activeOrgId || switchOrg.isPending) return;
    switchOrg.mutate(
      { organizationId: orgId },
      {
        onSuccess: async () => {
          // Claims + roles must re-resolve against the new org before
          // the UI can be trusted — refresh() re-pulls /auth/me and
          // iam.me() under the switched session (overlay bearer or
          // rotated cookie, whichever IAM left in place).
          await refresh();
          const switched = orgs.find((o) => o.id === orgId);
          toast.success(
            t(
              "orgSwitcher.switched",
              `Switched to ${switched?.name ?? "organization"}.`,
            ),
          );
        },
        onError: (err) => {
          toast.error(err.message);
        },
      },
    );
  };

  // Single org: display-only chip — still worth showing so the user
  // knows which context they operate in.
  if (orgs.length === 1) {
    return (
      <span
        title={t("orgSwitcher.activeTitle", "Active organization")}
        className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground"
      >
        <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="hidden max-w-32 truncate sm:inline">{activeName}</span>
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("orgSwitcher.label", "Switch organization")}
          title={t("orgSwitcher.label", "Switch organization")}
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {switchOrg.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          <span className="hidden max-w-32 truncate sm:inline">{activeName}</span>
          <ChevronsUpDown className="h-3 w-3 opacity-60" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {t("orgSwitcher.menuTitle", "Your organizations")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {orgs.map((o) => (
          <DropdownMenuItem
            key={o.id}
            onSelect={() => pick(o.id)}
            disabled={switchOrg.isPending}
            className={cn(
              "flex items-center gap-2",
              o.id === activeOrgId && "font-medium",
            )}
          >
            <Check
              className={cn(
                "h-4 w-4",
                o.id === activeOrgId
                  ? "opacity-100"
                  : "opacity-0", // keeps row heights aligned
              )}
              aria-hidden="true"
            />
            <span className="truncate">{o.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
