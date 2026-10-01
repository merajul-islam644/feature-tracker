// In-product Features mockup — mirrors the real app's project detail
// page where each feature row carries the Dev → Stg → Prod → UAT
// environment workflow chain plus status pills. Includes project list
// header + Add Environment / Create Project CTAs and a feature list.
import {
  FolderKanban,
  Plus,
  Layers,
  ChevronRight,
  Check,
  GitBranch,
} from "lucide-react";

const features = [
  {
    id: "FEAT-A1",
    title: "Apple Pay button on cart",
    flows: 6,
    passed: 4,
    failed: 1,
    pending: 1,
    chain: ["source", "cloned", "cloned", "available"],
  },
  {
    id: "FEAT-A2",
    title: "Tax line currency override",
    flows: 3,
    passed: 2,
    failed: 0,
    pending: 1,
    chain: ["source", "cloned", "available", "available"],
  },
  {
    id: "FEAT-A3",
    title: "Stripe webhook signature",
    flows: 4,
    passed: 3,
    failed: 1,
    pending: 0,
    chain: ["source", "available", "available", "available"],
  },
  {
    id: "FEAT-A4",
    title: "Reset password rate limit",
    flows: 2,
    passed: 2,
    failed: 0,
    pending: 0,
    chain: ["source", "cloned", "cloned", "cloned"],
  },
];

function EnvNode({ label, state }) {
  const stateClasses = {
    source: "border-yellow-400 bg-yellow-400 text-yellow-950",
    cloned: "border-yellow-400/60 bg-yellow-400/15 text-yellow-700",
    available: "border-yellow-400/40 bg-transparent text-yellow-600",
  };
  return (
    <span
      className={`inline-flex h-5 items-center justify-center rounded border px-1.5 text-[10px] font-semibold ${stateClasses[state]}`}
    >
      {label}
    </span>
  );
}

function EnvArrow() {
  return (
    <svg
      width="14"
      height="10"
      viewBox="0 0 14 10"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="text-yellow-400"
      aria-hidden="true"
    >
      <path
        d="M0 5 H10 M7 1 L11 5 L7 9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FeatureRow({ feature }) {
  return (
    <li className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2.5">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-indigo-50 text-indigo-600">
        <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-xs font-semibold text-slate-900">
            {feature.title}
          </p>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
            {feature.id}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-500">
          <span className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-medium text-slate-600">
            Passed {feature.passed}
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-medium text-slate-600">
            Failed {feature.failed}
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-medium text-slate-600">
            Pending {feature.pending}
          </span>
        </div>
      </div>
      {/* Env chain: Dev → Stg → Prod → UAT */}
      <div className="hidden items-center gap-0.5 lg:flex">
        <EnvNode label="Dev" state={feature.chain[0]} />
        <EnvArrow />
        <EnvNode label="Stg" state={feature.chain[1]} />
        <EnvArrow />
        <EnvNode label="Prod" state={feature.chain[2]} />
        <EnvArrow />
        <EnvNode label="UAT" state={feature.chain[3]} />
      </div>
      <ChevronRight
        className="h-3.5 w-3.5 shrink-0 text-slate-300"
        aria-hidden="true"
      />
    </li>
  );
}

export default function FeaturesMockup() {
  return (
    <div className="flex bg-slate-100/60">
      {/* Sidebar — Projects highlighted */}
      <aside className="hidden w-[170px] shrink-0 border-r border-slate-200 bg-slate-50/60 sm:flex sm:flex-col">
        <div className="flex items-center gap-2 px-3 py-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600 text-white">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
          </div>
          <span className="text-xs font-semibold text-slate-900">
            Feature Tracker
          </span>
        </div>
        <div className="px-2">
          <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Navigation
          </p>
          <ul className="flex flex-col gap-0.5">
            <li>
              <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] font-medium text-slate-600">
                <span className="h-3.5 w-3.5 rounded-sm border border-slate-300" />
                Dashboard
              </div>
            </li>
            <li>
              <div className="flex items-center gap-2 rounded-md bg-white px-2 py-1.5 text-[11px] font-semibold text-indigo-700 shadow-sm ring-1 ring-slate-200">
                <FolderKanban
                  className="h-3.5 w-3.5 text-indigo-600"
                  aria-hidden="true"
                />
                Projects
              </div>
            </li>
            <li>
              <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] font-medium text-slate-600">
                <span className="h-3.5 w-3.5 rounded-sm border border-slate-300" />
                Issues
              </div>
            </li>
            <li>
              <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] font-medium text-slate-600">
                <span className="h-3.5 w-3.5 rounded-sm border border-slate-300" />
                Chat
              </div>
            </li>
            <li>
              <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] font-medium text-slate-600">
                <span className="h-3.5 w-3.5 rounded-sm border border-slate-300" />
                Members
              </div>
            </li>
            <li>
              <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] font-medium text-slate-600">
                <span className="h-3.5 w-3.5 rounded-sm border border-slate-300" />
                Settings
              </div>
            </li>
          </ul>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Page header */}
        <header className="flex flex-col gap-3 border-b border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <FolderKanban
                className="h-4 w-4 text-indigo-600"
                aria-hidden="true"
              />
              <h1 className="text-lg font-semibold tracking-tight text-slate-900">
                Checkout v2
              </h1>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Manage your features and flows.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              tabIndex={-1}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700"
            >
              <Layers className="h-3.5 w-3.5" aria-hidden="true" />
              Add Environment
            </button>
            <button
              type="button"
              tabIndex={-1}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Create Project
            </button>
          </div>
        </header>

        {/* Project card */}
        <div className="flex-1 space-y-3 overflow-hidden p-5">
          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  Checkout v2
                </p>
                <p className="text-[11px] text-slate-500">
                  Dev · Stg · Prod · UAT
                </p>
              </div>
              <button
                type="button"
                tabIndex={-1}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600"
              >
                <Plus className="h-3 w-3" aria-hidden="true" />
                Add Feature
              </button>
            </div>
            <ul className="divide-y divide-slate-100 p-2">
              {features.map((feature) => (
                <FeatureRow key={feature.id} feature={feature} />
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
