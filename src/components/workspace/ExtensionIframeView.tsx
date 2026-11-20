// Sandboxed iframe rendering one panel contributed by an installed
// extension. The iframe is built from `ext.zipBase64` (decoded to the
// entry HTML pointed to by `manifest.main`) with a tiny host-client
// script prepended so the extension can talk to the host without
// needing to bundle anything of ours.
//
// Sandbox attributes: `allow-scripts` only. NO `allow-same-origin`
// (would let the extension touch host localStorage / cookies) and NO
// `allow-top-navigation` / `allow-popups` (would let it redirect or
// open windows). The extension is fully isolated; the only bridge is
// `postMessage`.

import { useEffect, useMemo, useRef } from "react";
import { base64ToBytes, strFromU8, unzipSync } from "@/lib/extensions/zip";
import type { InstalledExtension } from "@/lib/extensions/types";

interface ExtensionIframeViewProps {
  extension: InstalledExtension;
  /** Optional panel id — only used to scope the iframe title. */
  panelId?: string;
}

// ─── Host client (injected into the iframe) ──────────────────────────

/** JavaScript string injected at the top of the iframe srcDoc. Exposes
 *  `window.latticeHost` with a tiny pub/sub API the extension can
 *  call. The host posts `host:init` immediately after the iframe
 *  announces `ext:ready` so the extension can render. */
const HOST_CLIENT_SOURCE = `
(function () {
  var listeners = {};
  window.latticeHost = {
    on: function (type, handler) {
      (listeners[type] = listeners[type] || []).push(handler);
    },
    send: function (msg) {
      window.parent.postMessage(Object.assign({ source: "lattice-ext" }, msg), "*");
    },
    ready: function () {
      this.send({ type: "ext:ready", version: 1 });
    }
  };
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.source !== "lattice-host") return;
    var fns = listeners[data.type] || [];
    for (var i = 0; i < fns.length; i++) {
      try { fns[i](data); } catch (e) { console.error("[lattice-host handler]", e); }
    }
  });
  console.info("[lattice-host] host client loaded — call latticeHost.ready() when initialized");
})();
`.trim();

// ─── Message protocol ────────────────────────────────────────────────

export type HostToExtension =
  | {
      type: "host:init";
      manifest: { id: string; name: string; version: string };
    }
  | { type: "host:data"; key: string; value: unknown };

export type ExtensionToHost =
  | { type: "ext:ready"; version: number }
  | { type: "ext:log"; level: "info" | "warn" | "error"; message: string }
  | { type: "ext:navigate"; panelId: string }
  | { type: "ext:command"; commandId: string; args?: unknown };

// ─── Component ────────────────────────────────────────────────────────

export function ExtensionIframeView({
  extension,
  panelId,
}: ExtensionIframeViewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const srcDoc = useMemo(() => buildSrcDoc(extension), [extension]);

  useEffect(() => {
    function onMessage(event: MessageEvent<ExtensionToHost>) {
      // Only accept messages from our iframe (sandboxed iframes have
      // opaque-origin but `event.source` still points to the contentWindow).
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      switch (data.type) {
        case "ext:ready":
          // Respond with host:init so the extension can render.
          iframeRef.current?.contentWindow?.postMessage(
            {
              source: "lattice-host",
              type: "host:init",
              manifest: {
                id: extension.manifest.id,
                name: extension.manifest.name,
                version: extension.manifest.version,
              },
            },
            "*",
          );
          break;
        case "ext:log":
          // Forward to host console for debugging — extensions don't
          // have access to devtools of the host page (different origin).
          if (data.level === "error") {
            console.error(`[ext:${extension.manifest.id}]`, data.message);
          } else if (data.level === "warn") {
            console.warn(`[ext:${extension.manifest.id}]`, data.message);
          } else {
            console.info(`[ext:${extension.manifest.id}]`, data.message);
          }
          break;
        case "ext:navigate":
          // Bubble through window for WorkspacePage to listen on. We use
          // a custom event so the host component can wire without
          // prop-drilling.
          window.dispatchEvent(
            new CustomEvent("lattice-ext:navigate", {
              detail: { extensionId: extension.id, panelId: data.panelId },
            }),
          );
          break;
        case "ext:command":
          // Bubble for any host component that wants to handle
          // extension-fired commands (e.g. opening a URL, jumping to a
          // feature row). v1 just logs.
          console.info(
            `[ext:${extension.manifest.id}] command`,
              data.commandId,
              data.args,
          );
          break;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [extension.id, extension.manifest.id]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      title={`Extension: ${extension.manifest.name}${
        panelId ? ` — ${panelId}` : ""
      }`}
      data-testid={`extension-iframe-${extension.id}`}
      className="h-full w-full border-0 bg-card"
    />
  );
}

// ─── srcDoc builder ──────────────────────────────────────────────────

function buildSrcDoc(extension: InstalledExtension): string {
  // Decode the stored base64 zip back to entries, then resolve the
  // entry HTML. If anything fails we surface a visible error inside
  // the iframe so the user knows what's wrong.
  let entryHtml: string;
  try {
    const bytes = base64ToBytes(extension.zipBase64);
    const entries = unzipSync(bytes);
    const raw = entries[extension.manifest.main];
    if (!raw) {
      return errorHtml(
        `Entry \`${extension.manifest.main}\` not found in zip.`,
      );
    }
    entryHtml = strFromU8(raw);
  } catch (err) {
    return errorHtml(`Could not load extension: ${(err as Error).message}`);
  }
  // Inject host-client.js as the very first <script> so it runs before
  // any user code. We don't try to be clever about CSP / nonces —
  // `sandbox="allow-scripts"` already restricts the iframe.
  const injection = `<script>${HOST_CLIENT_SOURCE}<\/script>`;
  // If the entry already has a <head>, inject before its closing tag;
  // otherwise wrap.
  if (/<head[^>]*>/i.test(entryHtml)) {
    return entryHtml.replace(/<\/head>/i, `${injection}</head>`);
  }
  if (/<html[^>]*>/i.test(entryHtml)) {
    return entryHtml.replace(
      /<html([^>]*)>/i,
      `<html$1><head>${injection}</head>`,
    );
  }
  // No <html> at all — wrap in a minimal document so the browser
  // doesn't fall back to quirks mode.
  return `<!doctype html><html><head>${injection}</head><body>${entryHtml}</body></html>`;
}

function errorHtml(message: string): string {
  const escaped = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!doctype html><html><body style="font-family: ui-monospace, monospace; padding: 1rem; color: #b91c1c; background: #fff;">
    <strong>Extension failed to load</strong><br/>${escaped}
  </body></html>`;
}