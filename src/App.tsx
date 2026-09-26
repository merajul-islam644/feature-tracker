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
import { MembersPage } from "@/pages/MembersPage";
import { ChatPage } from "@/pages/ChatPage";
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
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/members" element={<MembersPage />} />
            <Route path="/chat" element={<ChatPage />} />
            {/* Bare `/issue-tracker` redirects to the panel since the
                Run verification controls live there; each sub-section
                has its own route under `/issue-tracker/<key>`. */}
            <Route
              path="/issue-tracker"
              element={<Navigate to="/issue-tracker/panel" replace />}
            />
            <Route
              path="/issue-tracker/targets"
              element={<TargetsPage />}
            />
            <Route
              path="/issue-tracker/secrets"
              element={<SecretsPage />}
            />
            <Route
              path="/issue-tracker/scope"
              element={<ScopePage />}
            />
            <Route
              path="/issue-tracker/panel"
              element={<PanelPage />}
            />
            <Route
              path="/issue-tracker/history"
              element={<HistoryPage />}
            />
            <Route
              path="/issue-tracker/issues"
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
