import { createTheme, type MantineColorsTuple } from "@mantine/core";

/**
 * The Mantine theme that carries the brand (see lib/brand/palette.ts). The app
 * runs dark-only, like the marketing site: the `dark` tuple below maps
 * Mantine's semantic slots onto the memo palette, so `<Paper>`, `c="dimmed"`,
 * default borders, and hovers all land on brand values without any per-page
 * CSS.
 *
 * Slot map for the `dark` tuple in dark mode:
 *   0 → text (ink)   2 → dimmed (soft)   4 → default borders
 *   6 → surfaces (sheet)   7 → body (paper)
 */

/** The band green, shade 4 = the brand value #a9c4a2. */
const band: MantineColorsTuple = [
  "#f2f6f0",
  "#e4ebe1",
  "#cddcc7",
  "#bbd0b4",
  "#a9c4a2",
  "#94b18c",
  "#5c7d55",
  "#4b6745",
  "#3b5136",
  "#2c3d29",
];

/** The rust stamp accent, shade 5 = the brand value #c05a3a. */
const stamp: MantineColorsTuple = [
  "#fbf0ec",
  "#f5ded5",
  "#ecc0af",
  "#e0a189",
  "#d07c5c",
  "#c05a3a",
  "#a84e32",
  "#8b4029",
  "#6f3321",
  "#552718",
];

/** The memo greys — greens, really — that Mantine's dark slots resolve to. */
const dark: MantineColorsTuple = [
  "#e9ede4",
  "#cfd6c9",
  "#adb8a8",
  "#78826f",
  "#454e42",
  "#2b322b",
  "#212721",
  "#191e19",
  "#141814",
  "#0f120f",
];

export const theme = createTheme({
  colors: { band, stamp, dark },
  primaryColor: "band",
  primaryShade: { light: 6, dark: 4 },
  // Band-filled buttons get dark-on-band text, matching the site's --onband.
  autoContrast: true,

  fontFamily: 'var(--font-geo), "Century Gothic", "Futura", sans-serif',
  fontFamilyMonospace: "var(--font-mono), ui-monospace, Menlo, monospace",
  headings: {
    fontFamily: 'var(--font-geo), "Century Gothic", "Futura", sans-serif',
    fontWeight: "700",
  },

  defaultRadius: "sm",
});
