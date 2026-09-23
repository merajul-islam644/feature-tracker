import { Toaster as Sonner } from "sonner";
import { useThemeStore, applyTheme } from "@/store/themeStore";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/*
 * Sonner toaster — see DESIGN-APP-v1.md §7.21.
 * Toasts: rounded-xl border shadow-elevated.
 * Icons: success CheckCircle2, error CircleAlert, warning TriangleAlert.
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
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-card-foreground group-[.toaster]:border-border group-[.toaster]:shadow-elevated group-[.toaster]:rounded-xl",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          success: "group-[.toaster]:border-emerald-500/40",
          error: "group-[.toaster]:border-destructive/40",
          info: "group-[.toaster]:border-sky-500/40",
          warning: "group-[.toaster]:border-amber-500/40",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
