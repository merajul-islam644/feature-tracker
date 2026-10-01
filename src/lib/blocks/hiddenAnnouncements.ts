// Per-user "hide" set for workspace announcements.
//
// A manager's `Trash` action truly deletes the row server-side so every
// member loses it. A non-manager's "delete from my account" should only
// suppress the announcement on this user's view — the row stays on the
// server and other members (including managers who posted it) keep
// seeing it.
//
// Storage choice (v2): a per-user Blocks Data row in `HiddenAnnouncement`
// (one row per `(userId, announcementId)`). The set is read+written via
// `useHiddenAnnouncements` / `useHideAnnouncement` / `useUnhideAnnouncement`
// — the same names as the v1 localStorage hooks so call sites
// (`AnnouncementsPanel`, notifier auto-open) don't change. The custom
// `storage` event plumbing is gone — TanStack Query invalidation handles
// cross-component refresh.
//
// A `lattice.mirror.hiddenAnnouncements.v1` mirror is read synchronously
// on first paint so the panel renders before the cloud round-trip
// resolves.

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  useHiddenAnnouncements as useHiddenAnnouncementSet,
  useHideAnnouncementMutation,
  useUnhideAnnouncementMutation,
} from "./hooks";

const MIRROR_KEY_PREFIX = "lattice.mirror.hiddenAnnouncements.v1:";

function mirrorKey(userId: string): string {
  return `${MIRROR_KEY_PREFIX}${userId}`;
}

function readMirror(userId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(mirrorKey(userId));
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((v): v is string => typeof v === "string"),
    );
  } catch {
    return new Set();
  }
}

function writeMirror(userId: string, ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      mirrorKey(userId),
      JSON.stringify(Array.from(ids)),
    );
  } catch {
    // best-effort
  }
}

/**
 * The current user's set of announcement ids they've hidden from
 * their dashboard. Synchronously seeded from the localStorage mirror
 * so first paint matches the last-known state, then hydrated from
 * `useHiddenAnnouncements` (the cloud read) once that resolves.
 */
export function useHiddenAnnouncementIds(): Set<string> {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  const cloud = useHiddenAnnouncementSet();
  const [mirror, setMirror] = useState<Set<string>>(
    () => (userId ? readMirror(userId) : new Set()),
  );

  // Reset mirror on user change so sign-out / sign-in as a different
  // user doesn't briefly show the previous user's state.
  useEffect(() => {
    setMirror(userId ? readMirror(userId) : new Set());
  }, [userId]);

  // Mirror every cloud update so the next reload reads the right
  // value before the cloud query resolves.
  useEffect(() => {
    if (userId && cloud.data) writeMirror(userId, cloud.data);
  }, [userId, cloud.data]);

  // Prefer cloud when loaded; fall back to mirror during the gap.
  if (cloud.data) return cloud.data;
  return mirror;
}

/**
 * Mark an announcement as hidden for the current user. Fire-and-forget
 * mutation; the mirror updates on the next render via TanStack Query
 * invalidation. Notifies same-tab subscribers through the cache refresh.
 */
export function useHideAnnouncement(): (
  announcementId: string,
) => void {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  const hide = useHideAnnouncementMutation();
  return useCallback(
    (announcementId: string) => {
      if (!userId) return;
      hide.mutate({ announcementId });
    },
    [userId, hide],
  );
}

/**
 * Reverse a hide — make a previously-hidden announcement visible
 * again on the current user's dashboard. The auto-open flow uses this
 * to surface a Repost even when the user had previously hidden that
 * announcement: a Repost is a fresh delivery, and the user's old "I'm
 * done with this" intent shouldn't silence the new arrival.
 */
export function useUnhideAnnouncement(): (
  announcementId: string,
) => void {
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? "";
  const unhide = useUnhideAnnouncementMutation();
  return useCallback(
    (announcementId: string) => {
      if (!userId) return;
      unhide.mutate({ announcementId });
    },
    [userId, unhide],
  );
}
