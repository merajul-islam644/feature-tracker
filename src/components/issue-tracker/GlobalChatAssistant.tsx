// Floating AI Assistant launcher for EVERY authenticated page.
//
// Renders the same ChatLauncher the Issue Tracker page used to own, wired
// to the app-wide store (see hooks/issueTrackerStore.tsx) — one chat
// thread, one session list, one live activity feed, reachable from the
// Dashboard, Projects, Members, Settings, anywhere.

import { useState } from "react";
import { useIssueTrackerStore } from "@/hooks/issueTrackerStore";
import { ChatLauncher } from "./ChatLauncher";

export function GlobalChatAssistant() {
  const {
    chat,
    targets,
    run,
    runActivityLog,
    sendingMessage,
    aiRetryStatus,
    sendMessage,
    applyChatAction,
    sessions,
    sessionsLoading,
    currentSessionId,
    startNewSession,
    switchSession,
    deleteSession,
    renameSession,
  } = useIssueTrackerStore();

  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <ChatLauncher
      messages={chat}
      sending={sendingMessage}
      retryStatus={aiRetryStatus}
      onSend={sendMessage}
      onAction={applyChatAction}
      targets={targets}
      activityLog={runActivityLog}
      runActive={run.status === "running"}
      sessions={sessions}
      sessionsLoading={sessionsLoading}
      currentSessionId={currentSessionId}
      onNewSession={startNewSession}
      onSelectSession={(id) => {
        switchSession(id);
        setHistoryOpen(false);
      }}
      onDeleteSession={deleteSession}
      onRenameSession={renameSession}
      historyOpen={historyOpen}
      onHistoryOpenChange={setHistoryOpen}
    />
  );
}
