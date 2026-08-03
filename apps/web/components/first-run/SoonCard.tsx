import { Stack, Text } from "@mantine/core";

import type { ComingNextStep, InterestProviderId } from "@growthmind/shared";

import { ProviderChips } from "./ProviderChips";

// Quieter than the live cards on purpose: dimmed text, no ordinal, and the one
// interactive element is the ping chip the row renders (AD-7.1, AD-8).
interface SoonCardProps {
  readonly step: ComingNextStep;
  readonly providerInterest: readonly InterestProviderId[];
  readonly interestPingAvailable: boolean;
}

export function SoonCard({ step, providerInterest, interestPingAvailable }: SoonCardProps) {
  return (
    <Stack gap="xs">
      <Text c="dimmed" size="sm" fw={600}>
        {step.title}
      </Text>
      <Text c="dimmed" size="sm">
        {step.whatItWillDo}
      </Text>
      <ProviderChips
        rail={step.rail}
        providerInterest={providerInterest}
        interestPingAvailable={interestPingAvailable}
      />
    </Stack>
  );
}
