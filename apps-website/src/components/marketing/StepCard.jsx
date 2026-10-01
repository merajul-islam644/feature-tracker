// StepCard per DESIGN.md §6.4 / §7.6. Step number, icon, title, copy.
// The connecting line between cards lives in the parent (HowItWorks).
export default function StepCard({ number, icon: Icon, title, description }) {
  return (
    <article className="relative flex flex-col items-center rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm transition duration-200 ease-smooth hover:-translate-y-1 hover:shadow-md sm:p-8">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">
        Step {number}
      </span>
      <div className="mt-4 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </div>
      <h3 className="mt-4 text-lg font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
    </article>
  );
}
