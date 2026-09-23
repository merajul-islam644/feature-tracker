// Hardcoded roster of the people who joined this repo — single source
// of truth for the Members page. Deliberately NOT Blocks IAM data: the
// page is a portfolio-style showcase where each card carries a bio the
// IAM user record doesn't have. To add someone, append one entry here;
// the page grid and sidebar need no changes.
//
// The initials avatar is derived from `name` (see Avatar's
// getInitials fallback), so no photo files are required — add an
// `avatarUrl` field and pass it as the Avatar's `src` if photos are
// ever wanted.

export interface Member {
  /** Stable key for React lists. */
  id: string;
  /** Full display name — also drives the initials avatar. */
  name: string;
  /** Optional one-line role shown under the name (e.g. "Software Engineer"). */
  role?: string;
  /** The caption shown underneath the pic. */
  bio: string;
  /**
   * The IAM user id (OIDC `sub`) of the same person, when they have an
   * account on this workspace. Profile pictures resolve via this id in
   * the shared `useProfilePics` map — without it the initials fallback
   * renders. Optional because not every portfolio entry corresponds to
   * an IAM user.
   */
  iamUserId?: string;
}

export const MEMBERS: Member[] = [
  {
    id: "meraj-zoarder",
    name: "Meraj Zoarder",
    role: "Software Engineer",
    bio: "I am a software engineer, currently working on Blocks OS — don't hesitate to reach out.",
    // Map the portfolio entry to the manager IAM account on this workspace
    // so the picture uploaded in Settings shows up on the Members grid.
    iamUserId: "41a74053-2c79-4fd5-aab3-90abce656a1d",
  },
];
