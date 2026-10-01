// Product visual per DESIGN.md §6.5. Four in-product mockups —
// Dashboard, Features (project detail), Issue Tracker, Team Chat —
// each wrapped in the same browser-style frame so the marketing site
// shows a believable multi-surface preview without a real screenshot
// being available yet.
import SectionHeading from "./SectionHeading.jsx";
import DashboardMockup from "./DashboardMockup.jsx";
import FeaturesMockup from "./FeaturesMockup.jsx";
import IssueTrackerMockup from "./IssueTrackerMockup.jsx";
import ChatMockup from "./ChatMockup.jsx";

function BrowserFrame({ url, children, label }) {
  return (
    <figure className="flex flex-col">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-product ring-1 ring-slate-900/5">
        <div className="flex h-10 items-center gap-2 border-b border-slate-200 bg-slate-50 px-4">
          <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          <span className="ml-3 text-xs font-medium text-slate-500">{url}</span>
        </div>
        {children}
      </div>
      {label && (
        <figcaption className="mt-3 text-center text-sm font-medium text-slate-700">
          {label}
        </figcaption>
      )}
    </figure>
  );
}

export default function ProductVisual() {
  return (
    <section
      id="product"
      className="section-padding bg-slate-50/60"
      aria-labelledby="product-heading"
    >
      <div className="container-marketing">
        <SectionHeading
          eyebrow="Product visual"
          title="A clear view of what your team is shipping."
          description="Feature Tracker brings projects, feature status, flows, issues, and team updates into one focused workspace."
        />

        {/* Hero screenshot — Dashboard. */}
        <div className="mt-14">
          <BrowserFrame
            url="app.feature-tracker.com/dashboard"
            label="Dashboard — projects, flows, issues, and announcements at a glance"
          >
            <DashboardMockup />
          </BrowserFrame>
        </div>

        {/* Features mockup — full width to show the env chain. */}
        <div className="mt-10">
          <BrowserFrame
            url="app.feature-tracker.com/projects/checkout-v2"
            label="Project features — environment workflow from Dev to Stg, Prod, and UAT"
          >
            <FeaturesMockup />
          </BrowserFrame>
        </div>

        {/* Two more screenshots side by side. */}
        <div className="mt-10 grid gap-8 lg:grid-cols-2">
          <BrowserFrame
            url="app.feature-tracker.com/issues"
            label="Issue Tracker — AI-powered verification with severity and assignees"
          >
            <IssueTrackerMockup />
          </BrowserFrame>

          <BrowserFrame
            url="app.feature-tracker.com/chat"
            label="Team Chat — direct messages with image attachments"
          >
            <ChatMockup />
          </BrowserFrame>
        </div>
      </div>
    </section>
  );
}
