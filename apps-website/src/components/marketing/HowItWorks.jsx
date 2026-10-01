// How-it-works per DESIGN.md §6.4. Three steps with a subtle dashed
// connector line on desktop, vertical line on mobile.
import { Plus, GitCompare, Rocket } from "lucide-react";
import SectionHeading from "./SectionHeading.jsx";
import StepCard from "./StepCard.jsx";

const steps = [
  {
    number: "01",
    icon: Plus,
    title: "Create the work",
    description:
      "Add projects, features, and flows to give your team a shared view of what is being built.",
  },
  {
    number: "02",
    icon: GitCompare,
    title: "Track the journey",
    description:
      "Follow each feature through development, staging, and production while keeping issues and updates connected.",
  },
  {
    number: "03",
    icon: Rocket,
    title: "Ship with context",
    description:
      "See what is ready, what needs attention, and what your team has communicated along the way.",
  },
];

export default function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="section-padding bg-white"
      aria-labelledby="how-heading"
    >
      <div className="container-marketing">
        <SectionHeading
          eyebrow="How it works"
          title="From idea to production, keep the path visible."
          description="Feature Tracker gives your team a simple workflow for keeping feature progress and engineering context connected."
        />

        <ol className="relative mt-14 grid gap-6 lg:grid-cols-3 lg:gap-8">
          {/* Desktop connector — dashed line through the cards. */}
          <div
            aria-hidden="true"
            className="absolute left-0 right-0 top-[44px] hidden border-t border-dashed border-slate-300 lg:block"
          />

          {steps.map((step) => (
            <li key={step.number} className="relative">
              {/* Mobile connector — vertical line between cards. */}
              <span
                aria-hidden="true"
                className="absolute left-1/2 top-full hidden h-6 w-px -translate-x-1/2 bg-slate-300 lg:hidden"
                style={{ display: "none" }}
              />
              <StepCard
                number={step.number}
                icon={step.icon}
                title={step.title}
                description={step.description}
              />
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
