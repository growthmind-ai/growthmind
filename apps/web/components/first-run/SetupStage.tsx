"use client";

import { Button, Stack, Text, Title } from "@mantine/core";

import {
  canArm,
  COUNTER_LABELS,
  ONBOARDING_MESSAGES,
  nextBlocker,
  STRIP_COUNTED_TEMPLATE,
  STRIP_SEEN_TEMPLATE,
  type OnboardingCounterView,
  type SetupFacts,
} from "@growthmind/shared";

import { tapTargetStyle } from "@/components/ui/tap-target";

import styles from "./first-run.module.css";

const SEPARATOR = "·";

const rowValue = (counter: OnboardingCounterView, label: string): number =>
  counter.rows.find((row) => row.label === label)?.value ?? 0;

const withCount = (template: string, count: number): string =>
  template.replaceAll("{count}", String(count));

interface SetupStageProps {
  readonly facts: SetupFacts;
  readonly counter: OnboardingCounterView;

  readonly attached: boolean;
  readonly pending: boolean;
  readonly onArm: () => void;
}

export function SetupStage(props: SetupStageProps) {
  const blocker = nextBlocker(props.facts);

  if (blocker === null) {
    return null;
  }

  const seen = withCount(
    STRIP_SEEN_TEMPLATE,
    rowValue(props.counter, COUNTER_LABELS.totalReceived),
  );
  const counted = withCount(STRIP_COUNTED_TEMPLATE, rowValue(props.counter, COUNTER_LABELS.kept));

  return (
    <Stack gap="sm">
      <Title order={2} size="h4">
        {blocker.heading}
      </Title>

      <Text c="dimmed" size="sm">
        {blocker.sentence}
      </Text>

      {/* THE WARMTH BEAT'S EVIDENCE. Real counts off the founder's own product,
          at eye level, before they have done any work for us — and deliberately
          absent before a connection exists, because a zero beside a word we
          have not measured yet is a claim rather than a number. Ambient, so it
          is announced by nothing: it changes on every poll. */}
      {props.attached ? (
        <Text size="sm" c="dimmed" aria-live="off">
          {`${seen} ${SEPARATOR} ${counted}`}
        </Text>
      ) : null}

      {/* Offered exactly when a watch could see something — `canArm` and the
          chain's last link are pinned to agree by a test, so a button can never
          appear above a sentence still asking for something. */}
      {canArm(props.facts) ? (
        <Button
          onClick={props.onArm}
          loading={props.pending}
          className={styles.action}
          style={tapTargetStyle}
          w={{ base: "100%", xs: "auto" }}
        >
          {ONBOARDING_MESSAGES.startWatching}
        </Button>
      ) : null}
    </Stack>
  );
}
