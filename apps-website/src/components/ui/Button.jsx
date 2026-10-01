// Single Button primitive used across hero, navbar, and CTA.
// Variants/colors come straight from DESIGN.md §7.2 + §11.
import { ArrowRight } from "lucide-react";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition duration-200 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 " +
  "disabled:pointer-events-none disabled:opacity-50";

const sizes = {
  sm: "px-4 py-2 text-sm",
  md: "px-5 py-2.5 text-sm",
  lg: "px-6 py-3 text-base",
};

const variants = {
  primary:
    "bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 active:bg-indigo-800",
  secondary:
    "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
  outline:
    "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
  ghost: "text-slate-700 hover:bg-slate-100",
  light: "bg-white text-indigo-700 hover:bg-indigo-50",
};

export default function Button({
  variant = "primary",
  size = "md",
  href,
  withArrow = false,
  children,
  className = "",
  type = "button",
  ...rest
}) {
  const classes = `${base} ${sizes[size]} ${variants[variant]} ${className}`.trim();

  const content = (
    <>
      {children}
      {withArrow && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
    </>
  );

  if (href) {
    return (
      <a href={href} className={classes} {...rest}>
        {content}
      </a>
    );
  }

  return (
    <button type={type} className={classes} {...rest}>
      {content}
    </button>
  );
}
