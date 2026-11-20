// Inline text input used both for the create-new-folder /
// create-new-file affordance and the rename affordance. Replaces
// `window.prompt` with a real text field that fits the Explorer
// aesthetic — Enter commits, Esc cancels, blur also commits (so
// the user can click out). Auto-focuses on mount so the user can
// start typing immediately.
//
// Lifted from `PlaywrightEditorPanel.tsx:295-364` with the
// `forwardRef` pattern dropped (nothing in this UI needs to grab
// the input ref externally — `select()` runs on mount).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface InlineFolderInputProps {
  initialValue: string;
  placeholder: string;
  ariaLabel: string;
  error?: string | null;
  leadingIcon?: ReactNode;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

export function InlineFolderInput({
  initialValue,
  placeholder,
  ariaLabel,
  error,
  leadingIcon,
  onCommit,
  onCancel,
}: InlineFolderInputProps) {
  const [value, setValue] = useState<string>(initialValue);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  return (
    <div className="flex w-full min-w-0 flex-col gap-1">
      <div className="flex w-full min-w-0 items-center gap-1">
        {leadingIcon}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-invalid={error ? "true" : "false"}
          className={cn(
            "h-6 min-w-0 flex-1 rounded border bg-background px-1.5 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1",
            error
              ? "border-destructive focus-visible:ring-destructive"
              : "border-input focus-visible:ring-ring",
          )}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onCommit(value);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          // Blur commits only when there's no error displayed — the
          // error path is a "must fix this before moving on" state,
          // so blurring would just leave a half-typed name. We still
          // call onCommit (in case the parent wants to validate
          // again) and let the parent decide whether to keep the
          // input open.
          onBlur={() => onCommit(value)}
        />
      </div>
      {error && (
        <span
          role="alert"
          className="truncate text-[10px] font-medium text-destructive"
        >
          {error}
        </span>
      )}
    </div>
  );
}