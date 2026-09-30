// Environment chip list with overflow handling. Used by the project card
// (chips navigate to /projects/:id/:slug) and the project info page
// (chips are static, no navigation).
//
// Visual rules:
//   - First VISIBLE_LIMIT (4) envs render inline as chips.
//   - Anything beyond that collapses behind a `+N` trigger button on
//     the right; clicking opens a Radix dropdown listing the rest with
//     identical chip styling.
//   - Canonical envs use Tailwind classes from PROJECT_ENV_META; custom
//     envs use a hex-tinted inline style via envChipStyle.
//
// The two surface modes differ only in what clicking a chip does:
//   - `mode="link"` renders each chip as a <button> that calls onSelect(slug).
//   - `mode="static"` renders each chip as a non-interactive <span>.
//
// Both modes share the same chip styling, the same overflow trigger,
// and the same dropdown markup so the two surfaces stay in sync.

import { forwardRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { envChipStyle } from "@/components/ui/color-picker";
import { PROJECT_ENVS, PROJECT_ENV_META } from "@/pages/ProjectDetailPage";
import { useLocale, useT } from "@/lib/blocks/i18n";
import type { CanonicalEnvSlug } from "@/lib/validation";
import type { ProjectCustomEnv } from "@/lib/blocks/data";

const VISIBLE_LIMIT = 4;

interface ChipEntryCommon {
  slug: string;
  label: string;
}

export type EnvChip =
  | (ChipEntryCommon & {
      kind: "canonical";
      className: string;
    })
  | (ChipEntryCommon & {
      kind: "custom";
      color: string;
    });

interface EnvironmentChipsProps {
  customEnvs: ProjectCustomEnv[];
  /**
   * `link` — render each chip as a button that navigates to
   *   `/projects/:projectId/:slug` (project card).
   * `static` — render each chip as a non-interactive span (info page).
   */
  mode: "link" | "static";
  /** Required when mode === "link". */
  projectId?: string;
}

export function EnvironmentChips({
  customEnvs,
  mode,
  projectId,
}: EnvironmentChipsProps) {
  const navigate = useNavigate();
  const { t } = useLocale();

  // Build the full env list once in display order (canonical → custom)
  // so the chip row and the dropdown see the same sequence. Canonical
  // labels use the *short* form (Dev/Stg/Prod/Uat) on both surfaces —
  // the long-form "projectEnv.env*" keys describe the full env name and
  // are not what a chip should show.
  const allEnvs: EnvChip[] = [
    ...PROJECT_ENVS.map((slug) => {
      const meta = PROJECT_ENV_META[slug as CanonicalEnvSlug];
      return {
        kind: "canonical" as const,
        slug,
        label: t(
          `projectCard.env${slug.charAt(0).toUpperCase() + slug.slice(1)}`,
          meta.shortLabel,
        ),
        className: meta.className,
      };
    }),
    ...customEnvs.map((env) => ({
      kind: "custom" as const,
      slug: env.slug,
      label: env.label || env.slug,
      color: env.color || "#0ea5e9",
    })),
  ];

  const visible = allEnvs.slice(0, VISIBLE_LIMIT);
  const overflow = allEnvs.slice(VISIBLE_LIMIT);

  const goTo = (slug: string) => {
    if (mode === "link" && projectId) {
      // Canonical env-menu URL — every env-scoped click lands on
      // `/projects/<id>/<envSlug>/features` (the `FeaturesPage` for
      // that env), so the sidebar's "Features" item, the env chip on
      // a project card, and the post-rename redirect all share one
      // URL pattern. The plain `/projects/<id>/<envSlug>` route
      // (ProjectDetailPage) still exists and is reachable via
      // browser history / deep-links, but no in-app menu surfaces
      // it anymore. User asked (2026-09-29): every env menu should
      // follow the `/features` URL pattern.
      navigate(`/projects/${projectId}/${slug}/features`);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visible.map((env) => (
        <EnvChipButton
          key={env.slug}
          env={env}
          mode={mode}
          onActivate={() => goTo(env.slug)}
        />
      ))}
      {overflow.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t(
                "projectCard.moreEnvironments",
                "{count, plural, =1 {1 more environment} other {# more environments}}",
                { count: overflow.length },
              )}
              className="inline-flex h-5 shrink-0 items-center rounded-full border border-border bg-background px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[state=open]:bg-accent"
            >
              +{overflow.length}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {overflow.map((env) => (
              <DropdownMenuItem
                key={env.slug}
                onSelect={() => goTo(env.slug)}
                asChild={mode === "link"}
              >
                <EnvChipButton env={env} mode={mode} />
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

// Renders a single env chip in either interactive (`mode="link"`) or
// decorative (`mode="static"`) form. Keeps the styling identical
// between inline and overflow so the two surfaces look the same.
//
// `forwardRef` is load-bearing here: the overflow path renders the chip
// inside `<DropdownMenuItem asChild>`, which uses Radix's `Slot` to
// merge its event handlers (including `onSelect`) onto the immediate
// child via a ref. Without `forwardRef`, React warns
// "Function components cannot be given refs" and the ref never lands
// on the inner `<button>` — Radix's `onSelect` never fires, so clicks
// on overflow chips did nothing (verified 2026-09-27: manager added
// custom env, clicked chip in the +N dropdown, nothing happened;
// console showed the Slot/ref warning with `EnvChipButton` in the
// stack). The inline path works regardless because it wires `onClick`
// directly via the `onActivate` prop — but `forwardRef` doesn't hurt
// the inline path either. `HTMLAttributes<HTMLButtonElement>` is
// spread on the inner button so callers (Radix, parent buttons) can
// pass through arbitrary DOM props.
const EnvChipButton = forwardRef<
  HTMLButtonElement,
  {
    env: EnvChip;
    mode: "link" | "static";
    onActivate?: () => void;
  } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function EnvChipButton(
  { env, mode, onActivate, className: passedClassName, ...rest },
  ref,
) {
  const t = useT();

  // Merge the slot-injected className (e.g. DropdownMenuItem's
  // `cursor-default …` on the overflow path) WITH the chip's own
  // classes. Order matters here: `cn()` runs tailwind-merge which
  // dedupes conflicting utilities and keeps the LAST one in the
  // argument list. If `passedClassName` comes after `cursor-pointer`,
  // tailwind-merge drops our `cursor-pointer` in favour of the
  // parent's `cursor-default` — verified 2026-09-27: chips in the +N
  // dropdown showed `cursor: default` despite both classes being
  // passed. Putting `passedClassName` FIRST means our chip's
  // `cursor-pointer` (and `rounded-full` / `text-xs` / etc.) are the
  // last occurrence, so they win the dedupe.
  const className = cn(
    passedClassName,
    "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
    env.kind === "canonical"
      ? `${env.className} hover:brightness-95 active:brightness-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`
      : "border-transparent hover:brightness-95 active:brightness-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    // `<button type="button">` doesn't get `cursor: pointer` by default
    // (only `<a href>` does), so the link-mode chips need it explicitly.
    // Without this the chips looked non-interactive even though clicks
    // worked after the forwardRef fix.
    mode === "link" && "cursor-pointer",
  );

  const style =
    env.kind === "custom" ? envChipStyle(env.color) : undefined;

  const ariaLabel =
    env.kind === "canonical"
      ? t(
          `projectCard.env${env.slug.charAt(0).toUpperCase() + env.slug.slice(1)}`,
          env.label,
        )
      : env.label;

  if (mode === "link") {
    return (
      <button
        ref={ref}
        type="button"
        onClick={onActivate}
        aria-label={ariaLabel}
        className={className}
        style={style}
        title={env.label}
        {...rest}
      >
        {env.label}
      </button>
    );
  }
  return (
    <span className={className} style={style}>
      {env.label}
    </span>
  );
});
