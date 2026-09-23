// Section heading shared by Features, How-it-works, Product visual.
// Align defaults to "center" per DESIGN.md §7.4.
import Badge from "../ui/Badge.jsx";

export default function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
  className = "",
}) {
  const wrapperAlign = align === "center" ? "text-center mx-auto" : "text-left";
  const descriptionAlign = align === "center" ? "mx-auto" : "";

  return (
    <div className={`max-w-3xl ${wrapperAlign} ${className}`.trim()}>
      {eyebrow && <Badge className="mb-4">{eyebrow}</Badge>}
      <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
        {title}
      </h2>
      {description && (
        <p
          className={`mt-4 text-base leading-7 text-slate-600 sm:text-lg sm:leading-8 ${descriptionAlign} max-w-2xl`}
        >
          {description}
        </p>
      )}
    </div>
  );
}
