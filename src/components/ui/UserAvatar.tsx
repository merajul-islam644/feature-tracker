// Avatar that renders the member's real profile picture everywhere.
//
// One shared component for every people-surface in the app (chat roster,
// thread header, announcements, members grid, topbar, profile/settings
// pages): it resolves userId → storage fileId via the workspace-wide
// `useProfilePics` map, then fileId → provider-signed URL via
// `useFileDownloadUrl` (both TanStack-cached, so N avatars showing the
// same person cost one row-list and one files.get between them). While
// either lookup is in flight — or the member never uploaded a picture —
// the initials fallback from the plain `<Avatar>` renders.

import { Avatar } from "@/components/ui/avatar";
import { useFileDownloadUrl, useProfilePics } from "@/lib/blocks/hooks";

interface UserAvatarProps {
  /** IAM user id — the key into the profile-pictures map. */
  userId: string | undefined;
  /** Fallback label; also the `<img>` alt when a picture renders. */
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function UserAvatar({ userId, name, size = "md", className }: UserAvatarProps) {
  const pics = useProfilePics();
  const fileId = userId ? pics.data?.get(userId)?.imageFileId ?? null : null;
  const url = useFileDownloadUrl(fileId);
  return <Avatar name={name} src={url.data} size={size} className={className} />;
}
