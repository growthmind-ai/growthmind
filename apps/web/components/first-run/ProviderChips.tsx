"use client";

import { Badge, Button, Group, Stack, Text, VisuallyHidden } from "@mantine/core";
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
import { resolveChipView, type ChipTap, type ChipView } from "./chip-state";

interface ProviderRow {
  readonly provider: ProviderDescriptor;
  readonly interest: InterestProviderId;
  readonly view: ChipView;
}

interface ProviderChipsProps {
  readonly rail: ProviderRail;
  readonly providerInterest: readonly InterestProviderId[];
  readonly interestPingAvailable: boolean;

  // Null where the section around the list already says these are not built.
  readonly label: string | null;
}

export function ProviderChips(props: ProviderChipsProps) {
  const { rail, providerInterest, interestPingAvailable, label } = props;

  const [taps, setTaps] = useState<Readonly<Record<string, ChipTap>>>({});
  const [failure, setFailure] = useState<string | null>(null);

  const rows = providerRows({ rail, providerInterest, interestPingAvailable, taps });

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

  function action(row: ProviderRow): ReactNode {
    if (row.view === "noted" || row.view === "noted-on-load") {
      return (
        <Badge variant="light" tt="none">
          {ONBOARDING_MESSAGES.interestNotedBadge}
        </Badge>
      );
    }

    if (row.view === "no-ping") {
      return null;
    }

    return (
      <Button
        variant="default"
        size="xs"
        radius="xl"
        onClick={() => void ping(row.interest)}
        disabled={row.view === "noting"}
        style={tapTargetStyle}
      >
        {row.view === "noting"
          ? ONBOARDING_MESSAGES.interestPendingLabel
          : ONBOARDING_MESSAGES.interestPingLabel}
      </Button>
    );
  }

  if (rows.length === 0) {
    return null;
  }

  return (
    <Stack gap="xs" maw={420}>
      {label === null ? null : (
        <Text size="xs" fw={700} tt="uppercase" c="dimmed">
          {label}
        </Text>
      )}

      {rows.map((row) => (
        <Group key={row.provider.id} justify="space-between" gap="sm">
          <Text size="sm" c="dimmed">
            {row.provider.displayName}
          </Text>
          {action(row)}
        </Group>
      ))}

      {/* Mounted before anything arrives, as WaitLog does: a live region added
          together with its content is not announced, and the tap's own button
          unmounts, so this is the signal that survives the flip. The badge is
          what a sighted reader sees, so the sentence is announced only. */}
      <Stack gap="xs" aria-live="polite">
        <VisuallyHidden>
          {rows
            .filter((row) => row.view === "noted")
            .map((row) => (
              <Text key={row.provider.id} span size="sm">
                {notedSentence(row.provider.displayName)}
              </Text>
            ))}
        </VisuallyHidden>

        {failure === null ? null : (
          <Text size="sm" c="stamp.4">
            {failure}
          </Text>
        )}
      </Stack>
    </Stack>
  );
}

interface ProviderRowsInput {
  readonly rail: ProviderRail;
  readonly providerInterest: readonly InterestProviderId[];
  readonly interestPingAvailable: boolean;
  readonly taps: Readonly<Record<string, ChipTap>>;
}

function providerRows(input: ProviderRowsInput): readonly ProviderRow[] {
  const rows: ProviderRow[] = [];

  for (const provider of PROVIDER_CATALOGUE) {
    if (provider.rail !== input.rail) {
      continue;
    }

    const interest = interestIdOf(provider);
    const view = resolveChipView({
      live: provider.live,
      interestPingAvailable: input.interestPingAvailable,
      notedOnLoad: interest !== null && input.providerInterest.includes(interest),
      tap: input.taps[provider.id] ?? "none",
    });

    // The live provider is what the card is for, not a row in a list of what
    // it cannot do yet.
    if (view === "live" || interest === null) {
      continue;
    }

    rows.push({ provider, interest, view });
  }

  return rows;
}

// `posthog` fails the parse by design: the live provider can never be pinged.
function interestIdOf(provider: ProviderDescriptor): InterestProviderId | null {
  const parsed = interestProviderIdSchema.safeParse(provider.id);
  return parsed.success ? parsed.data : null;
}

function notedSentence(provider: string): string {
  return ONBOARDING_MESSAGES.interestNotedTemplate.replaceAll("{provider}", provider);
}
