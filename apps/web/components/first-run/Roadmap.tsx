import { Box, Stack, Text } from "@mantine/core";

import { ROADMAP_LEAD, type ComingNextStep, type InterestProviderId } from "@growthmind/shared";

import { SoonCard } from "./SoonCard";

const MARGIN_RULE = { borderLeft: "1px dashed var(--mantine-color-default-border)" };

interface RoadmapProps {
  readonly steps: readonly ComingNextStep[];
  readonly providerInterest: readonly InterestProviderId[];
  readonly interestPingAvailable: boolean;
}

export function Roadmap({ steps, providerInterest, interestPingAvailable }: RoadmapProps) {
  if (steps.length === 0) {
    return null;
  }

  return (
    <Box component="section" aria-label={ROADMAP_LEAD} py="xs" pl="md" style={MARGIN_RULE}>
      <Stack gap="sm">
        <Text size="xs" fw={700} tt="uppercase" c="dimmed">
          {ROADMAP_LEAD}
        </Text>

        {/* ONE RENDERER, STILL. `SoonCard` draws both soon cards and the
            soon-card contract scans that one file; this component is the
            section around it, never a second way to draw a card. */}
        {steps.map((step) => (
          <SoonCard
            key={step.id}
            step={step}
            providerInterest={providerInterest}
            interestPingAvailable={interestPingAvailable}
          />
        ))}
      </Stack>
    </Box>
  );
}
