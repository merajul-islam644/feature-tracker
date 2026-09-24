import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Button — see DESIGN-SYSTEM-REWRITE.md §3 "Buttons".
 *
 * Variants: default | destructive | outline | secondary | ghost | link
 *   - default     : primary indigo, single solid color
 *   - destructive : red, only when the action is actually destructive
 *   - outline     : neutral surface, used for secondary actions
 *   - secondary   : muted surface, used in toolbars / data rows
 *   - ghost       : hover surface only, used for utility icons
 *   - link        : text-only with underline-on-hover
 *
 * Sizes mirror the spec: sm (h-8), default (h-9), lg (h-10), xl (h-11),
 * icon (h-9 w-9), icon-sm (h-8 w-8).
 *
 * AI surfaces use --technical tokens via the AI Assistant component, NOT a
 * gradient button — the gradient was retired in the 2026-09 design rewrite.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-border bg-surface text-foreground hover:bg-accent",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 text-sm",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-5 text-sm",
        xl: "h-11 rounded-md px-6 text-sm",
        icon: "h-9 w-9",
        "icon-sm": "h-8 w-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      leftIcon,
      rightIcon,
      fullWidth,
      children,
      disabled,
      type = "button",
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : "button";
    const classes = cn(
      buttonVariants({ variant, size }),
      fullWidth && "w-full",
      className
    );

    if (asChild) {
      return (
        <Comp ref={ref} className={classes} {...props}>
          {children}
        </Comp>
      );
    }

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading || undefined}
        className={classes}
        {...props}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          leftIcon
        )}
        <span className="inline-flex items-center gap-2">{children}</span>
        {!loading && rightIcon}
      </button>
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
