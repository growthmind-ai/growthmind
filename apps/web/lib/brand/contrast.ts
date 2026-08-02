import { luminance } from "@mantine/core";

import { palette } from "./palette";

export const WCAG_AA_NORMAL = 4.5;

const PARSEABLE = /^(#|rgba?\(|hsla?\()/i;

export function contrastRatio(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** The brand ink with the most contrast on `background`, or null if it is not a parseable colour. */
export function readableInk(background: string): string | null {
  // Mantine's toRgba() answers black for anything it cannot parse, so gate before measuring.
  if (!PARSEABLE.test(background)) {
    return null;
  }

  return contrastRatio(palette.onband, background) >= contrastRatio(palette.ink, background)
    ? palette.onband
    : palette.ink;
}
