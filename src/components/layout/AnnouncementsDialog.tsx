// Announcement broadcast modal — opened from the dashboard's top-right
// "Announcements" pill. Renders the same `<AnnouncementsPanel>` content
// as the dashboard's inline section but inside a Radix Dialog with a
// fixed title and a scrolling body. The panel is rendered with
// `expandedByDefault={true}` so opening the modal always reveals the
// full history; the "Show N more" toggle stays hidden because every
// row is already visible.
//
// Right-drawer animation:
// The base `DialogContent` wrapper (in `@/components/ui/dialog`) is
// wired with `data-[state=open]:zoom-in-95` + `data-[state=open]:fade-in-0`
// for a centred-card open. Those classes set `animation-name`, which
// collides with our `dialog-from-right` keyframe — in the CSS cascade
// the centred zoom wins (or interpolates against the slide), so the
// modal looked like it slid in from the centre instead of from the
// right edge. To win cleanly we bypass the wrapper and mount
// `DialogPrimitive.Content` ourselves with only the slide animations,
// plus a static `right: 0` to pin the resting position to the viewport
// edge.
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
            "fixed inset-0 z-50 bg-[hsl(var(--overlay))]/60",
            "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            // Position: pin to viewport right edge (no `left-[50%]
            // translate-x-[-50%]` — that would fight the keyframe's
            // `transform: translateX()`, making the drawer slide in
            // from the centre and then snap right when the animation
            // ends). Width is half the viewport horizontally so the
            // broadcast channel can show the megaphone + content +
            // Latest pill + Repost/Edit/Hide actions on a single row
            // without compressing the body copy. `min-w-[20rem]`
            // keeps the drawer readable on narrow phones (a literal
            // 50% on a 360px viewport would leave the content
            // unreadable); `max-w-[48rem]` caps it on ultrawide
            // monitors so the drawer doesn't swallow the whole screen.
            "fixed right-0 top-0 bottom-0 z-50 grid w-1/2 min-w-[20rem] max-w-[48rem]",
            // Drawer chrome. The left edge is a 2px strong border so
            // it's unambiguously visible against the page background
            // in both modes (the original `border-border` single-px
            // edge disappeared on dark surfaces). `shadow-2xl` gives
            // the drawer decisive elevation above the dimmed overlay.
            // `rounded-l-2xl` carves a more pronounced curve at the
            // left corners so the drawer reads as a deliberate
            // surface rather than a full-bleed overlay pane. The
            // subtle inset ring (`ring-black/5` light, `ring-white/5`
            // dark) adds an inner highlight on the rounded corners
            // without competing with the border.
            "h-screen gap-0 overflow-hidden border-l-2 border-border-strong bg-background p-0",
            "shadow-2xl sm:rounded-l-2xl sm:rounded-r-none",
            "ring-1 ring-inset ring-black/[0.04] dark:ring-white/[0.06]",
            // Slide animations. These are the only animation-name
            // declarations on the element — no `zoom-in-95` /
            // `fade-in-0` to fight them in the cascade. Because the
            // modal has no other `transform-*` classes, the keyframe's
            // `transform` is the sole owner of `transform` for the
            // lifetime of the animation, so the slide is purely
            // horizontal.
            "data-[state=open]:animate-dialog-from-right data-[state=closed]:animate-dialog-to-right",
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
          {/* Body container gives the panel a defined height so its
              internal flex layout can pin the composer at the top
              (`shrink-0`) and scroll only the announcement list
              (`flex-1 overflow-y-auto`). The drawer is full viewport
              height (100vh), so this region fills the remaining
              100vh - 64px after the pinned header row. */}
          <div className="h-[calc(100vh-64px)] p-0">
            <AnnouncementsPanel expandedByDefault />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </Dialog>
  );
}
