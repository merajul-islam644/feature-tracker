// "Bootstrap with an AI agent" — a canned, copy-paste prompt for an AI
// agent (Claude Code, Codex, …). The target repo is assumed already
// bootstrapped (the upstream blocks-skills BOOTSTRAP.md flow ran when the
// project was created), so the prompt only installs the Lattice env-walk
// skill AND pins the walk scope: the projectId + environmentId of the page
// the dialog was opened from (user asked, 2026-10-02 — any AI receiving the
// pasted text must know which project/env to fetch targets and secrets
// for, without asking). Pure client-side — no API call, nothing mutates,
// so unlike the authoring CTAs it needs no role gate.

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/useToast";
import { useT } from "@/lib/blocks/i18n";
import { useEnvironments } from "@/lib/blocks/hooks";

// The lattice-env-walk skill's committed copy. The copied prompt tells the
// target agent to fetch and install it, so "verify this app" works in any
// repo without the user explaining anything. Points at `main`.
const ENV_WALK_SKILL_URL =
  "https://raw.githubusercontent.com/merajul-islam644/feature-tracker/main/.lattice-skills/lattice-env-walk/SKILL.md";

/** The walk scope baked into the copied prompt. All four fields come from
 * the page the dialog is opened on (route params + the env row matching
 * the slug). Undefined → the prompt degrades to the skill-only one-liner
 * and the agent resolves the scope itself (asks the user). */
export interface BootstrapScope {
  projectId: string;
  environmentId: string;
  envLabel: string;
  envSlug: string;
}

/** The exact plain text "Copy instructions" puts on the clipboard. With a
 * scope it is self-describing: ids verbatim, where targets/secrets come
 * from, and where the walker's IAM login lives (MCP secret store, not an
 * .env file — user asked, 2026-10-02). The skill carries the rest. */
export function buildBootstrapPrompt(scope?: BootstrapScope): string {
  const head = `Read ${ENV_WALK_SKILL_URL} and do your job.`;
  if (!scope) return head;
  return [
    head,
    "",
    "Scope (use these ids verbatim — do not re-resolve):",
    `- projectId: ${scope.projectId}`,
    `- environmentId: ${scope.environmentId}  (env "${scope.envLabel}", slug "${scope.envSlug}")`,
    "",
    "Everything env-scoped hangs off that environmentId — one call fetches it all: `loadWalkerContext({ projectId, environmentId })` from `scripts/walker/data.mjs` (targets, secrets, bindings, verification scope).",
    'The walker\'s IAM login is the secret named "IAM Walker Login" in the MCP secret store (GET /secrets) — never an .env file.',
  ].join("\n");
}

interface BootstrapDialogProps {
  open: boolean;
  onClose: () => void;
  /** The project the dialog was opened from — pins the scope into the
   *  copied prompt. Optional so the dialog degrades to the skill-only
   *  prompt if a future caller can't supply it. */
  projectId?: string;
  /** The env slug of the page — resolved to the env row for the
   *  environmentId. */
  envSlug?: string;
}

export function BootstrapDialog({ open, onClose, projectId, envSlug }: BootstrapDialogProps) {
  const toast = useToast();
  const t = useT();
  const [copied, setCopied] = useState(false);

  // The env row matching the page's slug — read only while the dialog is
  // open, and the same cached query the page itself uses (no extra fetch).
  // While rows are loading (or the slug doesn't match a row) the prompt
  // falls back to the skill-only one-liner.
  const envsQuery = useEnvironments(open ? projectId ?? null : null);
  const env = (envsQuery.data ?? []).find((e) => e.slug === envSlug);
  const scope: BootstrapScope | undefined =
    projectId && envSlug && env
      ? {
          projectId,
          environmentId: env.id,
          envLabel: env.label,
          envSlug,
        }
      : undefined;

  // A stale "copied" flip from a previous open must not leak into the
  // next one — same reset discipline as DeleteProjectDialog's spinner.
  useEffect(() => {
    if (open) setCopied(false);
  }, [open]);

  // Same clipboard idiom as MembersPage/MailPage: writeText + toast +
  // a 1.5s Copy→Check flip on the trigger.
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildBootstrapPrompt(scope));
      setCopied(true);
      toast.success(
        t(
          "projectDetail.bootstrapCopied",
          "Bootstrap instructions copied to clipboard.",
        ),
      );
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(
        t("projectDetail.bootstrapCopyFailed", "Couldn't copy to clipboard."),
      );
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent size="lg">
        <DialogCloseButton />
        <DialogHeader>
          <DialogTitle>
            {t("projectDetail.bootstrapTitle", "Bootstrap with an AI agent")}
          </DialogTitle>
          {/* The description mirrors the clipboard text verbatim, split so
              the skill URL stays a real <a> in every locale. */}
          <DialogDescription>
            {t("projectDetail.bootstrapSkillBefore", "Read")}{" "}
            <a
              href={ENV_WALK_SKILL_URL}
              target="_blank"
              rel="noreferrer"
              className="break-all font-medium text-primary underline underline-offset-2"
            >
              {ENV_WALK_SKILL_URL}
            </a>{" "}
            {t("projectDetail.bootstrapSkillAfter", "and do your job.")}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {t(
              "projectDetail.bootstrapHint",
              "Paste this into your AI agent (Claude Code, Codex, Cursor, …) inside the repo where you want the skill installed.",
            )}
          </p>
          {/* Copy preview — the exact clipboard content, including the
              pinned scope ids. The <pre> is the literal prompt text, so
              it stays untranslated on purpose. */}
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs text-foreground">
            {buildBootstrapPrompt(scope)}
          </pre>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("projectDetail.bootstrapClose", "Close")}
          </Button>
          <Button
            onClick={handleCopy}
            leftIcon={
              copied ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )
            }
          >
            {t("projectDetail.bootstrapCopy", "Copy instructions")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
