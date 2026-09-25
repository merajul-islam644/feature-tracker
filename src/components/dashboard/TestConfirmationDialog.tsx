// Production deployment notice — opens from the "Test" button next
// to the Announcements pill on the dashboard. Started as an
// amber-tinted card mirroring the AI Assistant's
// `request_tool_permission` card (see `ChatMessage.tsx`), then
// evolved into a dark "system notification" surface so the message
// could read as quoted white text in both themes. Amber stays as the
// accent treatment (border, inner ring, close icon, avatar halo) so
// the card still reads as an "important operational notice" — not a
// generic dark modal — and is consistent with the amber-tinted Test
// pill that opens it.
//
// Polish notes (light vs. dark mode):
// * Dark slate card surface (`bg-slate-900` light, `bg-slate-950`
//   dark) — supports the message's `text-white` declaration in either
//   theme without a per-mode override. Amber stays as the accent
//   treatment (border + inner ring + close icon + avatar halo) so
//   the card still reads as a deliberate "system notification"
//   surface rather than a generic dark modal.
// * `text-white` (no `dark:` variant) — the quoted message is pure
//   white in both themes, the same as a printed quote on a notice
//   board. Curly quotes (`&ldquo;` … `&rdquo;`) wrap the sentence.
// * Inset ring (`ring-amber-500/30`) ties the dark slate fill back to
//   the amber accent system.
// * Avatar halo (`bg-white` light, `bg-slate-800` dark) + saturated
//   amber ring (500 / 400) keeps the badge clearly distinct from the
//   dark slate card in both modes.
//
// Closing still works via overlay click or the Esc key (Radix
// defaults). The trigger lives in `DashboardPage.tsx` next to the
// Announcements pill.

import { type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useAnnouncements } from "@/lib/blocks/hooks";
import { lookupUserById, useAllJoinedUsers } from "@/lib/blocks/users";
import { cn } from "@/lib/utils";

interface TestConfirmationDialogProps {
  /**
   * The element that opens the modal when clicked. Required for the
   * uncontrolled usage (a `<button>` trigger). When the modal is
   * mounted in controlled mode from `DashboardPage` (driven by
   * `useAnnouncementsAutoOpen`), no children are needed — the parent
   * flips `open` directly without a click handler.
   */
  children?: ReactNode;
  /**
   * Optional controlled `open` state. When provided (with
   * `onOpenChange`), the dialog is fully controlled — used by
   * `useAnnouncementsAutoOpen` so the modal pops for every other
   * member when a manager posts or reposts an announcement. When
   * omitted, the dialog falls back to Radix's default uncontrolled
   * state (the trigger + close button manage open/close on their
   * own), which is what the dashboard Test button uses.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function TestConfirmationDialog({
  children,
  open,
  onOpenChange,
}: TestConfirmationDialogProps) {
  // The avatar outside the amber card is a "from <user>" badge —
  // reads as the signed-in member whose deployment notice this is.
  // Falls back to a generic "User" label when auth hasn't hydrated
  // yet (rare, but matches the defensive pattern in `ChatMessage`).
  const { currentUser } = useAuth();

  // Spread `{ open, onOpenChange }` only when at least one is
  // provided so the uncontrolled Test-button mount keeps Radix's
  // internal open/close bookkeeping (no flicker from `undefined`
  // being treated as a re-open every render).
  const controlledProps: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  } = {};
  if (open !== undefined) controlledProps.open = open;
  if (onOpenChange !== undefined) controlledProps.onOpenChange = onOpenChange;
  // The dialog's signature is attributed to the AUTHOR of the most
  // recent announcement, not to whoever happens to open the dialog.
  // Without this hop, a manager posting the deployment notice would
  // be displayed as if it came from the viewer — so a tester opening
  // the Test button would see "— Tester Meraj" instead of the actual
  // sender, which reads as "the tester sent this" rather than "this
  // deployment notice was authored by a manager". We read
  // `useAnnouncements()` (sorted by `LastUpdatedDate` desc, same
  // ordering as `AnnouncementsPanel`'s active broadcast) and resolve
  // the author via the live roster, falling back to the hardcoded
  // `lookupUserById` (mirroring `AnnouncementCard`) for deleted
  // accounts. If nothing has been posted yet (fresh deployment, no
  // row), we degrade gracefully to the viewer — better than an
  // empty card or a "Loading…" placeholder on a system-wide dialog.
  const announcements = useAnnouncements().data ?? [];
  const latestAnnouncement = announcements[0];
  const roster = useAllJoinedUsers().data ?? [];
  const rosterById = new Map(roster.map((m) => [m.id, m]));
  const senderRecord =
    (latestAnnouncement
      ? rosterById.get(latestAnnouncement.authorId) ?? undefined
      : undefined) ??
    lookupUserById(latestAnnouncement?.authorId);
  const senderName =
    senderRecord?.name ??
    (latestAnnouncement ? currentUser?.name ?? "User" : currentUser?.name ?? "User");
  // Designation falls back to the sender's first IAM role (e.g.
  // "manager", "tester") — same logic that used to apply to
  // `currentUser`. When the sender is unresolvable (deleted account,
  // empty roster) we skip the designation line entirely so the
  // signature doesn't dangle with a blank second row.
  const senderRole =
    (senderRecord && "role" in senderRecord
      ? (senderRecord as { role?: string }).role
      : undefined) ??
    (latestAnnouncement
      ? currentUser?.roles?.[0]
      : currentUser?.roles?.[0]) ??
    "";
  const designation = senderRole ? senderRole.replace(/^./, (c) => c.toUpperCase()) : "";
  const avatarName = senderName;
  // Pass through `currentUser.id` for the avatar image fallback —
  // when the sender can't be resolved the avatar falls back to the
  // viewer's initials so the corner halo still has something to
  // show. Cheap and avoids a second lookup table.
  const avatarUserId = senderRecord?.id ?? currentUser?.id;

  // Modal body — prefer the most recent announcement's content over
  // the hardcoded "production deployment" sentence. When a manager
  // posts "Code freeze starts now." the modal should pop with THAT
  // message, not a stale smoke-test line that has nothing to do
  // with what the manager just broadcast. Falls back to the legacy
  // text when no announcement row exists (defensive — the auto-open
  // hook only fires when there IS a fresh delivery, so the fallback
  // is essentially unreachable in practice, but keeps the modal
  // renderable if someone opens it via a stray trigger path).
  const ANNOUNCEMENT_FALLBACK =
    "“The production deployment is complete. Please smoke-test your areas and report anything unusual right away.”";
  const announcementText = latestAnnouncement?.content?.trim() ?? "";
  // Wrap the announcement in the same curly quotes the legacy
  // template used so the rendered card reads as an attributed
  // statement regardless of which path fed the text. Empty
  // announcement content (deleted mid-render, etc.) drops back to
  // the fallback so the modal never shows a blank quote.
  const displayContent = announcementText
    ? `“${announcementText}”`
    : ANNOUNCEMENT_FALLBACK;

  return (
    // Spread `controlledProps` onto the Radix Root so `open` and
    // `onOpenChange` from `useAnnouncementsAutoOpen` actually drive
    // the modal. Without this the Root runs uncontrolled and our
    // `open={true}` flips from the parent are silently dropped — the
    // modal never opens even when the hook fires.
    <DialogPrimitive.Root {...controlledProps}>
      {/* `DialogTrigger asChild` forwards the trigger behaviour onto
          the caller's button — without it, the button is just a
          regular button that renders but never opens the dialog.
          Rendered only when a child trigger is provided (the
          uncontrolled mount from the dashboard Test button used to
          pass a `<button>` here). The controlled mount from
          `DashboardPage` skips the trigger entirely because Radix's
          `Trigger asChild` requires a single React element child —
          passing `undefined` would throw. With no trigger and a
          controlled `open` prop, the dialog is fully driven by the
          parent state. */}
      {children && (
        <DialogPrimitive.Trigger asChild>
          {children}
        </DialogPrimitive.Trigger>
      )}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-[hsl(var(--overlay))]/60",
            "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
          )}
        />
        {/* The modal content holds both the amber card (centered)
            and the profile avatar perched on the card's top-left
            corner. The dialog content's bounding box includes the
            avatar's negative offset, so the `translate-x/y-[-50%]`
            centering automatically accounts for the avatar pulling
            the visual centre slightly up-and-left. Bypassing
            `@/components/ui/dialog`'s `DialogContent` (which adds
            the parent card chrome) keeps the visual identical to
            the AI Assistant's inline permission card
            (`ChatMessage.tsx`). */}
        <DialogPrimitive.Content
          className={cn(
            "fixed left-[50%] top-[50%] z-50 translate-x-[-50%] translate-y-[-50%] outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
        >
          <DialogPrimitive.Title className="sr-only">
            Production deployment notice
          </DialogPrimitive.Title>
          {/* Screen-reader description mirrors `displayContent` so AT
              users hear the same sentence sighted users see in the
              card. Falls back to a generic deployment notice when no
              announcement row is loaded (rare — auto-open only
              triggers on a fresh delivery). */}
          <DialogPrimitive.Description className="sr-only">
            {announcementText || "The production deployment is complete. Smoke-test your areas and report anything unusual right away."}
          </DialogPrimitive.Description>

          {/* Dark deployment card. Originally rendered an amber-tinted
              surface (`bg-amber-100` / `dark:bg-amber-950`) but the
              message text is now white in both modes — so the card
              fill moves to a deep slate (`bg-slate-900` light,
              `bg-slate-950` dark) which keeps `text-white` crisp in
              either theme. Amber stays as the accent treatment
              (border + inner highlight + close icon + avatar halo)
              so the card still reads as a deliberate "system
              notification" surface rather than a generic dark modal.
              `shadow-2xl` keeps the elevated card clearly above the
              dimmed overlay; `ring-1 ring-inset ring-amber-500/30`
              ties the dark fill back to the amber accent system.
              Sized generously (`min-w-[32rem]` + `min-h-[12rem]` +
              `p-6`) so the card reads as a hero-sized prompt.
              `relative` so the close button's `absolute` positioning
              anchors to the card itself, not the dialog container. */}
          <div
            className={cn(
              "relative min-w-[32rem] min-h-[12rem] rounded-lg border border-amber-500 bg-slate-900 p-6 shadow-2xl",
              "ring-1 ring-inset ring-amber-500/30",
              "dark:bg-slate-950",
            )}
          >
            {/* Top-right close affordance — mirrors the
                `AnnouncementsDialog` X button so the dismissal pattern
                is consistent across the app's dialogs. Coloured
                amber-300, which reads cleanly against the dark
                slate card in both modes. `ring-offset` matches the
                card's slate colour so the focus ring doesn't bleed
                onto the overlay. */}
            <DialogPrimitive.Close
              aria-label="Close dialog"
              className={cn(
                "absolute right-3 top-3 rounded-md p-1.5 text-amber-300 transition-colors",
                "hover:bg-amber-500/20",
                "focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-slate-900",
                "dark:hover:bg-amber-500/30 dark:focus:ring-amber-400 dark:focus:ring-offset-slate-950",
              )}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </DialogPrimitive.Close>

            {/* Deployment banner text — pure white in both themes so the
                quoted message reads as a crisp "broadcast-style"
                statement on top of the dark slate card. `text-white`
                without a `dark:` variant keeps the color identical
                across the page theme switch. The message is wrapped
                in typographic curly quotes (&ldquo; … &rdquo;) so
                the long sentence reads as an attributed statement
                rather than a free-text prompt. `text-xl` gives the
                quote enough weight on the hero-sized card;
                `leading-relaxed` keeps multi-line wraps comfortable
                to read. `pr-8` leaves room for the close button in
                the top-right corner. */}
            <p className="pr-8 text-xl font-medium leading-relaxed text-white">
              {displayContent}
            </p>

            {/* Sender signature — pinned to the card's bottom-right so
                the quote reads as an attributed statement ("from
                <user>"). The two lines (name + designation) live in a
                flex column with `items-end` so they right-align as a
                tight stack. `text-amber-300` mirrors the close-icon
                colour so the eye groups them as the card's accent
                surfaces. Rendered as a small label so it doesn't
                compete with the `text-xl` quote. `pointer-events-none`
                because the absolute sibling lives inside the card
                and we don't want it to swallow clicks intended for
                the close button (which sits `top-3`, not `bottom-3`,
                so the overlap risk is theoretical — defensive anyway).
                The designation line is gated on `designation` truthy
                so users without an IAM role don't get a dangling
                blank line under their name. */}
            <div
              className={cn(
                "pointer-events-none absolute bottom-3 right-4 flex flex-col items-end gap-0.5 text-right",
              )}
            >
              <span className="text-sm font-medium text-amber-300 dark:text-amber-300">
                — {avatarName}
              </span>
              {designation && (
                <span className="text-xs font-normal text-amber-300/80 dark:text-amber-300/80">
                  {designation}
                </span>
              )}
            </div>
          </div>

          {/* Profile avatar — perched on the dark card's top-left
              corner, with the negative offset so it visibly "breaks
              out" of the card boundary. The halo pad is white in
              light mode (clean contrast against slate-900) and a
              raised slate in dark mode (subtle but legible against
              slate-950). The saturated amber ring (`ring-amber-500`
              / `dark:ring-amber-400`) keeps the badge visible
              regardless of theme. `shadow-lg` lifts the badge above
              the card surface. */}
          <div
            className={cn(
              "absolute left-0 top-0 z-10 -translate-x-1/2 -translate-y-1/2 shrink-0 rounded-full p-0.5 shadow-lg ring-2 ring-amber-500",
              "bg-white",
              "dark:bg-slate-800 dark:ring-amber-400",
            )}
          >
            <UserAvatar
              userId={avatarUserId}
              name={avatarName}
              size="lg"
            />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
