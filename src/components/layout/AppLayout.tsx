import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { RouteContext, type RouteState } from "@/app/router/routeContext";
import { SidebarProvider, SidebarInset, useSidebar } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar } from "./AppSidebar";
import { Topbar } from "./Topbar";
import { Toaster } from "@/components/ui/sonner";
import { IssueTrackerStoreProvider } from "@/hooks/issueTrackerStore";
import { ActiveEnvProvider } from "@/contexts/ActiveEnvContext";
import { GlobalChatAssistant } from "@/components/issue-tracker/GlobalChatAssistant";
import { IncomingCallDialog } from "@/components/team-chat/IncomingCallDialog";
import { TestConfirmationDialog } from "@/components/dashboard/TestConfirmationDialog";
import { EnvSync } from "./EnvSync";
import { useAnnouncementsAutoOpen } from "@/lib/blocks/hooks";

export function AppLayout() {
  // Global "fresh announcement" watcher — mounted once at the layout
  // level so it survives page navigations. Was previously owned by
  // DashboardPage, which meant the modal only popped while the user
  // was on /dashboard: any fresh delivery that arrived on, say,
  // /projects would either be missed (hook unmounted, fresh row seen
  // as baseline on the user's next /dashboard visit) or pop after a
  // page round-trip. Hoisting here puts the auto-open hook in the
  // same neighbourhood as `IncomingCallDialog` so the "global
  // overlays" cluster reads as one concept and the broadcasts land
  // on whichever page the user happens to be viewing.
  const [testModalOpen, setTestModalOpen] = useAnnouncementsAutoOpen();

  return (
    // ActiveEnvProvider wraps IssueTrackerStoreProvider because the
    // store's hook (useIssueTracker) reads `useActiveEnv()` during
    // render. If they were swapped, the hook would throw on the very
    // first render since the provider's value is null and its consumer
    // is the one supplying that value's reader. The env context itself
    // only requires anything-renders-inside, so placing it outermost
    // here at the layout root works for the whole authenticated tree.
    <ActiveEnvProvider>
    <IssueTrackerStoreProvider>
      {/* URL → ActiveEnv sync. Renders no UI — just stamps the URL's
          (projectId, envSlug) pair into the ActiveEnv context on every
          navigation, including the 4-segment Issue Tracker sub-routes
          that don't mount ProjectDetailPage. Without this, a user
          landing directly on /projects/<id>/dev/targets after the
          mirror last held `stg` would see the wrong-env target list and
          silently edit the wrong row. */}
      <EnvSync />
      <TooltipProvider delayDuration={150}>
        <SidebarProvider defaultOpen={readPersistedSidebarOpen()}>
          {/* Writes the collapsed/expanded choice to localStorage on
              every change — without this a refresh always reopened the
              sidebar (SidebarProvider starts from defaultOpen alone). */}
          <SidebarStatePersistence />
          <AppSidebar />
          <SidebarInset>
            <Topbar />
            <div className="flex-1 bg-background">
              {/* The 6xl cap fits laptops; from 2xl (≥1536px — external
                  monitors) the page fills the width so the workbench and
                  every other page don't float in wide empty gutters. */}
              <div className="mx-auto max-w-6xl 2xl:max-w-none px-4 py-6 md:px-8 md:py-8">
                {/* The ported workbench subtree (features/workbench) reads
                    navigation through the shared `useRoute()` context it
                    came with, not react-router's hooks — this bridge keeps
                    that seam working without touching the ported files. */}
                <RouteBridge>
                  <Outlet />
                </RouteBridge>
              </div>
            </div>
          </SidebarInset>
          {/* Floating AI Assistant — every authenticated page (fixed
              position, so DOM placement inside the layout is irrelevant;
              it renders on top of whatever page the Outlet shows). */}
          <GlobalChatAssistant />
          {/* Global incoming-call ring prompt — mounts once at the layout
              level so it pops regardless of which page the user is on.
              Fixed-position Dialog; sibling placement with Toaster keeps
              the "global overlays" cluster obvious to readers. */}
          <IncomingCallDialog />
          {/* Global announcement "smoke test" modal — auto-pops on a
              fresh delivery from a manager (the local hook in
              DashboardPage used to own this, which is why the modal
              only fired there). Owned by the layout now so a Post or
              Repost lands on whatever page the user is on, not only
              after they navigate back to /dashboard. The dashboard's
              own `AnnouncementsDialog` stays as the manual archive
              deep-dive (separate surface, separate state). */}
          <TestConfirmationDialog
            open={testModalOpen}
            onOpenChange={setTestModalOpen}
          />
          <Toaster richColors position="bottom-right" />
        </SidebarProvider>
      </TooltipProvider>
    </IssueTrackerStoreProvider>
    </ActiveEnvProvider>
  );
}

// --- Sidebar collapsed-state persistence -------------------------------------
//

// Adapts react-router's navigation state to the shape the ported
// workbench expects (`useRoute()` from TestPilot's router seam). Only
// `navigate` is consumed today (BottomPanel's "go to run" links), but
// the full RouteState is provided so other ported consumers resolve
// too. Params stay empty — no ported surface reads them react-router
// style; pages use useParams directly.
function RouteBridge({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const value = useMemo<RouteState>(
    () => ({
      navigate: (to: string) => navigate(to),
      params: {},
      path: location.pathname,
      search: location.search.replace(/^\?/, ""),
    }),
    [navigate, location.pathname, location.search],
  );
  return <RouteContext.Provider value={value}>{children}</RouteContext.Provider>;
}
// `SidebarProvider` starts every mount from `defaultOpen`, so a refresh
// after minimizing always re-expanded the sidebar. Two pieces fix it:
//
//   1. `readPersistedSidebarOpen()` — runs once at provider creation
//      (props must not change after mount), reading the last choice
//      from localStorage.
//   2. `<SidebarStatePersistence />` — a no-UI child inside the
//      provider that watches `useSidebar().state` and writes the
//      choice back on every toggle (header button, topbar button,
//      rail click — all funnels through the same state).
//
// localStorage is the right store here: per-browser UI preference,
// nothing to share, and a cleared store just means "default open".

const SIDEBAR_OPEN_KEY = "ft-sidebar-open";

function readPersistedSidebarOpen(): boolean {
  try {
    const v = localStorage.getItem(SIDEBAR_OPEN_KEY);
    if (v === "false") return false;
    if (v === "true") return true;
  } catch {
    // storage unavailable (private mode, cleared data) — default open.
  }
  return true;
}

function SidebarStatePersistence() {
  const { state } = useSidebar();
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_OPEN_KEY, state === "expanded" ? "true" : "false");
    } catch {
      // non-fatal — the preference just won't survive refreshes.
    }
  }, [state]);
  return null;
}
