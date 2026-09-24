import {
  Languages,
  Monitor,
  Moon,
  Palette,
  RotateCcw,
  Sparkles,
  Sun,
  UserCog,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  Wifi,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/useToast";
import { useLocale, useT } from "@/lib/blocks/i18n";
import {
  useSaveUserAiConfig,
  useSaveUserAvatarConfig,
  useUploadProfilePic,
  useUserAiConfig,
  useUserAvatarConfig,
} from "@/lib/blocks/hooks";
import type { AvatarProviderId, ChatProviderId } from "@/lib/blocks/data";
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
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { formatRelativeDate } from "@/lib/utils";

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
  const { currentUser } = useAuth();
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

      {/* Account — read-only identity block. Sits at the top of the page
          so the user sees their own profile + AI controls first; the
          /profile route still exists as a deeper landing for role tools. */}
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
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {t("settings.account.joined", "Joined")}
                  </dt>
                  <dd className="mt-1 text-sm text-foreground">
                    {formatRelativeDate(currentUser.createdAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {t(
                      "settings.account.lastUpdated",
                      "Last updated",
                    )}
                  </dt>
                  <dd className="mt-1 text-sm text-foreground">
                    {formatRelativeDate(currentUser.updatedAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {t("settings.account.roles", "Roles")}
                  </dt>
                  <dd className="mt-1 text-sm text-foreground">
                    {currentUser.roles.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {currentUser.roles.map((r) => (
                          <Badge
                            key={r}
                            variant="secondary"
                            className="font-mono text-[10px]"
                          >
                            {r}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </dd>
                </div>
              </dl>

              <Separator className="my-6" />

              {/* Personal AI key — entirely separate from the AI Gateway
                  section. Powers ONLY the AI-generated profile picture
                  flow (the "Generate AI avatar" button). The two systems
                  never share rows, headers, or env fallback. */}
              <PersonalAiKeySection />
            </CardContent>
          </Card>
        </section>
      )}

      {/* AI Gateway — per-user overrides for the chat panel's
          AI_GATEWAY_URL / AI_GATEWAY_MODEL / AI_GATEWAY_TOKEN values. The
          server-side proxy reads them as `x-ai-gateway-*` headers on each
          request and falls back to its .env defaults when blank. Empty
          fields here mean "use server default". Persisted in Blocks Data
          so the same overrides follow the user across browsers/devices. */}
      <section aria-labelledby="settings-ai-gateway-heading">
        <Card>
          <CardHeader>
            <CardTitle
              id="settings-ai-gateway-heading"
              className="flex items-center gap-2 text-base"
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              {t("settings.aiGateway.title", "AI Gateway")}
            </CardTitle>
            <CardDescription>
              {t(
                "settings.aiGateway.description",
                "Chat gateway URL, model, and token. The AI Assistant reads ONLY this section — no .env fallback. URL and token are required; model is optional (defaults to claude-sonnet-4-5).",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AiGatewayConfigSection />
          </CardContent>
        </Card>
      </section>

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

// AI Gateway config form. Mirrors `ProfilePictureUpload`'s
// decomposition — a self-contained inner component that owns its own
// loading state and toasts so the parent page stays clean. Reads the
// current value via `useUserAiConfig` (single-row, per-user filter)
// and writes via `useSaveUserAiConfig` (list → update or create,
// then invalidate). Empty fields = "no override" — the server-side
// proxy falls back to its .env defaults.
function AiGatewayConfigSection() {
  const t = useT();
  const toast = useToast();
  const aiConfigQuery = useUserAiConfig();
  const saveConfig = useSaveUserAiConfig();

  // Local form state — synced from the server when the query settles,
  // and pushed back via `saveConfig` on submit. Tracking dirty state
  // separately so we can disable Save when nothing changed.
  const [provider, setProvider] = useState<ChatProviderId>("anthropic");
  const [gatewayUrl, setGatewayUrl] = useState("");
  const [model, setModel] = useState("");
  const [token, setToken] = useState("");
  const [hydrated, setHydrated] = useState(false);

  // Hydrate local state from the server row once it arrives. We only
  // set when `hydrated` is false so the user's in-progress edits aren't
  // clobbered by a background refetch. `provider` defaults to "anthropic"
  // for rows saved before the multi-provider migration (no `provider`
  // field on disk) — matches `toUserAiConfig`.
  useEffect(() => {
    if (hydrated) return;
    if (aiConfigQuery.isSuccess) {
      const cfg = aiConfigQuery.data;
      setProvider(cfg?.provider ?? "anthropic");
      setGatewayUrl(cfg?.gatewayUrl ?? "");
      setModel(cfg?.model ?? "");
      setToken(cfg?.token ?? "");
      setHydrated(true);
    }
  }, [aiConfigQuery.isSuccess, aiConfigQuery.data, hydrated]);

  const hasOverride =
    provider !== "anthropic" ||
    gatewayUrl.trim() !== "" ||
    model.trim() !== "" ||
    token.trim() !== "";
  const isPending = saveConfig.isPending;
  const isFullyConfigured =
    gatewayUrl.trim() !== "" && token.trim() !== "";

  const handleSave = () => {
    saveConfig.mutate(
      {
        provider,
        gatewayUrl: gatewayUrl.trim(),
        model: model.trim(),
        token: token.trim(),
      },
      {
        onSuccess: () =>
          toast.success(
            t("settings.aiGateway.saved", "AI gateway config saved."),
          ),
        onError: (err) =>
          toast.error(
            t(
              "settings.aiGateway.errorSave",
              "Couldn't save AI config: {message}",
              { message: err.message },
            ),
          ),
      },
    );
  };

  // Test-connection probe: hits /api/ai/chat with the *current form values*
  // (not the saved ones) so the user can validate before saving. Reuses the
  // same `x-ai-chat-provider` + `x-ai-gateway-*` headers that the real chat
  // path uses — no separate code path on the proxy. The prompt is fixed to
  // a 1-token reply ("OK") so a flaky model still costs almost nothing.
  type TestStatus =
    | { kind: "idle" }
    | { kind: "testing" }
    | { kind: "ok"; provider: ChatProviderId; model: string }
    | { kind: "fail"; message: string };
  const [testStatus, setTestStatus] = useState<TestStatus>({ kind: "idle" });
  // Track the form snapshot at the moment the user clicked Test, so the
  // result badge stays meaningful even if they keep typing afterwards.
  const testFormRef = useRef<{
    provider: ChatProviderId;
    gatewayUrl: string;
    model: string;
    token: string;
  } | null>(null);

  const handleTestConnection = async () => {
    const snapshot = {
      provider,
      gatewayUrl: gatewayUrl.trim(),
      model: model.trim(),
      token: token.trim(),
    };
    testFormRef.current = snapshot;
    if (snapshot.gatewayUrl === "" || snapshot.token === "") {
      setTestStatus({
        kind: "fail",
        message: t(
          "settings.aiGateway.testMissingFields",
          "Fill in Gateway URL and Bearer token first.",
        ),
      });
      return;
    }
    setTestStatus({ kind: "testing" });
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ai-chat-provider": snapshot.provider,
          "x-ai-gateway-url": snapshot.gatewayUrl,
          "x-ai-gateway-model": snapshot.model,
          "x-ai-gateway-token": snapshot.token,
        },
        // Tiny prompt: 1-token expected reply, no tool calls. `system` is the
        // bare minimum the proxy needs to build an Anthropic-format body.
        body: JSON.stringify({
          text: "Reply with the single word OK.",
          system: "You are a connectivity probe. Reply with just OK.",
          history: [],
          tools: [],
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        // The proxy wraps upstream failures as `upstream_<status>: <body>` —
        // strip the prefix and surface the readable tail in the badge.
        const m = text.match(/"message"\s*:\s*"([^"]+)"/);
        setTestStatus({
          kind: "fail",
          message:
            m?.[1]?.slice(0, 200) ??
            t(
              "settings.aiGateway.testFailedStatus",
              "Connection failed with status {status}.",
              { status: res.status },
            ),
        });
        return;
      }
      const body = (await res.json()) as {
        model?: string;
        content?: Array<{ type: string; text?: string }>;
      };
      const reply = body.content?.find((c) => c.type === "text")?.text ?? "";
      setTestStatus({
        kind: "ok",
        provider: snapshot.provider,
        model: body.model ?? snapshot.model,
      });
      // Best-effort: keep the result visible for a moment, then idle out
      // so the badge doesn't linger after the user moves on.
      window.setTimeout(() => {
        if (testFormRef.current === snapshot) {
          setTestStatus({ kind: "idle" });
        }
      }, 6000);
      void reply; // not displayed — success means we got any valid reply
    } catch (err) {
      setTestStatus({
        kind: "fail",
        message:
          err instanceof Error
            ? err.message
            : t(
                "settings.aiGateway.testFailedNetwork",
                "Network error reaching the gateway.",
              ),
      });
    }
  };

  const handleClear = () => {
    saveConfig.mutate(
      { provider: "anthropic", gatewayUrl: "", model: "", token: "" },
      {
        onSuccess: () => {
          setProvider("anthropic");
          setGatewayUrl("");
          setModel("");
          setToken("");
          toast.info(
            t(
              "settings.aiGateway.cleared",
              "AI gateway config cleared — using server defaults.",
            ),
          );
        },
        onError: (err) =>
          toast.error(
            t(
              "settings.aiGateway.errorClear",
              "Couldn't clear AI config: {message}",
              { message: err.message },
            ),
          ),
      },
    );
  };

  // Resolve "what's the current state" for the status banner. While the
  // first read is in flight, show "loading" rather than the default hint.
  // The "default" state means "no override saved" — the chat panel will
  // 503 until the user fills in at least URL + token and clicks Save.
  const status: "loading" | "default" | "override" | "partial" =
    aiConfigQuery.isLoading
      ? "loading"
      : hasOverride
        ? isFullyConfigured
          ? "override"
          : "partial"
        : "default";

  return (
    <div className="space-y-4">
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "rounded-md border px-3 py-2 text-sm",
          (status === "loading" || status === "default" || status === "partial") &&
            "border-border bg-muted/30 text-muted-foreground",
          status === "override" &&
            "border-primary/30 bg-primary/5 text-foreground",
        )}
      >
        {status === "loading" &&
          t("settings.aiGateway.loading", "Loading saved config…")}
        {status === "default" &&
          t(
            "settings.aiGateway.notConfigured",
            "Not configured — fill in the form to enable AI chat.",
          )}
        {status === "partial" &&
          t(
            "settings.aiGateway.partial",
            "URL and token are required — model is optional.",
          )}
        {status === "override" &&
          t(
            "settings.aiGateway.overrideActiveWith",
            "Override active — {provider} → {model}",
            {
              provider:
                provider === "openai" ? "OpenAI" : "Anthropic",
              model: model.trim() || "(default model)",
            },
          )}
      </div>

      <Select
        label={t("settings.aiGateway.provider", "Provider")}
        value={provider}
        onChange={(e) => setProvider(e.target.value as ChatProviderId)}
        disabled={isPending}
        options={[
          {
            value: "anthropic",
            label: t(
              "settings.aiGateway.providerAnthropic",
              "Anthropic Compatible",
            ),
          },
          {
            value: "openai",
            label: t(
              "settings.aiGateway.providerOpenAI",
              "OpenAI Compatible",
            ),
          },
        ]}
      />
      <p className="-mt-2 text-xs text-muted-foreground">
        {t(
          "settings.aiGateway.providerHint",
          "Which API the gateway speaks. Switches the wire format the proxy uses.",
        )}
      </p>
      <Input
        label={t("settings.aiGateway.url", "Gateway URL")}
        placeholder={
          provider === "openai"
            ? "https://api.openai.com/v1"
            : "https://api.anthropic.com"
        }
        value={gatewayUrl}
        onChange={(e) => setGatewayUrl(e.target.value)}
        disabled={isPending}
        autoComplete="off"
        hint={
          provider === "openai"
            ? t(
                "settings.aiGateway.urlHintOpenAI",
                "Base URL of an OpenAI-compatible endpoint (any /v1/chat/completions gateway works).",
              )
            : t(
                "settings.aiGateway.urlHintAnthropic",
                "Base URL of an Anthropic-compatible gateway (any /v1/messages gateway works).",
              )
        }
      />
      <Input
        label={t("settings.aiGateway.model", "Model")}
        placeholder={
          provider === "openai" ? "gpt-4o-mini" : "claude-sonnet-4-5"
        }
        value={model}
        onChange={(e) => setModel(e.target.value)}
        disabled={isPending}
        autoComplete="off"
        hint={t(
          "settings.aiGateway.modelHint",
          "Model id this provider expects. Leave blank to send no model header.",
        )}
      />
      <Input
        type="password"
        label={t("settings.aiGateway.token", "Bearer token")}
        placeholder={t(
          "settings.aiGateway.tokenPlaceholder",
          "Paste a token for the selected provider",
        )}
        value={token}
        onChange={(e) => setToken(e.target.value)}
        disabled={isPending}
        autoComplete="off"
        hint={t(
          "settings.aiGateway.tokenHint",
          "API key / bearer for the selected provider. Stored per-user in Blocks Data; never written to .env.",
        )}
      />

      <Separator />

      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Left side — Test connection sits here (same position as Blocks
            Studio's "Add a custom model" dialog). Inline result badge
            appears to its right when idle/ok/fail so the row stays clean. */}
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={handleTestConnection}
            disabled={isPending || testStatus.kind === "testing"}
          >
            <Wifi className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
            {t("settings.aiGateway.test", "Test connection")}
          </Button>
          <div
            className="flex items-center gap-1.5 text-xs"
            aria-live="polite"
          >
            {testStatus.kind === "testing" && (
              <>
                <Loader2
                  className="h-3.5 w-3.5 animate-spin text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="text-muted-foreground">
                  {t("settings.aiGateway.testing", "Testing…")}
                </span>
              </>
            )}
            {testStatus.kind === "ok" && (
              <>
                <CheckCircle2
                  className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
                  aria-hidden="true"
                />
                <span className="text-emerald-700 dark:text-emerald-300">
                  {t(
                    "settings.aiGateway.testOk",
                    "Connection OK — {provider} → {model}",
                    {
                      provider:
                        testStatus.provider === "openai"
                          ? "OpenAI"
                          : "Anthropic",
                      model: testStatus.model || "(default model)",
                    },
                  )}
                </span>
              </>
            )}
            {testStatus.kind === "fail" && (
              <>
                <XCircle
                  className="h-3.5 w-3.5 text-destructive"
                  aria-hidden="true"
                />
                <span className="text-destructive">{testStatus.message}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleClear}
            disabled={isPending || !hasOverride}
          >
            {t("settings.aiGateway.clear", "Clear overrides")}
          </Button>
          <Button
            type="button"
            variant="default"
            onClick={handleSave}
            loading={isPending}
          >
            {t("settings.aiGateway.save", "Save")}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Personal AI key — lives on the user's `UserAvatarConfig` row and powers
// ONLY the AI-generated profile picture flow. Completely separate from the
// AI Gateway section above: distinct collection, distinct proxy headers
// (`x-ai-avatar-*`), no env fallback on the server. If the user clears
// this row, the "Generate AI avatar" button hides itself on the next
// probe and only the manual profile-picture upload remains.
//
// Layout mirrors `AiGatewayConfigSection` for visual consistency: same
// status banner, same wifi-icon Test connection button on the left, same
// Save / Clear on the right.
function PersonalAiKeySection() {
  const t = useT();
  const toast = useToast();
  const avatarConfigQuery = useUserAvatarConfig();
  const saveConfig = useSaveUserAvatarConfig();

  const [provider, setProvider] = useState<AvatarProviderId>("replicate");
  const [token, setToken] = useState("");
  const [model, setModel] = useState("");
  const [hydrated, setHydrated] = useState(false);

  // Hydrate once when the query settles — never clobber in-progress edits.
  useEffect(() => {
    if (hydrated) return;
    if (avatarConfigQuery.isSuccess) {
      const cfg = avatarConfigQuery.data;
      setProvider(cfg?.provider ?? "replicate");
      setToken(cfg?.token ?? "");
      setModel(cfg?.model ?? "");
      setHydrated(true);
    }
  }, [avatarConfigQuery.isSuccess, avatarConfigQuery.data, hydrated]);

  const hasOverride =
    provider !== "replicate" || token.trim() !== "" || model.trim() !== "";
  const isPending = saveConfig.isPending;
  const isFullyConfigured = token.trim() !== "";

  const handleSave = () => {
    saveConfig.mutate(
      {
        provider,
        token: token.trim(),
        model: model.trim(),
      },
      {
        onSuccess: () =>
          toast.success(
            t(
              "settings.personalAiKey.saved",
              "Personal AI key saved. The AI avatar button is now available.",
            ),
          ),
        onError: (err) =>
          toast.error(
            t(
              "settings.personalAiKey.errorSave",
              "Couldn't save Personal AI key: {message}",
              { message: err.message },
            ),
          ),
      },
    );
  };

  const handleClear = () => {
    saveConfig.mutate(
      { provider: "replicate", token: "", model: "" },
      {
        onSuccess: () => {
          setProvider("replicate");
          setToken("");
          setModel("");
          toast.info(
            t(
              "settings.personalAiKey.cleared",
              "Personal AI key cleared. AI avatar generation is disabled.",
            ),
          );
        },
        onError: (err) =>
          toast.error(
            t(
              "settings.personalAiKey.errorClear",
              "Couldn't clear Personal AI key: {message}",
              { message: err.message },
            ),
          ),
      },
    );
  };

  // Test connection reuses the same `/api/ai/avatar` middleware path —
  // sends a deliberately-invalid body so the proxy validates and rejects,
  // but with the real `x-ai-avatar-token` header attached so a 400 means
  // "wired up" and a 503 means "key missing or rejected".
  type PersonalTestStatus =
    | { kind: "idle" }
    | { kind: "testing" }
    | { kind: "ok" }
    | { kind: "fail"; message: string };
  const [testStatus, setTestStatus] = useState<PersonalTestStatus>({
    kind: "idle",
  });
  const testFormRef = useRef<{
    provider: AvatarProviderId;
    token: string;
    model: string;
  } | null>(null);

  const handleTestConnection = async () => {
    const snapshot = {
      provider,
      token: token.trim(),
      model: model.trim(),
    };
    testFormRef.current = snapshot;
    if (snapshot.token === "") {
      setTestStatus({
        kind: "fail",
        message: t(
          "settings.personalAiKey.testMissingToken",
          "Paste your API token first.",
        ),
      });
      return;
    }
    setTestStatus({ kind: "testing" });
    try {
      const res = await fetch("/api/ai/avatar", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ai-avatar-provider": snapshot.provider,
          "x-ai-avatar-token": snapshot.token,
          "x-ai-avatar-model": snapshot.model,
        },
        // Empty body — the proxy responds 400 (bad_request) if the token
        // passes its 503 guard. That 400 is the success signal here.
        body: JSON.stringify({}),
      });
      if (res.status === 400) {
        setTestStatus({ kind: "ok" });
        window.setTimeout(() => {
          if (testFormRef.current === snapshot) {
            setTestStatus({ kind: "idle" });
          }
        }, 6000);
        return;
      }
      const text = await res.text();
      const m = text.match(/"message"\s*:\s*"([^"]+)"/);
      setTestStatus({
        kind: "fail",
        message:
          m?.[1]?.slice(0, 200) ??
          t(
            "settings.personalAiKey.testFailedStatus",
            "Connection failed with status {status}.",
            { status: res.status },
          ),
      });
    } catch (err) {
      setTestStatus({
        kind: "fail",
        message:
          err instanceof Error
            ? err.message
            : t(
                "settings.personalAiKey.testFailedNetwork",
                "Network error reaching the gateway.",
              ),
      });
    }
  };

  const status: "loading" | "default" | "override" | "partial" =
    avatarConfigQuery.isLoading
      ? "loading"
      : hasOverride
        ? isFullyConfigured
          ? "override"
          : "partial"
        : "default";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-primary" aria-hidden="true" />
        <h4 className="text-sm font-semibold text-foreground">
          {t("settings.personalAiKey.title", "Personal AI key")}
        </h4>
        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          {t(
            "settings.personalAiKey.scopeBadge",
            "For AI avatar only",
          )}
        </span>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        {t(
          "settings.personalAiKey.description",
          "Stored separately from the AI Gateway above. This token only powers the AI-generated profile picture flow — it never reaches the chat proxy or any other request.",
        )}
      </p>

      {/* Status banner — same pattern as the AI Gateway card. */}
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "rounded-md border px-3 py-2 text-sm",
          (status === "loading" || status === "default" || status === "partial") &&
            "border-border bg-muted/30 text-muted-foreground",
          status === "override" &&
            "border-primary/30 bg-primary/5 text-foreground",
        )}
      >
        {status === "loading" &&
          t("settings.personalAiKey.loading", "Loading saved key…")}
        {status === "default" &&
          t(
            "settings.personalAiKey.notConfigured",
            "Not configured — the AI avatar button is hidden. Paste a token below to enable it.",
          )}
        {status === "partial" &&
          t(
            "settings.personalAiKey.partial",
            "Token is required — model is optional.",
          )}
        {status === "override" &&
          t(
            "settings.personalAiKey.overrideActive",
            "Personal AI key active — {provider}",
            { provider: provider === "replicate" ? "Replicate" : provider },
          )}
      </div>

      <Input
        type="password"
        label={t("settings.personalAiKey.token", "API token")}
        placeholder={t(
          "settings.personalAiKey.tokenPlaceholder",
          "r8_… (Replicate API token)",
        )}
        value={token}
        onChange={(e) => setToken(e.target.value)}
        disabled={isPending}
        autoComplete="off"
        hint={t(
          "settings.personalAiKey.tokenHint",
          "Stored per-user in Blocks Data; never written to .env or shared with the chat proxy.",
        )}
      />
      <Input
        label={t("settings.personalAiKey.model", "Model id (optional)")}
        placeholder={t(
          "settings.personalAiKey.modelPlaceholder",
          "fofr/face-to-many",
        )}
        value={model}
        onChange={(e) => setModel(e.target.value)}
        disabled={isPending}
        autoComplete="off"
        hint={t(
          "settings.personalAiKey.modelHint",
          "Replicate model id. Leave blank to use the server default.",
        )}
      />

      <Separator />

      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Test connection on the left — mirrors the AI Gateway card. */}
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={handleTestConnection}
            disabled={isPending || testStatus.kind === "testing"}
          >
            <Wifi className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
            {t("settings.personalAiKey.test", "Test connection")}
          </Button>
          <div
            className="flex items-center gap-1.5 text-xs"
            aria-live="polite"
          >
            {testStatus.kind === "testing" && (
              <>
                <Loader2
                  className="h-3.5 w-3.5 animate-spin text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="text-muted-foreground">
                  {t("settings.personalAiKey.testing", "Testing…")}
                </span>
              </>
            )}
            {testStatus.kind === "ok" && (
              <>
                <CheckCircle2
                  className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
                  aria-hidden="true"
                />
                <span className="text-emerald-700 dark:text-emerald-300">
                  {t(
                    "settings.personalAiKey.testOk",
                    "Connection OK — Reachable",
                  )}
                </span>
              </>
            )}
            {testStatus.kind === "fail" && (
              <>
                <XCircle
                  className="h-3.5 w-3.5 text-destructive"
                  aria-hidden="true"
                />
                <span className="text-destructive">{testStatus.message}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleClear}
            disabled={isPending || !hasOverride}
          >
            {t("settings.personalAiKey.clear", "Clear key")}
          </Button>
          <Button
            type="button"
            variant="default"
            onClick={handleSave}
            loading={isPending}
          >
            {t("settings.personalAiKey.save", "Save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
