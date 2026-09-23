// App-wide mount of the Issue Tracker store.
//
// `useIssueTracker()` holds single-instance state — the chat thread, the
// live verification run (SSE subscription, activity feed), executed-tool
// idempotency refs. Calling it from two components would fork that state
// into two divergent copies. This provider mounts it exactly ONCE at the
// AppLayout level so:
//
//   * the floating ChatLauncher can live on every page (GlobalChatAssistant)
//     and drive the SAME conversation the Issue Tracker page sees, and
//   * a verification run keeps streaming while the user navigates between
//     pages — leaving /issue-tracker no longer tears the SSE stream down.
//
// Non-consuming pages don't re-render on store changes: `children` arrives
// as a stable element reference, so React bails out of that subtree when
// the provider re-renders from its own state — only components calling
// useIssueTrackerStore() re-render.

import { createContext, useContext, type ReactNode } from "react";
import { useIssueTracker } from "./useIssueTracker";

export type IssueTrackerStore = ReturnType<typeof useIssueTracker>;

const IssueTrackerStoreContext = createContext<IssueTrackerStore | null>(null);

export function IssueTrackerStoreProvider({ children }: { children: ReactNode }) {
  const store = useIssueTracker();
  return (
    <IssueTrackerStoreContext.Provider value={store}>
      {children}
    </IssueTrackerStoreContext.Provider>
  );
}

export function useIssueTrackerStore(): IssueTrackerStore {
  const store = useContext(IssueTrackerStoreContext);
  if (!store) {
    throw new Error(
      "useIssueTrackerStore must be used inside <IssueTrackerStoreProvider> (mounted in AppLayout).",
    );
  }
  return store;
}
