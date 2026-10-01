// "Bootstrap with an AI agent" — a canned, copy-paste prompt for an AI
// agent (Claude Code, Codex, …). The target repo is assumed already
// bootstrapped (the upstream blocks-skills BOOTSTRAP.md flow ran when the
// project was created), so the prompt only installs the Lattice env-walk
// skill. Pure client-side — no API call, nothing mutates, so unlike the
// authoring CTAs it needs no role gate.

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

// The lattice-env-walk skill's committed copy. The copied prompt tells the
// target agent to fetch and install it, so "verify this app" works in any
// repo without the user explaining anything. Points at `main`.
const ENV_WALK_SKILL_URL =
  "https://raw.githubusercontent.com/merajul-islam644/feature-tracker/main/.lattice-skills/lattice-env-walk/SKILL.md";

/** The exact plain text "Copy instructions" puts on the clipboard — one
 * line, deliberately. The skill carries every instruction; the agent just
 * reads it and works. */
export function buildBootstrapPrompt(): string {
  return `Read ${ENV_WALK_SKILL_URL} and do your job.`;
}

interface BootstrapDialogProps {
  open: boolean;
  onClose: () => void;
}

export function BootstrapDialog({ open, onClose }: BootstrapDialogProps) {
  const toast = useToast();
  const t = useT();
  const [copied, setCopied] = useState(false);

  // A stale "copied" flip from a previous open must not leak into the
  // next one — same reset discipline as DeleteProjectDialog's spinner.
  useEffect(() => {
    if (open) setCopied(false);
  }, [open]);

  // Same clipboard idiom as MembersPage/MailPage: writeText + toast +
  // a 1.5s Copy→Check flip on the trigger.
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildBootstrapPrompt());
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
