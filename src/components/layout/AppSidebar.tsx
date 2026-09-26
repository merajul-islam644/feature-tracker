import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  FolderKanban,
  ShieldAlert,
  PanelLeftClose,
  PanelLeftOpen,
  FolderTree,
  MessageSquare,
  PlayCircle,
  Settings as SettingsIcon,
  Contact,
  LogOut,
  NotebookPen,
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
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
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
      label: t("nav.issueTracker", "Issue Tracker"),
      icon: ShieldAlert,
    },
    {
      to: "/chat",
      label: t("nav.chat", "Message"),
      icon: MessageSquare,
    },
    {
      to: "/notepad",
      label: t("nav.notepad", "Notepad"),
      icon: NotebookPen,
    },
    {
      to: "/members",
      label: t("nav.members", "Members"),
      icon: Contact,
    },
    {
      to: "/settings",
      label: t("nav.settings", "Settings"),
      icon: SettingsIcon,
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
              // (e.g. /projects/:id should highlight "Project",
              // /notepad/text should highlight "Notepad").
              const isActive =
                item.to === "/projects" || item.to === "/notepad"
                  ? location.pathname.startsWith(item.to)
                  : location.pathname === item.to;
              return (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    asChild
                    tooltip={item.label}
                    isActive={isActive}
                  >
                    <NavLink to={item.to}>
                      <Icon
                        aria-hidden="true"
                        // Inactive icons render in a muted version of
                        // the sidebar foreground — a neutral "default"
                        // color that doesn't fight the user's chosen
                        // accent. Active icons flip to the
                        // contrasting foreground because the active
                        // button paints its own background in
                        // `--sidebar-accent`.
                        className={
                          isActive
                            ? "text-sidebar-accent-foreground"
                            : "text-sidebar-foreground/70"
                        }
                      />
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
        className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md"
        aria-hidden="true"
      >
        {/* Lattice mark — five colored nodes connected by white lines,
            arranged so the geometry forms an "L" inside a square (the
            L emerges from the left-vertical + bottom-horizontal pair,
            the other two edges complete the network feel). Each node
            wears its own accent color with a soft outer glow for depth;
            deeper indigo gradient + faint inner border for refinement. */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 32 32"
          width="32"
          height="32"
        >
          <defs>
            <linearGradient id="latticeBg" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#3730A3" />
              <stop offset="100%" stopColor="#1E1B4B" />
            </linearGradient>
          </defs>
          <rect width="32" height="32" rx="9" fill="url(#latticeBg)" />
          <rect
            x="0.5"
            y="0.5"
            width="31"
            height="31"
            rx="8.5"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="0.5"
            opacity="0.08"
          />
          <g
            stroke="#FFFFFF"
            strokeLinecap="round"
            strokeWidth="1.25"
            opacity="0.35"
          >
            <line x1="9" y1="8" x2="9" y2="23" />
            <line x1="9" y1="23" x2="23" y2="23" />
            <line x1="9" y1="8" x2="23" y2="8" />
            <line x1="23" y1="8" x2="23" y2="23" />
            <line x1="9" y1="8" x2="16" y2="23" />
          </g>
          <g>
            <circle cx="9" cy="8" r="3.5" fill="#818CF8" opacity="0.25" />
            <circle cx="23" cy="8" r="3.5" fill="#C084FC" opacity="0.25" />
            <circle cx="9" cy="23" r="3.5" fill="#34D399" opacity="0.25" />
            <circle cx="16" cy="23" r="3.5" fill="#FBBF24" opacity="0.25" />
            <circle cx="23" cy="23" r="3.5" fill="#FB7185" opacity="0.25" />
          </g>
          <g>
            <circle cx="9" cy="8" r="2.25" fill="#818CF8" />
            <circle cx="23" cy="8" r="2.25" fill="#C084FC" />
            <circle cx="9" cy="23" r="2.25" fill="#34D399" />
            <circle cx="16" cy="23" r="2.25" fill="#FBBF24" />
            <circle cx="23" cy="23" r="2.25" fill="#FB7185" />
          </g>
        </svg>
      </div>
      <span className="truncate bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 bg-clip-text text-sm font-bold tracking-tight text-transparent group-data-[collapsible=icon]:hidden">
        Lattice
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
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
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
  const { currentUser } = useAuth();
  const { state } = useSidebar();

  if (!currentUser) return null;

  // Just an identity card — actions (sign out, language, settings) live
  // in the profile / settings pages, so the footer stays a calm read.
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          tooltip={currentUser.email}
          className="cursor-default"
          asChild
        >
          <div>
            <UserAvatar userId={currentUser.id} name={currentUser.name} size="md" />
            <div className="flex min-w-0 flex-1 flex-col items-start leading-tight">
              <span className="truncate text-sm font-semibold text-sidebar-foreground">
                {currentUser.name}
              </span>
              {state !== "collapsed" && (
                <span className="truncate text-xs text-sidebar-foreground/70">
                  {currentUser.email}
                </span>
              )}
            </div>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
