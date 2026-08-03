"use client";

import { Stack, Text, Title } from "@mantine/core";
import { useRef } from "react";

import {
  reduceStage,
  renderDeliveryLine,
  renderStageView,
  STAGE_FINDING_UNAVAILABLE,
  STAGE_RETIRE_CLOSURE,
  type FirstRunDeliveryState,
  type StagePersistedFacts,
} from "@growthmind/shared";

import { FindingCard } from "./FindingCard";
import styles from "./first-run.module.css";
import { WaitLog } from "./WaitLog";

interface StageProps {
  readonly facts: StagePersistedFacts;

  readonly nowMs: number;

  readonly channelId: string | null;

  readonly findingUnavailable: boolean;

  readonly delivery: FirstRunDeliveryState;
}

export function Stage(props: StageProps) {
  const state = reduceStage(props.facts, props.nowMs);
  const view = renderStageView(state);
  const deliveryLine = renderDeliveryLine(props.delivery, props.channelId);

  const mountedAs = useRef(state.kind);
  const arriving = state.kind !== mountedAs.current;

  return (
    <Stack gap="sm">
      <Title order={2} size="h4">
        {view.heading}
      </Title>

      <Text c="dimmed" size="sm">
        {view.hint}
      </Text>

      {/* The one fault this screen admits to. It never suppresses the log
          beside it: those lines are measurements that really did happen, and
          they are the evidence that the wait was real rather than dropped. */}
      {props.findingUnavailable ? (
        <Text size="sm" c="stamp.4">
          {STAGE_FINDING_UNAVAILABLE}
        </Text>
      ) : null}

      <WaitLog lines={view.lines} />

      <Text component="p" className={styles.elapsed} c="dimmed" size="sm" aria-live="off">
        <span className={styles.dot} aria-hidden="true" />
        <span aria-hidden="true">{view.elapsedSeconds} seconds elapsed</span>
      </Text>

      {state.kind === "finding" ? (
        <FindingCard finding={state.finding} arriving={arriving} />
      ) : null}

      {state.kind === "finding" ? (
        <>
          {deliveryLine === null ? null : (
            <Text size="sm" c="dimmed">
              {deliveryLine}
            </Text>
          )}

          <Text size="sm" c="dimmed">
            {STAGE_RETIRE_CLOSURE}
          </Text>
        </>
      ) : null}
    </Stack>
  );
}
