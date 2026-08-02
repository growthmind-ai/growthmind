import {
  createTheme,
  defaultVariantColorsResolver,
  parseThemeColor,
  type MantineColorsTuple,
  type VariantColorsResolver,
} from "@mantine/core";

import { readableInk } from "./brand/contrast";

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

/** The only scheme the app renders in — see viewport.colorScheme in app/layout.tsx. */
const COLOR_SCHEME = "dark";

// Mantine resolves a filled control's text colour against the LIGHT primary shade (it
// passes no colorScheme to parseThemeColor) while the background paints from the dark
// one, so autoContrast alone reads the wrong swatch. Measure the shade that paints.
const variantColorResolver: VariantColorsResolver = (input) => {
  const resolved = defaultVariantColorsResolver(input);
  if ((input.variant || "filled") !== "filled") {
    return resolved;
  }

  const painted = parseThemeColor({
    color: input.color || input.theme.primaryColor,
    theme: input.theme,
    colorScheme: COLOR_SCHEME,
  }).value;

  return { ...resolved, color: readableInk(painted) ?? resolved.color };
};

export const theme = createTheme({
  colors: { band, stamp, dark },
  primaryColor: "band",
  primaryShade: { light: 6, dark: 4 },

  autoContrast: true,
  variantColorResolver,

  fontFamily: 'var(--font-geo), "Century Gothic", "Futura", sans-serif',
  fontFamilyMonospace: "var(--font-mono), ui-monospace, Menlo, monospace",
  headings: {
    fontFamily: 'var(--font-geo), "Century Gothic", "Futura", sans-serif',
    fontWeight: "700",
  },

  defaultRadius: "sm",
});
