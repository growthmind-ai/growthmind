export type Point = readonly [x: number, y: number];

export const markGeometry = {
  size: 96,
  strokeWidth: 10.4,

  forward: [
    [43.5, 9],
    [82.5, 48],
    [43.5, 87],
  ],

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

export function pathData(points: readonly Point[]): string {
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ");
}

export type MarkPaths = {
  forward: string;
  trailing: string;
  strokeWidth: number;
};

export function markPaths(): MarkPaths {
  return {
    forward: pathData(markGeometry.forward),
    trailing: pathData(markGeometry.trailing),
    strokeWidth: markGeometry.strokeWidth,
  };
}
