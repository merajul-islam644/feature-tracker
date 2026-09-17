import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  FolderKanban,
  Bug,
  ChevronsLeft,
  ChevronsRight,
  FolderTree,
  PlayCircle,
  LogOut,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/useToast";
import { useWorkspaceTotals } from "@/lib/blocks/hooks";
import { useLocale, useT } from "@/lib/blocks/i18n";
import { cn } from "@/lib/utils";

// `useT` looks up against the loaded `common` module. Nav items map onto
// the `nav.*` namespace.
export function AppSidebar() {
  const t = useT();
  const location = useLocation();
  const navItems = [
    {
      to: "/dashboard",
      label: t("nav.dashboard", "Dashboard"),
      icon: LayoutDashboard,
    },
    {
      to: "/projects",
      label: t("nav.projects", "Projects"),
      icon: FolderKanban,
    },
    {
      to: "/issue-tracker",
      // label: t("nav.issueTracker", "Issue Tracker"),
      label: t("nav.issueTracker", "Issues"),
      icon: Bug,
    },
    // {
    //   to: "/repo-browser",
    //   label: t("nav.repoBrowser", "Repo Browser"),
    //   icon: FolderTree,
    // },
    // {
    //   to: "/test-runner",
    //   label: t("nav.testRunner", "Test Runner"),
    //   icon: PlayCircle,
    // },
  ];
  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader className="h-14 justify-center border-b border-sidebar-border">
        <BrandHeader />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel
            className={cn(
              // Keep the label row itself visible in both states so the toggle
              // icon stays clickable when the sidebar is collapsed.
              "justify-between group-data-[collapsible=icon]:justify-center",
              "group-data-[collapsible=icon]:opacity-100 group-data-[collapsible=icon]:mt-0",
            )}
          >
            <span className="group-data-[collapsible=icon]:hidden">
              {t("nav.navigation", "Navigation")}
            </span>
            <NavToggle />
          </SidebarGroupLabel>
          <SidebarMenu>
            {navItems.map((item) => {
              const Icon = item.icon;
              // Keep the parent route highlighted on detail pages
              // (e.g. /projects/:id should highlight "Project").
              const isActive =
                item.to === "/projects"
                  ? location.pathname.startsWith("/projects")
                  : location.pathname === item.to;
              return (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    asChild
                    tooltip={item.label}
                    isActive={isActive}
                  >
                    <NavLink to={item.to}>
                      <Icon aria-hidden="true" />
                      <span>{item.label}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <FooterUser />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}

function BrandHeader() {
  return (
    <NavLink
      to="/dashboard"
      className="flex items-center gap-2 rounded-md px-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
    >
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground"
        aria-hidden="true"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1-2-2h11" />
        </svg>
      </div>
      <span className="truncate text-sm font-semibold text-sidebar-foreground group-data-[collapsible=icon]:hidden">
        Feature Tracker
      </span>
    </NavLink>
  );
}

// Inline sidebar toggle that sits on the right of the "Navigation" group
// label. Stays visible and clickable in both expanded and collapsed states
// so the user can always toggle the sidebar from inside it.
function NavToggle() {
  const { state, toggleSidebar } = useSidebar();
  const t = useT();
  const collapsed = state === "collapsed";
  const Icon = collapsed ? ChevronsRight : ChevronsLeft;
  const label = collapsed
    ? t("nav.expandSidebar", "Expand sidebar")
    : t("nav.collapseSidebar", "Collapse sidebar");
  return (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded-md text-sidebar-foreground/70",
        "transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}

function FooterUser() {
  const { currentUser, logout } = useAuth();
  const t = useT();
  const totals = useWorkspaceTotals();
  const navigate = useNavigate();
  const toast = useToast();
  const { state } = useSidebar();
  const { language, setLanguage, availableLanguages } = useLocale();

  if (!currentUser) return null;

  const handleSignOut = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  // Tenant languages, in stable order: current language first, then the
  // rest alphabetically by code. Falls back to a single entry that just
  // shows the current code so the toggle never collapses entirely.
  const allLanguages =
    availableLanguages.length > 0
      ? availableLanguages
      : [{ languageCode: language, languageName: language, isDefault: true }];

  const handleCycleLanguage = () => {
    if (allLanguages.length < 2) return;
    const idx = allLanguages.findIndex((l) => l.languageCode === language);
    const next =
      allLanguages[(idx + 1) % allLanguages.length] ?? allLanguages[0];
    if (!next) return;
    setLanguage(next.languageCode);
    toast.info(
      t("auth.switchLanguageToast", "Language switched to {language}.", {
        language: next.languageName,
      }),
    );
  };

  const currentLanguageLabel =
    allLanguages.find((l) => l.languageCode === language)?.languageName ??
    language;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip={`${totals.data?.flows ?? 0} flows across ${totals.data?.features ?? 0} features`}
        >
          <span className="flex flex-col items-start truncate leading-tight">
            <span className="truncate font-medium text-sidebar-foreground">
              {currentUser.name}
            </span>
            {state !== "collapsed" && (
              <span className="truncate text-xs text-sidebar-foreground/70">
                {currentUser.email}
              </span>
            )}
          </span>
        </SidebarMenuButton>
      </SidebarMenuItem>

      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip={
            state === "collapsed"
              ? t("languageSwitcher", "Language")
              : undefined
          }
          onClick={handleCycleLanguage}
          disabled={allLanguages.length < 2}
        >
          <span className="text-xs uppercase tracking-wider text-sidebar-foreground/60">
            {currentLanguageLabel}
          </span>
          {state !== "collapsed" && allLanguages.length > 1 && (
            <span className="ml-auto text-xs">↻</span>
          )}
        </SidebarMenuButton>
      </SidebarMenuItem>

      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip={t("signOut", "Sign out")}
          onClick={handleSignOut}
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          <span>{t("signOut", "Sign out")}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>

      <SidebarMenuItem>
        <CollapseToggleInline />
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function CollapseToggleInline() {
  const { state, toggleSidebar } = useSidebar();
  const t = useT();
  const collapsed = state === "collapsed";
  const Icon = collapsed ? ChevronsRight : ChevronsLeft;
  const label = collapsed
    ? t("nav.expandSidebar", "Expand sidebar")
    : t("nav.collapseSidebar", "Collapse sidebar");
  return (
    <SidebarMenuButton
      tooltip={label}
      onClick={toggleSidebar}
      aria-label={label}
    >
      <Icon aria-hidden="true" />
      <span>
        {collapsed
          ? t("nav.expandSidebar", "Expand")
          : t("nav.collapseSidebar", "Collapse")}
      </span>
    </SidebarMenuButton>
  );
}
