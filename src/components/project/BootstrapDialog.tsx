// "Bootstrap with an AI agent" — a canned, copy-paste prompt for an AI
// agent (Claude Code, Codex, …). Self-contained — no skill file anywhere
// (user directive, 2026-10-03). The prompt pins the walk scope (projectId
// + environmentId of the page the dialog was opened from) and the run
// shape the user specified: work in TOTAL SILENCE, first bring the env's
// targets + secrets, then navigate to the target immediately. Pure
// client-side — no API call, nothing mutates, so unlike the authoring
// CTAs it needs no role gate.

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
import {
  useEnvironments,
  useIssueTrackerTargets,
  useSecretBindings,
} from "@/lib/blocks/hooks";

/** The walk scope baked into the copied prompt. The four id fields come
 * from the page the dialog is opened on (route params + the env row
 * matching the slug); `targets` is this env's enabled rows with each one's
 * bound secret id — so the pasted prompt carries the URL to navigate to
 * directly, and only the secret VALUES travel via the API at login time
 * (user directives, 2026-10-03). Undefined → the prompt degrades to a
 * one-liner telling the agent it must be pasted from an env page. */
export interface BootstrapScope {
  projectId: string;
  environmentId: string;
  envLabel: string;
  envSlug: string;
  targets: Array<{ url: string; secretId: string | null }>;
}

/** The exact plain text "Copy instructions" puts on the clipboard. Run
 * shape is the user's directives (2026-10-03): the target URLs are baked
 * into the text so the receiving agent navigates immediately, secrets are
 * fetched from the store only when a login form actually shows, and the
 * whole run is silent — the only things it ever says are a ✗ stop line
 * and the end-of-run report. */
export function buildBootstrapPrompt(scope?: BootstrapScope): string {
  if (!scope)
    return "You are verifying a target app. Open this dialog from an env page first — without its projectId + environmentId there is no target to resolve.";
  return [
    "Verify the target app below in a real browser. Work in TOTAL SILENCE — no commentary, no progress updates, no questions. The only things you ever say: a ✗ stop line when a step fails, and the end-of-run report.",
    "",
    `SCOPE  project ${scope.projectId}  ·  env "${scope.envLabel}" (${scope.envSlug})  ·  ${scope.environmentId}`,
    "",
    ...(scope.targets.length > 0
      ? scope.targets.map(
          (t) =>
            `TARGET ${t.url}${t.secretId ? `  ·  secret ${t.secretId}` : ""}`,
        )
      : [
          "TARGET (none)",
          `   ✗ no enabled target → "এই environment-এ কোনো target নেই — Targets পেজে যোগ করুন।"`,
        ]),
    "1 OPEN — navigate to the target URL ONCE. Never re-type it to restart a login; the only allowed re-navigation is returning from an off-target page (step 3).",
    "2 LOGIN — only if a login form shows: fetch the bound secret in-page (browser_evaluate → GET http://127.0.0.1:8787/secrets/<secretId>) → fill email+password. Password never in your output; never snapshot between fill and submit. Already on a logged-in page → skip.",
    `   ✗ no bound secret → "bound secret নেই — Secrets পেজে যোগ করে এই target-এ bind করুন।"`,
    `   ✗ login fails → "store করা credential দিয়ে লগইন হচ্ছে না — Secrets পেজে মিলিয়ে নিন।"`,
    `   ✗ bounce loop (app ↔ /login ↔ callback, again and again) → do NOT retry the login and do NOT re-navigate: file "Login redirect loop" (high), then keep walking from wherever the app landed.`,
    `   ✗ single-session gate ("session already in use / in a project") → this browser owns no other window, so any takeover prompt is a stale lock from a killed walk: take it ("Leave" / "Continue anyway") and continue.`,
    "3 WALK — every page: click all buttons/links · every form valid+invalid · theme · language · 375px · log console errors + status ≥400. A click that changes the URL → record that the redirect happened; if that page holds a target-related action (create / add / delete / configure), verify just that action and nothing else, then immediately navigate back to the target URL and resume from where the click was — never walk the off-target page; each link once.",
    `   ✗ 404/5xx or no login → file "Cannot reach <target>" (high) and stop`,
    '4 FILE — defect confirmed twice → node one-shot: import { walkerClient } from "./scripts/walker/auth.mjs" (it loads its own creds) and insert an Issue row. fingerprint = fnv1a32 hex of `origin+pathname|category|title.toLowerCase().replace(/\\d+/g,"#")`; first query rows with flat filter {fingerprint, projectId, envSlug} — exists → skip. Row fields: title, applicationName, url, category, severity, status:"open", description, expected, actual, reproductionStepsJson, evidenceJson, detectedAt, verificationRunId, fingerprint, occurrenceCount:"1", lastSeenAt, seenInRunIdsJson + scope {projectId, envSlug, environmentId, targetId}. No permission-asking, no other file reads.',
    "",
    "REPORT — only this, then stop: pages walked · issues filed · skipped + why",
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

export function BootstrapDialog({
  open,
  onClose,
  projectId,
  envSlug,
}: BootstrapDialogProps) {
  const toast = useToast();
  const t = useT();
  const [copied, setCopied] = useState(false);

  // The env row matching the page's slug — read only while the dialog is
  // open, and the same cached query the page itself uses (no extra fetch).
  // While rows are loading (or the slug doesn't match a row) the prompt
  // falls back to the one-liner.
  const envsQuery = useEnvironments(open ? (projectId ?? null) : null);
  const env = (envsQuery.data ?? []).find((e) => e.slug === envSlug);

  // This env's enabled targets + their bound secrets — the same cached
  // queries the Targets/Secrets pages use (useActiveEnv is route-driven,
  // so on an env page it IS the page's env). Their result is baked into
  // the prompt: the target URL to navigate to, and the secret id to fetch
  // ONLY when the app shows a login form. Secret values never appear in
  // the prompt — they travel page↔store at login time.
  const targetsQuery = useIssueTrackerTargets({ enabled: open });
  const bindingsQuery = useSecretBindings(
    env && envSlug
      ? { projectId: projectId ?? "", envSlug, environmentId: env.id }
      : null,
    { enabled: open && Boolean(env) },
  );
  const secretIdByTargetId = (() => {
    const map: Record<string, string> = {};
    for (const [secretId, targetIds] of Object.entries(
      bindingsQuery.data?.bindings ?? {},
    )) {
      for (const tid of targetIds) map[tid] ??= secretId;
    }
    return map;
  })();
  const scopeTargets = (targetsQuery.data ?? [])
    .filter((t) => t.enabled)
    .map((t) => ({ url: t.url, secretId: secretIdByTargetId[t.id] ?? null }));

  const scope: BootstrapScope | undefined =
    projectId &&
    envSlug &&
    env &&
    targetsQuery.isSuccess &&
    bindingsQuery.isSuccess
      ? {
          projectId,
          environmentId: env.id,
          envLabel: env.label,
          envSlug,
          targets: scopeTargets,
        }
      : undefined;
  // While the reads resolve the prompt can't show target URLs yet — say
  // so instead of flashing the fallback one-liner, which reads like a
  // mistake.
  const targetsPending =
    open && (!targetsQuery.isSuccess || !bindingsQuery.isSuccess);

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
          {/* The description states what the clipboard text does — the
              prompt is self-contained, no skill file to fetch. */}
          <DialogDescription>
            {t(
              "projectDetail.bootstrapDesc",
              "Copies a silent self-contained prompt: paste it into your AI agent and it fetches this environment's targets and secrets, navigates to the target, and verifies it without a word until the report.",
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {t(
              "projectDetail.bootstrapHint",
              "Paste this into your AI agent (Claude Code, Codex, Cursor, …) opened at this repo. It stays silent until the final report.",
            )}
          </p>
          {/* Copy preview — the exact clipboard content, including the
              pinned scope ids and target URLs. The <pre> is the literal
              prompt text, so it stays untranslated on purpose. While the
              target/binding reads resolve, say so instead of flashing the
              no-scope fallback (which would read like a mistake). */}
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs text-foreground">
            {targetsPending
              ? "Loading this environment's targets…"
              : buildBootstrapPrompt(scope)}
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
