import { Outlet } from "react-router-dom";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar } from "./AppSidebar";
import { Topbar } from "./Topbar";
import { Toaster } from "@/components/ui/sonner";
import { IssueTrackerStoreProvider } from "@/hooks/issueTrackerStore";
import { GlobalChatAssistant } from "@/components/issue-tracker/GlobalChatAssistant";
import { IncomingCallDialog } from "@/components/team-chat/IncomingCallDialog";
import { TestConfirmationDialog } from "@/components/dashboard/TestConfirmationDialog";
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
    <IssueTrackerStoreProvider>
      <TooltipProvider delayDuration={150}>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset>
            <Topbar />
            <div className="flex-1 bg-background">
              <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
                <Outlet />
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
  );
}
