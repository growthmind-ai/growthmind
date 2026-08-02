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
