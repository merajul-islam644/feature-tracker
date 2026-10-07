import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Small <Kbd> primitive — VS Code-style keycap. Used by the
 * WorkspacePage empty state to surface "⌘ + O" shortcut hints
 * without falling back to the inline `<kbd>` markup that lived at
 * EditorArea.tsx:46 and ExplorerSidebar.tsx:309.
 *
 * Visual: 20px-tall keycap with a 1px hairline border, subtle
 * inset shadow, monospace label. Stays neutral so it reads in both
 * light and dark surfaces without re-tinting.
 */
export const Kbd = React.forwardRef<
  HTMLElement,
  React.HTMLAttributes<HTMLElement>
>(function Kbd({ className, ...props }, ref) {
  return (
    <kbd
      ref={ref}
      className={cn(
        "inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground shadow-[0_1px_0_rgba(0,0,0,0.06)]",
        className,
      )}
      {...props}
    />
  );
});
