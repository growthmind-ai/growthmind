// THE STUB RENDERER — steps 1 and 4, and nothing else (O-008, FR-O3, FR-O15,
// AD-19, PRD rulings R3 and R5).
//
// ###########################################################################
// # THE ABSENCE OF A SURFACE IS THE SIGNAL.
// #
// # A stub is NOT a greyed-out card. It is a row with no card at all: the
// # ordinal, two dimmed sentences, and a hairline in the margin. There is no
// # bordered panel, no field, no control, no hover cue, no cursor change and
// # no tab stop. Every one of those reads to a first-time founder as "this
// # product is broken", which is a worse answer than an honest empty row
// # (`docs/mvp.md:48`) — and a control that looks live is worse still,
// # because they press it and it fails at the exact moment they were deciding
// # whether to trust us.
// #
// # ONE RENDERER, TWO SUBJECTS. AD-19 gives the `coming-next` arm no `fields`,
// # no `actions` and no `confirmations`, so there is no property on it a
// # control could be built from. Filling a stub later changes one descriptor's
// # kind and body: it renumbers nothing, widens no union and re-lays out
// # nothing. Both stubs come through here, so a scan of this file is a scan of
// # both of them.
// #
// # EVERY WORD ON SCREEN COMES OFF THE DESCRIPTOR. This file authors no
// # sentence of its own, so the plain-English audit over the copy home sees
// # all of it rather than most of it.
// ###########################################################################
//
// ── THE ORDINAL LEFT THIS ROW, AND NOTHING ELSE ABOUT IT DID ────────────────
//
// Both stubs moved out of the numbered sequence and under it, into `Roadmap`,
// because "Connect your code — not built yet" was the FIRST thing a founder
// ever saw and the eye lands on row one. A number here would re-create the
// sequence that move dissolved, and put the reader back to counting how much
// of the product does not exist yet — while also disagreeing with the live
// steps, which are now numbered 1-2-3 among themselves.
//
// This is still the ONE renderer both stubs come through, so a scan of this
// file is still a scan of both, and the whole shared stub contract
// (`apps/web/__tests__/first-run/stub-steps.test.ts`) still reads it here.
// `Roadmap` is the section around it, not a second way to draw a stub.
import { Stack, Text } from "@mantine/core";

import type { ComingNextStep } from "@growthmind/shared";

interface StubStepProps {
  readonly step: ComingNextStep;
}

export function StubStep({ step }: StubStepProps) {
  return (
    <Stack gap={2}>
      <Text c="dimmed" size="sm">
        {step.title}
      </Text>
      <Text c="dimmed" size="sm">
        {step.whatItWillDo}
      </Text>
      <Text c="dimmed" size="sm">
        {step.filler}
      </Text>
    </Stack>
  );
}
