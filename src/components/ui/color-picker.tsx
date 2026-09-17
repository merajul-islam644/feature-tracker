// Small color picker for user-defined environments. Renders an inline strip
// of preset swatches plus a native `<input type="color">` escape hatch —
// avoids pulling in a heavier library (e.g. react-colorful) for what's
// essentially "pick one of N swatches, or fine-tune".
//
// `value` is the current hex; `onChange` updates it. The component is
// uncontrolled-friendly: it does not own the picked value, so callers can
// initialise and reset freely from their own state.

import { cn } from "@/lib/utils";

// Curated palette: muted enough to read as a chip with a /10 tint applied
// over the top. Tailwind's defaults are too saturated for chip backgrounds
// once you multiply alpha by 0.1, so the list is hand-picked.
const PRESET_COLORS = [
  "#0ea5e9", // sky
  "#14b8a6", // teal
  "#22c55e", // green
  "#eab308", // yellow
  "#f97316", // orange
  "#ef4444", // red
  "#a855f7", // purple
  "#ec4899", // pink
  "#64748b", // slate
] as const;

interface ColorPickerProps {
  value: string;
  onChange: (next: string) => void;
  /** Optional override for the swatch palette. Defaults to PRESET_COLORS. */
  presets?: readonly string[];
  /** Accessible label for the swatch group and the native input. */
  ariaLabel?: string;
}

export function ColorPicker({
  value,
  onChange,
  presets = PRESET_COLORS,
  ariaLabel = "Color",
}: ColorPickerProps) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex flex-wrap items-center gap-2"
    >
      {presets.map((hex) => {
        const selected = hex.toLowerCase() === value.toLowerCase();
        return (
          <button
            key={hex}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${hex}`}
            onClick={() => onChange(hex)}
            className={cn(
              "h-7 w-7 rounded-full border transition-transform",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              selected
                ? "border-foreground scale-110"
                : "border-border/60 hover:scale-105",
            )}
            style={{ backgroundColor: hex }}
          />
        );
      })}
      <label className="ml-1 inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 cursor-pointer">
        <span>Custom</span>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`Custom ${ariaLabel.toLowerCase()}`}
          className="h-5 w-7 cursor-pointer border-0 bg-transparent p-0"
        />
      </label>
    </div>
  );
}

// Render-tint helper for chips and badges whose color is a custom user
// hex (not one of the four canonical envs with a hand-tuned Tailwind
// class). Applies a /10-tint background + full-strength text so the chip
// matches the visual weight of the canonical envs.
export function envChipStyle(color: string): React.CSSProperties {
  return {
    backgroundColor: `${color}1a`, // ~10% alpha tint
    color,
    borderColor: "transparent",
  };
}
