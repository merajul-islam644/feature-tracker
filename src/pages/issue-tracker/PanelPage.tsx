// Workspace surface — the body of the `/panel` route.
//
// What used to live here was the Playwright authoring surface (see
// git history for `PlaywrightEditorPanel.tsx`). The user replaced
// that with a VS Code-style file/folder management system: pick a
// local folder, browse its tree, edit files, save back to disk.
// All the actual workspace primitives (folder picker, file CRUD,
// tree refresh) live in `useDevServer()`; this page is the page-
// level wrapper that ties the heading row to the workspace body.

import type { ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useActiveEnv } from "@/contexts/ActiveEnvContext";
import { DevServerProvider, useDevServer } from "@/contexts/DevServerContext";
import { WorkspacePage } from "@/components/workspace/WorkspacePage";
import { BackToProjectsLink } from "@/components/layout/BackToProjectsLink";

// Mount the dev-server sandbox context unconditionally so the
// workspace primitives are available regardless of active-env
// status. The provider returns a null workspace when the
// `(user, project, env)` triple is empty, and the workspace page
// renders an "Open folder" empty-state in that case.
function DevServerWrapper({ children }: { children: ReactNode }) {
  const { currentUser } = useAuth();
  const activeEnv = useActiveEnv();
  return (
    <DevServerProvider
      userId={currentUser?.id ?? ""}
      projectId={activeEnv?.projectId ?? ""}
      envSlug={activeEnv?.envSlug ?? ""}
    >
      {children}
    </DevServerProvider>
  );
}

function PanelBody() {
  // `enabled` reflects the VITE_USE_DEV_SERVER flag. When the
  // sandbox is not configured the workspace page shows an empty
  // state instead of throwing — the user can still see the page,
  // just nothing happens on click.
  void useDevServer();
  return (
    <div className="space-y-4">
      <BackToProjectsLink />
      <WorkspacePage />
    </div>
  );
}

export function PanelPage() {
  return (
    <DevServerWrapper>
      <PanelBody />
    </DevServerWrapper>
  );
}