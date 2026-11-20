// Minimal type declarations for `react-file-icon` (1.6.0). The
// upstream package ships JS only; we only consume one component so
// declaring the surface we use keeps `tsc --noEmit` happy without
// pulling in a third-party @types/* package.

declare module "react-file-icon" {
  import type { ComponentType, SVGProps } from "react";

  export interface FileIconProps extends SVGProps<SVGSVGElement> {
    /** Extension (e.g. "ts", "tsx", "json") — drives glyph + label colour. */
    extension?: string;
    /** Background colour of the icon square. */
    color?: string;
    /** Colour of the top-right corner fold. */
    foldColor?: string;
    /** Colour of the foreground glyph inside the icon. */
    glyphColor?: string;
    /** Whether to draw the corner fold (default true). */
    fold?: boolean;
    /** Gradient end colour. */
    gradientColor?: string;
    /** 0-1, intensity of the background gradient. */
    gradientOpacity?: number;
    /** Colour of the bottom label band. */
    labelColor?: string;
    /** Colour of the text inside the label band. */
    labelTextColor?: string;
    /** Force label text to uppercase. */
    labelUppercase?: boolean;
    /** Corner radius (default 2). */
    radius?: number;
    /** Override the glyph (e.g. "code", "document", "image"). */
    type?: string;
  }

  export const FileIcon: ComponentType<FileIconProps>;
  export const defaultStyles: Record<string, unknown>;
}