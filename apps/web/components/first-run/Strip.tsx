"use client";

import { Box, Button, Stack, Text } from "@mantine/core";

import {
  COUNTER_LABELS,
  ONBOARDING_MESSAGES,
  STRIP_COUNTED_TEMPLATE,
  STRIP_LEAD,
  STRIP_POSTING_TO_TEMPLATE,
  STRIP_SEEN_TEMPLATE,
  type OnboardingCounterView,
} from "@growthmind/shared";

import { tapTargetStyle } from "@/components/ui/tap-target";

import styles from "./first-run.module.css";

const SEPARATOR = "·";

const withCount = (template: string, count: number): string =>
  template.replaceAll("{count}", String(count));

const withChannel = (template: string, channel: string): string =>
  template.replaceAll("{channel}", channel);

const rowValue = (counter: OnboardingCounterView, label: string): number =>
  counter.rows.find((row) => row.label === label)?.value ?? 0;

interface StripProps {
  readonly counter: OnboardingCounterView;

  readonly channelId: string | null;

  readonly notice: string | null;
  readonly reopened: boolean;
  readonly onToggle: () => void;
}

export function Strip(props: StripProps) {
  const { counter, channelId, notice } = props;

  const seen = withCount(STRIP_SEEN_TEMPLATE, rowValue(counter, COUNTER_LABELS.totalReceived));
  const counted = withCount(STRIP_COUNTED_TEMPLATE, rowValue(counter, COUNTER_LABELS.kept));
  const posting = channelId === null ? [] : [withChannel(STRIP_POSTING_TO_TEMPLATE, channelId)];

  const parts = [STRIP_LEAD, seen, counted, ...posting];

  return (
    <Stack gap="xs">
      {/* Ambient proof, not an event: it changes on every poll, so announcing
          it would talk over the log. The block carries a name instead. */}
      <Box component="section" aria-label={STRIP_LEAD} aria-live="off" className={styles.strip}>
        {parts.map((part, index) => (
          <Text key={part} span size="sm" c="dimmed">
            {index === 0 ? part : `${SEPARATOR} ${part}`}
          </Text>
        ))}
      </Box>

      {notice === null ? null : (
        <Text size="sm" c="dimmed">
          {notice}
        </Text>
      )}

      {/* T7. A toggle, not navigation — the address never changes and Back is
          unaffected, because there is nowhere on this surface to go back to. */}
      <Button
        variant="default"
        aria-expanded={props.reopened}
        onClick={props.onToggle}
        className={`${styles.action} ${styles.reopen}`}
        style={tapTargetStyle}
        w={{ base: "100%", xs: "auto" }}
      >
        {ONBOARDING_MESSAGES.stripReopen}
      </Button>
    </Stack>
  );
}
