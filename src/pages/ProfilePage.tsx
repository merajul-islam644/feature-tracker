import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/useToast";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { blocksClient } from "@/lib/blocks/client";
import { formatRelativeDate } from "@/lib/utils";

export function ProfilePage() {
  const { currentUser } = useAuth();
  const toast = useToast();

  useEffect(() => {
    toast.info("Profile loaded successfully.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One-time self-grant of the `manager` role. The Blocks CLI command
  // `blocks iam users access grant` 500s in this tenant (server-side bug
  // we can't fix from here), so we run the equivalent SDK call from the
  // browser. We need to read the user's existing roles first so we don't
  // clobber anything (e.g. someone promoted to admin elsewhere).
  const [granting, setGranting] = useState(false);

  const grantManagerRole = async () => {
    if (!currentUser) return;
    setGranting(true);
    try {
      const lookup = await blocksClient.iam.users.get(currentUser.id);
      const existing =
        (lookup as { data?: { roles?: string[] } }).data?.roles ?? [];
      if (existing.includes("manager")) {
        toast.info("You already hold the manager role.");
        return;
      }
      await blocksClient.iam.users.updateAccess({
        userId: currentUser.id,
        roles: Array.from(new Set([...existing, "manager"])),
      });
      toast.success("Manager role granted. Notifications will reach you.");
    } catch (err) {
      toast.error(
        `Could not grant role: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      setGranting(false);
    }
  };

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
          <CardHeader>
            <CardTitle id="profile-info-heading" className="sr-only">
              Profile information
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-start gap-5">
              <Avatar name={currentUser.name} size="lg" />
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
            </dl>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="role-tools-heading">
        <Card>
          <CardHeader>
            <CardTitle id="role-tools-heading" className="text-base">
              Role tools
            </CardTitle>
            <CardDescription>
              Demo aid for the notification system. Grants the{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                manager
              </code>{" "}
              Blocks IAM role to your account so project/feature creates
              land in your inbox. Run once.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="default"
              onClick={() => void grantManagerRole()}
              disabled={granting}
            >
              <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" />
              {granting ? "Granting…" : "Grant me the manager role"}
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
