import { Users } from "lucide-react";
import { useT } from "@/lib/blocks/i18n";
import { MEMBERS } from "@/data/members";
import { PageHeader } from "@/shared/ui/PageHeader";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { Card, CardContent } from "@/components/ui/card";

// Portfolio-style showcase of the people who joined this repo. The
// roster lives in `src/data/members.ts` (see its header comment for the
// add-a-member runbook); this page only handles presentation.
//
// `useT` looks up against the loaded `common` module. Page-level keys
// live under the `members.*` namespace, mirroring `settings.*`.
export function MembersPage() {
  const t = useT();

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Users className="h-5 w-5" aria-hidden="true" />
            {t("members.title", "Members")}
          </span>
        }
        subtitle={t(
          "members.description",
          "The people behind this repo.",
        )}
      />

      <section aria-label={t("members.title", "Members")}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {MEMBERS.map((member) => (
            <Card key={member.id} className="overflow-hidden">
              <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
                {/* Sized up past the UserAvatar default via className. The
                    initials fallback renders from `name` until the same
                    member uploads a picture — which we resolve via the
                    IAM user id when the portfolio entry maps to one. */}
                <UserAvatar
                  userId={member.iamUserId}
                  name={member.name}
                  className="h-24 w-24 text-2xl"
                />
                <div>
                  <h3 className="text-base font-semibold text-foreground">
                    {member.name}
                  </h3>
                  {member.role && (
                    <p className="mt-0.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {member.role}
                    </p>
                  )}
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {member.bio}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
