import { Toaster as Sonner } from "sonner";
import { useThemeStore, applyTheme } from "@/store/themeStore";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/*
 * Sonner toaster — see DESIGN-SYSTEM-REWRITE.md §3 "Toasts".
 * Compact system messages: rounded-lg, surface bg, border, shadow-lg.
 * Success / error / info / warning only tint the BORDER, so the surface
 * stays neutral and the icon carries the meaning.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const mode = useThemeStore((s) => s.mode);
  const resolved = (() => {
    if (mode === "dark") return "dark";
    if (mode === "light") return "light";
    if (typeof window === "undefined") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  })();

  void applyTheme;

  return (
    <Sonner
      theme={resolved}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-surface group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:rounded-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          success: "group-[.toaster]:border-success-border",
          error: "group-[.toaster]:border-destructive-border",
          info: "group-[.toaster]:border-info-border",
          warning: "group-[.toaster]:border-warning-border",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
