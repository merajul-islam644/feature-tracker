import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Compass,
  Home,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// 404 page — see DESIGN-APP-v1.md §9.
//
// Centered hero with a large 404 mark, a single sentence of guidance,
// and two CTAs (Back / Home). Kept entirely self-contained: no data
// hooks, no auth gating. If a user lands here from a stale link or
// mistyped URL they should see something dignified — not a blank page
// and not a scary stack trace.
export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        {/* Large 404 — uses the signature indigo→violet gradient so the
            page reads as part of the app even at a glance. */}
        <p
          aria-hidden="true"
          className="bg-gradient-to-r from-indigo-500 to-violet-600 bg-clip-text text-7xl font-bold tracking-tight text-transparent sm:text-8xl"
        >
          404
        </p>

        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">
          The page you're looking for doesn't exist or was moved. Check the
          URL or head back to the dashboard.
        </p>

        {/* Two CTAs: Back (uses history) + Home. Back sits on the
            left in a subtle outline button, Home is the primary action. */}
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate(-1)}
            className="w-full sm:w-auto"
          >
            <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
            Go back
          </Button>
          <Button asChild className="w-full sm:w-auto">
            <Link to="/dashboard">
              <Home className="mr-2 h-4 w-4" aria-hidden="true" />
              Back to dashboard
            </Link>
          </Button>
        </div>

        {/* Secondary affordances: search-style suggestion block. The
            search button is a static link (no search route exists yet)
            so we render it as a passive hint rather than wiring it up
            to a dead click. */}
        <div className="mt-10 inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
          <Compass className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Try the sidebar navigation or the topbar search</span>
          <Search className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
