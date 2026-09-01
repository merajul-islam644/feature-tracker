import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  FolderKanban,
  Bug,
  ChevronsLeft,
  ChevronsRight,
  PlayCircle,
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
import { useDataStore } from "@/store/dataStore";
import { useLocaleStore } from "@/store/localeStore";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";

const navItems = [
  {
    to: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    tooltip: "Dashboard",
  },
  {
    to: "/projects",
    label: "Project",
    icon: FolderKanban,
    tooltip: "Projects",
  },
  // {
  //   to: "/issue-tracker",
  //   label: "Issue Tracker",
  //   icon: Bug,
  //   tooltip: "Issue Tracker",
  // },
  // {
  //   to: "/test-runner",
  //   label: "Test Runner",
  //   icon: PlayCircle,
  //   tooltip: "Test Runner",
  // },
];

export function AppSidebar() {
  const location = useLocation();
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
              Navigation
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
                    tooltip={item.tooltip}
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

      {/* <SidebarFooter>
        <FooterUser />
      </SidebarFooter> */}

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
  const collapsed = state === "collapsed";
  const Icon = collapsed ? ChevronsRight : ChevronsLeft;
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
  return (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded-md text-sidebar-foreground/70",
        "transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}

// function FooterUser() {
//   const { currentUser, logout } = useAuth();
//   const setLocale = useLocaleStore((s) => s.setLocale);
//   const locale = useLocaleStore((s) => s.locale);
//   const projects = useDataStore((s) => s.projects);
//   const flows = useDataStore((s) => s.flows);
//   const navigate = useNavigate();
//   const toast = useToast();
//   const { state } = useSidebar();

//   if (!currentUser) return null;

//   return (
//     <SidebarMenu>
//       <SidebarMenuItem>
//         <SidebarMenuButton
//           tooltip={`${projects.length} projects • ${flows.length} flows`}
//         >
//           <span className="flex flex-col items-start truncate leading-tight">
//             <span className="truncate font-medium text-sidebar-foreground">
//               {currentUser.name}
//             </span>
//             {state !== "collapsed" && (
//               <span className="truncate text-xs text-sidebar-foreground/70">
//                 {currentUser.email}
//               </span>
//             )}
//           </span>
//         </SidebarMenuButton>
//       </SidebarMenuItem>

//       <SidebarMenuItem>
//         <SidebarMenuButton
//           tooltip={
//             state === "collapsed" ? "Toggle workspace language" : undefined
//           }
//           onClick={() => {
//             const next = locale === "en" ? "bn" : "en";
//             setLocale(next);
//             toast.info(
//               `Language switched to ${next === "en" ? "English" : "বাংলা"}.`,
//             );
//           }}
//         >
//           <span className="text-xs uppercase tracking-wider text-sidebar-foreground/60">
//             {locale === "en" ? "English" : "বাংলা"}
//           </span>
//           {state !== "collapsed" && <span className="ml-auto text-xs">↻</span>}
//         </SidebarMenuButton>
//       </SidebarMenuItem>

//       <SidebarMenuItem>
//         <SidebarMenuButton
//           tooltip="Sign out"
//           onClick={() => {
//             logout();
//             navigate("/login", { replace: true });
//           }}
//         >
//           <ChevronsRight className="rotate-180" aria-hidden="true" />
//           <span>Sign out</span>
//         </SidebarMenuButton>
//       </SidebarMenuItem>

//       <SidebarMenuItem>
//         <CollapseToggleInline />
//       </SidebarMenuItem>
//     </SidebarMenu>
//   );
// }

// function CollapseToggleInline() {
//   const { state, toggleSidebar } = useSidebar();
//   const collapsed = state === "collapsed";
//   const Icon = collapsed ? ChevronsRight : ChevronsLeft;
//   const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
//   return (
//     <SidebarMenuButton
//       tooltip={label}
//       onClick={toggleSidebar}
//       aria-label={label}
//     >
//       <Icon aria-hidden="true" />
//       <span>{collapsed ? "Expand" : "Collapse"}</span>
//     </SidebarMenuButton>
//   );
// }
