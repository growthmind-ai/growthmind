import { Box, Stack, Text } from "@mantine/core";

import { ROADMAP_LEAD, type ComingNextStep } from "@growthmind/shared";

import { StubStep } from "./StubStep";

const MARGIN_RULE = { borderLeft: "1px dashed var(--mantine-color-default-border)" };

interface RoadmapProps {
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
