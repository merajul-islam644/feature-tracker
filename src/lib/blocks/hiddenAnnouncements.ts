// Per-user "hide" set for workspace announcements.
//
// A manager's `Trash` action truly deletes the row server-side so every
// member loses it. A non-manager's "delete from my account" should only
// suppress the announcement on this user's view — the row stays on the
// server and other members (including managers who posted it) keep
// seeing it.
//
// Storage choice (v1): `localStorage` keyed by IAM user id. The hidden
// set therefore persists across reloads and tabs but not across
// browsers — "from his account" semantics within a single device. If
// a later release wants device-independent hide state, the right move
// is a per-user Blocks collection (same pattern as DirectMessage's
// `readAt` — see blocks/data/schemas/DirectMessage.json), with a
// `userId === me` filter and the schema deployed via
// `blocks data sync`. The `useHiddenAnnouncementIds` signature
// stays the same in that migration — only the read/write helpers
// change underneath.

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";

const STORAGE_KEY_PREFIX = "hiddenAnnouncements:v1:";
// Same-tab subscribers don't see the browser's `storage` event (it
// only fires for OTHER tabs), so we self-dispatch on the same window
// when our own helper writes.
const STORAGE_EVENT = "hiddenAnnouncements:changed";

function storageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

function read(userId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((v): v is string => typeof v === "string"),
    );
  } catch {
    // Corrupt JSON / quota / private-browsing quota — fail closed:
    // don't surface a partial set, just treat as empty.
    return new Set();
  }
}

function write(userId: string, ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      storageKey(userId),
      JSON.stringify(Array.from(ids)),
    );
  } catch {
    // Quota / unavailable storage — best-effort, fail open.
  }
}

/**
 * The current user's set of announcement ids they've hidden from
 * their dashboard. Stable across re-renders until the underlying
 * localStorage changes (either same-tab via the helper, or another
 * tab via the browser's `storage` event).
 */
export function useHiddenAnnouncementIds(): Set<string> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id;
  const [ids, setIds] = useState<Set<string>>(() =>
    userId ? read(userId) : new Set(),
  );

  // (Re-)read from localStorage whenever the signed-in user changes —
  // different identity, different hide-set. Without this, a sign-out
  // followed by a sign-in as a different user would briefly show the
  // previous user's hidden state until the next write.
  useEffect(() => {
    setIds(userId ? read(userId) : new Set());
  }, [userId]);

  // Cross-component / cross-tab sync. Same-tab writes go through the
  // helper, which dispatches our custom event. Cross-tab writes go
  // through the browser's `storage` event.
  useEffect(() => {
    // Bound to a non-nullable local so the closures below stay
    // inside the narrowed branch — `function` declarations are
    // hoisted and would otherwise see `userId: string | undefined`.
    if (!userId) return;
    const uid = userId;
    const refresh = () => {
      setIds(read(uid));
    };
    const handleStorage = (e: StorageEvent) => {
      if (e.key === storageKey(uid)) refresh();
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener(STORAGE_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(STORAGE_EVENT, refresh);
    };
  }, [userId]);

  return ids;
}

/**
 * Mark an announcement as hidden for the current user. Idempotent —
 * re-hiding an already-hidden id is a no-op. Notifies same-tab
 * subscribers via the custom event so any other
 * `useHiddenAnnouncementIds` consumer re-renders immediately.
 */
export function useHideAnnouncement(): (
  announcementId: string,
) => void {
  const { currentUser } = useAuth();
  const userId = currentUser?.id;
  return useCallback(
    (announcementId: string) => {
      if (!userId) return;
      const next = new Set(read(userId));
      next.add(announcementId);
      write(userId, next);
      window.dispatchEvent(new Event(STORAGE_EVENT));
    },
    [userId],
  );
}

/**
 * Reverse a hide — make a previously-hidden announcement visible
 * again on the current user's dashboard. Idempotent (un-hiding a
 * non-hidden id is a no-op).
 *
 * The auto-open flow uses this to surface a Repost even when the user
 * had previously hidden that announcement: a Repost is a fresh
 * delivery, and the user's old "I'm done with this" intent shouldn't
 * silence the new arrival. Without this, a user who hid an
 * announcement never sees its bumps — the dialog pops but the
 * panel's `!hiddenIds.has(...)` filter excludes the row and the
 * member sees no content inside.
 */
export function useUnhideAnnouncement(): (
  announcementId: string,
) => void {
  const { currentUser } = useAuth();
  const userId = currentUser?.id;
  return useCallback(
    (announcementId: string) => {
      if (!userId) return;
      const next = new Set(read(userId));
      next.delete(announcementId);
      write(userId, next);
      window.dispatchEvent(new Event(STORAGE_EVENT));
    },
    [userId],
  );
}
