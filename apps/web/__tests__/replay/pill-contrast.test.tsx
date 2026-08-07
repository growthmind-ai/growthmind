import { describe, expect, test } from "bun:test";
import { DEFAULT_THEME, MantineProvider, mergeMantineTheme } from "@mantine/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { contrastRatio, WCAG_AA_NORMAL } from "@/lib/brand/contrast";
import { palette } from "@/lib/brand/palette";
import { theme as themeOverride } from "@/lib/theme";

import { FilterBar } from "../../components/replay/filters/FilterBar";
import type { FilterDescriptor } from "../../components/replay/filters/types";

const theme = mergeMantineTheme(DEFAULT_THEME, themeOverride);

const APPLIED_COMPANY: FilterDescriptor = {
  param: "company",
  restLabel: "All companies",
  kind: "list",
  panelSize: [320, 326],
  searchPlaceholder: "acme.com",
  footNote: "Personal addresses (gmail, yahoo) aren't companies, so they're not listed.",
  options: [
    { value: "acme.com", label: "acme.com", description: null, sessionCount: 5, replayCount: 3 },
    {
      value: "orbitlabs.co.uk",
      label: "orbitlabs.co.uk",
      description: null,
      sessionCount: 2,
      replayCount: 1,
    },
  ],
  value: "acme.com",
  summarise: (value: string) => `Company: ${value}`,
  clearLabel: "Clear the company filter",
};

function shadeOf(color: string): string {
  const shade =
    typeof theme.primaryShade === "number" ? theme.primaryShade : theme.primaryShade.dark;
  return theme.colors[color]?.[shade] ?? "";
}

// The rendered value is a custom property, and a custom property is what the browser resolves.
// Resolving it here against the same theme the provider was given is that resolution, not a
// substitute for it: `#161c16` arrives as a literal, `var(--mantine-color-band-filled)` as a
// reference into the palette the theme painted.
function resolve(value: string): string {
  const reference = /^var\(--mantine-(?:color-([a-z0-9]+)|(primary-color))-filled\)$/i.exec(
    value.trim(),
  );

  if (reference === null) return value.trim();
  return shadeOf(reference[1] ?? theme.primaryColor);
}

function declaration(styleAttribute: string, property: string): string {
  for (const part of styleAttribute.split(";")) {
    const [name, ...rest] = part.split(":");
    if ((name ?? "").trim() === property) return rest.join(":").trim();
  }
  return "";
}

function accentedPillStyle(): string {
  const markup = renderToStaticMarkup(
    createElement(
      MantineProvider,
      { theme: themeOverride },
      createElement(FilterBar, { descriptors: [APPLIED_COMPANY] }),
    ),
  );

  const pill = /<button[^>]*aria-label="Company: acme\.com[^"]*"[^>]*>/.exec(markup)?.[0] ?? "";
  return /style="([^"]*)"/.exec(pill)?.[1] ?? "";
}

describe("the accented pill", () => {
  test("renders dark brand ink on the brand band at 4.5:1 or better", () => {
    const style = accentedPillStyle();

    const foreground = resolve(declaration(style, "--button-color"));
    const background = resolve(declaration(style, "--button-bg"));

    expect(foreground).not.toBe("");
    expect(background).not.toBe("");
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL);
  });

  test("takes the dark brand ink rather than white on the band", () => {
    const foreground = resolve(declaration(accentedPillStyle(), "--button-color"));

    expect(foreground.toLowerCase()).toBe(palette.onband);
    expect(foreground.toLowerCase()).not.toBe("#ffffff");
  });
});
