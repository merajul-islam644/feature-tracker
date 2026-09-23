// In-product Issue Tracker mockup — mirrors the real app layout: page
// header with "Start Verification" CTA, filter card with search +
// application + sort + chip rows, then a single-column list of issue
// rows (each with severity icon + title + status pill + assignee).
import {
  Bug,
  Search,
  AlertOctagon,
  AlertTriangle,
  AlertCircle,
  Info,
  Play,
  History,
  ChevronRight,
  BadgeCheck,
  Bot,
  Globe,
} from "lucide-react";

const severityMeta = {
  critical: {
    Icon: AlertOctagon,
    label: "Critical",
    tone: "border-red-200 bg-red-50 text-red-700",
    chipTone: "border-red-200 bg-red-50 text-red-700",
  },
  high: {
    Icon: AlertTriangle,
    label: "High",
    tone: "border-amber-200 bg-amber-50 text-amber-700",
    chipTone: "border-amber-200 bg-amber-50 text-amber-700",
  },
  medium: {
    Icon: AlertCircle,
    label: "Medium",
    tone: "border-yellow-200 bg-yellow-50 text-yellow-700",
    chipTone: "border-yellow-200 bg-yellow-50 text-yellow-700",
  },
  low: {
    Icon: Info,
    label: "Low",
    tone: "border-sky-200 bg-sky-50 text-sky-700",
    chipTone: "border-sky-200 bg-sky-50 text-sky-700",
  },
};

const statusTone = {
  open: "bg-red-50 text-red-700",
  investigating: "bg-amber-50 text-amber-700",
  confirmed: "bg-red-50 text-red-700",
  fixed: "bg-emerald-50 text-emerald-700",
  resolved: "bg-emerald-50 text-emerald-700",
  wont_fix: "bg-slate-100 text-slate-600",
  ignored: "bg-slate-100 text-slate-600",
  reopened: "bg-amber-50 text-amber-700",
};

const severityChips = [
  { id: "critical", label: "Critical", tone: "border-red-200 bg-red-50 text-red-700" },
  { id: "high", label: "High", tone: "border-amber-200 bg-amber-50 text-amber-700" },
  { id: "medium", label: "Medium", tone: "border-yellow-200 bg-yellow-50 text-yellow-700" },
  { id: "low", label: "Low", tone: "border-sky-200 bg-sky-50 text-sky-700" },
];

const statusChips = [
  { id: "open", label: "Open" },
  { id: "investigating", label: "Investigating" },
  { id: "confirmed", label: "Confirmed" },
  { id: "fixed", label: "Fixed" },
  { id: "resolved", label: "Resolved" },
  { id: "wont_fix", label: "Won't fix" },
  { id: "ignored", label: "Ignored" },
];

const categoryChips = [
  { id: "authentication", label: "Authentication" },
  { id: "authorization", label: "Authorization" },
  { id: "navigation", label: "Navigation" },
  { id: "ui", label: "UI" },
  { id: "functional", label: "Functional" },
  { id: "forms", label: "Forms" },
  { id: "api", label: "API" },
];

const issues = [
  {
    id: "ISS-1042",
    severity: "high",
    title: "Tax line shows wrong currency on EUR cart",
    status: "investigating",
    app: "checkout-web",
    desc: "When the user's last viewed currency is EUR but the cart is rebuilt in USD, the tax line keeps the EUR label without converting.",
    assignees: [{ initials: "MA", tone: "from-indigo-500 to-cyan-500" }],
    approved: false,
  },
  {
    id: "ISS-1041",
    severity: "critical",
    title: "Webhook times out after 30s on Stripe retry",
    status: "open",
    app: "checkout-api",
    desc: "Stripe sends a retry with the same idempotency key after a partial success — the handler waits for the upstream and hits the 30s gateway limit.",
    assignees: [
      { initials: "RA", tone: "from-pink-500 to-rose-500" },
      { initials: "AS", tone: "from-emerald-500 to-teal-500" },
    ],
    approved: false,
  },
  {
    id: "ISS-1037",
    severity: "medium",
    title: "Reset-password email not arriving for SSO users",
    status: "confirmed",
    app: "auth-service",
    desc: "SSO-linked accounts skip the email step but the UI still says 'check your inbox' — confusing copy in the success state.",
    assignees: [{ initials: "AS", tone: "from-emerald-500 to-teal-500" }],
    approved: true,
  },
  {
    id: "ISS-1033",
    severity: "low",
    title: "Invoice PDF layout breaks under 360px width",
    status: "fixed",
    app: "billing-portal",
    desc: "Total cell overflows the table on small viewports; tested on Pixel 5 in landscape.",
    assignees: [{ initials: "MR", tone: "from-indigo-500 to-cyan-500" }],
    approved: true,
  },
];

function SeverityIcon({ severity }) {
  const meta = severityMeta[severity];
  const Icon = meta.Icon;
  return (
    <div
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${meta.tone}`}
      aria-hidden="true"
    >
      <Icon className="h-4 w-4" />
    </div>
  );
}

function StatusPill({ status }) {
  const labels = {
    open: "Open",
    investigating: "Investigating",
    confirmed: "Confirmed",
    fixed: "Fixed",
    resolved: "Resolved",
    wont_fix: "Won't fix",
    ignored: "Ignored",
    reopened: "Reopened",
  };
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${statusTone[status]}`}
    >
      {labels[status]}
    </span>
  );
}

function Chip({ pressed, pressedTone, children }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-pressed={pressed}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
        pressed
          ? pressedTone
          : "border-slate-200 text-slate-500"
      }`}
    >
      {children}
    </button>
  );
}

function ChipRow({ label, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

export default function IssueTrackerMockup() {
  return (
    <div className="flex bg-slate-100/60">
      {/* Compact sidebar (same brand mark, Issues highlighted) */}
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
              <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] font-medium text-slate-600">
                <span className="h-3.5 w-3.5 rounded-sm border border-slate-300" />
                Projects
              </div>
            </li>
            <li>
              <div className="flex items-center gap-2 rounded-md bg-white px-2 py-1.5 text-[11px] font-semibold text-indigo-700 shadow-sm ring-1 ring-slate-200">
                <Bug
                  className="h-3.5 w-3.5 text-indigo-600"
                  aria-hidden="true"
                />
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
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight text-slate-900">
                Issue Tracker
              </h1>
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                <History className="h-3 w-3" aria-hidden="true" />
                Last run 12m ago
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                <Bot className="h-3 w-3" aria-hidden="true" />
                AI Assistant
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-cyan-100 bg-cyan-50 px-2 py-0.5 text-[11px] font-medium text-cyan-700">
                <Globe className="h-3 w-3" aria-hidden="true" />
                Playwright MCP
              </span>
            </div>
            <p className="text-xs text-slate-500">
              AI-powered application verification across your configured targets.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              tabIndex={-1}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              Start Verification
            </button>
          </div>
        </header>

        <div className="flex-1 space-y-3 overflow-hidden p-5">
          {/* Filter card */}
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                  <div className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-[11px] text-slate-400">
                    Search issues…
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-600">
                    All applications <ChevronRight className="h-3 w-3 -rotate-90" aria-hidden="true" />
                  </div>
                  <div className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-600">
                    Newest <ChevronRight className="h-3 w-3 -rotate-90" aria-hidden="true" />
                  </div>
                </div>
              </div>

              <ChipRow label="Severity">
                {severityChips.map((s, i) => (
                  <Chip
                    key={s.id}
                    pressed={i === 0}
                    pressedTone={s.tone}
                  >
                    {s.label}
                  </Chip>
                ))}
              </ChipRow>

              <ChipRow label="Status">
                {statusChips.map((s) => (
                  <Chip key={s.id} pressed={false}>
                    {s.label}
                  </Chip>
                ))}
              </ChipRow>

              <ChipRow label="Category">
                {categoryChips.map((c) => (
                  <Chip key={c.id} pressed={false}>
                    {c.label}
                  </Chip>
                ))}
              </ChipRow>
            </div>
          </div>

          {/* Issue list */}
          <ul className="space-y-2">
            {issues.map((issue) => (
              <li
                key={issue.id}
                className="flex items-start gap-3 rounded-md border border-slate-200 bg-white p-3 hover:border-indigo-200"
              >
                <SeverityIcon severity={issue.severity} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-mono text-slate-400">
                      {issue.id}
                    </span>
                    <p className="truncate text-xs font-semibold text-slate-900">
                      {issue.title}
                    </p>
                    <StatusPill status={issue.status} />
                    {issue.approved && (
                      <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700">
                        <BadgeCheck
                          className="h-3 w-3"
                          aria-hidden="true"
                        />
                        Approved
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-slate-600">
                    {issue.desc}
                  </p>
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                      {issue.app}
                    </span>
                    <div className="flex items-center gap-2">
                      <div className="flex -space-x-1.5">
                        {issue.assignees.map((a) => (
                          <div
                            key={a.initials}
                            className={`flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br text-[9px] font-semibold text-white ring-2 ring-white ${a.tone}`}
                          >
                            {a.initials}
                          </div>
                        ))}
                      </div>
                      <ChevronRight
                        className="h-3.5 w-3.5 text-slate-300"
                        aria-hidden="true"
                      />
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
