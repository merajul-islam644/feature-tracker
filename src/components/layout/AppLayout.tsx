import { Outlet } from "react-router-dom";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar } from "./AppSidebar";
import { Topbar } from "./Topbar";
import { Toaster } from "@/components/ui/sonner";
import { IssueTrackerStoreProvider } from "@/hooks/issueTrackerStore";
import { GlobalChatAssistant } from "@/components/issue-tracker/GlobalChatAssistant";

export function AppLayout() {
  return (
    <IssueTrackerStoreProvider>
      <TooltipProvider delayDuration={150}>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset>
            <Topbar />
            <div className="flex-1">
              <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
                <Outlet />
              </div>
            </div>
          </SidebarInset>
          {/* Floating AI Assistant — every authenticated page (fixed
              position, so DOM placement inside the layout is irrelevant;
              it renders on top of whatever page the Outlet shows). */}
          <GlobalChatAssistant />
          <Toaster richColors position="bottom-right" />
        </SidebarProvider>
      </TooltipProvider>
    </IssueTrackerStoreProvider>
  );
}
