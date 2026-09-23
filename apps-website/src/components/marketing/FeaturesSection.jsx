// Features grid per DESIGN.md §6.3. Eight cards on desktop (3-col →
// last row fills with two accent cards), 2 on tablet, 1 on mobile.
// Lucide icons match the recommended inventory.
import {
  Layers3,
  GitBranch,
  Workflow,
  KanbanSquare,
  MessageCircle,
  Megaphone,
  Bot,
  Globe,
} from "lucide-react";
import SectionHeading from "./SectionHeading.jsx";
import FeatureCard from "./FeatureCard.jsx";

const features = [
  {
    icon: Layers3,
    title: "Track features",
    description:
      "Create and manage features with clear status across development, staging, and production.",
  },
  {
    icon: GitBranch,
    title: "Follow critical flows",
    description:
      "Keep important product and engineering flows visible from development through production.",
  },
  {
    icon: Workflow,
    title: "See every environment",
    description:
      "Understand where a feature stands without jumping between separate tools or spreadsheets.",
  },
  {
    icon: KanbanSquare,
    title: "Move issues forward",
    description:
      "Organize issues on a focused Kanban board and keep evidence close to the work.",
  },
  {
    icon: MessageCircle,
    title: "Talk where work happens",
    description:
      "Message workspace members directly and share images without leaving the workspace.",
  },
  {
    icon: Megaphone,
    title: "Keep everyone informed",
    description:
      "Share important workspace updates and keep announcements visible to the team.",
  },
  {
    icon: Bot,
    title: "AI verification assistant",
    description:
      "Ask the in-app assistant to start, pause, or report a verification run — it drives the workflow for you without leaving the page.",
  },
  {
    icon: Globe,
    title: "Browser-driven evidence",
    description:
      "A real Playwright browser walks every page, captures console errors and broken links, and turns them into actionable issues.",
  },
];

export default function FeaturesSection() {
  return (
    <section
      id="features"
      className="section-padding bg-slate-50/60"
      aria-labelledby="features-heading"
    >
      <div className="container-marketing">
        <SectionHeading
          eyebrow="Everything in one workspace"
          title="Keep engineering work connected."
          description="From the first feature update to production status, keep the context your team needs close to the work."
        />

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <FeatureCard
              key={feature.title}
              icon={feature.icon}
              title={feature.title}
              description={feature.description}
            />
          ))}
        </div>

        {/* AI + Playwright are the two flagship capabilities — surface them
            with a little extra emphasis so a first-time visitor can't miss
            them. Both cards span a column and add a subtle "what's under
            the hood" detail row. */}
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div className="rounded-2xl border border-indigo-100 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-white">
                <Bot className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  Powered by the in-app AI Assistant
                </p>
                <p className="text-xs text-slate-500">
                  Same chat surface across every workspace page
                </p>
              </div>
            </div>
            <ul className="mt-4 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                <span>Run, pause, and report verifications in chat</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                <span>Filter and triage issues via natural language</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                <span>Export run reports straight from the conversation</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                <span>Pick up where you left off — chat history persists</span>
              </li>
            </ul>
          </div>

          <div className="rounded-2xl border border-indigo-100 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-white">
                <Globe className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  Real browser evidence, every run
                </p>
                <p className="text-xs text-slate-500">
                  Driven by Playwright MCP against your targets
                </p>
              </div>
            </div>
            <ul className="mt-4 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                <span>Headed Chromium walks every navigation path</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                <span>Captures console errors and network failures</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                <span>Reports broken links and missing primary headings</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                <span>Fingerprint-deduped so the same issue doesn't repeat</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
