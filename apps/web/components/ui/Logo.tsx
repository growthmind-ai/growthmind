import { markGeometry, markPaths } from "../../lib/brand/mark";

const { forward, trailing, strokeWidth } = markPaths();

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

export function LogoWordmark({ size = 18 }: { size?: number }) {
  return (
    <span style={{ fontWeight: 800, letterSpacing: "0.04em", fontSize: size }}>GROWTHMIND</span>
  );
}
