"use client";

import { Badge } from "@mantine/core";

import type { FactChipTone, FactChipView } from "@/lib/audience/read";

// One tone table for every audience object. Two hand-rolled copies keyed on the label's
// opening word had already disagreed: the same "assumed" chip drew outline in a row and
// grey-light in a card. "band" is the theme's primary palette (lib/theme.ts), the accent
// the storyboard gives a correction.
const TONES = {
  confirmed: { variant: "light", color: "green" },
  corrected: { variant: "light", color: "band" },
  observed: { variant: "light", color: "gray" },
  stated: { variant: "light", color: "gray" },
  research: { variant: "light", color: "gray" },
  assumed: { variant: "outline", color: "gray" },
} as const satisfies Record<FactChipTone, { readonly variant: string; readonly color: string }>;

export function FactChips({ chips }: { readonly chips: readonly FactChipView[] }) {
  return (
    <>
      {chips.map((chip) => (
        <Badge key={chip.label} radius="sm" size="sm" {...TONES[chip.tone]}>
          {chip.label}
        </Badge>
      ))}
    </>
  );
}
