// Environment chip list with overflow handling. Used by the project card
// (chips navigate to /projects/:id/:slug) and the project info page
// (chips are static, no navigation).
//
// Visual rules:
//   - First VISIBLE_LIMIT (4) envs render inline as chips.
//   - Anything beyond that collapses behind a `+N` trigger button on
//     the right; clicking opens a Radix dropdown listing the rest with
//     identical chip styling.
//   - Envs whose `kind` is canonical (dev/stg/prod/uat) use the fixed
//     Tailwind classes from ENV_KIND_META; custom envs use a hex-tinted
//     inline style via envChipStyle.
//
// Data source (schema v2.1): the project's blx_Environments rows via
// `useEnvironments(projectId)` — the component feeds itself, so callers
// only pass the project id. The row list includes custom envs naturally
// (they're rows too), ordered by `order`.
//
// Label rule (user asked, 2026-10-01): the card surface (`link` mode)
// shows the kind-derived SHORT form for canonical envs — Dev/Stg/Prod/
// UAT from PROJECT_ENV_META, whatever the row label says — while custom
// envs keep their row label. The static surface (project info page)
// keeps the full row label; it's a details view. The row label always
// rides along as `fullLabel` for the hover title / accessible name.
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
import {
  ENV_KIND_META,
  PROJECT_ENV_META,
  type CanonicalEnvSlug,
} from "@/pages/ProjectDetailPage";
import { useEnvironments } from "@/lib/blocks/hooks";
import { useT } from "@/lib/blocks/i18n";
import type { Environment } from "@/lib/blocks/data";

const VISIBLE_LIMIT = 4;

export interface EnvChipEntry {
  slug: string;
  label: string;
  /** The row label as stored — the accessible name / hover title, even
   *  when `label` renders a derived short form (canonical envs on the
   *  card surface). */
  fullLabel: string;
  /** The env's row identity — available to callers that need it. */
  environmentId: string;
  /** Tailwind classes for canonical kinds; undefined for custom envs. */
  className?: string;
  /** Hex color for custom envs (inline-tinted); undefined for canonical. */
  color?: string;
}

interface EnvironmentChipsProps {
  /**
   * `link` — render each chip as a button that navigates to
   *   `/projects/:projectId/:slug` (project card).
   * `static` — render each chip as a non-interactive span (info page).
   */
  mode: "link" | "static";
  /** Project whose env rows the chips render. */
  projectId?: string;
  /** Row override for callers that already hold the env list (skips the
   *  internal query — pass an empty array for "known no envs" so the
   *  internal read doesn't fire either). */
  envs?: Environment[];
}

export function EnvironmentChips({
  mode,
  projectId,
  envs: envsProp,
}: EnvironmentChipsProps) {
  const navigate = useNavigate();
  const t = useT();

  // When the caller supplies rows, the internal per-project read is
  // disabled entirely (projectId → null flips `enabled` off) — the
  // /projects page passes a workspace-wide map so N cards/rows cost one
  // env read total, not one each.
  const envsQuery = useEnvironments(
    envsProp !== undefined ? null : projectId ?? null,
  );
  const envs = envsProp ?? envsQuery.data ?? [];

  // Build the full env list once in row order (the `order` column —
  // canonical seeds 0/10/20/30, custom envs +10 past the max). Link
  // mode (project card) swaps a canonical env's row label for the
  // kind-derived short form; static mode (info page) keeps the row
  // label. `fullLabel` preserves the stored name either way.
  const allEnvs: EnvChipEntry[] = envs.map((env) => {
    const kindMeta = ENV_KIND_META[env.kind];
    if (kindMeta) {
      const shortLabel =
        mode === "link"
          ? PROJECT_ENV_META[env.kind as CanonicalEnvSlug]?.shortLabel ??
            env.label
          : env.label;
      return {
        slug: env.slug,
        label: shortLabel,
        fullLabel: env.label,
        environmentId: env.id,
        className: kindMeta.className,
      };
    }
    return {
      slug: env.slug,
      label: env.label,
      fullLabel: env.label,
      environmentId: env.id,
      color: env.color || "#0ea5e9",
    };
  });

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
    env: EnvChipEntry;
    mode: "link" | "static";
    onActivate?: () => void;
  } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function EnvChipButton(
  { env, mode, onActivate, className: passedClassName, ...rest },
  ref,
) {
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
    env.className
      ? `${env.className} hover:brightness-95 active:brightness-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`
      : "border-transparent hover:brightness-95 active:brightness-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    // `<button type="button">` doesn't get `cursor: pointer` by default
    // (only `<a href>` does), so the link-mode chips need it explicitly.
    // Without this the chips looked non-interactive even though clicks
    // worked after the forwardRef fix.
    mode === "link" && "cursor-pointer",
  );

  const style = env.color ? envChipStyle(env.color) : undefined;

  if (mode === "link") {
    return (
      <button
        ref={ref}
        type="button"
        onClick={onActivate}
        aria-label={env.fullLabel}
        className={className}
        style={style}
        title={env.fullLabel}
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
