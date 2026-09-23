// FeatureCard per DESIGN.md §6.3 / §7.5. Lucide icon in an indigo
// pill, neutral card with subtle hover lift.
export default function FeatureCard({ icon: Icon, title, description }) {
  return (
    <article className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition duration-200 ease-smooth hover:-translate-y-1 hover:shadow-md">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <h3 className="mt-5 text-lg font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
    </article>
  );
}
