// In-product dashboard mockup — replicates the real Feature Tracker
// layout (sidebar nav + topbar + main content with stat tiles, recent
// projects, recent flows, and announcements). Used inside the
// ProductVisual browser frame so the marketing site shows a believable
// preview without a real screenshot being available yet.
import {
  LayoutDashboard,
  FolderKanban,
  Bug,
  MessageSquare,
  Users,
  Settings,
  Layers3,
  GitBranch,
  Megaphone,
  CheckCircle2,
  Circle,
  Search,
  Bell,
  Sun,
  Languages,
  Plus,
} from "lucide-react";

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", active: true },
  { icon: FolderKanban, label: "Projects", active: false },
  { icon: Bug, label: "Issues", active: false },
  { icon: MessageSquare, label: "Chat", active: false },
  { icon: Users, label: "Members", active: false },
  { icon: Settings, label: "Settings", active: false },
];

function Brand() {
  return (
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
  );
}

function Sidebar() {
  return (
    <aside className="hidden w-[170px] shrink-0 border-r border-slate-200 bg-slate-50/60 sm:flex sm:flex-col">
      <Brand />
      <div className="px-2">
        <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Navigation
        </p>
        <ul className="flex flex-col gap-0.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.label}>
                <div
                  className={
                    item.active
                      ? "flex items-center gap-2 rounded-md bg-white px-2 py-1.5 text-[11px] font-semibold text-indigo-700 shadow-sm ring-1 ring-slate-200"
                      : "flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] font-medium text-slate-600"
                  }
                >
                  <Icon
                    className={
                      item.active ? "h-3.5 w-3.5 text-indigo-600" : "h-3.5 w-3.5"
                    }
                    aria-hidden="true"
                  />
                  {item.label}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-auto border-t border-slate-200 p-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-cyan-500 text-[10px] font-semibold text-white">
            MR
          </div>
          <div className="min-w-0">
            <p className="truncate text-[11px] font-medium text-slate-900">
              Merajul Islam
            </p>
            <p className="truncate text-[10px] text-slate-500">
              EN-US
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}

function Topbar() {
  return (
    <div className="flex h-10 items-center justify-between border-b border-slate-200 bg-white px-4">
      <h1 className="text-sm font-semibold text-slate-900">Dashboard</h1>
      <div className="flex items-center gap-3 text-slate-500">
        <Search className="h-3.5 w-3.5" aria-hidden="true" />
        <Languages className="h-3.5 w-3.5" aria-hidden="true" />
        <Bell className="h-3.5 w-3.5" aria-hidden="true" />
        <Sun className="h-3.5 w-3.5" aria-hidden="true" />
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-cyan-500 text-[9px] font-semibold text-white">
          MR
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value, sub, tone = "indigo" }) {
  const tones = {
    indigo: "bg-indigo-50 text-indigo-700",
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    cyan: "bg-cyan-50 text-cyan-700",
  };
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-xl font-bold text-slate-900">{value}</span>
        {sub && (
          <span
            className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${tones[tone]}`}
          >
            {sub}
          </span>
        )}
      </div>
    </div>
  );
}

function StatusChip({ status }) {
  const map = {
    Production: "bg-emerald-100 text-emerald-700",
    Staging: "bg-amber-100 text-amber-700",
    Development: "bg-indigo-100 text-indigo-700",
    "In Review": "bg-cyan-100 text-cyan-700",
    Blocked: "bg-red-100 text-red-700",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${map[status]}`}
    >
      {status}
    </span>
  );
}

function ProjectRow({ name, env, features, status }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 text-[11px]">
      <div className="min-w-0">
        <p className="truncate font-medium text-slate-900">{name}</p>
        <p className="truncate text-[10px] text-slate-500">
          {features} features · {env}
        </p>
      </div>
      <StatusChip status={status} />
    </div>
  );
}

function FlowRow({ name, status, env }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-[11px]">
      {status === "done" ? (
        <CheckCircle2
          className="h-3.5 w-3.5 shrink-0 text-emerald-600"
          aria-hidden="true"
        />
      ) : (
        <Circle
          className="h-3.5 w-3.5 shrink-0 text-slate-400"
          aria-hidden="true"
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-slate-900">{name}</p>
        <p className="text-[10px] text-slate-500">{env}</p>
      </div>
    </div>
  );
}

function AnnouncementRow({ title, time, who }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2">
      <Megaphone
        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-600"
        aria-hidden="true"
      />
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium text-slate-900">
          {title}
        </p>
        <p className="text-[10px] text-slate-500">
          {who} · {time}
        </p>
      </div>
    </div>
  );
}

export default function DashboardMockup() {
  return (
    <div className="flex bg-slate-100/60">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />

        <div className="flex-1 overflow-hidden p-4">
          {/* Greeting + Add button */}
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-[11px] text-slate-500">Welcome back</p>
              <p className="text-sm font-semibold text-slate-900">
                Merajul Islam
              </p>
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-sm"
              tabIndex={-1}
            >
              <Plus className="h-3 w-3" aria-hidden="true" />
              New Feature
            </button>
          </div>

          {/* Stat tiles */}
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <StatTile label="Projects" value="6" sub="+2" tone="indigo" />
            <StatTile label="Features" value="34" sub="+5" tone="emerald" />
            <StatTile label="Flows" value="128" sub="+12" tone="cyan" />
            <StatTile label="Open Issues" value="7" sub="-3" tone="amber" />
          </div>

          {/* Two-column body */}
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            {/* Recent projects */}
            <div className="rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-900">
                  <FolderKanban
                    className="h-3.5 w-3.5 text-indigo-600"
                    aria-hidden="true"
                  />
                  Recent Projects
                </div>
                <span className="text-[10px] text-indigo-600">View all</span>
              </div>
              <div className="divide-y divide-slate-100">
                <ProjectRow
                  name="Checkout v2"
                  env="Production · Staging · Dev"
                  features="12"
                  status="Production"
                />
                <ProjectRow
                  name="Auth refactor"
                  env="Staging · Dev"
                  features="6"
                  status="Staging"
                />
                <ProjectRow
                  name="Onboarding flow"
                  env="Dev"
                  features="4"
                  status="Development"
                />
              </div>
            </div>

            {/* Recent flows */}
            <div className="rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-900">
                  <GitBranch
                    className="h-3.5 w-3.5 text-indigo-600"
                    aria-hidden="true"
                  />
                  Recent Flows
                </div>
                <span className="text-[10px] text-indigo-600">View all</span>
              </div>
              <div className="divide-y divide-slate-100">
                <FlowRow name="Stripe webhook retry" env="Production" status="done" />
                <FlowRow name="Email verification" env="Staging" status="progress" />
                <FlowRow name="Reset password" env="Dev" status="progress" />
              </div>
            </div>
          </div>

          {/* Announcements strip */}
          <div className="mt-2 rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center gap-1.5 border-b border-slate-100 px-3 py-2 text-[11px] font-semibold text-slate-900">
              <Megaphone
                className="h-3.5 w-3.5 text-indigo-600"
                aria-hidden="true"
              />
              Announcements
            </div>
            <div className="grid gap-1 px-1 py-1 sm:grid-cols-2">
              <AnnouncementRow
                title="v2.4 ships to production Friday"
                time="2h ago"
                who="Rafi"
              />
              <AnnouncementRow
                title="New issue tracker filters available"
                time="1d ago"
                who="Asha"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
