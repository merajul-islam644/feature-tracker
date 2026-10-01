// Backwards-compatible shim over `useLocale()` from the
// `LocalizationProvider`. The original `useLocaleStore` exposed
// `{ locale, setLocale }` and persisted to `localStorage`; that contract
// is preserved, but the values now come from the Blocks localization
// service (and are full culture codes like `en-US` / `bn-BD` / `de-DE`).

import { useLocale } from "@/lib/blocks/i18n";

export type Locale = string;

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export function useLocaleStore(): LocaleState {
  const { language, setLanguage } = useLocale();
  return {
    locale: language,
    setLocale: setLanguage,
  };
}

// Re-export the hook in case a future call wants the same naming as the
// old Zustand store. Keep the export minimal so the SDK is the source of
// truth.
export const localeStore = { useLocaleStore };