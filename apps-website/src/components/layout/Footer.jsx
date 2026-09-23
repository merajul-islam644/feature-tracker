// Footer per DESIGN.md §6.7. Dark slate panel, three link columns,
// copyright + privacy/terms. No fake social links.
import { Layers3 } from "lucide-react";

const columns = [
  {
    heading: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "How it works", href: "#how-it-works" },
      { label: "Get started", href: "#get-started" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { label: "Documentation", href: "#docs" },
      { label: "Support", href: "#support" },
      { label: "Changelog", href: "#changelog" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "#about" },
      { label: "Contact", href: "#contact" },
    ],
  },
];

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="bg-slate-950 text-slate-300">
      <div className="container-marketing py-16">
        <div className="grid gap-10 lg:grid-cols-4">
          <div>
            <a
              href="#top"
              className="flex items-center gap-2 text-base font-semibold text-white"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white">
                <Layers3 className="h-5 w-5" aria-hidden="true" />
              </span>
              Feature Tracker
            </a>
            <p className="mt-4 max-w-xs text-sm leading-6 text-slate-400">
              Track every feature. Follow every flow. Ship with confidence.
            </p>
          </div>

          {columns.map((col) => (
            <nav key={col.heading} aria-label={col.heading}>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-white">
                {col.heading}
              </h3>
              <ul className="mt-4 space-y-3">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="text-sm text-slate-400 transition hover:text-white"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-slate-800 pt-8 text-sm text-slate-400 sm:flex-row sm:items-center">
          <p>© {year} Feature Tracker. All rights reserved.</p>
          <div className="flex items-center gap-6">
            <a href="#privacy" className="transition hover:text-white">
              Privacy
            </a>
            <a href="#terms" className="transition hover:text-white">
              Terms
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
