import * as React from "react";
import { useId } from "react";
import { cn } from "@/lib/utils";

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
  placeholder?: string;
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  (
    { label, error, options, placeholder, id, className, required, ...rest },
    ref
  ) => {
    const autoId = useId();
    const selectId = id ?? autoId;
    const errorId = `${selectId}-error`;

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={selectId}
            className="text-sm font-medium text-foreground"
          >
            {label}
            {required && (
              <span className="ml-0.5 text-destructive" aria-hidden="true">
                *
              </span>
            )}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? errorId : undefined}
          className={cn(
            // Order matters here: `bg-background` MUST come after the
            // `bg-[url(...)]` arbitrary-value utilities, otherwise
            // `tailwind-merge` (used by `cn`) treats the arbitrary
            // background-image shorthand as a `bg-` conflict and
            // strips `bg-background` — which leaves the trigger white
            // in dark mode (white background + light text = invisible).
            "flex h-10 w-full appearance-none rounded-md border border-input px-3 pr-9 text-sm text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            error && "border-destructive focus-visible:ring-destructive",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22currentColor%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><polyline points=%226 9 12 15 18 9%22/></svg>')] bg-[length:12px_12px] bg-[position:right_0.75rem_center] bg-no-repeat bg-background",
            className
          )}
          required={required}
          {...rest}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {error && (
          <p id={errorId} className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }
);
Select.displayName = "Select";

export { Select };
