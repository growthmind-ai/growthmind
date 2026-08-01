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
import { Box, Group, Stack, Text } from "@mantine/core";

import type { ComingNextStep } from "@growthmind/shared";

/**
 * The ordinal column, at the same fixed 20px the landing page's glyph column
 * already uses — so the sequence's numbers line up whether the row beside them
 * is a card or a note in the margin.
 */
const ORDINAL_COLUMN = { width: 20, flexShrink: 0 };

/**
 * A hairline in the margin rather than a box around the row.
 *
 * It says "this belongs to the sequence" without saying "there is something
 * here to do". Dashed, dimmed, and drawn from the semantic border token so it
 * resolves per colour scheme — never a literal.
 */
const MARGIN_RULE = { borderLeft: "1px dashed var(--mantine-color-default-border)" };

interface StubStepProps {
  readonly step: ComingNextStep;
}

export function StubStep({ step }: StubStepProps) {
  return (
    <Box py="xs" pl="md" style={MARGIN_RULE}>
      <Group align="flex-start" gap="sm" wrap="nowrap">
        <Text c="dimmed" fw={700} aria-hidden style={ORDINAL_COLUMN}>
          {step.ordinal}
        </Text>
        <Stack gap={4}>
          <Text c="dimmed">{step.title}</Text>
          <Text c="dimmed" size="sm">
            {step.whatItWillDo}
          </Text>
          <Text c="dimmed" size="sm">
            {step.filler}
          </Text>
        </Stack>
      </Group>
    </Box>
  );
}
