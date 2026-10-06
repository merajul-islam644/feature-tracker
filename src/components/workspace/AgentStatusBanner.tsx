// AgentStatusBanner — proactive UI for the local-agent bridge.
//
// Two visual elements, two components:
//
//   <AgentStatusBanner status={status} />
//     Full-width yellow banner with copyable "start the agent"
//     command. Renders only when status is non-null, the bridge
//     is engaged, and the agent is NOT connected. Designed to
//     sit above the workspace top bar.
//
//   <AgentStatusPill status={status} />
//     Tiny green "Local agent · connected" pill. Renders only
//     when the bridge is engaged AND the agent is connected.
//     Designed to sit inside the top bar next to the other
//     affordances.
//
// Why a banner instead of a toast
//   A toast is reactive (it appears on failure) and disappears in
//   a few seconds. The user would think "did the network break?"
//   and the 503 message doesn't make it clear what to do. The
//   banner is proactive (it appears before the first failure) and
//   stays until the agent is connected. The copyable command box
//   lowers the friction of "how do I start the agent" to one
//   click on a "Copy command" button.

import { useMemo, useState } from "react";
import { CheckCircle2, Copy, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/blocks/i18n";

export type AgentStatus = {
  enabled: boolean;
  connected: boolean;
  connectedAt: string | null;
  version: string | null;
} | null;

export function AgentStatusBanner({ status }: { status: AgentStatus }) {
  const t = useT();

  // Hide on loading + dev case + connected case. Only the
  // disconnected case shows the full banner.
  if (status === null) return null;
  if (!status.enabled) return null;
  if (status.connected) return null;

  return <DisconnectedBanner t={t} version={status.version} />;
}

export function AgentStatusPill({ status }: { status: AgentStatus }) {
  const t = useT();
  if (status === null) return null;
  if (!status.enabled) return null;
  if (!status.connected) return null;

  return (
    <div
      data-testid="agent-status-pill"
      className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200"
    >
      <CheckCircle2 className="h-3.5 w-3.5" />
      <span>{t("agent.connected", "Local agent · connected")}</span>
    </div>
  );
}

function DisconnectedBanner({
  t,
  version,
}: {
  t: ReturnType<typeof useT>;
  version: string | null;
}) {
  // The full command line the user needs to run. The token is a
  // placeholder; the user pastes the real one from the cloud
  // portal (or, in a future change, from the Settings page).
  const command = useMemo(
    () => "node agent/agent.mjs --token <paste-the-token-here>",
    [],
  );

  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      // execCommand works in cross-origin iframes; clipboard API
      // does not. The panel may render inside one.
      const el = document.createElement("textarea");
      el.value = command;
      el.setAttribute("readonly", "");
      el.style.position = "absolute";
      el.style.left = "-9999px";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      // User can still select-and-copy the text manually.
    }
  };

  return (
    <div
      data-testid="agent-status-banner"
      role="status"
      className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <Plug className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
        <div className="min-w-0">
          <p className="font-medium">
            {t("agent.disconnectedTitle", "Local agent not connected")}
          </p>
          <p className="mt-0.5 text-sm text-amber-800">
            {t(
              "agent.disconnectedBody",
              "Open a terminal in the Lattice repo and run the command below. The agent reads your local files and runs your dev server.",
            )}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 sm:flex-shrink-0">
        <code className="block max-w-md truncate rounded bg-amber-100/80 px-2 py-1 font-mono text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
          {command}
        </code>
        <Button
          size="sm"
          variant="outline"
          onClick={onCopy}
          className="border-amber-300 bg-white hover:bg-amber-50"
        >
          {copied ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              <span className="ml-1.5">{t("agent.copied", "Copied")}</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span className="ml-1.5">{t("agent.copyCommand", "Copy")}</span>
            </>
          )}
        </Button>
      </div>
      {version === null ? null : (
        <p className="text-[10px] uppercase tracking-wide text-amber-700/70">
          {t("agent.cloudVersion", "Cloud bridge v")}
          {version}
        </p>
      )}
    </div>
  );
}
