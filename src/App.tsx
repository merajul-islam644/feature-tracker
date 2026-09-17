import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryProvider } from "@/components/QueryProvider";
import { AppLayout } from "@/components/layout/AppLayout";
import { LoginPage } from "@/pages/LoginPage";
import { CallbackPageGuard } from "@/pages/CallbackPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { ProjectDetailPage } from "@/pages/ProjectDetailPage";
import { ProfilePage } from "@/pages/ProfilePage";
import { SettingsPage } from "@/pages/SettingsPage";
import { IssueTrackerPage } from "@/pages/IssueTrackerPage";
import { ProjectInfoPage } from "@/pages/ProjectInfoPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { RequireAuth } from "@/hooks/useAuth";
import { PlaywrightPage } from "./playwright/PlaywrightPage";
import { RepoBrowserPage } from "./repo-browser/RepoBrowserPage";

export default function App() {
  return (
    <QueryProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          {/* /login/callback MUST stay outside RequireAuth — the user is by
            definition not yet authenticated when IAM redirects back here. */}
          <Route path="/login/callback" element={<CallbackPageGuard />} />

          <Route
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route
              path="/projects/:projectId"
              element={<ProjectDetailPage />}
            />
            {/* `/info` is matched BEFORE the `:envSlug` catch-all so the
                literal `info` segment isn't accidentally bound to the env
                parameter. Catch-all then handles both the canonical env
                routes (dev/stg/prod/uat) and user-added custom envs. */}
            <Route
              path="/projects/:projectId/info"
              element={<ProjectInfoPage />}
            />
            <Route
              path="/projects/:projectId/:envSlug"
              element={<ProjectDetailPage />}
            />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/issue-tracker" element={<IssueTrackerPage />} />
            <Route path="/repo-browser" element={<RepoBrowserPage />} />
            <Route path="/test-runner" element={<PlaywrightPage />} />
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </QueryProvider>
  );
}
