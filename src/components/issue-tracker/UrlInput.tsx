// One row in the verification-targets list (URL + remove button).
// URL validation per spec section 10.

import { Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Props {
  id: string;
  value: string;
  error?: string | null;
  onChange: (value: string) => void;
  onRemove: () => void;
  canRemove: boolean;
}

export function UrlInput({ id, value, error, onChange, onRemove, canRemove }: Props) {
  return (
    <div className="flex items-start gap-2">
      <div className="flex-1 space-y-1">
        <label htmlFor={`url-${id}`} className="sr-only">
          Application URL
        </label>
        <Input
          id={`url-${id}`}
          type="url"
          inputMode="url"
          placeholder="https://example.com"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? `url-${id}-error` : undefined}
          className={error ? "border-destructive focus-visible:ring-destructive" : undefined}
        />
        {error && (
          <p id={`url-${id}-error`} className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onRemove}
        disabled={!canRemove}
        aria-label="Remove URL"
        className="mt-0.5 text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
//  URL validation helpers (section 10) — pure, exported for the parent.
// ────────────────────────────────────────────────────────────────────────────

export function validateUrl(raw: string, allValues: string[]): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return "URL is required.";
  // Whitespace-only is already caught by trim(), but keep for clarity.
  if (!trimmed) return "URL is required.";
  // Basic URL parse — protocol required.
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return "Please enter a valid URL.";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return "Please enter a valid URL.";
  }
  // Duplicate check (case-insensitive on host + path).
  const norm = `${url.protocol}//${url.host}${url.pathname}`.toLowerCase();
  const dupes = allValues.filter(
    (v) => v.trim() && v.trim().toLowerCase() === norm,
  );
  if (dupes.length > 1) return "This URL has already been added.";
  return null;
}
