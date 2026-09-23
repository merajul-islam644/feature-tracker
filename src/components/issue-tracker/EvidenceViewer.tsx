// Renders an evidence item based on its type (spec section 25).

import { Image, Video, Terminal, Network, Link2, Eye } from "lucide-react";
import type { Evidence } from "@/types/issue-tracker";

interface Props {
  evidence: Evidence;
}

export function EvidenceViewer({ evidence }: Props) {
  const Icon = iconFor(evidence.type);

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="text-xs font-medium text-foreground">{evidence.label}</span>
        <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">
          {evidence.type}
        </span>
      </div>
      <div className="p-3">
        {renderBody(evidence)}
        {evidence.timestamp && (
          <p className="mt-2 text-[10px] text-muted-foreground">
            Captured at {new Date(evidence.timestamp).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}

function renderBody(evidence: Evidence) {
  switch (evidence.type) {
    case "screenshot": {
      // MCP step 7: prefer `storageRef` (resolved via /api/evidence/:ref)
      // when present, otherwise fall back to an inline data URI. The two
      // paths are visually identical — only the source differs.
      const src =
        evidence.storageRef
          ? `/api/evidence/${encodeURIComponent(evidence.storageRef)}`
          : evidence.value;
      if (src && (src.startsWith("data:image") || src.startsWith("/api/"))) {
        return (
          <img
            src={src}
            alt={evidence.label}
            className="max-h-64 w-full rounded border border-border object-contain"
          />
        );
      }
      return <Placeholder label="Screenshot unavailable" sublabel={evidence.storageRef ?? evidence.value} />;
    }
    case "video":
      return <Placeholder label="Video playback unavailable in mock" sublabel={evidence.storageRef ?? evidence.value} />;
    case "console":
      return (
        <pre className="max-h-40 overflow-auto rounded bg-zinc-950 px-2 py-1 font-mono text-xs leading-relaxed text-zinc-100">
          {evidence.value || <span className="text-zinc-400">[content stored at /api/evidence/{evidence.storageRef}]</span>}
        </pre>
      );
    case "network":
      return (
        <pre className="max-h-40 overflow-auto rounded bg-zinc-950 px-2 py-1 font-mono text-xs leading-relaxed text-zinc-100">
          {evidence.value || <span className="text-zinc-400">[content stored at /api/evidence/{evidence.storageRef}]</span>}
        </pre>
      );
    case "url":
      // When `storageRef` is present, the link resolves to the MCP-server
      // evidence file. When absent, `value` is the URL itself — the caller
      // (verification agent) is responsible for ensuring it's a safe
      // http(s) href; we still gate to those schemes defensively so a
      // `javascript:` value can't execute in the new tab.
      //
      // `noopener,noreferrer` is the correct combo for `target="_blank"`:
      // noreferrer keeps Referer quiet; noopener prevents the opened tab
      // from reaching back into window.opener and rewriting this page.
      {
        const href = evidence.storageRef
          ? `/api/evidence/${encodeURIComponent(evidence.storageRef)}`
          : evidence.value;
        const safeHref = /^https?:\/\//i.test(href) ? href : "";
        if (!safeHref) {
          return (
            <p className="break-all text-xs text-muted-foreground">
              {evidence.value || evidence.storageRef}
            </p>
          );
        }
        return (
          <a
            href={safeHref}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-xs text-primary hover:underline"
          >
            {evidence.storageRef ? `Open ${evidence.storageRef}` : href}
          </a>
        );
      }
    case "observation":
      return (
        <p className="whitespace-pre-wrap text-xs text-foreground">{evidence.value}</p>
      );
  }
}

function Placeholder({ label, sublabel }: { label: string; sublabel?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded border border-dashed border-border bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
      <Eye className="h-4 w-4" aria-hidden="true" />
      <p className="font-medium text-foreground">{label}</p>
      {sublabel && <p className="font-mono text-[10px]">{sublabel}</p>}
    </div>
  );
}

function iconFor(type: Evidence["type"]) {
  switch (type) {
    case "screenshot":
      return Image;
    case "video":
      return Video;
    case "console":
      return Terminal;
    case "network":
      return Network;
    case "url":
      return Link2;
    case "observation":
      return Eye;
  }
}
