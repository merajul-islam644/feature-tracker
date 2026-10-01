// "Bootstrap with an AI agent" — mirrors the Blocks OS portal's Bootstrap
// dialog: a canned, copy-paste prompt that hands the project key to an AI
// agent (Claude Code, Codex, …) and points it at the blocks-skills
// BOOTSTRAP.md runbook. Pure client-side — no API call, nothing mutates,
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
import { blocksConfig } from "@/lib/blocks/config";

const BOOTSTRAP_URL =
  "https://raw.githubusercontent.com/SELISEdigitalplatforms/blocks-skills/main/BOOTSTRAP.md";

// The lattice-env-walk skill's committed copy. The bootstrap prompt tells the
// target agent to fetch and install it, so "verify this app" works in any
// bootstrapped repo without the user explaining anything. Points at `main` —
// 404s until .lattice-skills is pushed and merged there.
const ENV_WALK_SKILL_URL =
  "https://raw.githubusercontent.com/merajul-islam644/feature-tracker/main/.lattice-skills/lattice-env-walk/SKILL.md";

/** The exact plain text "Copy instructions" puts on the clipboard. */
export function buildBootstrapPrompt(projectKey: string): string {
  return `Read ${BOOTSTRAP_URL} and follow it to bootstrap this repo, then get me set up on project ${projectKey} and show me what's already there. Then also read ${ENV_WALK_SKILL_URL} and install it as a skill in this repo — save it to .agents/skills/lattice-env-walk/SKILL.md and add a stub at .claude/skills/lattice-env-walk/SKILL.md pointing to it — and follow that skill whenever I ask you to verify or walk an app, or to find issues.`;
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
      await navigator.clipboard.writeText(
        buildBootstrapPrompt(blocksConfig.xBlocksKey),
      );
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
          {/* The prompt itself is the description, translated as segments
              around the (untranslatable) URLs and the project key so the
              links stay real <a>s in every locale. The clipboard text comes
              from buildBootstrapPrompt — plain URLs, no links. */}
          <DialogDescription>
            {t("projectDetail.bootstrapBodyBefore", "Read")}{" "}
            <a
              href={BOOTSTRAP_URL}
              target="_blank"
              rel="noreferrer"
              className="break-all font-medium text-primary underline underline-offset-2"
            >
              {BOOTSTRAP_URL}
            </a>{" "}
            {t(
              "projectDetail.bootstrapBodyMiddle",
              "and follow it to bootstrap this repo, then get me set up on project",
            )}{" "}
            <span className="font-mono text-foreground">
              {blocksConfig.xBlocksKey}
            </span>{" "}
            {t(
              "projectDetail.bootstrapBodyAfter",
              "and show me what's already there.",
            )}{" "}
            {t(
              "projectDetail.bootstrapSkillBefore",
              "It also installs the env-walk verification skill from",
            )}{" "}
            <a
              href={ENV_WALK_SKILL_URL}
              target="_blank"
              rel="noreferrer"
              className="break-all font-medium text-primary underline underline-offset-2"
            >
              {ENV_WALK_SKILL_URL}
            </a>{" "}
            {t(
              "projectDetail.bootstrapSkillAfter",
              "so afterwards you can just ask the agent to verify or walk an app.",
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {t(
              "projectDetail.bootstrapHint",
              "Paste this into your AI agent (Claude Code, Codex, Cursor, …) inside the repo you want to bootstrap.",
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
