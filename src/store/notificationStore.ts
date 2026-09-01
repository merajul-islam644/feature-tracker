import { create } from "zustand";

export interface Notification {
  id: string;
  title: string;
  body: string;
  createdAt: string; // ISO
  read: boolean;
}

// Seeded with a few sample notifications so the bell + panel have something
// to render. In a real app these would come from the backend.
const seedNotifications: Notification[] = [
  {
    id: "n1",
    title: "Welcome to Feature Tracker",
    body: "Get started by creating your first project.",
    createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(), // 30m ago
    read: false,
  },
  {
    id: "n2",
    title: "New feature added",
    body: "Authentication has 2 flows ready to review.",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(), // 3h ago
    read: false,
  },
  {
    id: "n3",
    title: "Demo reminder",
    body: "Demo mode — any non-empty credentials work for sign-in.",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), // 1d ago
    read: true,
  },
];

interface NotificationState {
  items: Notification[];
  markAllRead: () => void;
  markRead: (id: string) => void;
  clear: () => void;
}

export const useNotificationStore = create<NotificationState>()((set) => ({
  items: seedNotifications,
  markAllRead: () =>
    set((s) => ({ items: s.items.map((n) => ({ ...n, read: true })) })),
  markRead: (id) =>
    set((s) => ({
      items: s.items.map((n) => (n.id === id ? { ...n, read: true } : n)),
    })),
  clear: () => set({ items: [] }),
}));

export function unreadCount(items: Notification[]): number {
  return items.filter((n) => !n.read).length;
}

export function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
