import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <p className="text-sm font-medium uppercase tracking-wider text-primary">
        404
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-foreground">
        Page not found
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        We couldn't find what you were looking for.
      </p>
      <div className="mt-5">
        <Link to="/dashboard">
          <Button>Back to dashboard</Button>
        </Link>
      </div>
    </div>
  );
}