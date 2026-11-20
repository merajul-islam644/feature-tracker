// Extensions manager — the panel shown when the user clicks the
// "Extensions" icon in the workspace activity bar. Lists installed
// extensions, has the "Install from .zip" picker, and exposes
// enable/disable/uninstall via per-row menu.
//
// Pattern is modeled on `src/pages/SettingsPage.tsx:158-260` (Card
// section). Uses hidden `<input type="file">` + button ref for the
// picker — same shape as `src/components/settings/AIAvatarButton.tsx:128-148`.

import { useRef, useState } from "react";
import {
  Puzzle,
  Trash2,
  Upload,
  MoreVertical,
  Power,
  PowerOff,
  LayoutPanelLeft,
  TerminalSquare,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useExtensions } from "@/contexts/ExtensionsContext";
import type { InstalledExtension } from "@/lib/extensions/types";
import { cn } from "@/lib/utils";

interface PendingInstall {
  file: File;
  /** The would-be extension id (read from manifest preview). */
  previewName: string;
  previewVersion: string;
  previewPanels: number;
  previewCommands: number;
}

export function ExtensionsManagerPanel() {
  const { installed, install, uninstall, setEnabled } = useExtensions();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingInstall | null>(null);
  const [busy, setBusy] = useState(false);

  const sorted = [...installed].sort((a, b) =>
    a.manifest.name.localeCompare(b.manifest.name),
  );

  function handlePickFile() {
    fileInputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset so re-picking the same file still fires onChange.
    e.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".zip")) {
      toast.error("Please pick a .zip file.");
      return;
    }
    // Quick pre-read to surface a preview dialog before commit. The
    // full install pipeline runs again on confirm (validation +
    // localStorage write). Keeps the dialog cancellation cheap.
    setBusy(true);
    try {
      const { readManifest, unzipBuffer, arrayBufferToBase64 } =
        await import("@/lib/extensions/zip");
      const buf = await file.arrayBuffer();
      const entries = unzipBuffer(buf);
      const m = readManifest(entries);
      if (!m.ok) {
        toast.error(m.error);
        return;
      }
      setPending({
        file,
        previewName: m.manifest.name,
        previewVersion: m.manifest.version,
        previewPanels: m.manifest.contributes?.panels?.length ?? 0,
        previewCommands: m.manifest.contributes?.commands?.length ?? 0,
      });
      // Suppress unused-import warning for the lazy imports above.
      void arrayBufferToBase64;
    } catch (err) {
      toast.error(`Could not read zip: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function confirmInstall() {
    if (!pending) return;
    setBusy(true);
    try {
      const result = await install(pending.file);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Installed ${result.extension.manifest.name}`);
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  function handleUninstall(ext: InstalledExtension) {
    const ok = window.confirm(
      `Uninstall "${ext.manifest.name}"? This cannot be undone.`,
    );
    if (!ok) return;
    uninstall(ext.id);
    toast.success(`Uninstalled ${ext.manifest.name}`);
  }

  return (
    <div
      className="flex h-full w-full flex-col"
      role="region"
      aria-label="Extensions manager"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border bg-muted/20 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Puzzle className="h-4 w-4 text-muted-foreground" aria-hidden />
          <h2 className="text-sm font-semibold">Extensions</h2>
          <Badge variant="secondary" className="font-mono text-[10px]">
            {installed.length}
          </Badge>
        </div>
        <Button
          variant="default"
          size="sm"
          onClick={handlePickFile}
          disabled={busy}
          data-testid="extensions-install-zip"
        >
          <Upload className="mr-1 h-3.5 w-3.5" aria-hidden />
          Install .zip
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          className="sr-only"
          onChange={handleFileChange}
        />
      </header>

      <div className="flex-1 overflow-y-auto py-1">
        {sorted.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="space-y-0">
            {sorted.map((ext) => (
              <ExtensionRow
                key={ext.id}
                ext={ext}
                onToggle={(enabled) => {
                  const result = setEnabled(ext.id, enabled);
                  if (!result.ok) {
                    toast.error(result.error ?? "Could not update extension");
                  } else {
                    toast.success(
                      `${enabled ? "Enabled" : "Disabled"} ${ext.manifest.name}`,
                    );
                  }
                }}
                onUninstall={() => handleUninstall(ext)}
              />
            ))}
          </ul>
        )}
      </div>

      <InstallPreviewDialog
        pending={pending}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={confirmInstall}
      />
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────

function ExtensionRow({
  ext,
  onToggle,
  onUninstall,
}: {
  ext: InstalledExtension;
  onToggle: (enabled: boolean) => void;
  onUninstall: () => void;
}) {
  const panels = ext.manifest.contributes?.panels ?? [];
  const commands = ext.manifest.contributes?.commands ?? [];
  const accent = avatarColor(ext.manifest.id);
  const initial = ext.manifest.name.trim().charAt(0).toUpperCase() || "?";
  return (
    <li className="group relative">
      <div
        className={cn(
          "relative mx-3 my-2 overflow-hidden rounded-xl border bg-card",
          "shadow-sm transition-all duration-150",
          "hover:-translate-y-px hover:border-primary/40 hover:shadow-md",
          !ext.enabled && "opacity-75",
        )}
      >
        {/* Top color stripe — same gradient as the avatar; doubles as a
            publisher chip background when hovered. */}
        <div
          aria-hidden
          className="h-1 w-full"
          style={{
            background: `linear-gradient(90deg, ${accent.from}, ${accent.to})`,
          }}
        />

        <div className="p-3">
          {/* Title row: avatar · name · menu */}
          <div className="flex items-start gap-3">
            <div
              aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[15px] font-semibold uppercase shadow-sm ring-1 ring-inset ring-black/5"
              style={{
                background: `linear-gradient(135deg, ${accent.from}, ${accent.to})`,
                color: "#fff",
              }}
            >
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold leading-tight text-foreground">
                {ext.manifest.name}
              </div>
              {/* Publisher + version + installed */}
              <div className="mt-1 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                {ext.manifest.publisher && (
                  <span className="inline-flex shrink-0 items-center gap-1 font-medium text-foreground/80">
                    <span
                      aria-hidden
                      className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] font-bold uppercase text-white"
                      style={{
                        background: `linear-gradient(135deg, ${accent.from}, ${accent.to})`,
                      }}
                    >
                      {ext.manifest.publisher.charAt(0).toUpperCase()}
                    </span>
                    {ext.manifest.publisher}
                  </span>
                )}
                <span className="text-muted-foreground/40">·</span>
                <span className="shrink-0 font-mono text-[10px]">
                  v{ext.manifest.version}
                </span>
                <span className="ml-auto shrink-0 pl-1.5 text-muted-foreground/70">
                  {formatRelative(ext.installedAt)}
                </span>
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 -mr-1 -mt-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                  aria-label="Extension actions"
                >
                  <MoreVertical className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onToggle(!ext.enabled)}>
                  {ext.enabled ? (
                    <>
                      <PowerOff className="mr-2 h-3.5 w-3.5" aria-hidden />
                      Disable
                    </>
                  ) : (
                    <>
                      <Power className="mr-2 h-3.5 w-3.5" aria-hidden />
                      Enable
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onUninstall}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" aria-hidden />
                  Uninstall
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Footer: toggle + contributes + (secondary menu link) */}
          <div
            className={cn(
              "mt-3 flex items-center gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5",
              "transition-colors group-hover:bg-muted/60",
            )}
          >
            <ToggleSwitch
              checked={ext.enabled}
              onChange={(v) => onToggle(v)}
              label={`${ext.enabled ? "Disable" : "Enable"} ${ext.manifest.name}`}
            />
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {ext.enabled ? "Enabled" : "Disabled"}
            </span>
            {(panels.length > 0 || commands.length > 0) && (
              <>
                <span className="ml-1 h-3 w-px bg-border" aria-hidden />
                <span className="flex flex-wrap items-center gap-1 truncate text-[10px] text-muted-foreground">
                  {panels.length > 0 && (
                    <span className="inline-flex items-center gap-0.5">
                      <LayoutPanelLeft className="h-2.5 w-2.5" aria-hidden />
                      {panels.length}
                    </span>
                  )}
                  {panels.length > 0 && commands.length > 0 && (
                    <span className="text-muted-foreground/40">·</span>
                  )}
                  {commands.length > 0 && (
                    <span className="inline-flex items-center gap-0.5">
                      <TerminalSquare className="h-2.5 w-2.5" aria-hidden />
                      {commands.length}
                    </span>
                  )}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

// ─── Toggle switch ────────────────────────────────────────────────────
//
// Built locally because the project doesn't ship `src/components/ui/switch`.
// Uses a Radix-style checkbox under the hood (`useExtensions` already wires
// on/off semantics) wrapped in a custom track/thumb. ARIA is preserved via
// the inner Checkbox's role=checkbox.
function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label
      className="relative inline-flex h-5 w-9 cursor-pointer items-center rounded-full transition-colors"
      style={{
        backgroundColor: checked
          ? "hsl(var(--primary))"
          : "hsl(var(--muted-foreground) / 0.35)",
      }}
      aria-label={label}
    >
      <span
        aria-hidden
        className="inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform"
        style={{
          transform: `translateX(${checked ? 16 : 2}px)`,
        }}
      />
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
      />
    </label>
  );
}

// Deterministic avatar palette. Maps a string id to one of seven warm-friendly
// gradient pairs so each extension gets a stable, recognizable tile.
const AVATAR_PALETTE: ReadonlyArray<{ from: string; to: string }> = [
  { from: "#6366f1", to: "#8b5cf6" }, // indigo → violet
  { from: "#0ea5e9", to: "#2563eb" }, // sky → blue
  { from: "#14b8a6", to: "#0d9488" }, // teal
  { from: "#f59e0b", to: "#ef4444" }, // amber → red
  { from: "#ec4899", to: "#f43f5e" }, // pink → rose
  { from: "#10b981", to: "#059669" }, // emerald
  { from: "#f97316", to: "#db2777" }, // orange → pink
];
function avatarColor(id: string): { from: string; to: string } {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

// ─── Empty state ──────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 py-10 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/15 to-violet-500/15 ring-1 ring-inset ring-primary/20">
        <Puzzle className="h-7 w-7 text-primary" aria-hidden />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-semibold">No extensions installed</p>
        <p className="text-xs text-muted-foreground">
          Click <span className="font-medium text-foreground">Install .zip</span>
          {" "}
          above to add one. Extensions run sandboxed in an iframe and
          contribute sidebar panels.
        </p>
      </div>
    </div>
  );
}

// ─── Install preview dialog ───────────────────────────────────────────

function InstallPreviewDialog({
  pending,
  busy,
  onCancel,
  onConfirm,
}: {
  pending: PendingInstall | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Install extension</DialogTitle>
          <DialogDescription>
            Confirm what this extension will add to your workspace.
          </DialogDescription>
        </DialogHeader>
        {pending && (
          <div className="space-y-2 text-sm">
            <Row label="Name" value={pending.previewName} />
            <Row label="Version" value={pending.previewVersion} />
            <Row label="Panels" value={String(pending.previewPanels)} />
            <Row label="Commands" value={String(pending.previewCommands)} />
            <Row label="Source" value={pending.file.name} />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={busy}>
            {busy ? "Installing…" : "Install"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}