import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
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
  ChevronRight,
  Globe,
  KeyRound,
  ListChecks,
  Activity,
  History,
  AlertCircle,
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAuth } from "@/hooks/useAuth";
import { useLocale, useT } from "@/lib/blocks/i18n";
import { cn } from "@/lib/utils";

// `useT` looks up against the loaded `common` module. Nav items map onto
// the `nav.*` namespace. The sidebar supports two shapes of nav item:
//   - `link`: a normal route entry that highlights when its path is
//     the current pathname (with the existing startsWith carve-out for
//     parent routes like `/projects` and `/notepad`).
//   - `group`: a collapsible parent that has no route of its own —
//     clicking it only toggles its children's visibility. The
//     Issue Tracker group is the first user of this shape; if more
//     groups get added later, promote `expanded` to a
//     `Record<string, boolean>` keyed on `group.key`.
export function AppSidebar() {
  const t = useT();
  const location = useLocation();

  type NavItem =
    | {
        kind: "link";
        to: string;
        label: string;
        icon: LucideIcon;
      }
    | {
        kind: "group";
        key: string;
        label: string;
        icon: LucideIcon;
        children: {
          key: string;
          label: string;
          to?: string;
          icon?: LucideIcon;
        }[];
      };

  const navItems: NavItem[] = [
    {
      kind: "link",
      to: "/dashboard",
      label: t("nav.dashboard", "Dashboard"),
      icon: LayoutDashboard,
    },
    {
      kind: "link",
      to: "/projects",
      label: t("nav.projects", "Projects"),
      icon: FolderKanban,
    },
    {
      kind: "group",
      key: "issue-tracker",
      label: t("nav.issueTracker", "Issue Tracker"),
      icon: ShieldAlert,
      children: [
        {
          key: "targets",
          to: "/issue-tracker/targets",
          icon: Globe,
          label: t(
            "nav.issueTracker.targets",
            "Verification Targets",
          ),
        },
        {
          key: "secrets",
          to: "/issue-tracker/secrets",
          icon: KeyRound,
          label: t(
            "nav.issueTracker.secrets",
            "Verification Secrets",
          ),
        },
        {
          key: "scope",
          to: "/issue-tracker/scope",
          icon: ListChecks,
          label: t("nav.issueTracker.scope", "Verification Scopes"),
        },
        {
          key: "panel",
          to: "/issue-tracker/panel",
          icon: Activity,
          label: t(
            "issueTracker.panel.title",
            "Verification Panel",
          ),
        },
        {
          key: "history",
          to: "/issue-tracker/history",
          icon: History,
          label: t(
            "issueTracker.history.title",
            "Run History",
          ),
        },
        {
          key: "issues",
          to: "/issue-tracker/issues",
          icon: AlertCircle,
          label: t(
            "issueTracker.issues.title",
            "Issues",
          ),
        },
      ],
    },
    {
      kind: "link",
      to: "/chat",
      label: t("nav.chat", "Message"),
      icon: MessageSquare,
    },
    {
      kind: "link",
      to: "/notepad",
      label: t("nav.notepad", "Notepad"),
      icon: NotebookPen,
    },
    {
      kind: "link",
      to: "/members",
      label: t("nav.members", "Members"),
      icon: Contact,
    },
    {
      kind: "link",
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

  // The Issue Tracker group is the only collapsible entry today. When
  // other groups get added, lift this to `Record<string, boolean>`
  // keyed on `group.key` so they each remember their own state.
  const [issueTrackerOpen, setIssueTrackerOpen] = useState(false);

  // Auto-open the group when the user is on (or navigates to) the
  // Issue Tracker page so deep-linking to `/issue-tracker*` always
  // shows the children the user came looking for. Re-runs on each
  // pathname change to keep deep links in a consistent state.
  const isOnIssueTracker = location.pathname.startsWith("/issue-tracker");
  useEffect(() => {
    if (isOnIssueTracker) setIssueTrackerOpen(true);
  }, [isOnIssueTracker]);

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
                item.kind === "link" &&
                (item.to === "/projects" || item.to === "/notepad"
                  ? location.pathname.startsWith(item.to)
                  : location.pathname === item.to);

              if (item.kind === "link") {
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
              }

              // `kind: "group"` — collapsible parent. No NavLink on the
              // parent itself: clicking it toggles the sub-menu and
              // does NOT navigate. The button still uses the same
              // hover/active background as a regular item so the
              // chevron affordance reads as part of the row, not as a
              // separate control.
              const groupActive = isOnIssueTracker;
              return (
                <SidebarMenuItem key={item.key}>
                  <SidebarMenuButton
                    tooltip={item.label}
                    isActive={groupActive}
                    onClick={() => setIssueTrackerOpen((v) => !v)}
                    aria-expanded={issueTrackerOpen}
                  >
                    <Icon
                      aria-hidden="true"
                      className={
                        groupActive
                          ? "text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/70"
                      }
                    />
                    <span>{item.label}</span>
                    <ChevronRight
                      aria-hidden="true"
                      className={cn(
                        "ml-auto h-4 w-4 transition-transform",
                        // Rotated 90° when open — mirrors the
                        // apps-website folder convention so the cue
                        // reads at a glance.
                        issueTrackerOpen && "rotate-90",
                      )}
                    />
                  </SidebarMenuButton>

                  {issueTrackerOpen && (
                    <SidebarMenuSub>
                      {item.children.map((child) => {
                        // Children with a `to` route via `NavLink` and
                        // pick up active styling when their path is the
                        // current pathname. Children without a `to`
                        // remain visual-only placeholders for sections
                        // that haven't been split into routes yet.
                        //
                        // Icons render before the label. The
                        // `SidebarMenuSubButton` primitive applies
                        // `[&>svg]:text-sidebar-accent-foreground`
                        // unconditionally to any direct `<svg>`
                        // descendant, so even an idle row gets an icon
                        // painted in the accent-foreground colour
                        // (which only reads against the hover/active
                        // background, not against the default
                        // sidebar background, so idle icons effectively
                        // disappear).
                        //
                        // To override that we can't just pass
                        // `text-sidebar-foreground/70` on the icon —
                        // CSS class strings don't pierce into a tag
                        // child from className alone. Instead we attach
                        // a descendant selector on the wrapper that
                        // reaches the SVG: `[&>svg]:text-sidebar-foreground/70`
                        // for idle rows, `[&>svg]:text-sidebar-accent-foreground`
                        // for active. Same rule as the parent nav rows
                        // (muted when idle, accent-foreground when
                        // active) so the visual language is consistent.
                        const Icon = child.icon;
                        if (child.to) {
                          const childActive =
                            location.pathname === child.to ||
                            location.pathname.startsWith(`${child.to}/`);
                          return (
                            <SidebarMenuSubItem key={child.key}>
                              <SidebarMenuSubButton
                                size="sm"
                                asChild
                                isActive={childActive}
                                className={
                                  childActive
                                    ? "[&>svg]:text-sidebar-accent-foreground"
                                    : "[&>svg]:text-sidebar-foreground/70"
                                }
                              >
                                <NavLink to={child.to}>
                                  {Icon && <Icon aria-hidden="true" />}
                                  <span>{child.label}</span>
                                </NavLink>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          );
                        }
                        return (
                          <SidebarMenuSubItem key={child.key}>
                            <SidebarMenuSubButton
                              size="sm"
                              asChild
                              aria-disabled="true"
                              // Same descendant rule: muted foreground
                              // for the disabled placeholder row.
                              className="[&>svg]:text-sidebar-foreground/70"
                            >
                              <span>
                                {Icon && <Icon aria-hidden="true" />}
                                {child.label}
                              </span>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        );
                      })}
                    </SidebarMenuSub>
                  )}
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
