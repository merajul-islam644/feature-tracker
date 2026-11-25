// Teams/GitHub-style profile hovercard. Hovering any wrapped profile
// picture surfaces the member's identity from the live IAM roster:
// large avatar, name, role badge, and email. Reusable — wrap any
// trigger element (typically a UserAvatar) as the sole child.
//
// Rendered through the app's shared Tooltip primitives, so the
// TooltipProvider mounted in AppLayout drives the hover delay; content
// is informational only (no interactive controls inside — hovercards
// close the moment the pointer leaves, so buttons in there would be
// flaky).

import { Mail } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";
import { UserAvatar } from "./UserAvatar";
import { useAllJoinedUsers } from "@/lib/blocks/users";

interface ProfileHovercardProps {
  userId: string;
  /** Shown until the IAM roster resolves the real name. */
  fallbackName?: string;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}

export function ProfileHovercard({
  userId,
  fallbackName,
  children,
  side = "top",
}: ProfileHovercardProps) {
  const members = useAllJoinedUsers().data ?? [];
  const info = members.find((m) => m.id === userId);
  const displayName = info?.name ?? fallbackName ?? "Member";

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} sideOffset={8} className="w-64 p-0">
        <div className="flex items-center gap-3 p-3">
          <UserAvatar
            userId={userId}
            name={displayName}
            size="md"
            className="h-12 w-12 shrink-0"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">
              {displayName}
            </p>
            <span className="mt-0.5 inline-block rounded-sm border border-border bg-muted px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {info?.role ?? "member"}
            </span>
          </div>
        </div>
        {info?.email && (
          <div className="flex items-center gap-2 border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
            <Mail className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{info.email}</span>
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
