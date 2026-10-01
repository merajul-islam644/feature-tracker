// Single chat message — user or assistant (with optional inline actions).
// Spec section 7.
//
// Both bubbles expose a small Copy button that appears on hover. Clicking
// it writes the message text to the clipboard via the async Clipboard API
// and flashes a transient "Copied" toast. The button stays visible at all
// times on touch / keyboard focus, since hover doesn't exist there.
//
// When the assistant emits a tool_use proposal, the bubble also shows a
// permission card listing each tool it wants to invoke with an Allow
// button — the user must click before anything actually mutates state.

import { useState } from "react";
import { Bot, Check, Copy, ShieldCheck, User as UserIcon, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { toolLabel, browserToolLabel } from "@/lib/chatTools";
import { matchCheckIntent } from "@/services/issueTrackerApi";
import { verificationChecks } from "@/data/issueTrackerConstants";
import { VerifyTargetPicker } from "./VerifyTargetPicker";
import type {
  ChatMessage as ChatMessageT,
  ToolUseBlock,
  VerificationTarget,
} from "@/types/issue-tracker";

interface Props {
  message: ChatMessageT;
  onAction?: (action: NonNullable<ChatMessageT["actions"]>[number]) => void;
  /** The most recent user message in the thread — lets the permission
   *  card flag a proposed toggle that doesn't match what was asked. */
  lastUserMessage?: string;
  /** Targets for the inline verify-target picker (only read when the
   *  message carries `picker: "verify-target"`). */
  pickerTargets?: VerificationTarget[];
  /** Emitter for the picker's submit — sends the "Verify <url>" turn
   *  down the same path as the chat input. */
  onSend?: (text: string) => void;
  /** Pauses the picker while a turn is in flight (same rule as the
   *  chat input). */
  pickerDisabled?: boolean;
}

export function ChatMessage({
  message,
  onAction,
  lastUserMessage,
  pickerTargets,
  onSend,
  pickerDisabled,
}: Props) {
  const isUser = message.role === "user";
  const { success, error } = useToast();
  // Briefly flip the icon to a checkmark after a successful copy so the
  // user gets a visual confirmation alongside the toast. Resets on its
  // own so it doesn't linger on the next hover.
  const [justCopied, setJustCopied] = useState(false);

  const handleCopy = async () => {
    const text = message.content;
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Older browsers / non-secure contexts fall back to a hidden
        // textarea + execCommand so the feature still works there.
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setJustCopied(true);
      success("Copied to clipboard.");
      window.setTimeout(() => setJustCopied(false), 1500);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      error(`Unable to copy: ${detail}`);
    }
  };

  const toolUse = message.toolUse;
  const hasPermissionActions =
    message.actions?.some((a) => a.kind === "request_tool_permission") ?? false;

  return (
    <div
      className={cn(
        "group flex w-full gap-2",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      {!isUser && (
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
          aria-hidden="true"
        >
          <Bot className="h-4 w-4" />
        </div>
      )}
      <div
        className={cn(
          // `min-w-0` lets the bubble shrink below its intrinsic content
          // size; without it, a long unbroken token (URL, code, hash)
          // can push the bubble past max-w-* and force a horizontal
          // scrollbar on the chat scroll container.
          "relative min-w-0 max-w-full px-3.5 py-2.5 text-sm leading-relaxed",
          // Chat bubble styles per DESIGN-SYSTEM-REWRITE.md §3 "Chat":
          //   Human   : bg-primary-muted (subtle indigo tint)
          //   System/AI: bg-surface-muted + border
          // Restrained rounded-md per spec — not large pill bubbles.
          isUser
            ? "w-fit max-w-[82%] rounded-md bg-primary-muted text-foreground"
            : "w-fit max-w-[88%] rounded-md border border-border bg-surface-muted text-foreground",
        )}
      >
        <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {message.content}
        </p>

        {/* Inline target picker — attached to the assistant reply that
            asks "which app should I verify?". The gateway is never
            called for the bare verify ask; this widget produces the
            real "Verify <url>" turn on submit. */}
        {message.picker === "verify-target" &&
          pickerTargets &&
          pickerTargets.length > 0 &&
          onSend && (
            <VerifyTargetPicker
              targets={pickerTargets}
              onSend={onSend}
              disabled={pickerDisabled}
            />
          )}

        {/* Permission card — shown only when the assistant proposed tools
            that need consent. Each row pairs the tool name with an Allow
            button. The label flips to "Allowed" once dispatched so the
            user can't fire the same action twice. Browser walkthrough
            steps carry no permission action (they run automatically), so
            they render the slim chip below instead. */}
        {toolUse && toolUse.length > 0 && hasPermissionActions && (
          <div className="mt-2 space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
            <p className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-300">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              {toolUse.length === 1
                ? "The assistant wants to:"
                : `The assistant wants to do ${toolUse.length} things:`}
            </p>
            <ul className="space-y-1.5">
              {toolUse.map((t) => (
                <ToolPermissionRow
                  key={t.id}
                  tool={t}
                  actions={message.actions ?? []}
                  onAction={onAction}
                  lastUserMessage={lastUserMessage}
                />
              ))}
            </ul>
          </div>
        )}
        {toolUse && toolUse.length > 0 && !hasPermissionActions && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-[11px] text-muted-foreground">
            <Zap className="h-3 w-3" aria-hidden="true" />
            <span className="sr-only">Browser step ran automatically:</span>
            {toolUse.map((t, i) => (
              <span key={t.id} className="inline-flex items-center gap-1.5">
                {i > 0 && <span aria-hidden="true">·</span>}
                <span className="font-medium text-foreground">
                  {browserToolLabel(t.name)}
                </span>
              </span>
            ))}
          </div>
        )}

        {/* Plain action buttons — used for canned assistant responses
            (Start Verification, View Critical Issues, etc.). Hidden when
            the bubble already shows a permission card so the layout
            doesn't double up. */}
        {message.actions && message.actions.length > 0 && !hasPermissionActions && (
          <div className="mt-2 flex flex-wrap gap-2">
            {message.actions.map((a) => (
              <Button
                key={a.id}
                size="sm"
                variant={isUser ? "secondary" : "default"}
                onClick={() => onAction?.(a)}
              >
                {a.label}
              </Button>
            ))}
          </div>
        )}

        {/* Copy button — visible on hover, focus, or right after a click.
            Pinned to the top-right corner so it never crowds the text.
            Tooltip kept light (title attr) to avoid pulling in another
            component just for a hover label. */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleCopy}
          aria-label={`Copy message: ${truncate(message.content, 60)}`}
          title={justCopied ? "Copied" : "Copy"}
          className={cn(
            "absolute -right-2 -top-2 h-6 w-6 rounded-full bg-card/90 text-muted-foreground shadow-sm transition-opacity hover:text-foreground",
            justCopied
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          )}
        >
          {justCopied ? (
            <Check className="h-3 w-3" aria-hidden="true" />
          ) : (
            <Copy className="h-3 w-3" aria-hidden="true" />
          )}
        </Button>
      </div>
      {isUser && (
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
          aria-hidden="true"
        >
          <UserIcon className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}

// One row inside the permission card. Reads the matching
// `request_tool_permission` action off the message and renders its
// "Allow" / "Allowed" button — that single callback in `useIssueTracker`
// owns the dispatch.
function ToolPermissionRow({
  tool,
  actions,
  onAction,
  lastUserMessage,
}: {
  tool: ToolUseBlock;
  actions: NonNullable<ChatMessageT["actions"]>;
  onAction?: Props["onAction"];
  lastUserMessage?: string;
}) {
  const perm = actions.find(
    (a) =>
      a.kind === "request_tool_permission" &&
      (a.payload?.toolUseId as string | undefined) === tool.id,
  );
  // Static chat tools get their label from the table; dynamic Playwright
  // MCP browser tools (browser_navigate, …) derive one from the name.
  const label =
    toolLabel[tool.name as keyof typeof toolLabel] ?? browserToolLabel(tool.name);
  const detail = describeToolInput(tool);
  const mismatch = toggleMismatch(tool, lastUserMessage);
  return (
    <li className="flex items-start justify-between gap-2 rounded-sm bg-background/60 px-2 py-1.5">
      <div className="min-w-0">
        <p className="font-medium text-foreground">{label}</p>
        {detail && (
          <p className="truncate text-[11px] text-muted-foreground">
            {detail}
          </p>
        )}
        {mismatch && (
          <p className="mt-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
            Heads up: you asked about “{mismatch.askedLabel}” — this would
            change “{mismatch.proposedLabel}”. Review before allowing.
          </p>
        )}
      </div>
      {perm && (
        <Button
          size="sm"
          variant="default"
          onClick={() => onAction?.(perm)}
          disabled={perm.label === "Allowed"}
          className="h-6 shrink-0 px-2 text-xs"
        >
          {perm.label === "Allowed" ? (
            <>
              <Check className="mr-1 h-3 w-3" aria-hidden="true" />
              Allowed
            </>
          ) : (
            "Allow"
          )}
        </Button>
      )}
    </li>
  );
}

// Semantic guard for toggle proposals: when the user's last message names
// one check ("enable the all functionality check") but the model proposes a
// different checkId, return both labels so the card can warn. Only fires
// when the intent matcher actually recognized a check in the user's words —
// an ambiguous or unrelated message shouldn't produce a false alarm.
function toggleMismatch(
  tool: ToolUseBlock,
  lastUserMessage: string | undefined,
): { askedLabel: string; proposedLabel: string } | null {
  if (tool.name !== "toggle_verification_check") return null;
  const proposedId = String(tool.input.checkId ?? "");
  if (!proposedId || !lastUserMessage) return null;
  const intent = matchCheckIntent(lastUserMessage.toLowerCase());
  if (!intent || intent.checkId === proposedId) return null;
  const asked = verificationChecks.find((c) => c.id === intent.checkId);
  const proposed = verificationChecks.find((c) => c.id === proposedId);
  if (!asked || !proposed) return null;
  return { askedLabel: asked.label, proposedLabel: proposed.label };
}

function describeToolInput(tool: ToolUseBlock): string | null {
  const input = tool.input;
  switch (tool.name) {
    case "toggle_verification_check": {
      // Direction matters as much as the target — "check = X" alone
      // doesn't say whether allowing the card turns X on or off.
      const dir =
        input.enabled === undefined ? "toggle" : input.enabled ? "on" : "off";
      return `check = ${String(input.checkId ?? "—")} → ${dir}`;
    }
    case "set_target_enabled":
      return `target = ${String(input.targetId ?? "—")} → ${String(input.enabled ?? "—")}`;
    case "set_filters": {
      const parts: string[] = [];
      if (Array.isArray(input.severities)) parts.push(`severities=[${input.severities.join(", ")}]`);
      if (Array.isArray(input.statuses)) parts.push(`statuses=[${input.statuses.join(", ")}]`);
      if (typeof input.application === "string") parts.push(`application=${input.application}`);
      if (typeof input.search === "string") parts.push(`search="${input.search}"`);
      return parts.length ? parts.join(", ") : null;
    }
    case "start_verification":
      return null;
    case "update_issue_status":
      return `${String(input.issueId ?? "—")} → ${String(input.status ?? "—")}`;
    case "open_target_in_browser":
      return `targetId = ${String(input.targetId ?? "—")}`;
    case "add_verification_target":
      return `url = ${String(input.url ?? "—")}`;
    case "verify_live_url":
      return `url = ${String(input.url ?? "—")}`;
    default:
      return null;
  }
}

// Trim the aria-label so screen readers don't read out a 500-word paragraph
// when the user lands on the copy button. Falls back to "message" for an
// empty / whitespace-only bubble.
function truncate(text: string, max: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "message";
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}
