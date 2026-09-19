import { Bell } from "lucide-react";
import { useNavigate } from "react-router-dom";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useNotificationInbox,
  formatRelative,
  formatExact,
  actionVisual,
} from "@/lib/blocks/notifier";

export function NotificationBell() {
  const navigate = useNavigate();
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
          {items.length > 0 && (
            <Button
              variant="link"
              size="sm"
              onClick={markAllRead}
              className="h-7 px-2 py-1 text-xs font-medium"
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
            {items.map((n) => {
              const { Icon, tone, ring } = actionVisual(n.context, n.action);
              return (
                <DropdownMenuItem
                  key={n.id}
                  onSelect={() => {
                    // Mark read on click AND navigate to the details
                    // page. The details page also marks read on mount
                    // (idempotent), so deep links to unread entries
                    // behave the same way.
                    markRead(n.id);
                    navigate(`/notifications/${n.id}`);
                  }}
                  className="flex items-start gap-3 px-3 py-2"
                >
                  {/* Context-aware action icon. Reads carry the same
                      tone but lower opacity so the row visually fades
                      without changing shape. */}
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${ring} ${
                      n.read ? "opacity-50" : ""
                    }`}
                  >
                    <Icon
                      className={`h-3.5 w-3.5 ${tone}`}
                      aria-hidden={true}
                    />
                  </span>

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
                      {/* Hover the relative label to see the exact
                          timestamp. Wraps the label in a Radix trigger;
                          keeps keyboard accessibility intact. */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            tabIndex={0}
                            className="shrink-0 cursor-default text-xs text-muted-foreground outline-none"
                          >
                            {formatRelative(n.createdAt)}
                          </span>
                        </TooltipTrigger>
                        {formatExact(n.createdAt) ? (
                          <TooltipContent side="left">
                            {formatExact(n.createdAt)}
                          </TooltipContent>
                        ) : null}
                      </Tooltip>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {n.body}
                    </span>
                  </span>
                </DropdownMenuItem>
              );
            })}
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