import { DEFAULT_THEME, mergeMantineTheme } from "@mantine/core";
import { describe, expect, it } from "bun:test";

import { contrastRatio, readableInk, WCAG_AA_NORMAL } from "@/lib/brand/contrast";
import { palette } from "@/lib/brand/palette";
import { theme as themeOverride } from "@/lib/theme";

const theme = mergeMantineTheme(DEFAULT_THEME, themeOverride);

const BRAND_COLORS = ["band", "stamp", "dark"] as const;

function paintedShade(color: string): string {
  const shade =
    typeof theme.primaryShade === "number" ? theme.primaryShade : theme.primaryShade.dark;
  return theme.colors[color][shade];
}

function filledTextColor(color?: string): string {
  return theme.variantColorResolver({
    color: color ?? theme.primaryColor,
    theme,
    variant: "filled",
  }).color;
}

describe("contrastRatio", () => {
  it("is 21 for black on white", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  it("is 1 for a colour against itself", () => {
    expect(contrastRatio(palette.band, palette.band)).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    expect(contrastRatio(palette.ink, palette.paper)).toBeCloseTo(
      contrastRatio(palette.paper, palette.ink),
      5,
    );
  });
});

describe("readableInk", () => {
  it("picks the dark ink on the band green", () => {
    expect(readableInk(palette.band)).toBe(palette.onband);
  });

  it("picks the light ink on the paper background", () => {
    expect(readableInk(palette.paper)).toBe(palette.ink);
  });

  it("returns null rather than guessing on an unparseable value", () => {
    expect(readableInk("var(--mantine-color-band-filled)")).toBeNull();
    expect(readableInk("")).toBeNull();
  });
});

describe("filled controls in the app theme", () => {
  it("never puts white text on the primary button", () => {
    expect(filledTextColor()).not.toBe("var(--mantine-color-white)");
    expect(filledTextColor()).toBe(palette.onband);
  });

  it.each([...BRAND_COLORS])("reaches WCAG AA on %s", (color) => {
    const ratio = contrastRatio(filledTextColor(color), paintedShade(color));
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL);
  });

  it("leaves non-filled variants to Mantine", () => {
    const subtle = theme.variantColorResolver({ color: "gray", theme, variant: "subtle" });
    expect(subtle.background).toBe("transparent");
  });
});
