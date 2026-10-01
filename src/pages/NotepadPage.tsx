// Notepad landing — two side-by-side cards for the two scratch tools:
// a plain-text textarea and a small Excel-style grid. Each card is a
// router link so each tool gets its own URL (`/notepad/text`,
// `/notepad/excel`) for back/forward + refresh. No server state lives
// here — both tools persist locally in the browser (see the sub-pages).

import { Link } from "react-router-dom";
import { FileText, Sheet, ArrowRight } from "lucide-react";
import { useT } from "@/lib/blocks/i18n";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function NotepadPage() {
  const t = useT();
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">
          {t("notepad.title", "Notepad")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "notepad.description",
            "Quick scratch tools — pick one and start typing.",
          )}
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Plain Text — links to the textarea page. `card-interactive`
            gives the hover lift (see index.css) so the card reads as a
            clickable target, not a static panel. The icon avatar sits
            in the header so both cards share the same layout rhythm. */}
        <Link
          to="/notepad/text"
          className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg"
        >
          <Card className="card-interactive h-full">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary-muted text-primary"
                  aria-hidden="true"
                >
                  <FileText className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-base">
                    {t("notepad.textTitle", "Plain Text")}
                  </CardTitle>
                </div>
              </div>
              <CardDescription>
                {t(
                  "notepad.textDescription",
                  "A free-form scratchpad. Auto-saves to your browser.",
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {t("notepad.openCta", "Open")}
              </span>
              <ArrowRight
                className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </CardContent>
          </Card>
        </Link>

        {/* Excel — links to the small-grid page. Same layout as the
            Plain Text card so the two sit on the same visual line; the
            icon and color avatar are the only differences. */}
        <Link
          to="/notepad/excel"
          className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg"
        >
          <Card className="card-interactive h-full">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300"
                  aria-hidden="true"
                >
                  <Sheet className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-base">
                    {t("notepad.excelTitle", "Excel")}
                  </CardTitle>
                </div>
              </div>
              <CardDescription>
                {t(
                  "notepad.excelDescription",
                  "A small editable grid for quick tables. Auto-saves to your browser.",
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {t("notepad.openCta", "Open")}
              </span>
              <ArrowRight
                className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
