"use client";

import { Stack, Text, Title } from "@mantine/core";
import { useRef } from "react";

import {
  isDeliveryAddress,
  reduceStage,
  renderDeliveryClosure,
  renderStageView,
  STAGE_FINDING_UNAVAILABLE,
  STAGE_NO_DELIVERY_LINE,
  STAGE_UNREADABLE_DELIVERED_TEMPLATE,
  STAGE_UNREADABLE_HEADING,
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

  // The address decides whether there is a claim to make; the label is what the
  // sentence names. A row can hold a deliverable id and no name at all.
  readonly channelLabel: string | null;

  readonly findingUnavailable: boolean;

  // Whether the row was refused before the delivery lane could post it. Separate from the
  // flag above, and never rendered as a reason — what was refused stays unnamed.
  readonly findingWithheld: boolean;

  readonly delivery: FirstRunDeliveryState;

  // Written by the delivery lane when the post failed, so the repair is the sentence
  // that already exists rather than a second one composed on this screen.
  readonly deliveryReason: string | null;
}

// Where it went, for the one state that cannot show it. NOT `renderDeliveryClosure`: an
// unrenderable row correlates no delivery, so `delivery` is always "none" here and that
// helper would answer "nowhere" for a channel that did receive it.
function unreadableClosureOf(props: StageProps): string | null {
  const { channelId } = props;

  if (!props.findingUnavailable) return null;

  if (!isDeliveryAddress(channelId)) return STAGE_NO_DELIVERY_LINE;

  // The delivery lane drops a withheld row on the same terms this read did, so the
  // channel holds no copy and nobody is sent there to look for one.
  if (props.findingWithheld) return null;

  return STAGE_UNREADABLE_DELIVERED_TEMPLATE.replaceAll(
    "{channel}",
    props.channelLabel?.trim() || channelId,
  );
}

export function Stage(props: StageProps) {
  const state = reduceStage(props.facts, props.nowMs);
  const view = renderStageView(state);
  const deliveryLine = renderDeliveryClosure(props.delivery, props.channelId, props.channelLabel);

  const mountedAs = useRef(state.kind);
  const arriving = state.kind !== mountedAs.current;

  const unreadableClosure = unreadableClosureOf(props);

  return (
    <Stack gap="sm">
      {/* The fault owns the heading when there is one. "Reading what came back."
          above a sentence saying there is nothing left to wait for is the screen
          contradicting itself, and the hint under it — "this screen rebuilds
          itself" — promises a recovery that is not coming (B-040). */}
      <Title order={2} size="h4">
        {props.findingUnavailable ? STAGE_UNREADABLE_HEADING : view.heading}
      </Title>

      {/* The one fault this screen admits to. It never suppresses the log
          beside it: those lines are measurements that really did happen, and
          they are the evidence that the wait was real rather than dropped. */}
      <Text size="sm" c={props.findingUnavailable ? "stamp.4" : "dimmed"}>
        {props.findingUnavailable ? STAGE_FINDING_UNAVAILABLE : view.hint}
      </Text>

      {unreadableClosure === null ? null : (
        <Text size="sm" c="dimmed">
          {unreadableClosure}
        </Text>
      )}

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
          <Text size="sm" c="dimmed">
            {deliveryLine}
          </Text>

          {props.deliveryReason === null ? null : (
            <Text size="sm" c="dimmed">
              {props.deliveryReason}
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
