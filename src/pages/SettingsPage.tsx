import { Link, useNavigate } from "react-router-dom";
import {
  Languages,
  LogOut,
  Monitor,
  Moon,
  Palette,
  RotateCcw,
  Sun,
  UserCog,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/useToast";
import { useLocale, useT } from "@/lib/blocks/i18n";
import { useUploadProfilePic } from "@/lib/blocks/hooks";
import {
  applyTheme,
  useThemeStore,
  type ThemeMode,
} from "@/store/themeStore";
import { cn } from "@/lib/utils";
import {
  UserAvatar,
} from "@/components/ui/UserAvatar";
import { Button } from "@/components/ui/button";
import { AIAvatarButton } from "@/components/settings/AIAvatarButton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ColorPicker } from "@/components/ui/color-picker";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

// Mirror the option list used by the topbar ThemeToggler so the three
// surfaces (topbar / settings / future command palette) stay in sync.
const THEME_OPTIONS: {
  value: ThemeMode;
  label: string;
  Icon: typeof Sun;
}[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

// `useT` looks up against the loaded `common` module. Page-level keys
// live under the `settings.*` namespace so future translations slot in
// alongside the existing `nav.*` keys.
export function SettingsPage() {
  const t = useT();
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const { language, setLanguage, availableLanguages } = useLocale();
  const themeMode = useThemeStore((s) => s.mode);
  const setThemeMode = useThemeStore((s) => s.setMode);
  const accentColor = useThemeStore((s) => s.accentColor);
  const setAccentColor = useThemeStore((s) => s.setAccentColor);

  useEffect(() => {
    toast.info(
      t("settings.loadedToast", "Settings loaded."),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tenant languages, in stable order: current language first, then
  // the rest in the order the tenant published them. Falls back to a
  // single entry so the picker never collapses entirely (same
  // fallback the topbar LanguageSwitcher uses).
  const fallbackLanguages = [
    { languageCode: "en-US", languageName: "English", isDefault: true },
    { languageCode: "bn-BD", languageName: "বাংলা", isDefault: false },
  ];
  const languages =
    availableLanguages.length > 0 ? availableLanguages : fallbackLanguages;
  const currentLanguage =
    languages.find((l) => l.languageCode === language) ?? languages[0];

  const handleThemeChange = (next: ThemeMode) => {
    setThemeMode(next);
    // Mirror the topbar ThemeToggler: apply immediately and persist
    // (the zustand `persist` middleware handles persistence, but
    // applyTheme still has to run so the .dark class flips on <html>).
    applyTheme(next);
  };

  const handleAccentChange = (next: string) => {
    // `setAccentColor` persists AND applies to <html>'s CSS variables
    // — see themeStore.ts.
    setAccentColor(next);
  };

  const handleAccentReset = () => {
    setAccentColor(null);
    toast.info(
      t("settings.accent.resetToast", "Accent color reset to default."),
    );
  };

  const handleLanguageChange = (code: string) => {
    setLanguage(code);
    const next = languages.find((l) => l.languageCode === code);
    if (next) {
      toast.info(
        t("settings.language.switchedToast", "Language switched to {name}.", {
          name: next.languageName,
        }),
      );
    }
  };

  const handleSignOut = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  // Default hex for the picker when the user hasn't picked a color
  // yet. Matches the first swatch in the ColorPicker palette so the
  // "no accent set" state looks like a deliberate choice. We never
  // write this default back to the store — only explicit user picks
  // are persisted.
  const pickerValue = accentColor ?? "#0ea5e9";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">
          {t("settings.title", "Settings")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "settings.description",
            "Application preferences for your account.",
          )}
        </p>
      </header>

      {/* Appearance — theme picker + accent color picker. Mirrors the
          topbar ThemeToggler's store, so changing the theme here is
          reflected immediately everywhere (the topbar icon updates via
          the same zustand subscription). The accent color feeds the
          same store as the sidebar icon theming. */}
      <section aria-labelledby="settings-appearance-heading">
        <Card>
          <CardHeader>
            <CardTitle
              id="settings-appearance-heading"
              className="flex items-center gap-2 text-base"
            >
              <Palette className="h-4 w-4" aria-hidden="true" />
              {t("settings.appearance.title", "Appearance")}
            </CardTitle>
            <CardDescription>
              {t(
                "settings.appearance.description",
                "Theme and accent color. 'System' follows your operating system preference.",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <div
                role="radiogroup"
                aria-label={t("settings.appearance.theme.label", "Theme")}
                className="inline-flex rounded-md border border-input bg-background p-0.5"
              >
                {THEME_OPTIONS.map((opt) => {
                  const Icon = opt.Icon;
                  const active = themeMode === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => handleThemeChange(opt.value)}
                      className={cn(
                        "inline-flex h-9 items-center gap-2 rounded px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                        active
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      <span>
                        {opt.value === "light"
                          ? t("settings.theme.light", "Light")
                          : opt.value === "dark"
                            ? t("settings.theme.dark", "Dark")
                            : t("settings.theme.system", "System")}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <Separator />

            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t("settings.accent.title", "Accent color")}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t(
                      "settings.accent.description",
                      "Used for buttons, focus rings, and sidebar icons.",
                    )}
                  </p>
                </div>
                {accentColor && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleAccentReset}
                  >
                    <RotateCcw
                      className="mr-1.5 h-3.5 w-3.5"
                      aria-hidden="true"
                    />
                    {t("settings.accent.reset", "Reset")}
                  </Button>
                )}
              </div>
              <ColorPicker
                value={pickerValue}
                onChange={handleAccentChange}
                ariaLabel={t("settings.accent.title", "Accent color")}
              />
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Language — same useLocale hook the topbar LanguageSwitcher
          uses. Duplicated here so the page is self-contained; the
          topbar picker stays for quick access from any route. */}
      <section aria-labelledby="settings-language-heading">
        <Card>
          <CardHeader>
            <CardTitle
              id="settings-language-heading"
              className="flex items-center gap-2 text-base"
            >
              <Languages className="h-4 w-4" aria-hidden="true" />
              {t("settings.language.title", "Language")}
            </CardTitle>
            <CardDescription>
              {t(
                "settings.language.description",
                "Interface language. Switching is immediate and persists across sessions.",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-w-xs">
              <Select
                aria-label={t("settings.language.title", "Language")}
                value={currentLanguage?.languageCode ?? language}
                onChange={(e) => handleLanguageChange(e.target.value)}
                options={languages.map((l) => ({
                  value: l.languageCode,
                  label: `${l.languageName} (${l.languageCode})`,
                }))}
              />
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Account — read-only identity block + sign out + a link to the
          existing /profile page for the role tools. Kept terse; the
          /profile page is the canonical place for account management
          actions like granting the manager role. */}
      {currentUser && (
        <section aria-labelledby="settings-account-heading">
          <Card>
            <CardHeader>
              <CardTitle
                id="settings-account-heading"
                className="flex items-center gap-2 text-base"
              >
                <UserCog className="h-4 w-4" aria-hidden="true" />
                {t("settings.account.title", "Account")}
              </CardTitle>
              <CardDescription>
                {t(
                  "settings.account.description",
                  "Signed-in identity and session controls.",
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-start gap-5">
                <UserAvatar userId={currentUser.id} name={currentUser.name} size="lg" />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-lg font-semibold text-foreground">
                    {currentUser.name}
                  </h3>
                  <p className="truncate text-sm text-muted-foreground">
                    {currentUser.email}
                  </p>
                  {/* Profile picture upload — visible to the signed-in
                      user only (you can't change someone else's avatar).
                      Hidden file input driven by the Button's ref so the
                      native picker opens on click; the mutation runs the
                      presign + PUT + UserProfile upsert flow and toasts
                      the outcome. Same picture surfaces everywhere via
                      the shared `useProfilePics` map. */}
                  <ProfilePictureUpload />
                </div>
              </div>

              <Separator className="my-6" />

              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {t("settings.account.userId", "User ID")}
                  </dt>
                  <dd className="mt-1 break-all text-sm font-mono text-foreground">
                    {currentUser.id}
                  </dd>
                </div>
              </dl>

              <Separator className="my-6" />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button asChild variant="outline">
                  <Link to="/profile">
                    {t(
                      "settings.account.openProfile",
                      "Open full profile",
                    )}
                  </Link>
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => void handleSignOut()}
                >
                  <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
                  {t("settings.account.signOut", "Sign out")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}

// Profile picture uploader — a button that opens a native file picker
// and triggers the presign + PUT + UserProfile upsert flow. Lives in
// SettingsPage because that's where signed-in users manage their own
// identity; the same picture surfaces everywhere else (chat, members,
// announcements, topbar) via the shared `useProfilePics` map.
function ProfilePictureUpload() {
  const t = useT();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const upload = useUploadProfilePic();

  // Max 4 MB — anything bigger makes the presigned-URL PUT fragile and
  // bloats the table view of every avatar in the app.
  const MAX_BYTES = 4 * 1024 * 1024;

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input so picking the same file twice still triggers
    // onChange — browsers silently suppress same-value re-selects.
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("settings.account.uploadInvalid", "Please pick an image file."));
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(
        t(
          "settings.account.uploadTooLarge",
          "Image must be 4 MB or smaller.",
        ),
      );
      return;
    }
    upload.mutate(
      { file },
      {
        onSuccess: () =>
          toast.success(
            t(
              "settings.account.uploadSuccess",
              "Profile picture updated.",
            ),
          ),
        onError: (err) =>
          toast.error(
            t(
              "settings.account.uploadError",
              "Couldn't upload picture: {message}",
              { message: err.message },
            ),
          ),
      },
    );
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={onPick}
        // Disabling while in flight blocks the user from queuing
        // another upload before the first PUT settles.
        disabled={upload.isPending}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => inputRef.current?.click()}
        disabled={upload.isPending}
      >
        {upload.isPending
          ? t("settings.account.uploading", "Uploading…")
          : t("settings.account.upload", "Upload picture")}
      </Button>
      {/* AI-stylized avatar flow. Renders nothing when the proxy
          reports `REPLICATE_API_TOKEN` is unset — capability probe
          lives inside `AIAvatarButton` so the Settings page doesn't
          have to gate on it. */}
      <AIAvatarButton />
    </div>
  );
}
