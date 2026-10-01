// Custom multi-select dropdown for picking which verification targets a
// credential should bind to.
//
// We started with a native `<select>` (single-select) and a single-target
// binding model. The user asked for one credential to bind to several
// URLs — e.g. the same QA account on GitHub, Stripe, Slack — so the
// dropdown became a checkbox list and the orchestration turns the
// checkbox set into a diff-based N PATCHes against target.credentialId.
//
// Why a custom Radix DropdownMenu instead of a native multi-select:
//   1. Native `<select multiple>` has no room for a two-line layout
//      (name on top, URL below in muted text). Real-world targets like
//      "https://github.com/.../feature-tracker/pulls" used to truncate
//      mid-host.
//   2. There's no way to render a "Bound to X" amber badge on each
//      option in a native control — we want the user to see which
//      targets are currently held by another secret before they
//      displace them.
//   3. We want a polished trigger button — current selection summary
//      with a count chip and a name preview, instead of a one-line
//      OS-styled listbox.
//
// The component stays specific to VerificationTarget rather than a
// generic `<Select>` replacement — the layout (checkbox + icon + name
// + URL + binding badge) only makes sense in this domain. SecretCard
// and SecretForm both consume it.

import {
  Link2,
  Link2Off,
  ChevronDown,
  Globe,
  Tag,
  Check,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { VerificationTarget } from "@/types/issue-tracker";

interface TargetSelectProps {
  /** DOM id for the trigger (lets a `<Label htmlFor>` reach it). */
  id?: string;
  /** Currently selected targetIds (empty array = not bound anywhere). */
  value: string[];
  /** Fires with the next full set of selected targetIds whenever the
   *  user toggles a checkbox. The parent computes the diff and only
   *  dispatches PATCHes for changed targets. */
  onChange: (next: string[]) => void;
  /** Every configured verification target. Disabled targets stay
   *  selectable but render dimmed so the user can pre-bind a credential
   *  for when the target is re-enabled. */
  targets: VerificationTarget[];
  /** Map targetId → name of the secret currently bound to that
   *  target. Each option shows a "Bound to X" amber badge when its
   *  binding is held by a secret OTHER than `currentSecretName`. */
  boundSecretByTargetId?: Record<string, string>;
  /** When re-binding an existing secret, pass its display name. The
   *  component suppresses the "Bound to X" badge on the entries where
   *  this secret is the current holder (the user knows those are
   *  theirs) — every other bound entry still shows the badge so the
   *  user can see who they'd be displacing. */
  currentSecretName?: string;
  /** When true the trigger renders inert and the menu is closed. */
  disabled?: boolean;
  /** Optional extra classes for the trigger button. */
  triggerClassName?: string;
}

export function TargetSelect({
  id,
  value,
  onChange,
  targets,
  boundSecretByTargetId = {},
  currentSecretName,
  disabled = false,
  triggerClassName,
}: TargetSelectProps) {
  // Resolve the selected targets once so both the trigger summary and
  // the dropdown items can read stable references. Re-derived on every
  // render — the cost is a single .filter over ~10 rows.
  const selected = targets.filter((t) => value.includes(t.id));

  const isEmpty = targets.length === 0;
  const selectedCount = selected.length;

  // Toggling a checkbox: idempotent add/remove on the parent's array.
  // Returning a fresh array reference is important — React's state
  // equality is reference-based and skipping this would silently drop
  // the click handler's effect on the parent.
  const toggle = (targetId: string) => {
    if (value.includes(targetId)) {
      onChange(value.filter((id) => id !== targetId));
    } else {
      onChange([...value, targetId]);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        id={id}
        disabled={disabled}
        // Match the previous native <select> height (h-10) so the
        // surrounding layout doesn't shift when this swap lands.
        className={cn(
          "group inline-flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-sm transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 data-[state=open]:bg-accent/40 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
          triggerClassName,
        )}
        aria-label={
          selectedCount === 0
            ? "Not bound to any target. Pick targets to bind."
            : selectedCount === 1
              ? `Bound to ${selected[0]!.applicationName}. Change targets.`
              : `Bound to ${selectedCount} targets. Change targets.`
        }
      >
        <span className="flex min-w-0 items-center gap-2">
          {selectedCount > 0 ? (
            <Link2
              className="h-4 w-4 shrink-0 text-primary"
              aria-hidden="true"
            />
          ) : (
            <Link2Off
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          )}
          <span className="min-w-0 flex-1 truncate">
            {selectedCount === 0 ? (
              <span className="text-sm text-muted-foreground">
                Not bound to any target
              </span>
            ) : selectedCount === 1 ? (
              <span className="flex min-w-0 items-baseline gap-1.5">
                <span className="truncate text-sm font-medium text-foreground">
                  {selected[0]!.applicationName}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {selected[0]!.url}
                </span>
              </span>
            ) : (
              <span className="flex min-w-0 items-baseline gap-1.5">
                <span className="truncate text-sm font-medium text-foreground">
                  Bound to {selectedCount} targets
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {previewNames(selected)}
                </span>
              </span>
            )}
          </span>
        </span>
        <ChevronDown
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
          aria-hidden="true"
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        // Wide enough to fit a full GitHub URL + badge on one line —
        // the longest realistic label we see today. Caps at 28rem so
        // the dropdown doesn't stretch past the form card on small
        // viewports.
        className="w-[min(28rem,calc(100vw-2rem))] p-1"
      >
        {/* Header strip — echoes the current selection count so the
            user always sees the state without scrolling. */}
        <DropdownMenuLabel className="flex items-center justify-between gap-2 text-xs font-normal normal-case tracking-normal text-muted-foreground">
          <span>Verification targets</span>
          <span
            className={cn(
              "inline-flex h-5 min-w-[1.5rem] items-center justify-center rounded-full px-1.5 text-[10px] font-semibold uppercase tracking-wide",
              selectedCount > 0
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground",
            )}
            aria-live="polite"
          >
            {selectedCount === 0
              ? "None"
              : selectedCount === 1
                ? "1 selected"
                : `${selectedCount} selected`}
          </span>
        </DropdownMenuLabel>

        {isEmpty && (
          <DropdownMenuLabel className="text-xs font-normal normal-case tracking-normal text-muted-foreground">
            No verification targets yet. Add one in the Verification
            Targets section to enable binding.
          </DropdownMenuLabel>
        )}

        {/* Per-target entries. Each is a tappable checkbox row: tap
            anywhere on the row to toggle, with a leading check icon
            that lights up when selected. Targets bound to a DIFFERENT
            credential are disabled (one-target-one-secret invariant) —
            the user must unbind that other credential first. Targets
            bound to the CURRENT credential stay enabled so the user
            can unbind them. */}
        {targets.map((t) => {
          const isSelected = value.includes(t.id);
          const boundSecretName = boundSecretByTargetId[t.id];
          // Locked = held by some other credential. Show the "Already
          // bound" chip and block the row.
          const boundToOtherSecret =
            boundSecretName !== undefined &&
            boundSecretName !== currentSecretName;
          return (
            <DropdownMenuItem
              key={t.id}
              disabled={boundToOtherSecret}
              onSelect={(e) => {
                // Prevent the menu from auto-closing — we want the
                // user to keep toggling without reopening the
                // dropdown on every click. Radix supports
                // onSelect(e.preventDefault()) for exactly this.
                e.preventDefault();
                toggle(t.id);
              }}
              // Disabled targets stay selectable (so the user can
              // pre-bind) — we just dim them with opacity-60 below.
              // Don't pass `disabled` to Radix or it will skip the
              // onSelect entirely.
              className={cn(
                "flex items-start gap-2 py-2",
                t.enabled === false && "opacity-60",
              )}
            >
              {/* Checkbox indicator — same column as the icon, so
                  the layout doesn't shift when selection changes. */}
              <span
                className={cn(
                  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors",
                  isSelected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-background text-transparent",
                )}
                aria-hidden="true"
              >
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
              <Globe
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0",
                  isSelected ? "text-primary" : "text-muted-foreground",
                )}
                aria-hidden="true"
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-baseline gap-1.5">
                  <span
                    className={cn(
                      "truncate text-sm",
                      isSelected
                        ? "font-semibold text-foreground"
                        : "font-medium text-foreground",
                    )}
                  >
                    {t.applicationName}
                  </span>
                  {!t.enabled && (
                    <span className="rounded-full border border-border bg-muted px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Disabled
                    </span>
                  )}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {t.url}
                </span>
              </span>
              {boundToOtherSecret && (
                <span
                  className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400"
                  title={`This target is already bound to "${boundSecretName}". Unbind it there first.`}
                >
                  <Tag className="h-3 w-3" aria-hidden="true" />
                  Already bound to {boundSecretName}
                </span>
              )}
            </DropdownMenuItem>
          );
        })}

        {/* Footer hint — only shown when at least one selected
            target is currently held by a different secret. The
            one-target-one-secret invariant means saving will be
            blocked until those targets are unbound from their current
            holder. The form below repeats the same warning inline. */}
        {value.some(
          (id) =>
            boundSecretByTargetId[id] !== undefined &&
            boundSecretByTargetId[id] !== currentSecretName,
        ) && (
          <>
            <DropdownMenuSeparator />
            <p className="px-2 pb-1 pt-0.5 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
              Some selected targets are held by other credentials.
              Saving will be blocked — unbind them first.
            </p>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Compact preview of the first few selected names for the trigger
// summary. "A, B and 1 more" style — keeps the trigger one line even
// when the user has bound to many targets.
function previewNames(selected: VerificationTarget[]): string {
  if (selected.length === 0) return "";
  if (selected.length === 1) return selected[0]!.applicationName;
  if (selected.length === 2)
    return `${selected[0]!.applicationName}, ${selected[1]!.applicationName}`;
  return `${selected[0]!.applicationName}, ${selected[1]!.applicationName} and ${selected.length - 2} more`;
}
