import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Small action button used in page headers and toolbars.
 *
 * Wraps the project's shadcn `Button` so callers can pass a single `icon`
 * node alongside a text label (or omit children for an icon-only control).
 * `icon`-variant buttons have no visible label, so the supplied `title`
 * is also forwarded as `aria-label` to keep them reachable from a screen
 * reader.
 *
 * Variants:
 *   - "primary" — solid button, label + icon (default).
 *   - "accent"  — outlined button, useful when an action needs to stand
 *                 out from siblings without competing with the solid
 *                 primary.
 *   - "icon"    — square icon-only button. Requires a `title`/`aria-label`.
 *   - "ghost"   — subtle text button with optional icon.
 */
export type ActionButtonVariant = "primary" | "accent" | "icon" | "ghost";

export interface ActionButtonProps
  extends Omit<
    ButtonProps,
    "leftIcon" | "rightIcon" | "asChild" | "variant"
  > {
  variant?: ActionButtonVariant;
  /** Icon node rendered before the text label (or alone for icon-only). */
  icon?: React.ReactNode;
}

export const ActionButton = React.forwardRef<
  HTMLButtonElement,
  ActionButtonProps
>(({ variant = "primary", icon, className, children, title, ...props }, ref) => {
  if (variant === "icon") {
    const accessibleName =
      typeof children === "string" && children.length > 0 ? children : title;
    return (
      <Button
        ref={ref}
        type="button"
        variant="ghost"
        size="icon"
        title={title}
        aria-label={accessibleName}
        className={cn(
          "h-9 w-9 text-muted-foreground hover:bg-muted hover:text-foreground",
          className,
        )}
        {...props}
      >
        {icon}
      </Button>
    );
  }

  if (variant === "ghost") {
    return (
      <Button
        ref={ref}
        type="button"
        variant="ghost"
        size="sm"
        title={title}
        className={cn("text-muted-foreground hover:text-foreground", className)}
        {...props}
      >
        {icon}
        {children}
      </Button>
    );
  }

  if (variant === "accent") {
    return (
      <Button
        ref={ref}
        type="button"
        variant="outline"
        size="sm"
        title={title}
        className={cn(
          "border-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground",
          className,
        )}
        {...props}
      >
        {icon}
        {children}
      </Button>
    );
  }

  return (
    <Button
      ref={ref}
      type="button"
      size="sm"
      title={title}
      className={className}
      {...props}
    >
      {icon}
      {children}
    </Button>
  );
});
ActionButton.displayName = "ActionButton";