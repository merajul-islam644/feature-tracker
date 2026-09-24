// Floating AI Assistant launcher — see DESIGN-APP-v1.md §6.7 + §9.1 + §9.9.
//
// Closed: gradient pill with Sparkles icon + label "Ask Feature Tracker".
// During active verification: shows "Verifying · 62%" with a pulsing dot,
// so the launcher doubles as a verification status portal (§6.7).
// Open: 420px-wide expanded panel with chat-in animation.
// Layering: z-40 above Topbar (z-30), below z-50 sheets/menus.

import { useEffect, useState, type ComponentProps } from "react";
import { Bot, Sparkles, X } from "lucide-react";
import { ChatPanel } from "./ChatPanel";
import { cn } from "@/lib/utils";

type ChatPanelProps = ComponentProps<typeof ChatPanel>;

export interface ChatLauncherProps extends ChatPanelProps {
  /** Current verification progress percentage (0–100) when active. */
  runProgressPct?: number;
}

export function ChatLauncher({
  runProgressPct,
  ...props
}: ChatLauncherProps) {
  const [open, setOpen] = useState(false);

  // Escape closes while open — matches the sheet/drawer convention
  // without yanking focus (the input keeps its own key handling).
  // Layers go first: when a Radix sheet (the history panel) or dropdown
  // is open on top of the chat, the same Escape that dismisses it must
  // NOT also collapse the chat underneath.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const layerAbove = document.querySelector(
        '[role="dialog"][data-state], [data-radix-popper-content-wrapper]',
      );
      if (layerAbove) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const showActiveStatus = props.runActive && !open && runProgressPct != null;

  return (
    <>
      {open && (
        <div
          role="dialog"
          aria-label="AI Assistant chat"
          className={cn(
            "fixed z-40 flex animate-chat-in flex-col overflow-hidden rounded-2xl border bg-card shadow-dialog",
            // Mobile: bottom sheet, nearly full viewport.
            "inset-x-3 bottom-24 top-16",
            // Desktop: 420px panel pinned bottom-right above the launcher.
            "sm:inset-auto sm:bottom-24 sm:right-6 sm:h-[min(720px,calc(100vh-96px))] sm:w-[420px]"
          )}
        >
          <ChatPanel {...props} />
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={open ? "Close AI Assistant chat" : "Open AI Assistant chat"}
        className={cn(
          // `group/launcher` is the hover anchor for the label reveal
          // below. Naming the group keeps this button's hover from
          // colliding with any other `group` ancestor (e.g. the parent
          // sidebar's collapse group).
          "group/launcher fixed bottom-6 right-6 z-40 inline-flex h-12 items-center rounded-full",
          // Solid primary per DESIGN-SYSTEM-REWRITE.md §3 — the
          // indigo→violet gradient was retired in favour of the
          // signature single-accent system. The animate-ai-glow keyframe
          // still breathes a subtle halo around the button so the
          // launcher reads as the "AI is alive" affordance; users with
          // `prefers-reduced-motion: reduce` see a static shadow.
          "bg-primary text-primary-foreground",
          "animate-ai-glow",
          // Animate padding + gap together so the icon stays pinned
          // to the left as the label slides out. Width comes from
          // content; no explicit width animation needed.
          "transition-[padding,gap,box-shadow,transform] duration-300 ease-out",
          "hover:-translate-y-0.5",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          // Collapsed: 28px icon + 10px padding × 2 = 48px, matching
          // h-12 for a perfect circle. Symmetric `pl-2.5 pr-2.5` so the
          // icon stays visually centered on the resting state.
          // Hovered: left padding opens to 14px, gap-2 introduces
          // breathing room between icon and label, right padding
          // grows to 20px to leave trailing whitespace before the
          // rounded edge — no extra utility needed, the button
          // auto-grows to fit the label.
          "gap-0 pl-2.5 pr-2.5 hover:gap-2 hover:pl-3.5 hover:pr-5",
        )}
      >
        {/* Icon — sits directly on the gradient. The Bot icon is the
            universal "AI assistant" mark (Sparkles was too generic and
            could read as "new feature"); a soft white drop shadow keeps
            the icon legible against the violet end of the gradient.
            The X swaps in when the panel is open; the pulsing dot
            replaces the Bot while a verification run is in flight. */}
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center"
          aria-hidden="true"
        >
          {open ? (
            <X
              className="h-5 w-5 drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)]"
              aria-hidden="true"
            />
          ) : showActiveStatus ? (
            <span
              className="h-2.5 w-2.5 rounded-full bg-white animate-progress-pulse shadow-[0_0_8px_rgba(255,255,255,0.8)]"
              aria-hidden="true"
            />
          ) : (
            <Bot
              className="h-5 w-5 drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)]"
              aria-hidden="true"
            />
          )}
        </span>

        {/* Label — sits at max-w-0 + opacity-0 when collapsed, then
            expands and fades in on parent hover. `delay-75` lets the
            width growth lead the opacity so the text doesn't streak in
            before there's room for it. `aria-hidden` while collapsed
            keeps the SR announcement to a single concise button label. */}
        <span
          aria-hidden="true"
          className={cn(
            "overflow-hidden whitespace-nowrap text-sm font-medium",
            "max-w-0 opacity-0 transition-[max-width,opacity] duration-300 ease-out",
            "group-hover/launcher:max-w-[180px] group-hover/launcher:opacity-100",
            "group-hover/launcher:delay-75",
          )}
        >
          {open
            ? "Close chat"
            : showActiveStatus
              ? `Verifying · ${Math.round(runProgressPct!)}%`
              : "Ask Lattice"}
        </span>
      </button>
    </>
  );
}
