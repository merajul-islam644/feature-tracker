import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { seedUser } from "@/lib/seed";

// Local shape definition — see src/types/Shemastructure/User.ts for the
// canonical schema, which is intentionally not imported here.
interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
}

interface AuthState {
  currentUser: User | null;
  isHydrated: boolean;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
  setHydrated: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      currentUser: null,
      isHydrated: false,

      login: async (email, password) => {
        const trimmedEmail = email.trim();
        if (!trimmedEmail) return { ok: false, error: "Email is required" };
        if (!password) return { ok: false, error: "Password is required" };

        // Simulated network delay
        await new Promise((r) => setTimeout(r, 300));

        // Treat any non-empty credentials as valid; assign the seeded demo user
        // but use the email the user typed so the profile reflects their input.
        const user: User = {
          ...seedUser,
          email: trimmedEmail,
          name: deriveNameFromEmail(trimmedEmail) || seedUser.name,
          updatedAt: new Date().toISOString(),
        };
        set({ currentUser: user });
        return { ok: true };
      },

      logout: () => {
        set({ currentUser: null });
      },

      setHydrated: () => set({ isHydrated: true }),
    }),
    {
      name: "ft-auth",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ currentUser: state.currentUser }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated();
      },
    }
  )
);

function deriveNameFromEmail(email: string): string | null {
  const local = email.split("@")[0];
  if (!local) return null;
  // Convert e.g. "john.doe" -> "John Doe"
  return local
    .split(/[._\-+]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}