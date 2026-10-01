import { useMemo } from "react";
import type { LucideIcon } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  FolderKanban,
  PanelLeftClose,
  PanelLeftOpen,
  MessageSquare,
  Mail,
  Settings as SettingsIcon,
  Contact,
  NotebookPen,
  Globe,
  KeyRound,
  ListChecks,
  Activity,
  History,
  AlertCircle,
  LayoutGrid,
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
import { useAuth, useIsRole } from "@/hooks/useAuth";
import { useActiveEnv } from "@/contexts/ActiveEnvContext";
import { useT } from "@/lib/blocks/i18n";
import { cn } from "@/lib/utils";

// `useT` looks up against the loaded `common` module. Nav items map onto
// the `nav.*` namespace. The sidebar supports one shape of nav item:
//   - `link`: a normal route entry that highlights when its path is the
//     current pathname (with the existing startsWith carve-out for parent
//     routes like `/projects` and `/notepad`, and a custom `activeMatch`
//     predicate for rows whose "selected" state spans more than one
//     route — e.g. Features is highlighted on BOTH the env landing
//     `/projects/X/Y` AND the dedicated page `/projects/X/Y/features`).
//
// Two optional flags narrow which links show for which audience:
//
//   - `envOnly`: true on rows that are scoped to a project env. The
//     sidebar gate hides them off-env and shows them on-env (replacing
//     the global nav, see the env-context block below).
//
//   - `devAllowKey`: key used to filter Issue Tracker sub-surfaces for
//     the developer role. When set on an `envOnly` row, the developer
//     sees only the row whose key matches theirs — e.g. "issues" — so
//     they don't get visual noise from QA- / manager-driven surfaces
//     (targets / secrets / scope / panel / run history). Features has
//     no `devAllowKey` (visible to all roles).
export function AppSidebar() {
  const t = useT();
  const location = useLocation();
  // Developer role narrows the Issue Tracker surface down to just the
  // Issues row. The verification / secret / panel workflows are driven
  // by the manager + tester roles — developers author features and
  // flows but don't drive verifications, so showing them the full
  // surface would be visual noise. The flag is consumed in the
  // flatMap below.
  const isDeveloper = useIsRole("developer");

  // Active env context — the source of truth for "which project's env
  // am I scoped to". The Features link below consumes this to build
  // its `to` URL (`/projects/X/Y/features`).
  //
  // We also derive `(projectId, envSlug)` straight from the URL as a
  // fallback — `useActiveEnv` is populated by `ProjectDetailPage` /
  // `FeaturesPage` on mount, but there is a brief render window on
  // first navigation where the context hasn't caught up yet (the
  // page component just mounted but its effect hasn't run). Without
  // the URL fallback, the Features link flickers or stays missing on
  // direct deep-links. The URL parse is cheap and the regex below
  // matches the same paths the env-context gate cares about.
  const activeEnv = useActiveEnv();
  const envFromUrl = useMemo(() => {
    // Match the env landing (`/projects/X/Y`), the dedicated
    // features view (`/projects/X/Y/features`), AND any Issue
    // Tracker sub-surface (`/projects/X/Y/<key>` where `<key>` is
    // one of targets/secrets/scope/panel/history/issues) so the
    // sidebar can build project-scoped URLs from the (projectId,
    // envSlug) pair on any of those pages — not just the env
    // landing. The literal `info` segment is excluded (project
    // metadata, not an env context). The sub-surface segment list
    // mirrors the six routes declared in `App.tsx`.
    const m = location.pathname.match(
      /^\/projects\/([^/]+)\/([^/]+)(?:\/(?:features|targets|secrets|scope|panel|history|issues))?\/?$/,
    );
    if (!m) return null;
    if (m[2] === "info") return null;
    return { projectId: m[1], envSlug: m[2] };
    // Re-derive on every pathname change.
  }, [location.pathname]);
  // Prefer the URL — it's synchronously available on every render,
  // including the very first. Kept as a belt-and-braces fallback
  // for the brief moment between mount and the first effect on
  // pages that don't push the URL→context map themselves.
  const effectiveEnv = envFromUrl ?? activeEnv;

  type NavItem = {
    kind: "link";
    to: string;
    label: string;
    icon: LucideIcon;
    // Issue Tracker sub-surfaces (Targets, Secrets, Scopes, Panel,
    // Run History, Issues) and the Features link all share one
    // constraint: they're scoped to a project env. The same flag
    // covers all of them so the render pipe doesn't have to
    // special-case by `to`. Tagging instead of route-keying keeps the
    // rule self-documenting at the definition site.
    envOnly?: boolean;
    // Used by the developer narrowing — when `envOnly` and the user
    // is on a developer role, the row is kept only if its key appears
    // in this set. Without a key the row is dropped alongside the
    // others (developer sees their role-appropriate subset of Issue
    // Tracker surfaces — "issues" only today). The Features link
    // carries no key on purpose; it uses `allRoles: true` instead
    // (see below) so the developer narrowing doesn't have to
    // special-case by absence-of-key.
    devAllowKey?: string;
    // Bypass the developer narrowing — when `true`, the row stays
    // visible to every role regardless of `devAllowKey`. Used by the
    // Features link so developers see it alongside their Issues row.
    allRoles?: boolean;
    // Custom active-state matcher for rows whose "selected" state
    // spans more than one route. When unset, the default predicate
    // applies:
    //   - /projects and /notepad use startsWith for parent-route
    //     highlight;
    //   - everything else uses === pathname match.
    activeMatch?: (pathname: string) => boolean;
    // Opt-in corner decoration: a radiating signal-wave ping anchored
    // at the icon's top-left corner (see the `signal-wave` keyframe in
    // tailwind.config.js). The Mail row uses it so the placeholder
    // entry feels alive until the real feature lands.
    signalWave?: boolean;
  };

  // Issue Tracker sub-surfaces as flat top-level links. Each row is
  // `envOnly`, so the env-context gate below hides all six together
  // when the user is off-env and shows them together when they're
  // inside a project env — no parent collapsible to click. The
  // grouping still exists conceptually (data hooks, AI snapshot,
  // i18n namespace `nav.issueTracker.*`) but the sidebar reflects the
  // user-facing flatten: each surface is its own nav row, top-level,
  // with its own active-state highlight on deep-link.
  //
  // URLs are project-scoped (`/projects/<id>/<env>/<key>` — the
  // `/issue-tracker` segment was removed by user request on
  // 2026-09-29) so the (projectId, envSlug) pair is in the URL
  // itself. `to` is built off `effectiveEnv`; off-env the gate hides
  // these rows before the URLs ever render, so the link target is
  // always valid.
  const issueTrackerBase = effectiveEnv
    ? `/projects/${effectiveEnv.projectId}/${effectiveEnv.envSlug}`
    : "/projects"; // unreachable (off-env gate hides the rows) but a safe string for type-check
  const issueTrackerSurface: NavItem[] = [
    {
      kind: "link",
      to: `${issueTrackerBase}/targets`,
      label: t("nav.issueTracker.targets", "Targets"),
      icon: Globe,
      envOnly: true,
    },
    {
      kind: "link",
      to: `${issueTrackerBase}/secrets`,
      label: t("nav.issueTracker.secrets", "Secrets"),
      icon: KeyRound,
      envOnly: true,
    },
    {
      kind: "link",
      to: `${issueTrackerBase}/scope`,
      label: t("nav.issueTracker.scope", "Scopes"),
      icon: ListChecks,
      envOnly: true,
    },
    {
      kind: "link",
      to: `${issueTrackerBase}/panel`,
      label: t("issueTracker.panel.title", "Panel"),
      icon: Activity,
      envOnly: true,
    },
    {
      kind: "link",
      to: `${issueTrackerBase}/history`,
      label: t("issueTracker.history.title", "History"),
      icon: History,
      envOnly: true,
    },
    {
      kind: "link",
      to: `${issueTrackerBase}/issues`,
      label: t("issueTracker.issues.title", "Issues"),
      icon: AlertCircle,
      envOnly: true,
      // Developer role: keep only the Issues surface among the Issue
      // Tracker rows. The rest (Targets / Secrets / Scopes / Panel /
      // Run History) are QA/manager-driven — a developer author sees
      // them as visual noise.
      devAllowKey: "issues",
    },
  ];

  // Features link — top of the env-only nav (user requirement:
  // "shobar upor"). Plain link, no children. Clicking it navigates
  // to `/projects/X/Y/features` which renders `FeaturesPage` — the
  // dedicated single-page view that lists every feature authored
  // under the active env. Built only when `activeEnv` is set; off-env
  // the env-only gate filters it out anyway.
  //
  // Active-by-default on the env landing AND on the dedicated page:
  // when the user lands on `/projects/X/Y` (env detail) the Features
  // row is already highlighted, matching the user's "by default
  // selected থাকবে" requirement. Issue Tracker sub-routes do NOT
  // light up the Features row — they're a separate context. The
  // `/projects/X/info` route is excluded (project metadata, not an
  // env context).
  const featuresLink: NavItem | null = effectiveEnv
    ? {
        kind: "link",
        to: `/projects/${effectiveEnv.projectId}/${effectiveEnv.envSlug}/features`,
        label: t("nav.features", "Features"),
        icon: LayoutGrid,
        envOnly: true,
        // Visible to every role — developers see Features alongside
        // their Issues row. Without this flag the developer
        // narrowing would drop Features (since it has no
        // `devAllowKey` to match "issues").
        allRoles: true,
        activeMatch: (pathname) => {
          const m = pathname.match(
            /^\/projects\/([^/]+)\/([^/]+)(\/features)?\/?$/,
          );
          if (!m) return false;
          if (m[3] === "/features") return true;
          return m[2] !== "info";
        },
      }
    : null;

  // Flat list rendered top-to-bottom inside the sidebar. The Features
  // link sits at the very top of the on-env nav. Off-env, `envOnly:
  // true` rows are filtered out by the gate below — so off-env still
  // shows the same global nav as before, with Features nowhere on the
  // page.
  //
  // The order is rebuilt on every render via `useMemo` keyed on the
  // inputs that affect it (`activeEnv` for the Features link's
  // existence, `t` for the i18n labels).
  const navItems: NavItem[] = useMemo(() => {
    return [
      ...(featuresLink ? [featuresLink] : []),
      {
        kind: "link" as const,
        to: "/dashboard",
        label: t("nav.dashboard", "Dashboard"),
        icon: LayoutDashboard,
      },
      {
        kind: "link" as const,
        to: "/projects",
        label: t("nav.projects", "Projects"),
        icon: FolderKanban,
      },
      ...issueTrackerSurface,
      {
        kind: "link" as const,
        to: "/chat",
        label: t("nav.chat", "Message"),
        icon: MessageSquare,
      },
      {
        kind: "link" as const,
        to: "/notepad",
        label: t("nav.notepad", "Notepad"),
        icon: NotebookPen,
      },
      {
        kind: "link" as const,
        to: "/members",
        label: t("nav.members", "Members"),
        icon: Contact,
      },
      {
        kind: "link" as const,
        to: "/mail",
        label: t("nav.mail", "Mail"),
        icon: Mail,
        signalWave: true,
      },
      {
        kind: "link" as const,
        to: "/settings",
        label: t("nav.settings", "Settings"),
        icon: SettingsIcon,
      },
    ];
    // `featuresLink` is derived from `activeEnv`; `t` is the i18n
    // translator. Re-runs when either changes. The Issue Tracker
    // sub-surface is intentionally not a dependency — its labels are
    // stable per `t` and its members don't depend on env.
  }, [activeEnv, t, featuresLink, issueTrackerSurface]);

  // Issue Tracker only exists inside a project environment — clicking
  // an env chip on a project card lands on `/projects/:id/:envSlug/features`,
  // and that's the only context where its data (targets / secrets /
  // scope / panel / history / issues) is scoped. The sidebar reacts
  // in two directions:
  //
  //   * Off-env (the user is on Dashboard, /projects, /chat, …):
  //     `envOnly` rows hide entirely. Their data hooks refuse to act
  //     outside an env anyway, so leaving them visible would invite
  //     a dead-end click.
  //   * On-env (the user is inside `/projects/:id/:envSlug` or
  //     `/projects/:id/:envSlug/features` or any
  //     `/projects/:id/:envSlug/<key>` Issue Tracker sub-route —
  //     note the `/issue-tracker` segment was removed from the URL
  //     on 2026-09-29): the global nav collapses down to the
  //     env-only surface only. Dashboard / Projects / Message /
  //     Notepad / Members / Settings all bypass the env scope or
  //     duplicate the env-free experience, so showing them alongside
  //     Issue Tracker / Features would be both context-noise and an
  //     invitation to leave the env unintentionally. The brand logo
  //     at the top of the sidebar (links to /dashboard) stays
  //     visible as the escape hatch.
  //
  // Env-context-active detection — single regex that captures all
  // on-env shapes:
  //   1. `/projects/:id/:envSlug` (env landing)
  //   2. `/projects/:id/:envSlug/features`
  //   3. `/projects/:id/:envSlug/<issue-tracker-key>`
  //      where `<issue-tracker-key>` is one of
  //      targets/secrets/scope/panel/history/issues
  // The literal `info` segment is excluded — `/projects/X/info` is
  // project metadata, not an env landing, and should show the global
  // nav. Reading straight from the URL avoids a new context provider
  // for this visibility-only signal; the env slug remains the single
  // source of truth.
  const envContextActive =
    /^\/projects\/[^/]+\/(?!info\/)([^/]+)(?:\/(?:features|targets|secrets|scope|panel|history|issues))?\/?$/.test(
      location.pathname,
    );

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
            {/*
              Off-env: keep the global nav, hide `envOnly` rows
              (Features + Issue Tracker sub-surfaces). Their data
              hooks refuse to act outside an env and would land the
              user on an empty panel.

              On-env: collapse the navigation down to the env-only
              surface ONLY. The rest of the global nav (Dashboard /
              Projects / Message / Notepad / Members / Settings) becomes
              contextual noise. Brand logo at the top stays visible as
              the escape hatch.

              Developer narrowing: on-env, when the user is on the
              developer role, keep only the Issue Tracker row whose
              `devAllowKey` matches the developer surface ("issues").
              Features is kept (no narrowing — visible to all roles per
              the user's explicit requirement).
            */}
            {navItems
              .filter((item) => {
                if (envContextActive) {
                  if (!item.envOnly) return false;
                  // Developer narrowing on env: keep rows that opt in
                  // for every role (`allRoles: true` — currently the
                  // Features link) and rows whose `devAllowKey`
                  // matches the developer surface ("issues"). Every
                  // other env-scoped row (Targets, Secrets, Scope,
                  // Panel, History) drops because they are
                  // QA/manager-driven.
                  if (
                    isDeveloper &&
                    item.kind === "link" &&
                    !item.allRoles &&
                    item.devAllowKey !== "issues"
                  ) {
                    return false;
                  }
                  return true;
                }
                return !item.envOnly;
              })
              .map((item) => {
                const Icon = item.icon;
                // Custom active matcher wins when set — used by the
                // Features link so it highlights on BOTH the env
                // landing and the dedicated /features route. Default
                // predicate applies for everything else:
                //   - /projects and /notepad use startsWith for
                //     parent-route highlight;
                //   - everything else uses === pathname match.
                const isActive = item.activeMatch
                  ? item.activeMatch(location.pathname)
                  : item.to === "/projects" || item.to === "/notepad"
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
                        <span className="relative inline-flex">
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
                          {item.signalWave && (
                            <span
                              aria-hidden="true"
                              className="pointer-events-none absolute -left-1.5 -top-1.5 h-2.5 w-2.5 motion-reduce:hidden"
                            >
                              {/* Two staggered rings + a static origin
                                  dot — the radiating "signal wave".
                                  Rings scale 0.35→1.5 and fade on the
                                  `signal-wave` keyframe; the second
                                  ring trails the first by half a cycle
                                  so the ping reads continuous. */}
                              <span className="absolute inset-0 rounded-full border-[1.5px] border-indigo-400 motion-safe:animate-signal-wave" />
                              <span className="absolute inset-0 rounded-full border-[1.5px] border-indigo-400/70 motion-safe:animate-signal-wave [animation-delay:1.1s]" />
                              <span className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-500" />
                            </span>
                          )}
                        </span>
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
