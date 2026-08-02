import { createTheme, type MantineColorsTuple } from "@mantine/core";

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

export const theme = createTheme({
  colors: { band, stamp, dark },
  primaryColor: "band",
  primaryShade: { light: 6, dark: 4 },

  autoContrast: true,

  fontFamily: 'var(--font-geo), "Century Gothic", "Futura", sans-serif',
  fontFamilyMonospace: "var(--font-mono), ui-monospace, Menlo, monospace",
  headings: {
    fontFamily: 'var(--font-geo), "Century Gothic", "Futura", sans-serif',
    fontWeight: "700",
  },

  defaultRadius: "sm",
});
