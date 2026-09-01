import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Avatar } from "@/components/ui/avatar";
import { useToast } from "@/hooks/useToast";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatRelativeDate } from "@/lib/utils";

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
    </div>
  );
}
