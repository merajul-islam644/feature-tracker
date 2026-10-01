// Hero section per DESIGN.md §6.2. Centered H1 with eyebrow + 2 CTAs,
// subtle indigo glow background, scroll cue arrow.
import { ArrowRight, ChevronDown } from "lucide-react";
import Badge from "../ui/Badge.jsx";
import Button from "../ui/Button.jsx";

export default function Hero() {
  return (
    <section
      id="top"
      className="relative overflow-hidden bg-white pb-20 pt-20 sm:pt-24 lg:pb-28 lg:pt-28"
    >
      {/* Subtle decorative glow — keep it behind content. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 left-1/2 h-[480px] w-[860px] -translate-x-1/2 rounded-full bg-indigo-100/50 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[480px] bg-hero-grid bg-[length:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]"
      />

      <div className="container-marketing relative">
        <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
          <Badge className="mb-6">Engineering Workspace</Badge>

          <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
            Track every feature.
            <br className="hidden sm:block" /> Follow every flow.{" "}
            <br className="hidden sm:block" />
            <span className="text-indigo-600">Ship with confidence.</span>
          </h1>

          <p className="mt-6 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
            Keep features, flows, environments, issues, announcements, and team
            conversations connected in one workspace built for engineering
            teams.
          </p>

          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
            <Button href="#get-started" size="lg" withArrow>
              Get Started
            </Button>
            <Button href="#features" size="lg" variant="secondary">
              Explore Features
            </Button>
          </div>

          <a
            href="#features"
            aria-label="Scroll to features"
            className="mt-12 inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:text-indigo-600"
          >
            <ChevronDown className="h-5 w-5" aria-hidden="true" />
          </a>
        </div>
      </div>
    </section>
  );
}
