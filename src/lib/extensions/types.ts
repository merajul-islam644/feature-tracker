// Extension manifest + state types — see plan §1 "Manifest format".
//
// An extension ships as a zip whose root contains a `manifest.json`. The
// host validates the manifest before install and uses the `contributes`
// section to wire UI surfaces (sidebar panels, commands) into the
// workspace activity bar.

export interface PanelContribution {
  /** Unique within the extension manifest. Used in activity-bar ids. */
  id: string;
  /** Human-readable label shown on the panel tab and tooltip. */
  title: string;
  /** Lucide icon name. Resolved host-side so extensions don't bundle
   *  a font; fallback `Box` if the icon name is unknown. */
  icon?: string;
  /** Reserved for future context-key gating (no-op in v1). */
  when?: string;
}

export interface CommandContribution {
  /** Globally-unique. Convention: `<extensionId>.<commandId>`. */
  id: string;
  title: string;
  /** Reserved for future keybinding wiring (no-op in v1). */
  keybinding?: string;
}

export interface ExtensionManifest {
  /** kebab-case, unique. */
  id: string;
  name: string;
  /** semver x.y.z. */
  version: string;
  publisher?: string;
  /** Path inside the zip to the entry HTML, e.g. "index.html". */
  main: string;
  contributes: {
    panels?: PanelContribution[];
    commands?: CommandContribution[];
  };
}

/** A single installed extension as stored in localStorage. */
export interface InstalledExtension {
  id: string;
  manifest: ExtensionManifest;
  enabled: boolean;
  installedAt: string; // ISO timestamp
  /** The original zip as base64. Capped at MAX_ZIP_SIZE_BYTES. */
  zipBase64: string;
}

/** localStorage map shape: `Record<extId, InstalledExtension>`. */
export type InstalledMap = Record<string, InstalledExtension>;

// ─── Constants ────────────────────────────────────────────────────────

export const MAX_ZIP_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
export const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;