import { Toaster as Sonner } from "sonner";
import { useThemeStore, applyTheme } from "@/store/themeStore";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  // Determine effective theme for Sonner (light/dark only - "system" is resolved here).
  const mode = useThemeStore((s) => s.mode);
  const resolved = (() => {
    if (mode === "dark") return "dark";
    if (mode === "light") return "light";
    if (typeof window === "undefined") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  })();

  // Keep Sonner in sync when the persisted theme changes (applyTheme is a no-op
  // for non-system modes, but the document <html> class list is what Sonner reads).
  void applyTheme;

  return (
    <Sonner
      theme={resolved}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          success: "group-[.toaster]:border-green-500",
          error: "group-[.toaster]:border-destructive",
          info: "group-[.toaster]:border-primary",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
