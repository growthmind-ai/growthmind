// WHAT IS STILL BEING BUILT — the two stubs, after they left the sequence.
//
// ###########################################################################
// # AD-19's TWO INVARIANTS SURVIVE THIS MOVE INTACT. ONLY THE POSITION MOVED.
// #
// # The `coming-next` arm still carries no `fields`, no `actions` and no
// # `confirmations`, so there is still no property a control could be built
// # from and a later edit that wants one still has to widen the union first.
// # Both sentences still say what is coming AND what brings it, which is the
// # difference between reading as honest and reading as abandoned.
// #
// # WHAT CHANGED IS WHERE THEY SIT, AND IT WAS COSTING THE WHOLE SCREEN.
// # "Connect your code — not built yet" was the FIRST thing on the page. A
// # founder opening the product for the first time met a dead row before they
// # met anything that worked, and the eye lands on row one. A roadmap belongs
// # under the thing it is a roadmap for.
// #
// # THIS IS NOT A RENUMBERING. `STEP_DESCRIPTORS` is untouched, still frozen,
// # still five, still ordinals 1-5 with no gaps, and the ids still outlive the
// # stubs — the property AD-19 was actually protecting. The page chooses what
// # to render where; the data did not change shape to allow it.
// ###########################################################################
import { Box, Stack, Text } from "@mantine/core";

import { ROADMAP_LEAD, type ComingNextStep } from "@growthmind/shared";

import { StubStep } from "./StubStep";

/** A hairline in the margin. It says "this belongs here" without saying "there
 * is something here to do" — the same grammar `StubStep` used. */
const MARGIN_RULE = { borderLeft: "1px dashed var(--mantine-color-default-border)" };

interface RoadmapProps {
  /** The `coming-next` descriptors, in their own ordinal order. */
  readonly steps: readonly ComingNextStep[];
}

export function Roadmap({ steps }: RoadmapProps) {
  if (steps.length === 0) {
    return null;
  }

  return (
    <Box component="section" aria-label={ROADMAP_LEAD} py="xs" pl="md" style={MARGIN_RULE}>
      <Stack gap="sm">
        <Text size="xs" fw={700} tt="uppercase" c="dimmed">
          {ROADMAP_LEAD}
        </Text>

        {/* ONE RENDERER, STILL. `StubStep` draws both stubs and the shared stub
            contract still scans that one file; this component is the section
            around it, never a second way to draw a stub. */}
        {steps.map((step) => (
          <StubStep key={step.id} step={step} />
        ))}
      </Stack>
    </Box>
  );
}
