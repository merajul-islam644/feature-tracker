// Animated dotted border that runs around the edge of its parent.
//
// Renders a rounded-rect SVG outline whose stroke is dashed and whose
// stroke-dashoffset is animated continuously, so the dashes appear to
// travel around the perimeter (left → top → right → bottom → left).
// The component is sized by its parent — pass `className="absolute
// inset-0 h-full w-full"` to overlay it on a pill-shaped container, and
// the contents of that container sit on top via relative positioning.
//
// Why SVG over a CSS conic gradient: at the small size of the project
// card footer pill, the SVG path stays crisp at every zoom level and
// the dash pattern renders as true dots rather than a banded gradient.
// The animation is a single transform-equivalent (strokeDashoffset
// shift of one period) running at 1.2s linear infinite so the motion
// feels steady, not jittery.

import type { SVGProps } from "react";

interface RotatingDottedBorderProps extends SVGProps<SVGSVGElement> {
  /** Stroke color. Defaults to currentColor so it inherits text color. */
  strokeColor?: string;
}

export function RotatingDottedBorder({
  strokeColor = "currentColor",
  ...rest
}: RotatingDottedBorderProps) {
  return (
    <svg
      {...rest}
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      fill="none"
      stroke={strokeColor}
      strokeWidth="2"
      strokeLinecap="round"
      strokeDasharray="2 4"
      // `animate-rotate-stroke` is the keyframe defined in tailwind.config.js
      // (rotate-stroke, 1.2s linear infinite). It shifts strokeDashoffset
      // by exactly one period so the loop is seamless.
      className={`animate-rotate-stroke ${rest.className ?? ""}`}
    >
      <rect x="1" y="1" width="98" height="22" rx="3" ry="3" />
    </svg>
  );
}
