import { useEffect } from "react";
import { UserCircle2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useToast } from "@/hooks/useToast";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { formatRelativeDate } from "@/lib/utils";

// Profile is read-only — roles are granted externally (via Blocks-OS
// admin tooling or `blocks iam users access grant` from the CLI), and
// `AuthProvider` re-fetches `currentUser.roles` on every visibility
// change + on a 5-minute background poll. So any role grant made
// outside the app shows up here automatically the next time the tab
// regains focus — no in-app grant button needed.

export function ProfilePage() {
  const { currentUser } = useAuth();
  const toast = useToast();

  useEffect(() => {
    toast.info("Profile loaded successfully.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!currentUser) return null;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300"
          >
            <UserCircle2 className="h-4 w-4" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Profile
          </h1>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Your account information and assigned roles.
        </p>
      </header>

      <section aria-labelledby="profile-info-heading">
        <Card>
          <CardHeader>
            <CardTitle id="profile-info-heading" className="text-base">
              Account
            </CardTitle>
            <CardDescription>
              Read-only identity block. Roles are granted outside the app.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-start gap-5">
              <UserAvatar userId={currentUser.id} name={currentUser.name} size="lg" />
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-lg font-semibold text-foreground">
                  {currentUser.name}
                </h3>
                <p className="truncate text-sm text-muted-foreground">
                  {currentUser.email}
                </p>
              </div>
            </div>

            <Separator className="my-6" />
            <dl className="grid gap-4 sm:grid-cols-2">
              <DetailItem label="User ID">
                <span className="break-all font-mono text-foreground">
                  {currentUser.id}
                </span>
              </DetailItem>
              <DetailItem label="Joined">
                {formatRelativeDate(currentUser.createdAt)}
              </DetailItem>
              <DetailItem label="Last updated">
                {formatRelativeDate(currentUser.updatedAt)}
              </DetailItem>
              <DetailItem label="Roles">
                {currentUser.roles.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {currentUser.roles.map((r) => (
                      <Badge key={r} variant="secondary" className="font-mono text-[10px]">
                        {r}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </DetailItem>
            </dl>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function DetailItem({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm text-foreground">{children}</dd>
    </div>
  );
}
