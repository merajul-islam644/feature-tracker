import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryProvider } from "@/components/QueryProvider";
import { AppLayout } from "@/components/layout/AppLayout";
import { LoginPage } from "@/pages/LoginPage";
import { CallbackPageGuard } from "@/pages/CallbackPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { ProjectDetailPage } from "@/pages/ProjectDetailPage";
import { FeaturesPage } from "@/pages/FeaturesPage";
import { ProfilePage } from "@/pages/ProfilePage";
import { SettingsPage } from "@/pages/SettingsPage";
import { MembersPage } from "@/pages/MembersPage";
import { ChatPage } from "@/pages/ChatPage";
import { MailPage } from "@/pages/MailPage";
import { TargetsPage } from "@/pages/issue-tracker/TargetsPage";
import { SecretsPage } from "@/pages/issue-tracker/SecretsPage";
import { ScopePage } from "@/pages/issue-tracker/ScopePage";
import { PanelPage } from "@/pages/issue-tracker/PanelPage";
import { HistoryPage } from "@/pages/issue-tracker/HistoryPage";
import { IssuesPage } from "@/pages/issue-tracker/IssuesPage";
import { ProjectInfoPage } from "@/pages/ProjectInfoPage";
import { NotificationDetailPage } from "@/pages/NotificationDetailPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { NotepadPage } from "@/pages/NotepadPage";
import { NotepadTextPage } from "@/pages/NotepadTextPage";
import { NotepadTextEditorPage } from "@/pages/NotepadTextEditorPage";
import { NotepadExcelPage } from "@/pages/NotepadExcelPage";
import { NotepadExcelEditorPage } from "@/pages/NotepadExcelEditorPage";
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
            {/* Dedicated features view for the active env — every
                feature authored under this env on a single page. The
                sidebar's Features entry points here. React Router
                matches longest-path-first, so this 4-segment route
                doesn't get absorbed by the 3-segment catch-all
                above. */}
            <Route
              path="/projects/:projectId/:envSlug/features"
              element={<FeaturesPage />}
            />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/members" element={<MembersPage />} />
            <Route path="/mail" element={<MailPage />} />
            <Route path="/chat" element={<ChatPage />} />
            {/* Issue Tracker is project+env scoped — every sub-surface
                lives directly under `/projects/:projectId/:envSlug/<key>`
                (the `/issue-tracker` segment was removed by user
                request on 2026-09-29). The 4-segment shape doesn't
                collide with the 3-segment `/projects/:id/:envSlug`
                catch-all (env landing) or the 3-segment
                `/projects/:id/info` (project metadata) — React Router
                matches the longest prefix, so a custom env named
                `targets` would still hit ProjectDetailPage via the
                catch-all while `targets` as a 4th segment routes to
                TargetsPage. The URL carries the (projectId, envSlug)
                pair the data hooks need; no reliance on the ActiveEnv
                mirror for routing. */}
            <Route
              path="/projects/:projectId/:envSlug/targets"
              element={<TargetsPage />}
            />
            <Route
              path="/projects/:projectId/:envSlug/secrets"
              element={<SecretsPage />}
            />
            <Route
              path="/projects/:projectId/:envSlug/scope"
              element={<ScopePage />}
            />
            <Route
              path="/projects/:projectId/:envSlug/panel"
              element={<PanelPage />}
            />
            <Route
              path="/projects/:projectId/:envSlug/history"
              element={<HistoryPage />}
            />
            <Route
              path="/projects/:projectId/:envSlug/issues"
              element={<IssuesPage />}
            />
            <Route path="/notepad" element={<NotepadPage />} />
            <Route path="/notepad/text" element={<NotepadTextPage />} />
            <Route
              path="/notepad/text/:padId"
              element={<NotepadTextEditorPage />}
            />
            <Route path="/notepad/excel" element={<NotepadExcelPage />} />
            <Route
              path="/notepad/excel/:padId"
              element={<NotepadExcelEditorPage />}
            />
            <Route
              path="/notifications/:notificationId"
              element={<NotificationDetailPage />}
            />
            <Route path="/repo-browser" element={<RepoBrowserPage />} />
            <Route path="/test-runner" element={<PlaywrightPage />} />
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </QueryProvider>
  );
}
