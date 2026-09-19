import { useEffect, useRef } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  InboxItem,
  useNotificationInbox,
  formatExact,
  formatRelative,
  actionVisual,
} from "@/lib/blocks/notifier";

/**
 * `/notifications/:notificationId` — full-detail view for a single
 * inbox entry. Reachable from the bell (clicking a row navigates here
 * AND marks the entry read) and from any deep link the user pastes.
 *
 * The page reads from the inbox query cache rather than calling the
 * notifier again — there's no SDK `getNotificationById`, the `mark-*`
 * endpoints are mutating, and the only read endpoint the SDK ships is
 * the paged `getNotifications` list. The 20-item inbox window is
 * enough for the click-from-bell path; for deep links to aged-out
 * notifications we surface a "not in your recent inbox" empty state
 * rather than try to refetch with a synthetic filter.
 */
export function NotificationDetailPage() {
  const { notificationId } = useParams<{ notificationId: string }>();
  const navigate = useNavigate();
  const { items, markRead } = useNotificationInbox();

  const item = notificationId
    ? items.find((n) => n.id === notificationId)
    : undefined;

  // Mark as read on entry. Fires once per `notificationId` — the
  // `markRead` ref is held in a `useRef` so the effect deps stay
  // `[notificationId]` only. Earlier versions listed `markRead` in
  // the deps too, and combined with `onSuccess` re-invalidating the
  // inbox query, that produced an infinite POST loop
  // (`ERR_INSUFFICIENT_RESOURCES`) before any single request could
  // complete. The bell click path also calls `markRead` synchronously
  // for an immediate badge drop; this effect's POST is the
  // idempotent server-side flip. The server tolerates repeated calls
  // for an already-read id.
  const markReadRef = useRef(markRead);
  markReadRef.current = markRead;
  useEffect(() => {
    if (!notificationId) return;
    markReadRef.current(notificationId);
  }, [notificationId]);

  if (!item) {
    return <NotFoundView onBack={() => navigate(-1)} />;
  }

  const { Icon, tone, ring } = actionVisual(item.context, item.action);
  const resourceHref = getResourceHref(item);

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(-1)}
          aria-label="Go back"
          className="mt-1"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Notification
          </p>
          <h1 className="mt-1 truncate text-2xl font-semibold text-foreground">
            {item.title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="capitalize">{item.context}</span> ·{" "}
            <span className="capitalize">{item.action}</span>
          </p>
        </div>
        <span
          aria-hidden="true"
          className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${ring}`}
        >
          <Icon className={`h-6 w-6 ${tone}`} aria-hidden={true} />
        </span>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Message</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed text-foreground">{item.body}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <DetailRow label="Actor" value={item.actorName} />
            <DetailRow
              label="When"
              value={
                <>
                  <span>{formatExact(item.createdAt)}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({formatRelative(item.createdAt)})
                  </span>
                </>
              }
            />
            {item.projectName ? (
              <DetailRow label="Project" value={item.projectName} />
            ) : null}
            {item.featureName ? (
              <DetailRow label="Feature" value={item.featureName} />
            ) : null}
            {item.flowName ? (
              <DetailRow label="Flow" value={item.flowName} />
            ) : null}
            {item.envSlug ? (
              <DetailRow
                label="Environment"
                value={<span className="font-mono">{item.envSlug}</span>}
              />
            ) : null}
            <DetailRow
              label="Status"
              value={
                item.read ? (
                  <span className="text-muted-foreground">Read</span>
                ) : (
                  <span className="font-medium text-foreground">Unread</span>
                )
              }
            />
          </dl>
        </CardContent>
      </Card>

      {resourceHref ? (
        <div className="flex justify-end">
          <Button asChild>
            <Link to={resourceHref}>Open {item.context} →</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm text-foreground">{value}</dd>
    </div>
  );
}

function NotFoundView({ onBack }: { onBack: () => void }) {
  return (
    <div className="space-y-6">
      <Button
        variant="ghost"
        size="icon"
        onClick={onBack}
        aria-label="Go back"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <span
            aria-hidden="true"
            className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
          >
            <Inbox className="h-6 w-6" aria-hidden={true} />
          </span>
          <h2 className="text-lg font-semibold text-foreground">
            Notification not found
          </h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            We could not find this notification in your recent inbox. It may
            have aged out of the 20-item window — open the bell to see what's
            still listed.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Where the "Open <context>" link on the details page should land.
 * Returns null when no useful href can be built (missing projectId or
 * a context the app doesn't currently render at a dedicated route).
 */
function getResourceHref(item: InboxItem): string | null {
  if (!item.projectId) return null;
  const base = `/projects/${item.projectId}`;
  if (item.context === "project") {
    return item.envSlug ? `${base}/${item.envSlug}` : base;
  }
  if (item.context === "feature" || item.context === "flow") {
    return item.envSlug ? `${base}/${item.envSlug}` : base;
  }
  if (item.context === "environment") {
    // Environment notifications only carry a slug — pick a sensible
    // default env if none is attached so the link still lands on a
    // valid page.
    return `${base}/${item.envSlug ?? "dev"}`;
  }
  return null;
}