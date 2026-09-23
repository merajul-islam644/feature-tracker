import { AlertTriangle } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/utils";

/*
 * ErrorState — see DESIGN-APP-v1.md §7.23.
 *
 * Anatomy: icon · headline · description · retry · secondary.
 * Default copy matches §12.8: "We couldn't load this data." with retry + go-back.
 */

interface ErrorStateProps {
  title?: string;
  message?: React.ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  secondaryAction?: React.ReactNode;
  className?: string;
}

export function ErrorState({
  title = "We couldn't load this data.",
  message = "The workspace data could not be loaded. Try again or return to the previous page.",
  onRetry,
  retryLabel = "Retry",
  secondaryAction,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        "flex min-h-[240px] flex-col items-center justify-center rounded-2xl border border-destructive/30 bg-destructive/5 p-8 text-center",
        className
      )}
      role="alert"
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {message && (
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
          {message}
        </p>
      )}
      {onRetry && (
        <div className="mt-5">
          <Button variant="outline" size="sm" onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      )}
      {secondaryAction && (
        <div className="mt-2 text-xs text-muted-foreground">
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
