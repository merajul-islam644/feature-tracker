// Tiered tool-approval policy for the workspace chat agent.
//
// The Allow-card flow used to gate EVERY tool call, which turned a
// multi-file build into a click-through exercise (one scaffold milestone
// needed 13 separate Allow clicks). Policy since the DataGuard dogfood:
// only "important" actions ask — destructive workspace ops, history-
// changing git commands, un-allowlisted shell, arbitrary browser code,
// and anything touching shared Lattice data (secrets, projects, issues,
// flows). Everything else — reads, file writes, renames, search, npm
// install/build/test, read-only git — auto-runs and leaves its
// "✓ Done" line in the thread as the audit trail.

import type { ToolUseBlock } from "@/types/issue-tracker";

// ── exec command classification ────────────────────────────────────────
// One-shot shell is the widest risk surface, so it gets a real
// allowlist rather than a blanket pass: package/build/test tooling and
// read-only inspection run unattended; anything else (and anything
// carrying a destructive token, wherever it hides in the pipeline)
// shows the permission card.

/** File/system destructors — matched anywhere in the command line. */
const DESTRUCTIVE_EXEC =
  /(^|[\s;&|(])(rm|rmdir|del|rd|erase|format|mkfs|shutdown|taskkill|kill|killall)\b/i;

/** History-changing git subcommands — `git status` is fine, `git push` is not. */
const DESTRUCTIVE_GIT = /\bgit\b[^;&|]*(push|reset|clean|checkout|switch|restore|rebase|merge|cherry-pick|stash\s+(drop|clear))\b/i;

/** Piping a remote fetch straight into a shell — never auto-run. */
const REMOTE_CODE =
  /\b(curl|wget|irm|iwr|invoke-webrequest|invoke-restmethod)\b[^;&|]*\|\s*(sh|bash|zsh|pwsh|powershell|iex)\b/i;

/** Publishing — irreversible and shared. */
const PACKAGE_PUBLISH = /\b(npm|pnpm|yarn|bun)\s+(publish|unpublish)\b/i;

/** Commands safe to run without asking. */
const SAFE_EXEC =
  /^(npm|pnpm|yarn|bun|npx|node|tsc|tsx|vite|eslint|prettier|jest|vitest|playwright|ls|dir|cat|type|echo|pwd|tree|whoami|netstat|tasklist|findstr|where|ipconfig|hostname|git\s+(status|log|diff|show|branch|remote|rev-parse))\b/i;

/**
 * PowerShell one-liners need their own gate: the agent legitimately
 * reaches for `powershell -NoProfile -Command "…ReadAllLines…Write-Host"`
 * when workspace_read_file truncates a long file, and carding a pure
 * read is exactly the click-fatigue the tiered policy exists to avoid.
 * Denylist first — any mutating or dangerous token asks, even when a
 * read token is also present — then require at least one recognizably
 * read-only cmdlet/.NET call.
 */
const PS_DANGEROUS =
  /\b(Set-\w+|Remove-\w+|Clear-\w+|New-Item\b|New-Object\b|Out-File\b|Copy-Item\b|Move-Item\b|Rename-Item\b|Start-Process\b|Stop-Process\b|Stop-Service\b|Invoke-Expression\b|\biex\b|Invoke-WebRequest\b|Invoke-RestMethod\b|WebClient\b|DownloadFile\b|WriteAllText\b|WriteAllLines\b|WriteAllBytes\b|AppendAllText\b|AppendAllLines\b|\.Delete\(\)|taskkill)/i;

const PS_READ_ONLY =
  /\b(Get-Content|Get-ChildItem|Get-Item|Get-Date|Get-Process|Get-Service|ReadAllLines|ReadAllText|ReadAllBytes|Write-Host|Write-Output|Select-String|Measure-Object|Test-Path|Split-Path|Join-Path|ForEach-Object|Where-Object)\b/i;

function isReadOnlyPowerShell(cmd: string): boolean {
  return !PS_DANGEROUS.test(cmd) && PS_READ_ONLY.test(cmd);
}

export function isSafeCommand(command: string): boolean {
  const cmd = command.trim();
  if (!cmd) return false;
  if (DESTRUCTIVE_EXEC.test(cmd)) return false;
  if (DESTRUCTIVE_GIT.test(cmd)) return false;
  if (REMOTE_CODE.test(cmd)) return false;
  if (PACKAGE_PUBLISH.test(cmd)) return false;
  if (/^(powershell|pwsh)\b/i.test(cmd)) return isReadOnlyPowerShell(cmd);
  return SAFE_EXEC.test(cmd);
}

// ── tool-level classification ──────────────────────────────────────────

/**
 * Tools that ALWAYS show a permission card, no matter what. Two
 * families: irreversible/destructive workspace + git operations, and
 * shared-tenant Lattice data mutations (the original reason cards
 * existed — issue/secrets/project edits affect every teammate).
 * `browser_run_code_unsafe` stays carded too: it is arbitrary code
 * execution by design.
 */
const ALWAYS_ASK = new Set<string>([
  // workspace — destructive or history-changing
  "workspace_delete_path",
  "workspace_git_stage",
  "workspace_git_unstage",
  "workspace_git_discard",
  "workspace_git_commit",
  "workspace_git_push",
  "workspace_git_pull",
  "workspace_git_checkout",
  // browser — arbitrary code execution
  "browser_run_code_unsafe",
  // Lattice shared data — mutations teammates see
  "toggle_verification_check",
  "set_target_enabled",
  "set_filters",
  "start_verification",
  "update_issue_status",
  "add_verification_target",
  "update_verification_target",
  "delete_verification_target",
  "create_secret",
  "update_secret",
  "delete_secret",
  "bind_secret",
  "create_project",
  "update_project",
  "delete_project",
  "add_project_environment",
  "create_feature",
  "update_feature",
  "delete_feature",
  "create_flow",
  "update_flow",
  "delete_flow",
  "verify_live_url",
]);

/**
 * True when a tool call may execute WITHOUT a permission card. The
 * `input` matters only for exec — every other tool is decided by name.
 */
export function isSafeAutoRun(
  tool: Pick<ToolUseBlock, "name" | "input">,
): boolean {
  const { name, input } = tool;
  if (ALWAYS_ASK.has(name)) return false;
  // Remaining browser tools are read/interact steps inside the
  // verification browser — auto-run since the walkthrough shipped.
  if (name.startsWith("browser_")) return true;
  if (name === "workspace_exec_command") {
    const command = typeof input.command === "string" ? input.command : "";
    return isSafeCommand(command);
  }
  // Everything else in the workspace_* family — list/read/write/rename,
  // search, npm script listing, open file/folder, LSP diagnostics,
  // tests — is the day-to-day building work the user wants unattended.
  return name.startsWith("workspace_");
}
