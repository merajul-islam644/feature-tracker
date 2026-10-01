// Small pill used for eyebrow labels (Hero, Features, How-it-works).
// Variants per DESIGN.md §7.3.
const variants = {
  primary:
    "inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-indigo-700",
  neutral:
    "inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-slate-700",
  success:
    "inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-700",
};

export default function Badge({
  children,
  variant = "primary",
  className = "",
  ...rest
}) {
  return (
    <span className={`${variants[variant]} ${className}`.trim()} {...rest}>
      {children}
    </span>
  );
}
