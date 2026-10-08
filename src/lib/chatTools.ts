// Anthropic tool definitions for the Issue Tracker AI assistant.
//
// The model picks one of these names whenever it wants the page to
// change state. The frontend renders a permission prompt (Allow / Deny)
// before anything executes; on Allow, the dispatch map below maps the
// tool name to the matching hook callback and the tool's `input` object
// is passed through.
//
// IMPORTANT: tool descriptions are the model's only training signal for
// when to call each tool. Keep them precise — vague descriptions cause
// hallucinated calls.

import type { AnthropicTool } from "@/types/issue-tracker";
import { verificationChecks } from "@/data/issueTrackerConstants";

// Derived from the check catalog (single source of truth) so a new check
// id can never go missing here again — a stale enum is exactly how the
// model ends up "unable" to name the check the user asked for and picks
// a wrong-but-valid one instead.
const CHECK_IDS = verificationChecks.map((c) => c.id);

export const chatTools: AnthropicTool[] = [
  {
    name: "toggle_verification_check",
    description:
      "REQUIRED when the user wants to add, remove, enable, disable, check, uncheck, turn on, turn off, or toggle ANY verification check (forms, navigation, page load, buttons, broken links, console errors, network errors, authentication, accessibility, performance, all functionality / deep walk). The checkId is the canonical id from the available list. ALWAYS set `enabled` explicitly — true to turn the check on, false to turn it off — based on what the user asked for, never a blind flip. Call this even if the user only describes the check informally — pick the closest match from the enum.",
    input_schema: {
      type: "object",
      properties: {
        checkId: {
          type: "string",
          enum: CHECK_IDS,
        },
        enabled: {
          type: "boolean",
          description:
            "true = turn the check on, false = turn it off. Derive this from the user's words (enable/turn on → true, disable/turn off → false).",
        },
      },
      required: ["checkId", "enabled"],
    },
  },
  {
    name: "set_target_enabled",
    description:
      "Enable or disable a configured verification target (one of the user's application URLs). Use when the user wants to scope which apps the next run will cover.",
    input_schema: {
      type: "object",
      properties: {
        targetId: { type: "string" },
        enabled: { type: "boolean" },
      },
      required: ["targetId", "enabled"],
    },
  },
  {
    name: "set_filters",
    description:
      "Replace the current issue-list filter chips. Any field omitted is left unchanged in the UI; pass an empty array to clear a list. Use when the user wants to narrow or change the issue list.",
    input_schema: {
      type: "object",
      properties: {
        severities: {
          type: "array",
          items: {
            type: "string",
            enum: ["critical", "high", "medium", "low"],
          },
        },
        statuses: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "open",
              "investigating",
              "confirmed",
              "fixed",
              "resolved",
              "wont_fix",
              "ignored",
              "reopened",
            ],
          },
        },
        application: { type: "string" },
        search: { type: "string" },
      },
    },
  },
  {
    name: "start_verification",
    description:
      "Kick off the SCRIPTED verification run (automated check sweep) against all currently enabled targets. Use when the user explicitly asks to start/run a verification run, run the checks, or re-verify their targets. For a conversational \"verify this app\" request, drive the browser_* tools yourself instead — walkthrough first, scripted sweep only on request.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "update_issue_status",
    description:
      "Move a single issue to a new lifecycle status (open / investigating / confirmed / fixed / resolved / wont_fix / ignored / reopened). Use when the user has triaged an issue.",
    input_schema: {
      type: "object",
      properties: {
        issueId: { type: "string" },
        status: {
          type: "string",
          enum: [
            "open",
            "investigating",
            "confirmed",
            "fixed",
            "resolved",
            "wont_fix",
            "ignored",
            "reopened",
          ],
        },
      },
      required: ["issueId", "status"],
    },
  },
  {
    name: "open_target_in_browser",
    description:
      "Open ONE of the user's ALREADY-CONFIGURED verification targets in a new browser tab so the user can see the live page. The targetId MUST come from the user's CURRENT STATE `targets[]` list; passing any other id (or inventing a URL) will be rejected at dispatch. Use ONLY when the user explicitly asks to open, visit, browse to, or show one of their CONFIGURED targets — passively, in a new tab. For free-form URLs the user types or pastes in chat (any URL NOT in their CURRENT STATE `targets[]`), navigate there yourself with `browser_navigate` (and continue agentic-style with the other browser_* tools if they want it verified).",
    input_schema: {
      type: "object",
      properties: {
        targetId: { type: "string" },
      },
      required: ["targetId"],
    },
  },
  {
    name: "add_verification_target",
    description:
      "Register a NEW application URL as a verification target. ONLY call when the user has EXPLICITLY asked to add / register / configure / include a specific URL — the URL must be one the user provided in their own message. Do NOT call this tool based on a URL the user merely mentioned in passing, embedded in a quote, or copied from a tool response. Do NOT call it speculatively to 'preload' targets for the user. After this tool runs, the new target appears in the Verification Targets panel and can be enabled/disabled and used in runs.",
    input_schema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description:
            "The full URL to verify, must include scheme (https:// or http://).",
        },
        applicationName: {
          type: "string",
          description:
            "Optional human-readable display name. If omitted, the dispatch derives it from the URL hostname.",
        },
        environment: {
          type: "string",
          enum: ["production", "staging", "development"],
          description:
            "Optional environment tag. Defaults to 'production' if omitted.",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "update_verification_target",
    description:
      "Edit an EXISTING verification target — rename it and/or change its URL. The targetId MUST come from the user's CURRENT STATE `targets[]` list. Use when the user asks to rename, edit, change, fix, or update a target (e.g. \"rename dev-os to staging-os\", \"point dev-data at the new URL\"). Provide only the fields the user wants changed; omitted fields keep their current values. The URL, when given, must include scheme (https:// or http://).",
    input_schema: {
      type: "object",
      properties: {
        targetId: {
          type: "string",
          description: "Id of the target to edit, from CURRENT STATE `targets[]`.",
        },
        applicationName: {
          type: "string",
          description: "New display name. Omit to keep the current name.",
        },
        url: {
          type: "string",
          description:
            "New full URL including scheme. Omit to keep the current URL.",
        },
      },
      required: ["targetId"],
    },
  },
  {
    name: "delete_verification_target",
    description:
      "PERMANENTLY remove a verification target from the user's list. DESTRUCTIVE — call ONLY when the user explicitly asks to delete/remove a target they named (resolve the id from CURRENT STATE `targets[]`; never guess). Do NOT call for \"disable\" (use set_target_enabled) or \"verify\" requests. The Allow/Deny card shown before execution is the user's confirmation.",
    input_schema: {
      type: "object",
      properties: {
        targetId: {
          type: "string",
          description: "Id of the target to delete, from CURRENT STATE `targets[]`.",
        },
      },
      required: ["targetId"],
    },
  },
  {
    name: "create_secret",
    description:
      "Create a new login credential (name + email + password) in the Secrets panel, optionally binding it to a verification target. SECURITY: a password typed in chat is stored in the chat history and passes through the AI gateway — before calling, warn the user about this and recommend the Secrets panel form for real passwords; proceed only when they have clearly provided the credential in their message anyway (e.g. disposable/test credentials). The password itself is masked in the cloud store and pushed encrypted to the local MCP server, same as the form. If targetId is given, the credential is bound to that target immediately (replacing any previous binding).",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Display name, e.g. \"Staging admin\".",
        },
        email: {
          type: "string",
          description: "Login email/username.",
        },
        password: {
          type: "string",
          description: "Login password, exactly as the user provided it.",
        },
        targetId: {
          type: "string",
          description:
            "Optional target id from CURRENT STATE `targets[]` to bind this credential to.",
        },
      },
      required: ["name", "email", "password"],
    },
  },
  {
    name: "update_secret",
    description:
      "Edit an EXISTING credential's name and/or email. The secretId MUST come from CURRENT STATE `secrets[]`. Passwords are intentionally NOT editable here (same as the UI form). Use when the user asks to rename or fix a credential.",
    input_schema: {
      type: "object",
      properties: {
        secretId: {
          type: "string",
          description: "Id of the credential to edit, from CURRENT STATE `secrets[]`.",
        },
        name: {
          type: "string",
          description: "New display name. Omit to keep the current name.",
        },
        email: {
          type: "string",
          description: "New login email. Omit to keep the current email.",
        },
      },
      required: ["secretId"],
    },
  },
  {
    name: "delete_secret",
    description:
      "PERMANENTLY remove a credential from the Secrets panel. DESTRUCTIVE — call ONLY when the user explicitly asks to delete/remove a credential they named (resolve the id from CURRENT STATE `secrets[]`; never guess). Any target bound to this credential is automatically unbound first. The Allow/Deny card shown before execution is the user's confirmation.",
    input_schema: {
      type: "object",
      properties: {
        secretId: {
          type: "string",
          description: "Id of the credential to delete, from CURRENT STATE `secrets[]`.",
        },
      },
      required: ["secretId"],
    },
  },
  {
    name: "bind_secret",
    description:
      "Bind a saved credential to a verification target (the target will log in with it during runs), or unbind it by passing targetId: null. Ids MUST come from CURRENT STATE `secrets[]` and `targets[]`. Use when the user says things like \"use the staging credential for dev-os\" or \"remove the credential from that target\".",
    input_schema: {
      type: "object",
      properties: {
        secretId: {
          type: "string",
          description: "Id of the credential, from CURRENT STATE `secrets[]`.",
        },
        targetId: {
          type: ["string", "null"],
          description:
            "Id of the target to bind to (from `targets[]`), or null to unbind.",
        },
      },
      required: ["secretId", "targetId"],
    },
  },
  {
    name: "create_project",
    description:
      "Create a NEW project (top-level container in Projects → Features → Flows). Use when the user asks to create, make, or set up a project (\"create a project named X\"). Managers only — a tester account gets a clear error, which you should relay, not retry. The project appears on the Projects page, not the Issue Tracker.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Project name, e.g. \"Blocks-Logic\".",
        },
        description: {
          type: "string",
          description: "Optional short description of the project.",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "update_project",
    description:
      "Edit an EXISTING project — rename it, change its description, or change its status (e.g. active / archived). The projectId MUST come from the user's CURRENT STATE `projects[]` list (match by name there first). Use when the user asks to rename, describe, archive, or update a project.",
    input_schema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Id of the project, from CURRENT STATE `projects[]`.",
        },
        name: { type: "string", description: "New name. Omit to keep." },
        description: {
          type: "string",
          description: "New description. Omit to keep.",
        },
        status: {
          type: "string",
          description: "New status, e.g. \"active\" or \"archived\". Omit to keep.",
        },
      },
      required: ["projectId"],
    },
  },
  {
    name: "delete_project",
    description:
      "PERMANENTLY delete a project. DESTRUCTIVE and irreversible — call ONLY when the user explicitly asks to delete/remove a project they named (resolve the id from CURRENT STATE `projects[]`; never guess). The Allow/Deny card shown before execution is the user's confirmation. Managers only.",
    input_schema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Id of the project to delete, from CURRENT STATE `projects[]`.",
        },
      },
      required: ["projectId"],
    },
  },
  {
    name: "add_project_environment",
    description:
      "Add a CUSTOM environment to a project, beyond the built-in dev / stg / prod / uat (e.g. \"add a qa environment to Blocks-Logic\"). The projectId MUST come from CURRENT STATE `projects[]`. Duplicate slugs (including the built-in four) are rejected. Managers only.",
    input_schema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Id of the project, from CURRENT STATE `projects[]`.",
        },
        label: {
          type: "string",
          description: "Display label, e.g. \"QA\".",
        },
        slug: {
          type: "string",
          description:
            "Optional URL slug (lowercase, no spaces). Derived from the label if omitted.",
        },
      },
      required: ["projectId", "label"],
    },
  },
  {
    name: "list_project_contents",
    description:
      "List a project's features and flows. Use when the user asks WHAT is inside a project, or to double-check names before acting. The projectId MUST come from CURRENT STATE `projects[]`. (Action tools accept feature/flow NAMES directly — listing first is optional.)",
    input_schema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Id of the project, from CURRENT STATE `projects[]`.",
        },
      },
      required: ["projectId"],
    },
  },
  {
    name: "create_feature",
    description:
      "Create a new feature (work item) inside a project. Use when the user asks to add/create a feature (\"add a login feature to Blocks-Logic\"). Managers only — testers get a clear error. envSlug defaults to \"dev\" (the source env clones propagate from).",
    input_schema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Id of the parent project, from CURRENT STATE `projects[]`.",
        },
        name: { type: "string", description: "Feature name." },
        envSlug: {
          type: "string",
          description:
            "Environment to create it in (dev / stg / prod / uat or a custom env slug). Defaults to dev.",
        },
      },
      required: ["projectId", "name"],
    },
  },
  {
    name: "update_feature",
    description:
      "Rename an existing feature (cross-env clones sync automatically). Identify the feature by NAME (what the user said) or by id if you already listed the project. Managers only.",
    input_schema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Parent project id, from CURRENT STATE `projects[]`." },
        featureName: { type: "string", description: "Current name of the feature, as the user said it." },
        featureId: { type: "string", description: "Optional — id instead of name, if already known." },
        name: { type: "string", description: "New name." },
      },
      required: ["projectId", "name"],
    },
  },
  {
    name: "delete_feature",
    description:
      "PERMANENTLY delete a feature AND its cross-env clones. DESTRUCTIVE — call ONLY on an explicit user request. Identify the feature by NAME (what the user said) or by id. The Allow/Deny card is the user's confirmation. Managers only.",
    input_schema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Parent project id, from CURRENT STATE `projects[]`." },
        featureName: { type: "string", description: "Name of the feature to delete." },
        featureId: { type: "string", description: "Optional — id instead of name." },
      },
      required: ["projectId"],
    },
  },
  {
    name: "create_flow",
    description:
      "Create a new flow (testable step/scenario) under a feature. Identify the parent feature by NAME (what the user said) or by id. The flow inherits the feature's environment. Managers only.",
    input_schema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Parent project id, from CURRENT STATE `projects[]`." },
        featureName: { type: "string", description: "Name of the parent feature." },
        featureId: { type: "string", description: "Optional — id instead of name." },
        name: { type: "string", description: "Flow name, e.g. \"submits login with empty password\"." },
        description: { type: "string", description: "Optional longer description." },
        steps: {
          type: "array",
          items: { type: "string" },
          description: "Optional ordered steps to perform.",
        },
      },
      required: ["projectId", "name"],
    },
  },
  {
    name: "update_flow",
    description:
      "Edit an existing flow — rename it and/or change its status (draft / active / done / passed / failed / pending / investigating / pause). Identify the flow by NAME (what the user said) or by id. Cross-env clones sync automatically. Managers only.",
    input_schema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Parent project id, from CURRENT STATE `projects[]`." },
        flowName: { type: "string", description: "Current name of the flow, as the user said it." },
        flowId: { type: "string", description: "Optional — id instead of name." },
        name: { type: "string", description: "New name. Omit to keep." },
        status: {
          type: "string",
          enum: [
            "draft",
            "active",
            "done",
            "passed",
            "failed",
            "pending",
            "investigating",
            "pause",
          ],
          description: "New status. Omit to keep.",
        },
      },
      required: ["projectId"],
    },
  },
  {
    name: "delete_flow",
    description:
      "PERMANENTLY delete a flow AND its cross-env clones. DESTRUCTIVE — call ONLY on an explicit user request. Identify the flow by NAME (what the user said) or by id. The Allow/Deny card is the user's confirmation. Managers only.",
    input_schema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Parent project id, from CURRENT STATE `projects[]`." },
        flowName: { type: "string", description: "Name of the flow to delete." },
        flowId: { type: "string", description: "Optional — id instead of name." },
      },
      required: ["projectId"],
    },
  },
  {
    name: "verify_live_url",
    description:
      "Run the SCRIPTED check sweep against a free-form URL the user typed or pasted — the same automated checks a Start Verification run uses (page load, navigation, buttons, forms, broken links, console errors, network errors, authentication when a credential is bound, accessibility, performance), on a headless Playwright Chromium. Use ONLY when the user explicitly asks for the automated/scripted checks or a quick one-shot sweep with issues recorded — NOT for a conversational \"verify/test/check this app\" request, which you should handle YOURSELF with the browser_* tools (navigate, click through, inspect, screenshot, report). Detected issues are persisted to Blocks Data exactly like a regular run; the VerificationPanel animates while the run is in flight; the chat updates with a summary. The URL itself is NOT added as a permanent target — for that, use `add_verification_target`. Use `open_target_in_browser` ONLY when the user names a targetId from CURRENT STATE `targets[]` and wants to see it in a new tab without running checks. URL must include scheme (https:// or http://); file:// / data: / javascript: etc. are rejected at dispatch.",
    input_schema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description:
            "Full URL including scheme, e.g. https://example.com or http://localhost:3000.",
        },
        scope: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "page_load",
              "navigation",
              "buttons",
              "forms",
              "broken_links",
              "console_errors",
              "network_errors",
              "authentication",
              "accessibility",
              "performance",
            ],
          },
          description:
            "Optional override for which checks to run. Defaults to the user's CURRENT STATE `scope` (the same checks a normal verification would use). Omit to honour the user's existing scope.",
        },
      },
      required: ["url"],
    },
  },

  // ── Workspace (/panel) tools ────────────────────────────────────
  // Every one of these operates on the folder the user picked in the
  // VS Code-style workspace (`/projects/:projectId/:envSlug/panel`).
  // All resolve the workspace id + root from CURRENT STATE `workspace`;
  // when that block is absent the dispatch refuses with "no workspace
  // folder is open" — never guess a path. Relative paths ONLY (they are
  // resolved against the workspace root server-side; an absolute path
  // or a `..` escape is refused by the backend's traversal guard).

  {
    name: "workspace_list_files",
    description:
      "List the file tree of the workspace folder (Explorer view). Use when the user asks what files exist, or before reading a file whose exact path you don't know. Hides node_modules/.git; caps at 5000 entries and 8 levels deep. Keep maxDepth small (1-3) — the response is a tree string, and deep trees waste context.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Optional sub-folder to list, relative to the workspace root. Omit for the root.",
        },
        maxDepth: {
          type: "number",
          description:
            "How many levels deep to walk (1-8). Default 2. Use 1 for a quick overview, 3+ only when the user asks for the full tree of a small folder.",
        },
      },
    },
  },
  {
    name: "workspace_read_file",
    description:
      "Read a text file from the workspace. Use to inspect code, config, or output before editing it (ALWAYS read before you rewrite a whole file). The path is workspace-relative. Returns the UTF-8 content — long files are truncated with a notice. Refuses .env / credential files.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "File path relative to the workspace root, e.g. \"src/main.ts\".",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "workspace_write_file",
    description:
      "Create or overwrite a text file in the workspace (auto-creates parent folders, 1MB cap). Use for new files or complete rewrites. For SMALL targeted edits to an existing file, still read the file first and write back the full updated content. Do NOT use for renaming (use workspace_rename_path) or deletion. Refuses .env / credential files. After writing, offer to run the tests or the build to verify.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "File path relative to the workspace root. Missing parents are created.",
        },
        content: {
          type: "string",
          description: "The FULL new file content (UTF-8).",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "workspace_create_folder",
    description:
      "Create a directory in the workspace (mkdir -p — missing parents are created). Use when the user asks for a new folder, or before writing a file you want grouped somewhere that doesn't exist yet (though workspace_write_file already creates parents).",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Folder path relative to the workspace root.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "workspace_delete_path",
    description:
      "PERMANENTLY delete a file or folder (recursive for folders) from the workspace. DESTRUCTIVE and irreversible — call ONLY when the user explicitly asks to delete that path by name, and NEVER for .env / credential files. If the workspace is a git repo and the path is tracked, prefer mentioning `git checkout`/discard semantics first for tracked files the user merely wants reverted. The Allow/Deny card is the user's confirmation.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path relative to the workspace root.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "workspace_rename_path",
    description:
      "Rename or move a file/folder inside the workspace. Refused if the destination already exists. Use when the user says rename/move; do NOT use copy — there is no copy tool, so copying means read + write.",
    input_schema: {
      type: "object",
      properties: {
        oldPath: {
          type: "string",
          description: "Current path relative to the workspace root.",
        },
        newPath: {
          type: "string",
          description: "New path relative to the workspace root.",
        },
      },
      required: ["oldPath", "newPath"],
    },
  },
  {
    name: "workspace_search",
    description:
      "Full-text search across the workspace folder (ripgrep-style, recursive, hides node_modules/.git). Use to locate code by name, symbol, or error string before reading files — far cheaper than walking the tree. Supports regex and include/exclude globs.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Text or regex to search for.",
        },
        caseSensitive: { type: "boolean" },
        wholeWord: { type: "boolean" },
        regex: {
          type: "boolean",
          description: "Treat the query as a regular expression.",
        },
        includeGlobs: {
          type: "array",
          items: { type: "string" },
          description:
            "Only search files matching these globs, e.g. [\"src/**/*.ts\"].",
        },
        excludeGlobs: {
          type: "array",
          items: { type: "string" },
          description: "Skip files/folders matching these globs.",
        },
        maxResults: {
          type: "number",
          description: "Cap on matches returned (server default 5000).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "workspace_exec_command",
    description:
      "Run a one-shot shell command with cwd = the workspace root and get back exit code + stdout + stderr. Use for builds, test runs, package installs, git plumbing the dedicated git tools don't cover, lint, and anything a developer would type in the terminal. BLOCKING — the call waits for the command to finish; default timeout 120s (max 300s), so NEVER use it for `npm run dev` or other long-lived servers (the workspace's Dev-servers panel owns those). Each stream is capped at 2MB. Prefer `npm run <script>` (see workspace_npm_scripts) over raw node/npx invocations. Refuses to echo .env / credential files.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "The command line to run, e.g. \"npm test\" or \"npx tsc --noEmit\".",
        },
        timeoutMs: {
          type: "number",
          description:
            "Kill the child after this long. 1000-300000, default 120000. Pick a tight budget for quick commands.",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "workspace_npm_scripts",
    description:
      "Read the workspace's package.json summary — name, scripts, and key dependency lists. Use before running anything, so you call `npm run <script>` with a script that actually exists, and to check whether a dependency is installed.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "workspace_open_file",
    description:
      "Open a workspace file in the user's editor as a new tab (and focus it). Use AFTER writing or editing a file so the user sees the result, or when the user asks to open/show a file. The file must exist — create it first with workspace_write_file if needed.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path relative to the workspace root.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "workspace_open_folder",
    description:
      "Open a folder on disk as the ACTIVE workspace root — the equivalent of the user clicking Open Folder and typing a path. Use when the user gives you an absolute path to work in (e.g. 'use D:\\repos\\my-app') or asks you to switch projects. The folder must ALREADY EXIST on the machine — refuses with 'Folder not found' otherwise; ask the user to create it first. Switching replaces the current folder (tabs clear, tree re-lists); works even when no folder is open yet. After it succeeds, re-list the new root with workspace_list_files before touching files.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Absolute folder path, e.g. D:\\projects\\my-app (Windows) or /home/user/my-app.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "workspace_git_status",
    description:
      "Read the git status of the workspace repo — current branch, staged/unstaged/untracked files. Use before any git action to see what would be committed, and after edits to confirm what changed.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "workspace_git_branches",
    description:
      "List the branches of the workspace repo with the current one marked. Use before workspace_git_checkout.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "workspace_git_diff",
    description:
      "Get the unified diff of one file in the workspace repo. staged=false compares against the index; staged=true compares the index against HEAD. Empty for untracked files. Use to review changes before staging/committing.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path relative to the workspace root.",
        },
        staged: {
          type: "boolean",
          description: "true = show the staged diff. Default false.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "workspace_git_stage",
    description:
      "Stage files for the next commit (git add). Paths are workspace-relative; an empty array stages EVERYTHING (git add -A). Use after edits, paired with workspace_git_status to pick the right files.",
    input_schema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description:
            "Files to stage, relative to the workspace root. Empty array = stage all changes.",
        },
      },
      required: ["paths"],
    },
  },
  {
    name: "workspace_git_unstage",
    description:
      "Unstage files (git reset HEAD -- <paths>) — keeps the working-tree changes, just takes them out of the index.",
    input_schema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Files to unstage, relative to the workspace root.",
        },
      },
      required: ["paths"],
    },
  },
  {
    name: "workspace_git_discard",
    description:
      "DISCARD the uncommitted changes of the given files (git checkout -- <paths>) — the edits are LOST. DESTRUCTIVE — call ONLY when the user explicitly asks to discard/revert changes they named. The Allow/Deny card is the user's confirmation.",
    input_schema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Files to discard, relative to the workspace root.",
        },
      },
      required: ["paths"],
    },
  },
  {
    name: "workspace_git_commit",
    description:
      "Commit the staged index with the given message. Stage first (workspace_git_stage) — an empty index fails. Write the commit message in the repo's own convention, concise and imperative.",
    input_schema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "The commit message.",
        },
      },
      required: ["message"],
    },
  },
  {
    name: "workspace_git_push",
    description:
      "Push the workspace repo's current branch to its remote (git push). Use only when the user explicitly asks to push. Network failures are possible — report the stderr verbatim and let the user decide about retries.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "workspace_git_pull",
    description:
      "Pull the workspace repo's current branch from its remote (git pull). Use when the user asks to sync/update, or before starting new work. Merge conflicts come back in the output — surface them to the user instead of trying to resolve them yourself.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "workspace_git_checkout",
    description:
      "Switch the workspace repo to another branch (git checkout <branch>). Use workspace_git_branches first to confirm the exact name; uncommitted changes may block or carry over — check workspace_git_status first when the tree is dirty.",
    input_schema: {
      type: "object",
      properties: {
        branch: {
          type: "string",
          description: "Branch name to switch to.",
        },
      },
      required: ["branch"],
    },
  },
];

// The official Playwright MCP browser tools (browser_navigate, browser_click,
// …) are NOT listed above — their catalog is fetched live from the backend
// bridge (which spawns `npx @playwright/mcp@latest`) so it can never drift
// from the official server. These helpers derive presentational text from
// the catalog names at runtime, the same derive-don't-hardcode rule the
// activity feed follows.

// "browser_take_screenshot" → "Playwright: take screenshot" — permission-card
// label for a dynamic browser tool.
export function browserToolLabel(name: string): string {
  return `Playwright: ${name.replace(/^browser_/, "").replace(/_/g, " ")}`;
}

// One-liner for the post-execution "✓ Done" line — mirrors the input's most
// identifying argument (url / ref / element description) when present.
export function browserToolSummary(
  name: string,
  input: Record<string, unknown>,
): string {
  const action = name.replace(/^browser_/, "").replace(/_/g, " ");
  const arg = input.url ?? input.ref ?? input.text ?? input.element;
  return `${action}${arg !== undefined ? ` — ${String(arg).slice(0, 80)}` : ""} (via Playwright MCP)`;
}

// Human-readable label per tool — shown in the permission card so the
// user understands what they're being asked to do, not just the
// programmatic tool name.
export const toolLabel: Record<AnthropicTool["name"], string> = {
  toggle_verification_check: "toggle a verification check",
  set_target_enabled: "enable or disable a target",
  set_filters: "change the issue-list filters",
  start_verification: "start a verification run",
  update_issue_status: "update an issue's status",
  open_target_in_browser: "open a target in a new browser tab",
  add_verification_target: "add a new verification target",
  update_verification_target: "edit a verification target",
  delete_verification_target: "permanently delete a verification target",
  create_secret: "create a new login credential",
  update_secret: "edit a credential's name or email",
  delete_secret: "permanently delete a credential",
  bind_secret: "bind or unbind a credential to a target",
  create_project: "create a new project",
  update_project: "edit a project",
  delete_project: "permanently delete a project",
  add_project_environment: "add a custom environment to a project",
  list_project_contents: "list a project's features and flows",
  create_feature: "create a new feature in a project",
  update_feature: "rename a feature",
  delete_feature: "permanently delete a feature and its clones",
  create_flow: "create a new flow under a feature",
  update_flow: "edit a flow's name or status",
  delete_flow: "permanently delete a flow and its clones",
  verify_live_url: "verify an arbitrary URL live",
  workspace_list_files: "list the workspace file tree",
  workspace_read_file: "read a workspace file",
  workspace_write_file: "write a workspace file",
  workspace_create_folder: "create a folder in the workspace",
  workspace_delete_path: "permanently delete a file/folder from the workspace",
  workspace_rename_path: "rename or move a workspace file/folder",
  workspace_search: "search text across the workspace",
  workspace_exec_command: "run a shell command in the workspace",
  workspace_npm_scripts: "read the workspace package.json scripts",
  workspace_open_file: "open a file in the editor",
  workspace_open_folder: "open a folder as the workspace root",
  workspace_git_status: "read the workspace git status",
  workspace_git_branches: "list the workspace git branches",
  workspace_git_diff: "show a workspace file's git diff",
  workspace_git_stage: "stage workspace files",
  workspace_git_unstage: "unstage workspace files",
  workspace_git_discard: "discard uncommitted workspace changes",
  workspace_git_commit: "commit the staged workspace changes",
  workspace_git_push: "push the workspace repo",
  workspace_git_pull: "pull the workspace repo",
  workspace_git_checkout: "switch the workspace git branch",
};

// Short summary per tool, used in the post-execution "✓ Done" line so
// the user sees a one-liner describing what just happened.
export const toolActionSummary: Record<
  AnthropicTool["name"],
  (input: Record<string, unknown>) => string
> = {
  toggle_verification_check: (input) => {
    const checkId = input.checkId as string;
    const enabled = input.enabled as boolean | undefined;
    return `Verification check "${checkId}" ${enabled === undefined ? "toggled" : enabled ? "enabled" : "disabled"}.`;
  },
  set_target_enabled: (input) => {
    const targetId = input.targetId as string;
    const enabled = input.enabled as boolean;
    return `Target ${targetId} ${enabled ? "enabled" : "disabled"}.`;
  },
  set_filters: () => "Issue filters updated.",
  start_verification: () => "Verification started.",
  update_issue_status: (input) => {
    const issueId = input.issueId as string;
    const status = input.status as string;
    return `${issueId} set to ${status}.`;
  },
  open_target_in_browser: (input) => {
    const targetId = input.targetId as string;
    return `Opened target ${targetId} in a new tab.`;
  },
  add_verification_target: (input) => {
    const url = input.url as string;
    return `Target ${url} added.`;
  },
  update_verification_target: (input) => {
    const targetId = input.targetId as string;
    const changes: string[] = [];
    if (typeof input.applicationName === "string") {
      changes.push(`name → "${input.applicationName}"`);
    }
    if (typeof input.url === "string") changes.push(`url → ${input.url}`);
    return `Target ${targetId} updated (${changes.join(", ") || "no changes"}).`;
  },
  delete_verification_target: (input) => {
    const targetId = input.targetId as string;
    return `Target ${targetId} deleted.`;
  },
  create_secret: (input) => {
    const name = input.name as string;
    return `Credential "${name}" created${input.targetId ? " and bound" : ""}.`;
  },
  update_secret: (input) => {
    const secretId = input.secretId as string;
    return `Credential ${secretId} updated.`;
  },
  delete_secret: (input) => {
    const secretId = input.secretId as string;
    return `Credential ${secretId} deleted.`;
  },
  bind_secret: (input) => {
    const secretId = input.secretId as string;
    return input.targetId
      ? `Credential ${secretId} bound to ${input.targetId}.`
      : `Credential ${secretId} unbound.`;
  },
  create_project: (input) => {
    const name = input.name as string;
    return `Project "${name}" created.`;
  },
  update_project: (input) => {
    const projectId = input.projectId as string;
    const changes: string[] = [];
    if (typeof input.name === "string") changes.push(`name → "${input.name}"`);
    if (typeof input.description === "string") {
      changes.push("description updated");
    }
    if (typeof input.status === "string") changes.push(`status → ${input.status}`);
    return `Project ${projectId} updated (${changes.join(", ") || "no changes"}).`;
  },
  delete_project: (input) => {
    const projectId = input.projectId as string;
    return `Project ${projectId} deleted.`;
  },
  add_project_environment: (input) => {
    const label = input.label as string;
    return `Environment "${label}" added to the project.`;
  },
  list_project_contents: (input) => {
    const projectId = input.projectId as string;
    return `Listed features and flows of project ${projectId}.`;
  },
  create_feature: (input) => {
    const name = input.name as string;
    return `Feature "${name}" created.`;
  },
  update_feature: (input) => {
    const featureId = input.featureId as string;
    return `Feature ${featureId} renamed to "${input.name}".`;
  },
  delete_feature: (input) => {
    const featureId = input.featureId as string;
    return `Feature ${featureId} deleted.`;
  },
  create_flow: (input) => {
    const name = input.name as string;
    return `Flow "${name}" created.`;
  },
  update_flow: (input) => {
    const flowId = input.flowId as string;
    return `Flow ${flowId} updated.`;
  },
  delete_flow: (input) => {
    const flowId = input.flowId as string;
    return `Flow ${flowId} deleted.`;
  },
  verify_live_url: (input) => {
    const url = input.url as string;
    return `Live verification of ${url} dispatched.`;
  },
  workspace_list_files: (input) =>
    `Listed the workspace tree${input.path ? ` under ${input.path as string}` : ""}.`,
  workspace_read_file: (input) =>
    `Read ${input.path as string}.`,
  workspace_write_file: (input) =>
    `Wrote ${input.path as string}.`,
  workspace_create_folder: (input) =>
    `Created folder ${input.path as string}.`,
  workspace_delete_path: (input) =>
    `Deleted ${input.path as string}.`,
  workspace_rename_path: (input) =>
    `Renamed ${input.oldPath as string} → ${input.newPath as string}.`,
  workspace_search: (input) =>
    `Searched the workspace for "${input.query as string}".`,
  workspace_exec_command: (input) =>
    `Ran \`${input.command as string}\`.`,
  workspace_npm_scripts: () => "Read the workspace package.json.",
  workspace_open_file: (input) =>
    `Opened ${input.path as string} in the editor.`,
  workspace_open_folder: (input) =>
    `Opening workspace folder ${input.path as string}.`,
  workspace_git_status: () => "Read the git status.",
  workspace_git_branches: () => "Listed the git branches.",
  workspace_git_diff: (input) =>
    `Showed the ${input.staged ? "staged " : ""}diff of ${input.path as string}.`,
  workspace_git_stage: (input) => {
    const paths = (input.paths as string[]) ?? [];
    return paths.length ? `Staged ${paths.join(", ")}.` : "Staged all changes.";
  },
  workspace_git_unstage: (input) => {
    const paths = (input.paths as string[]) ?? [];
    return `Unstaged ${paths.join(", ")}.`;
  },
  workspace_git_discard: (input) => {
    const paths = (input.paths as string[]) ?? [];
    return `Discarded changes in ${paths.join(", ")}.`;
  },
  workspace_git_commit: (input) =>
    `Committed: "${input.message as string}".`,
  workspace_git_push: () => "Pushed to the remote.",
  workspace_git_pull: () => "Pulled from the remote.",
  workspace_git_checkout: (input) =>
    `Switched to branch ${input.branch as string}.`,
};
