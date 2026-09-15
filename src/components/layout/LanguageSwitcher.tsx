import { Check, Languages } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocale, useT } from "@/lib/blocks/i18n";

export function LanguageSwitcher() {
  const { language, setLanguage, availableLanguages } = useLocale();
  const t = useT();

  const fallback = [
    { languageCode: "en-US", languageName: "English", isDefault: true },
    { languageCode: "bn-BD", languageName: "বাংলা", isDefault: false },
  ];
  const list = availableLanguages.length > 0 ? availableLanguages : fallback;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("languageSwitcher", "Language")}
          className="relative inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Languages className="h-4 w-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>
          {t("languageSwitcher", "Language")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {list.map((opt) => {
          const active = language === opt.languageCode;
          return (
            <DropdownMenuItem
              key={opt.languageCode}
              onSelect={() => setLanguage(opt.languageCode)}
              className="flex items-center justify-between"
            >
              <span className="flex flex-col">
                <span className="font-medium">{opt.languageName}</span>
                <span className="text-xs text-muted-foreground">
                  {opt.languageCode}
                </span>
              </span>
              {active && (
                <Check
                  className="h-4 w-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}