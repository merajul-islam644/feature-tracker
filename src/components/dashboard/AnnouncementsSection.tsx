// Dashboard announcements — the manager's broadcast channel.
//
// A manager ("we are going to prod today") posts here; every invited
// member sees the same newest-first list on their Dashboard. The
// composer and per-row delete controls render for managers only;
// the mutation hooks re-check the role server-call-side as
// defense-in-depth (same pattern as the tester guards).
//
// This file is the *inline* Card-framed mount on the Dashboard. The
// inner content (composer + list + announcement cards) lives in
// `AnnouncementsPanel.tsx` so the same renderer can also be opened
// from the topbar speaker button — see `AnnouncementsDialog.tsx`.

import { Megaphone } from "lucide-react";
import { useT } from "@/lib/blocks/i18n";
import { useIsRole } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { AnnouncementsPanel } from "./AnnouncementsPanel";
import { useAnnouncements } from "@/lib/blocks/hooks";

export function AnnouncementsSection() {
  const t = useT();
  const isManager = useIsRole("manager");
  const announcementsQuery = useAnnouncements();
  const announcements = announcementsQuery.data ?? [];

  return (
    <section aria-labelledby="announcements-heading">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle
            id="announcements-heading"
            className="flex items-center gap-2 text-base font-semibold"
          >
            <Megaphone className="h-4 w-4 text-primary" aria-hidden="true" />
            {t("announcements.title", "Announcements")}
          </CardTitle>
          {/* Total-count badge is a manager-only affordance — members
              just read the list, the tally is posting bookkeeping. */}
          {isManager && announcements.length > 0 && (
            <Badge variant="muted">{announcements.length}</Badge>
          )}
        </CardHeader>
        <Separator />
        <CardContent className="p-0">
          <AnnouncementsPanel />
        </CardContent>
      </Card>
    </section>
  );
}
