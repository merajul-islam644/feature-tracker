// Final CTA per DESIGN.md §6.6. Indigo panel with a single strong
// "Get Started" call to action.
import Button from "../ui/Button.jsx";

export default function CTASection() {
  return (
    <section
      id="get-started"
      className="section-padding bg-white"
      aria-labelledby="cta-heading"
    >
      <div className="container-marketing">
        <div className="relative overflow-hidden rounded-3xl bg-indigo-600 px-6 py-16 text-center text-white sm:px-12 sm:py-20">
          {/* Subtle decorative blob — kept small and behind text. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-indigo-500/20 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-indigo-500/20 blur-3xl"
          />

          <div className="relative">
            <h2
              id="cta-heading"
              className="text-3xl font-bold tracking-tight sm:text-4xl"
            >
              Give your engineering team one clear view.
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-indigo-100 sm:text-lg sm:leading-8">
              Bring features, flows, environments, issues, and team
              communication together.
            </p>
            <div className="mt-8 flex justify-center">
              <Button href="#sign-in" size="lg" variant="light" withArrow>
                Get Started
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
