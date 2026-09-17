// Comments chip for a single flow row.
//
// Sits to the LEFT of the relative-time span on each flow row, between
// the Status chip and the time. Displays the count of comments on
// this flow and acts as the trigger for CommentsModal. The chip is a
// plain button (no dropdown) because the click target is a single
// destination — the comments form.
//
// Color: cyan, chosen to be distinct from the status/stack palettes
// (green/red/amber/violet/sky/indigo/slate) so the chip reads as a
// different kind of control (annotation, not state). When the count
// is 0 the chip falls back to the muted "unset" palette — same trick
// StatusChip / StackChip use for their placeholder labels.
//
// Read-only mode does NOT disable the chip — annotations are a
// read-write affordance independent of state ownership. Users on
// uat/prod can still view and post comments.

import { MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/blocks/i18n";

interface CommentsChipProps {
  /** Number of comments currently on this flow. */
  count: number;
  /** Open the CommentsModal. Called on click / Enter / Space. */
  onOpen: () => void;
}

export function CommentsChip({ count, onOpen }: CommentsChipProps) {
  const t = useT();
  return (
    <button
      type="button"
      aria-label={t("flowComments.chipLabel", "Comments")}
      onClick={(e) => {
        // Stop propagation so the click doesn't bubble to the parent
        // <li> in FeatureItem (which would trigger row-level clicks
        // / hover affordances). Matches the kebab's swallow pattern.
        e.stopPropagation();
        onOpen();
      }}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 text-[10px] font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        count > 0
          ? "border-cyan-300 bg-cyan-50 text-cyan-700 hover:bg-cyan-100"
          : "border-border bg-muted text-muted-foreground hover:bg-accent",
      )}
    >
      <MessageCircle className="h-3 w-3" aria-hidden="true" />
      <span>{t("flowComments.label", "Comments")}</span>
      <span className="font-semibold">{count}</span>
    </button>
  );
}
