// User-defined verification scopes.
//
// The shipped set of checks (page_load, navigation, etc.) lives in
// `src/data/issueTrackerConstants.ts` and is read-only. This hook
// owns the per-user ADDITIONAL scopes the user defines themselves —
// the labels and descriptions the AI uses as guidance when running
// a verification pass.
//
// Storage choice (v2): the canonical store is `UserPreference.customChecksJson`
// in Blocks Data (one row per user). The cloud write fires
// fire-and-forget after every mutation; a `lattice.mirror.userPreference.v1`
// mirror under the same shape is read synchronously on first paint so
// the page boots before the cloud query resolves. The `customChecks`
// field on `UserPreference` is `unknown[]` in the cloud shape so the
// hook's typed surface still uses `CustomVerificationCheck[]`.

import { useCallback, useEffect, useState } from "react";
import {
  useUserPreference,
  useSaveUserPreference,
} from "@/lib/blocks/hooks";

export interface CustomVerificationCheck {
  /** Stable id, prefixed `custom_` so it never collides with a
   *  built-in `VerificationCheckId`. Generated from the label at
   *  create time (slug + nanoid fallback for collisions). */
  id: string;
  label: string;
  description: string;
  recommended: boolean;
  createdAt: string;
}

const STORAGE_MIRROR_KEY = "lattice.mirror.customChecks.v1";

function readStoredChecks(): CustomVerificationCheck[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_MIRROR_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.every(
        (x) =>
          x !== null &&
          typeof x === "object" &&
          typeof (x as CustomVerificationCheck).id === "string" &&
          typeof (x as CustomVerificationCheck).label === "string",
      )
    ) {
      return parsed as CustomVerificationCheck[];
    }
  } catch {
    // Corrupt JSON / private mode — fall through to empty.
  }
  return [];
}

function writeStoredChecks(checks: CustomVerificationCheck[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_MIRROR_KEY, JSON.stringify(checks));
  } catch {
    // best-effort
  }
}

function asCustomChecks(value: unknown): CustomVerificationCheck[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (x): x is CustomVerificationCheck =>
      x !== null &&
      typeof x === "object" &&
      typeof (x as CustomVerificationCheck).id === "string" &&
      typeof (x as CustomVerificationCheck).label === "string",
  );
}

// Slugify a label into an id-safe fragment: lowercase, replace
// non-alphanumerics with `-`, trim leading/trailing dashes, cap at
// 40 chars. The full id is `custom_<slug>` so it can't collide with
// any built-in `VerificationCheckId`.
function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// Cryptographically-random suffix for collision-safe ids. We avoid
// pulling in `nanoid` for one use; this is short enough to read.
function randomSuffix(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}

export function makeCustomCheckId(
  label: string,
  existingIds: ReadonlySet<string>,
): string {
  const slug = slugify(label) || "scope";
  let candidate = `custom_${slug}`;
  if (!existingIds.has(candidate)) return candidate;
  // Collision — append a random suffix and try again. Two retries
  // is overwhelmingly enough given the namespace.
  for (let i = 0; i < 3; i++) {
    candidate = `custom_${slug}-${randomSuffix()}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `custom_${slug}-${Date.now()}`;
}

interface UseCustomVerificationChecksResult {
  customChecks: CustomVerificationCheck[];
  addCustomCheck: (input: {
    label: string;
    description: string;
    recommended: boolean;
  }) => CustomVerificationCheck;
  updateCustomCheck: (
    id: string,
    patch: Partial<Pick<CustomVerificationCheck, "label" | "description" | "recommended">>,
  ) => void;
  deleteCustomCheck: (id: string) => void;
}

export function useCustomVerificationChecks(): UseCustomVerificationChecksResult {
  const prefQuery = useUserPreference();
  const savePref = useSaveUserPreference();
  // Synchronous seed from the localStorage mirror so the page boots
  // before the cloud query resolves.
  const [customChecks, setCustomChecks] = useState<CustomVerificationCheck[]>(
    () => readStoredChecks(),
  );

  // Cross-tab sync — listen for `storage` events so another tab's
  // add/delete shows up here without a refresh.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_MIRROR_KEY) return;
      setCustomChecks(readStoredChecks());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Replace local state + mirror once the cloud query resolves.
  useEffect(() => {
    if (!prefQuery.data) return;
    const fromCloud = asCustomChecks(prefQuery.data.customChecks);
    setCustomChecks(fromCloud);
    writeStoredChecks(fromCloud);
  }, [prefQuery.data]);

  const persist = useCallback(
    (next: CustomVerificationCheck[]) => {
      setCustomChecks(next);
      writeStoredChecks(next);
      void savePref.mutateAsync({ customChecks: next as unknown[] });
    },
    [savePref],
  );

  const addCustomCheck = useCallback(
    (input: { label: string; description: string; recommended: boolean }) => {
      const trimmedLabel = input.label.trim();
      if (!trimmedLabel) {
        throw new Error("Label is required.");
      }
      // Read the latest list — the closure over `customChecks` may
      // be stale across rapid adds.
      const existing = readStoredChecks();
      const existingIds = new Set(existing.map((c) => c.id));
      const id = makeCustomCheckId(trimmedLabel, existingIds);
      const next: CustomVerificationCheck = {
        id,
        label: trimmedLabel,
        description: input.description.trim(),
        recommended: input.recommended,
        createdAt: new Date().toISOString(),
      };
      persist([...existing, next]);
      return next;
    },
    [persist],
  );

  const updateCustomCheck = useCallback(
    (
      id: string,
      patch: Partial<
        Pick<CustomVerificationCheck, "label" | "description" | "recommended">
      >,
    ) => {
      const existing = readStoredChecks();
      const next = existing.map((c) =>
        c.id === id
          ? {
              ...c,
              ...(patch.label !== undefined ? { label: patch.label.trim() } : {}),
              ...(patch.description !== undefined
                ? { description: patch.description.trim() }
                : {}),
              ...(patch.recommended !== undefined
                ? { recommended: patch.recommended }
                : {}),
            }
          : c,
      );
      persist(next);
    },
    [persist],
  );

  const deleteCustomCheck = useCallback(
    (id: string) => {
      const existing = readStoredChecks();
      persist(existing.filter((c) => c.id !== id));
    },
    [persist],
  );

  return {
    customChecks,
    addCustomCheck,
    updateCustomCheck,
    deleteCustomCheck,
  };
}
