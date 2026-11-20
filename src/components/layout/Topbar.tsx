import { useNavigate } from "react-router-dom";
import { LogOut, User as UserIcon } from "lucide-react";
import { UserAvatar } from "@/components/ui/UserAvatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSidebar } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/useAuth";
import { NavToggle } from "./AppSidebar";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { NotificationBell } from "./NotificationBell";
import { OrgSwitcher } from "./OrgSwitcher";
import { ThemeToggler } from "./ThemeToggler";

export function Topbar() {
  const { currentUser, logout } = useAuth();
  // Collapsed-mode toggle slot — when the icon rail can't fit the
  // sidebar's own header toggle, the expand control moves here (the
  // topbar's left edge). Hidden entirely in expanded mode where the
  // sidebar header owns the control.
  const { state } = useSidebar();
  const navigate = useNavigate();

  if (!currentUser) return null;

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-border bg-surface px-4 md:px-6">
      {/* Left: collapsed-mode expand control (red-marked slot) + brand */}
      <div className="flex items-center gap-2">
        {state === "collapsed" && <NavToggle />}
      </div>

      {/* Right: utility icons + profile avatar */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-0.5">
          {/* Announcements broadcast entry moved to the Dashboard's
              top-right pill (see `DashboardPage`). The topbar keeps
              the rest of the utility chrome — language, notifications,
              theme — and intentionally drops the speaker icon to avoid
              two entry points for the same surface. */}
          {/* Org context switcher leads the utility chrome (user
              directive: left of the language switcher) — it's the
              broadest context control, so it sits first; renders
              nothing when the user has no org memberships. */}
          <OrgSwitcher />
          <LanguageSwitcher />
          <NotificationBell />
          <ThemeToggler />
        </div>
        <Separator
          orientation="vertical"
          className="mx-1 hidden h-5 sm:block"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Open user menu"
              className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <UserAvatar userId={currentUser.id} name={currentUser.name} size="md" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="space-y-0.5">
              <div className="truncate font-semibold capitalize text-foreground">
                {currentUser.name}
              </div>
              {currentUser.email && (
                <div
                  className="truncate text-xs font-normal text-muted-foreground"
                  title={currentUser.email}
                >
                  {currentUser.email}
                </div>
              )}
              {currentUser.roles.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {currentUser.roles.map((r) => (
                    <span
                      key={r}
                      className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
                    >
                      {r}
                    </span>
                  ))}
                </div>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => navigate("/profile")}
              className="flex items-center gap-2"
            >
              <UserIcon className="h-4 w-4" aria-hidden="true" />
              <span>Profile</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={handleLogout}
              className="text-destructive focus:text-destructive"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
