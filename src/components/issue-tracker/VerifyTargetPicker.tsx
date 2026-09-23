// In-chat verification target picker. When the user tells the assistant
// to verify an app WITHOUT naming a URL ("verify this app"), the chat
// appends an assistant message carrying this widget instead of hitting
// the AI gateway: a radio dropdown of every configured verification
// target, a free-text box for a URL not in the list, and a Submit
// button that stays disabled until the user picks or writes one. On
// submit it emits the "Verify <url>" conversation turn the agent then
// walks.

import { useState } from "react";
import { Check, ChevronDown, Globe, ListChecks, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { VerificationTarget } from "@/types/issue-tracker";

interface Props {
  targets: VerificationTarget[];
  onSend: (text: string) => void;
  /** Pauses the widget while a turn is in flight — a stale picker must
   *  not fire a second walkthrough on top of a running one. */
  disabled?: boolean;
}

// Environment → badge tint. Same semantic palette the targets card uses
// (development = info blue, staging = amber, production = rose) so the
// chip reads identically here and on the page. Keys are the
// TargetEnvironment union values, verbatim.
const envTone: Record<string, string> = {
  development: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  staging: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  preview: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  production: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

function EnvBadge({ environment }: { environment: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[10px] font-semibold uppercase tracking-wide",
        envTone[environment] ??
          "border-border bg-muted text-muted-foreground",
      )}
    >
      {environment}
    </span>
  );
}

// Two-line target identity shared by the trigger and the dropdown rows —
// one visual language in both places.
function TargetIdentity({ target }: { target: VerificationTarget }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Globe className="h-3 w-3" aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-col text-left">
        <span className="truncate text-sm font-medium leading-tight text-foreground">
          {target.applicationName}
        </span>
        <span className="truncate text-xs leading-tight text-muted-foreground">
          {target.url.replace(/^https?:\/\//, "")}
        </span>
      </span>
    </span>
  );
}

// A pasted URL is "ready" when it has a host — strip the scheme and
// require a dot so "example" doesn't fire the button but
// "example.com", "localhost:5173" and full https URLs all do.
function looksLikeUrl(raw: string): boolean {
  const host = raw.replace(/^https?:\/\//, "").split(/[/?#]/)[0];
  return host.includes(".") || host.includes(":");
}

export function VerifyTargetPicker({ targets, onSend, disabled }: Props) {
  // Nothing preselected — the whole point is an explicit choice: the
  // Submit button enables only after the user picks a target or writes
  // their own URL.
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [customUrl, setCustomUrl] = useState("");
  const [sentUrl, setSentUrl] = useState<string | null>(null);

  const selected = targets.find((t) => t.url === selectedUrl) ?? null;
  const trimmedCustom = customUrl.trim();
  const chosen =
    trimmedCustom && looksLikeUrl(trimmedCustom)
      ? { url: trimmedCustom, name: null as string | null }
      : selected
        ? { url: selected.url, name: selected.applicationName }
        : null;

  const submit = () => {
    if (!chosen || sentUrl || disabled) return;
    // Normalise a bare "example.com" to https:// so the browser tool
    // gets a navigable URL either way.
    const url = /^https?:\/\//i.test(chosen.url)
      ? chosen.url
      : `https://${chosen.url}`;
    setSentUrl(chosen.name ?? url);
    onSend(
      chosen.name
        ? `Verify ${chosen.name} (${url})`
        : `Verify ${url}`,
    );
  };

  // After submit the widget collapses to a confirmation line — the
  // conversation carries the actual walkthrough from here.
  if (sentUrl) {
    return (
      <div className="mt-2 flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
        <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
        Verifying {sentUrl.replace(/^https?:\/\//, "")}…
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border border-border bg-muted/30 p-2.5">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <ListChecks className="h-3 w-3" aria-hidden="true" />
        Pick a target
        <Badge variant="muted" className="h-4 px-1.5 text-[10px]">
          {targets.length}
        </Badge>
      </p>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            disabled={disabled}
            className={cn(
              "h-auto w-full justify-between gap-2 py-2 font-normal hover:bg-accent",
              // Highlight once a choice is made so the enabled Submit
              // button visibly pairs with it.
              selected && !trimmedCustom && "border-primary/40",
            )}
            aria-label="Pick a verification target"
          >
            {selected && !trimmedCustom ? (
              <TargetIdentity target={selected} />
            ) : (
              <span className="text-sm text-muted-foreground">
                Select a target…
              </span>
            )}
            <span className="flex shrink-0 items-center gap-2">
              {selected && !trimmedCustom && (
                <EnvBadge environment={selected.environment} />
              )}
              <ChevronDown
                className="h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64 max-h-72 overflow-y-auto">
          <DropdownMenuLabel>Verification targets</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={selectedUrl ?? ""}
            onValueChange={(v) => {
              setSelectedUrl(v);
              // Picking from the list supersedes anything half-typed in
              // the custom box — one clear choice at a time.
              setCustomUrl("");
            }}
          >
            {targets.map((t) => (
              <DropdownMenuRadioItem key={t.id} value={t.url} className="gap-2 py-2">
                <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">
                      {t.applicationName}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {t.url.replace(/^https?:\/\//, "")}
                    </span>
                  </span>
                  <EnvBadge environment={t.environment} />
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
        or
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
      </div>

      <div className="flex gap-2">
        <Input
          value={customUrl}
          onChange={(e) => {
            setCustomUrl(e.target.value);
            // Typing a URL of their own clears the dropdown pick — the
            // custom box is the user saying "none of those".
            if (e.target.value.trim()) setSelectedUrl(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          disabled={disabled}
          placeholder="Paste a different URL…"
          className="h-9 text-xs"
          aria-label="Verify a URL not in the target list"
        />
        <Button
          size="sm"
          onClick={submit}
          disabled={disabled || !chosen}
          className="h-9 shrink-0 gap-1.5"
        >
          <Play className="h-3.5 w-3.5" aria-hidden="true" />
          Verify
        </Button>
      </div>
    </div>
  );
}
