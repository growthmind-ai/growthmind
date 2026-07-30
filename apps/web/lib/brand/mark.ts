/**
 * The Growthmind mark — two open-stroke chevrons: a forward one in ink and a
 * smaller trailing one in the band green, nested inside it.
 *
 * The geometry mirrors the marketing site's `lib/brand/mark.ts`, which is the
 * canonical source (its `bun run brand` generates the logo files). If the mark
 * ever changes there, update these coordinates to match.
 */

export type Point = readonly [x: number, y: number];

export const markGeometry = {
  /** The mark is drawn in a square of this side, and is centred in it. */
  size: 96,
  strokeWidth: 10.4,
  /** The outer chevron, pointing forward. Carries the ink colour. */
  forward: [
    [43.5, 9],
    [82.5, 48],
    [43.5, 87],
  ],
  /** The inner chevron, pointing back. Carries the band colour. */
  trailing: [
    [33, 29.8],
    [13.5, 48],
    [33, 66.2],
  ],
} as const satisfies {
  size: number;
  strokeWidth: number;
  forward: readonly Point[];
  trailing: readonly Point[];
};

/** Turns a run of points into an SVG polyline `d`. */
export function pathData(points: readonly Point[]): string {
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ");
}

export type MarkPaths = {
  forward: string;
  trailing: string;
  strokeWidth: number;
};

/** The two `d` strings and the stroke width that goes with them. */
export function markPaths(): MarkPaths {
  return {
    forward: pathData(markGeometry.forward),
    trailing: pathData(markGeometry.trailing),
    strokeWidth: markGeometry.strokeWidth,
  };
}
