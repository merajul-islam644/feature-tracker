// Runtime localization for Feature Tracker. Owns:
//   - the active language (`language` state, persisted in `localStorage`)
//   - the loaded dictionary cache (delegated to `blocksClient.localization`)
//   - a `t()` lookup with `{var}` and `{var, plural, ...}` substitution
//
// All reads go through `blocksClient.localization.t(...)`; the SDK owns
// the dictionary cache, so loaded modules are shared across the app.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { blocksClient } from "./client";

// One module for now. Add more here when content grows; nothing else in
// the app needs to change.
const MODULES = ["common"] as const;

// Persisted user choice — single source of truth across reloads.
const STORAGE_KEY = "ft-locale";

export interface LanguageOption {
  languageCode: string;
  languageName: string;
  isDefault: boolean;
}

interface I18nContextValue {
  language: string;
  setLanguage: (code: string) => void;
  availableLanguages: LanguageOption[];
  isReady: boolean;
  t: (key: string, fallback?: string, options?: Record<string, unknown>) => string;
  formatRelativeTime: (iso: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

// Sensible default while we wait for the tenant language list. If the
// tenant has `en-US` configured, the very first `setLanguage` call will
// switch to whatever the user actually had persisted.
const DEFAULT_LANGUAGE = "en-US";

export function LocalizationProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<string>(() =>
    readPersistedLanguage() ?? DEFAULT_LANGUAGE,
  );
  const [availableLanguages, setAvailableLanguages] = useState<LanguageOption[]>(
    [],
  );
  const [isReady, setIsReady] = useState(false);

  // Load the tenant's supported languages once on boot, then resolve
  // `language` against them so we never land on a culture the tenant
  // hasn't configured.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list =
          (await blocksClient.localization.languagesForCurrentTenant()) as
            | LanguageOption[]
            | unknown;
        const opts = Array.isArray(list)
          ? (list as LanguageOption[])
          : extractLanguages(list);
        if (cancelled) return;
        setAvailableLanguages(opts);
        if (opts.length > 0) {
          setLanguageState((current) => {
            const match = opts.find(
              (o) => o.languageCode === current,
            );
            if (match) return match.languageCode;
            const persisted = readPersistedLanguage();
            const persistedMatch =
              persisted &&
              opts.find((o) => o.languageCode === persisted);
            if (persistedMatch) return persistedMatch.languageCode;
            const def =
              opts.find((o) => o.isDefault) ?? opts[0];
            return def ? def.languageCode : current;
          });
        }
      } catch {
        // Non-fatal: keep the default; dictionary load below will still
        // try the chosen code and fall back gracefully.
      } finally {
        if (!cancelled) setIsReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Reload the dictionary whenever the active language changes. Skips
  // until the boot effect has run at least once, so the first load uses
  // a verified language code.
  useEffect(() => {
    if (!isReady) return;
    let cancelled = false;
    (async () => {
      try {
        await blocksClient.localization.load(language, [...MODULES]);
      } catch {
        // Swallow — `t()` falls back to its second argument or the key.
      } finally {
        if (!cancelled) {
          // Intentionally left blank — nothing else to do after load.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [language, isReady]);

  const setLanguage = useCallback((code: string) => {
    setLanguageState(code);
    try {
      window.localStorage.setItem(STORAGE_KEY, code);
    } catch {
      // localStorage may be unavailable in private mode; ignore.
    }
  }, []);

  const t = useCallback(
    (key: string, fallback?: string, options?: Record<string, unknown>) => {
      const raw = blocksClient.localization.t(
        key,
        fallback ?? key,
        options ? { language, moduleName: MODULES[0] } : { language },
      );
      return options ? formatIcu(raw, options, language) : raw;
    },
    [language],
  );

  const formatRelativeTime = useCallback(
    (iso: string) => formatRelative(iso, language, t),
    [language, t],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage,
      availableLanguages,
      isReady,
      t,
      formatRelativeTime,
    }),
    [language, setLanguage, availableLanguages, isReady, t, formatRelativeTime],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useLocale(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useLocale must be used inside <LocalizationProvider>.");
  }
  return ctx;
}

export function useT() {
  return useLocale().t;
}

// --- helpers ---------------------------------------------------------------

function readPersistedLanguage(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function extractLanguages(raw: unknown): LanguageOption[] {
  // The SDK wraps the response in `{ data: [...] }` on some methods; pull
  // the inner array out if needed.
  const arr = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { data?: unknown })?.data)
      ? ((raw as { data: unknown[] }).data as unknown[])
      : [];
  return arr
    .filter((x) => typeof x === "object" && x !== null)
    .map((x) => x as LanguageOption);
}

// Tiny ICU MessageFormat-lite: handles `{var}` and
// `{var, plural, =0 {…} one {…} other {…}}`. Anything we don't recognise
// is left untouched so the lookup still produces a readable string.
function formatIcu(
  template: string,
  options: Record<string, unknown>,
  language: string,
): string {
  const pluralRules = new Intl.PluralRules(language);
  return template.replace(/\{([^}]+)\}/g, (match, body: string) => {
    const trimmed = body.trim();
    if (trimmed.includes(",")) {
      const [head, ...rest] = trimmed.split(",").map((s) => s.trim());
      if (rest[0] === "plural") {
        const varName = head;
        const value = Number(options[varName]);
        const branches: Record<string, string> = {};
        const branchText = rest.slice(1).join(",");
        const branchRe = /(=\d+|zero|one|two|few|many|other)\s*\{([^}]*)\}/g;
        let m: RegExpExecArray | null;
        while ((m = branchRe.exec(branchText)) !== null) {
          branches[m[1]] = m[2];
        }
        const pluralCategory = Number.isFinite(value)
          ? pluralRules.select(value)
          : "other";
        const exactMatch = branches[`=${value}`];
        const categoryMatch = branches[pluralCategory];
        const fallback = branches.other ?? "";
        const chosen = exactMatch ?? categoryMatch ?? fallback;
        return formatIcu(chosen, options, language);
      }
    }
    const value = options[trimmed];
    return value === undefined || value === null
      ? match
      : String(value);
  });
}

function formatRelative(
  iso: string,
  language: string,
  t: (key: string, fallback?: string, options?: Record<string, unknown>) => string,
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const now = Date.now();
  const diffSec = Math.round((now - date.getTime()) / 1000);
  const diffMin = Math.round(diffSec / 60);
  const diffHr = Math.round(diffMin / 60);
  const diffDay = Math.round(diffHr / 24);

  if (diffSec < 60) return t("time.justNow", "just now");
  if (diffMin < 60)
    return t("time.minutesAgo", "{count} minutes ago", { count: diffMin });
  if (diffHr < 24) return t("time.hoursAgo", "{count} hours ago", { count: diffHr });
  if (diffDay < 7) return t("time.daysAgo", "{count} days ago", { count: diffDay });

  try {
    return new Intl.DateTimeFormat(language, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(date);
  } catch {
    return date.toLocaleDateString();
  }
}