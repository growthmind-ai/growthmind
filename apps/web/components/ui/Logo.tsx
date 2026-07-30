import { markGeometry, markPaths } from "../../lib/brand/mark";

// The shape belongs to lib/brand/mark.ts; this component only colours it.
const { forward, trailing, strokeWidth } = markPaths();

/**
 * The double-chevron mark: forward chevron in ink, trailing chevron in the
 * band colour.
 *
 * Decorative by default — beside the wordmark it says nothing a screen reader
 * doesn't already get from the text, so it is `aria-hidden`. Pass `label`
 * where the mark stands alone and *is* the meaning; that promotes the SVG
 * itself to `role="img"`, which is what the accessibility tree expects for
 * inline SVG.
 */
export function LogoMark({
  size = 30,
  stroke = "currentColor",
  accent = "var(--band)",
  label,
}: {
  size?: number;
  stroke?: string;
  accent?: string;
  label?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${markGeometry.size} ${markGeometry.size}`}
      fill="none"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <path d={forward} stroke={stroke} strokeWidth={strokeWidth} />
      <path d={trailing} stroke={accent} strokeWidth={strokeWidth} />
    </svg>
  );
}

/** GROWTHMIND set as type, monochrome to match the full logo. */
export function LogoWordmark({ size = 18 }: { size?: number }) {
  return (
    <span style={{ fontWeight: 800, letterSpacing: "0.04em", fontSize: size }}>GROWTHMIND</span>
  );
}
