// Announcement broadcast modal — opened from the topbar speaker
// button. Renders the same `<AnnouncementsPanel>` content as the
// dashboard's inline section but inside a Radix Dialog with a fixed
// title and a scrolling body. The panel is rendered with
// `expandedByDefault={true}` so opening the modal always reveals
// the full history; the "Show N more" toggle stays hidden because
// every row is already visible.
//
// Top-sheet animation:
// The base `DialogContent` wrapper (in `@/components/ui/dialog`) is
// wired with `data-[state=open]:zoom-in-95` + `data-[state=open]:fade-in-0`
// for a centred-card open. Those classes set `animation-name`, which
// collides with our `dialog-from-top` keyframe — in the CSS cascade
// the centred zoom wins (or interpolates against the slide), so the
// modal looked like it slid in from the side instead of sliding
// straight down from above. To win cleanly we bypass the wrapper and
// mount `DialogPrimitive.Content` ourselves with only the slide
// animations, plus a static `top: 0` to pin the resting position to
// the viewport edge.
//
// Usage:
//
//   <AnnouncementsDialog>
//     <button>...</button>          // any single trigger element
//   </AnnouncementsDialog>
//
// The dialog state is managed internally via Radix's uncontrolled
// open — opening/closing happens through `DialogTrigger` /
// `DialogClose`. Callers don't need to thread `open` /
// `onOpenChange` through props.

import { type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Megaphone, X } from "lucide-react";
import { useT } from "@/lib/blocks/i18n";
import { AnnouncementsPanel } from "@/components/dashboard/AnnouncementsPanel";
import {
  Dialog,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface AnnouncementsDialogProps {
  /** The element that opens the modal when clicked. */
  children: ReactNode;
  /**
   * Optional controlled `open` state. When provided (with
   * `onOpenChange`), the dialog is fully controlled — useful for
   * auto-opening on a new announcement arriving. When omitted, the
   * dialog falls back to Radix's default uncontrolled state (the
   * trigger + close button manage open/close on their own).
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function AnnouncementsDialog({
  children,
  open,
  onOpenChange,
}: AnnouncementsDialogProps) {
  const t = useT();

  // Spread `{ open, onOpenChange }` only when at least one is
  // provided — passing both as `undefined` would be a no-op for
  // Radix's `useControllableState`, but spreading an empty object
  // keeps the call site readable when comparing to the existing
  // uncontrolled usage.
  const controlledProps: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  } = {};
  if (open !== undefined) controlledProps.open = open;
  if (onOpenChange !== undefined) controlledProps.onOpenChange = onOpenChange;

  return (
    <Dialog {...controlledProps}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogPrimitive.Portal>
        {/* Overlay keeps the same fade pattern the shared DialogOverlay
            uses, but is mounted locally so the slide animation can't
            be cross-coupled with anything inside the modal. */}
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[2px]",
            "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            // Position: pin to viewport top, centre horizontally with
            // `inset-x-0` + `mx-auto` (NOT `left-[50%] translate-x-[-50%]`
            // — that would fight the keyframe's `transform: translateY()`,
            // making the modal slide in from the left edge and then snap
            // to centre when the animation ends). Width is "as wide as
            // possible, capped at 1600px" so it reads as a top dashboard
            // strip on ultrawide monitors and as a wide panel on smaller
            // screens. 90vh keeps the bottom edge clear of the viewport
            // so the rounded corners actually look like a drawer.
            "fixed inset-x-0 top-0 z-50 mx-auto grid w-[calc(100vw-2rem)] max-w-[min(1600px,calc(100vw-2rem))]",
            "max-h-[90vh] gap-0 overflow-hidden border-0 bg-background p-0",
            "shadow-dialog sm:rounded-b-xl sm:rounded-t-none",
            // Slide animations. These are the only animation-name
            // declarations on the element — no `zoom-in-95` /
            // `fade-in-0` to fight them in the cascade. Because the
            // modal has no other `transform-*` classes (no
            // translate-x-[-50%]), the keyframe's `transform` is the
            // sole owner of `transform` for the lifetime of the
            // animation, so the slide is purely vertical.
            "data-[state=open]:animate-dialog-from-top data-[state=closed]:animate-dialog-to-top",
          )}
        >
          <div className="flex flex-row items-center justify-between space-y-0 border-b border-border px-5 py-4">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold leading-none tracking-tight text-foreground">
              <Megaphone
                className="h-4 w-4 text-primary"
                aria-hidden="true"
              />
              {t("announcements.title", "Announcements")}
            </DialogTitle>
            <DialogPrimitive.Close
              aria-label="Close dialog"
              className="rounded-md p-1 text-muted-foreground opacity-70 transition-opacity hover:bg-accent hover:text-foreground hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>
          {/* Body scrolls independently so composer stays pinned at the
              top regardless of how much history is loaded. `min-h-0`
              on the parent flex keeps the scroll area from overflowing
              the dialog's max-height. The 64px offset covers the
              pinned header row. */}
          <div className="max-h-[calc(90vh-64px)] overflow-y-auto p-0">
            <AnnouncementsPanel expandedByDefault />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </Dialog>
  );
}
