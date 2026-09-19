import { Bell, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import {
  useNotificationInbox,
  formatRelative,
} from "@/lib/blocks/notifier";

export function NotificationBell() {
  // `unread` and `total` come from the API-reported counts so the
  // badge stays accurate even when the notifier persists records the
  // List endpoint can't enumerate (a known platform quirk in this
  // tenant — `totalNotificationsCount: N, notifications: []`).
  const { items, isLoading, markRead, markAllRead, unread, total } =
    useNotificationInbox();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
          className="relative inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          {unread > 0 && (
            <span
              aria-hidden="true"
              className="absolute right-0.5 top-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground"
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 pb-2 pt-3">
          <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
          {unread > 0 && (
            <Button
              variant="link"
              size="sm"
              onClick={markAllRead}
              className="h-auto px-0 py-0 text-xs"
            >
              Mark all read
            </Button>
          )}
        </div>
        <DropdownMenuSeparator />
        {isLoading ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            Loading…
          </p>
        ) : items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            No notifications yet.
          </p>
        ) : (
          <div className="max-h-80 overflow-y-auto py-1">
            {items.map((n) => (
              <DropdownMenuItem
                key={n.id}
                onSelect={() => markRead(n.id)}
                className="flex items-start gap-3 px-3 py-2"
              >
                <span
                  aria-hidden="true"
                  className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                    n.read ? "bg-transparent" : "bg-primary"
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span
                      className={`truncate text-sm ${
                        n.read
                          ? "font-normal text-muted-foreground"
                          : "font-semibold text-foreground"
                      }`}
                    >
                      {n.title}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatRelative(n.createdAt)}
                    </span>
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {n.body}
                  </span>
                </span>
                {!n.read && (
                  <Check
                    className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
                    aria-hidden="true"
                  />
                )}
              </DropdownMenuItem>
            ))}
          </div>
        )}
        <DropdownMenuSeparator />
        <div className="px-3 py-2 text-center">
          <Badge variant="muted" className="font-normal">
            {total} total
          </Badge>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
