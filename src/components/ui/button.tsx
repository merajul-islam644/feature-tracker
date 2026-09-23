import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        danger: "bg-red-600 text-white hover:bg-red-700 active:bg-red-800",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
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
      // When asChild is true, Radix Slot requires exactly one React element
      // child. Icons / loading / rightIcon would have to be siblings, which
      // Slot refuses. Following the canonical shadcn Button contract, those
      // visual extras are mutually exclusive with asChild — consumers that
      // need an icon on an asChild button should place it inside their own
      // child element (e.g. wrap a Link with an inline icon).
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
        {/* Flex, not a plain span: call sites pass icon + text as children
            (e.g. IssueTrackerHeader's Start button), and without this the
            icon and text collapse into one inline run — no gap, baseline
            alignment, icon visually off-center. Mirrors the button's own
            items-center/gap-2 so nested content aligns identically. */}
        <span className="inline-flex items-center gap-2">{children}</span>
        {!loading && rightIcon}
      </button>
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
