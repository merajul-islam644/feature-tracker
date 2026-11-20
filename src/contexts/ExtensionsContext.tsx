// React bridge over the in-memory `extensionRegistry`. Subscribes to
// the registry's pub/sub via `useSyncExternalStore` so any component
// re-renders when an extension is installed / enabled / disabled /
// removed.
//
// Exposes the install pipeline (`installFromFile`) and the per-extension
// mutators that route through localStorage through the registry, then
// refresh the in-memory list so the UI updates.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { InstalledExtension } from "@/lib/extensions/types";
import {
  extensionRegistry,
  installFromFile,
  setExtensionEnabled,
  uninstallExtension,
} from "@/lib/extensions/registry";
import { useAuth } from "@/hooks/useAuth";

interface ExtensionsContextValue {
  installed: InstalledExtension[];
  install: (file: File) => Promise<
    | { ok: true; extension: InstalledExtension }
    | { ok: false; error: string }
  >;
  uninstall: (id: string) => void;
  setEnabled: (id: string, enabled: boolean) => { ok: boolean; error?: string };
  getExtension: (id: string) => InstalledExtension | null;
}

const ExtensionsContext = createContext<ExtensionsContextValue | null>(null);

export function ExtensionsProvider({ children }: { children: ReactNode }) {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";

  // useSyncExternalStore needs a stable subscribe + getSnapshot. We
  // bind them to the current user id so switching accounts refreshes
  // the list.
  const subscribe = useCallback(
    (listener: () => void) => extensionRegistry.subscribe(listener),
    [],
  );
  const getSnapshot = useCallback(
    () => extensionRegistry.list(userId),
    [userId],
  );
  const installed = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // On mount + whenever userId changes, reload from localStorage.
  useEffect(() => {
    if (!userId) return;
    extensionRegistry.load(userId);
  }, [userId]);

  const value = useMemo<ExtensionsContextValue>(
    () => ({
      installed,
      install: async (file: File) => {
        if (!userId) {
          return { ok: false, error: "Not signed in." };
        }
        const result = await installFromFile(file, userId);
        if (result.ok) {
          extensionRegistry.refresh(userId);
        }
        return result;
      },
      uninstall: (id: string) => {
        if (!userId) return;
        uninstallExtension(userId, id);
        extensionRegistry.refresh(userId);
      },
      setEnabled: (id: string, enabled: boolean) => {
        if (!userId) return { ok: false, error: "Not signed in." };
        const result = setExtensionEnabled(userId, id, enabled);
        extensionRegistry.refresh(userId);
        return result.ok
          ? { ok: true }
          : { ok: false, error: result.error };
      },
      getExtension: (id: string) =>
        userId ? extensionRegistry.get(userId, id) : null,
    }),
    [installed, userId],
  );

  return (
    <ExtensionsContext.Provider value={value}>
      {children}
    </ExtensionsContext.Provider>
  );
}

/** Hook for reading/manipulating installed extensions from any
 *  component mounted inside `<ExtensionsProvider>`. */
export function useExtensions(): ExtensionsContextValue {
  const ctx = useContext(ExtensionsContext);
  if (!ctx) {
    throw new Error(
      "useExtensions must be used inside <ExtensionsProvider>",
    );
  }
  return ctx;
}

/** Lightweight hook that returns only the list — for components that
 *  just need to render activity-bar items. */
export function useInstalledExtensions(): InstalledExtension[] {
  return useExtensions().installed;
}