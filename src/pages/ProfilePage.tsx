import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useToast } from "@/hooks/useToast";
import {
  Card,
  CardContent,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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
      <header>
        <h1 className="text-2xl font-semibold text-foreground">Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your account information.
        </p>
      </header>

      <section aria-labelledby="profile-info-heading">
        <Card>
          <CardTitle id="profile-info-heading" className="sr-only">
            Profile information
          </CardTitle>
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
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  User ID
                </dt>
                <dd className="mt-1 break-all text-sm font-mono text-foreground">
                  {currentUser.id}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Joined
                </dt>
                <dd className="mt-1 text-sm text-foreground">
                  {formatRelativeDate(currentUser.createdAt)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Last updated
                </dt>
                <dd className="mt-1 text-sm text-foreground">
                  {formatRelativeDate(currentUser.updatedAt)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Roles
                </dt>
                <dd className="mt-1 text-sm text-foreground">
                  {currentUser.roles.length > 0
                    ? currentUser.roles.map((r) => (
                        <code
                          key={r}
                          className="mr-1 rounded bg-muted px-1.5 py-0.5 text-xs font-mono"
                        >
                          {r}
                        </code>
                      ))
                    : "—"}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
