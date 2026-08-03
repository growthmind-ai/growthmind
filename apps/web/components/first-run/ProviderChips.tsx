"use client";

// One chip renderer for both card kinds (AD-8): the row derives from the
// catalogue by rail — never a hand-passed provider list (D11) — and the live
// chip's treatment is visual only, because no registered string may say "live".
import { Badge, Button, Group, Stack, Text } from "@mantine/core";
import { useState, type ReactNode } from "react";

import {
  interestProviderIdSchema,
  ONBOARDING_MESSAGES,
  PROVIDER_CATALOGUE,
  type InterestProviderId,
  type ProviderDescriptor,
  type ProviderRail,
} from "@growthmind/shared";

import { tapTargetStyle } from "@/components/ui/tap-target";

import { postInterest } from "./api";
import { resolveChipView, type ChipTap } from "./chip-state";

interface ProviderChipsProps {
  readonly rail: ProviderRail;
  readonly providerInterest: readonly InterestProviderId[];
  readonly interestPingAvailable: boolean;
}

export function ProviderChips(props: ProviderChipsProps) {
  const { rail, providerInterest, interestPingAvailable } = props;

  const [taps, setTaps] = useState<Readonly<Record<string, ChipTap>>>({});
  const [failure, setFailure] = useState<string | null>(null);

  const chips = PROVIDER_CATALOGUE.filter((provider) => provider.rail === rail);

  async function ping(provider: InterestProviderId): Promise<void> {
    setFailure(null);
    setTaps((current) => ({ ...current, [provider]: "in-flight" }));

    const outcome = await postInterest(provider);

    if (outcome.ok) {
      setTaps((current) => ({ ...current, [provider]: "done" }));
      return;
    }

    setTaps((current) => ({ ...current, [provider]: "failed" }));
    setFailure(outcome.message);
  }

  function chip(provider: ProviderDescriptor): ReactNode {
    const interestId = interestIdOf(provider);
    const view = resolveChipView({
      live: provider.live,
      interestPingAvailable,
      notedOnLoad: interestId !== null && providerInterest.includes(interestId),
      tap: taps[provider.id] ?? "none",
    });

    if (view === "live") {
      return (
        <Badge key={provider.id} variant="filled" tt="none">
          {provider.displayName}
        </Badge>
      );
    }

    const noted = view === "noted" || view === "noted-on-load";

    return (
      <Group key={provider.id} gap={6}>
        <Text size="sm" c="dimmed">
          {provider.displayName}
        </Text>
        <Badge variant="light" tt="none">
          {noted ? ONBOARDING_MESSAGES.interestNotedBadge : ONBOARDING_MESSAGES.providerSoonBadge}
        </Badge>
        {interestId === null || noted || view === "no-ping" ? null : (
          <Button
            variant="default"
            size="xs"
            radius="xl"
            onClick={() => void ping(interestId)}
            disabled={view === "noting"}
            style={tapTargetStyle}
          >
            {view === "noting"
              ? ONBOARDING_MESSAGES.interestPendingLabel
              : ONBOARDING_MESSAGES.interestPingLabel}
          </Button>
        )}
      </Group>
    );
  }

  const notedThisVisit = chips.filter((provider) => (taps[provider.id] ?? "none") === "done");

  return (
    <Stack gap="xs">
      <Group gap="sm">{chips.map((provider) => chip(provider))}</Group>

      {notedThisVisit.map((provider) => (
        <Text key={provider.id} size="sm" c="dimmed">
          {notedSentence(provider.displayName)}
        </Text>
      ))}

      {failure === null ? null : (
        <Text size="sm" c="stamp.4">
          {failure}
        </Text>
      )}
    </Stack>
  );
}

// `posthog` fails the parse by design: the live chip can never offer the ping.
function interestIdOf(provider: ProviderDescriptor): InterestProviderId | null {
  const parsed = interestProviderIdSchema.safeParse(provider.id);
  return parsed.success ? parsed.data : null;
}

function notedSentence(provider: string): string {
  return ONBOARDING_MESSAGES.interestNotedTemplate.replaceAll("{provider}", provider);
}
