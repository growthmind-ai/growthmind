"use client";

// STEP 5 — THE STAGE (O-008, AD-5, FR-O18, FR-O19, binding rule B2).
//
// ###########################################################################
// # THIS COMPONENT DERIVES NOTHING. IT RENDERS `reduceStage`'S OUTPUT.
// #
// # The branch order — payoff, then unarmed, then ended, then the two legs —
// # lives in ONE home, and a second copy of it in here would be a wire waiting
// # to be severed: the route and the screen would answer "what is this wait
// # doing" differently, on exactly the cases that matter, and nothing would
// # fail. Two of those cases are not hypothetical. A finding persisted before
// # the reader landed has to render on first paint, which only happens because
// # branch 1 never consults the arming stamp. And a run that reached
// # `completed` microseconds before its finding row became readable has to keep
// # narrating rather than announce that nothing was found — which only happens
// # because branch 3 refuses to call that ending.
// #
// # THE PLAYABLE STORYBOARD HAS THAT ORDER WRONG. Anyone implementing from the
// # prototype's source will write the arming check first. This file calls the
// # shipped reducer instead, and a source scan holds it there for every future
// # edit.
// ###########################################################################
//
// ── THE ELAPSED READOUT IS SILENT, AND THAT IS AN ACCESSIBILITY DECISION ────
//
// The log beside it announces every fact once as it becomes true. The digits
// here change every second: inside a live region they would drown the narration
// they exist to support, reading "38 seconds, 39 seconds, 40 seconds" over the
// top of it. So they are hidden from assistive technology and the region around
// them is explicitly off. The information is not lost — the log's own stamps
// carry the timing, delivered once per event instead of once per second.
//
// NOTHING HERE COMMITS TO A DURATION. No countdown, no ring, no bar, no ETA,
// no percentage. Elapsed counts UP from a persisted origin, which states what
// has already happened rather than what is about to.
import { Stack, Text, Title } from "@mantine/core";
import { useRef } from "react";

import {
  reduceStage,
  renderStageView,
  STAGE_RETIRE_TEMPLATE,
  type StagePersistedFacts,
} from "@growthmind/shared";

import { FindingCard } from "./FindingCard";
import styles from "./first-run.module.css";
import { WaitLog } from "./WaitLog";

interface StageProps {
  /** The persisted milestones, exactly as the reducer consumes them. */
  readonly facts: StagePersistedFacts;
  /** The clock, owned by the client that holds the interval. */
  readonly nowMs: number;
  /** FR-O13: read from the stored connection row, never from a payload. */
  readonly channelId: string | null;
}

export function Stage(props: StageProps) {
  const state = reduceStage(props.facts, props.nowMs);
  const view = renderStageView(state);

  // T13. What the stage was showing when it mounted is what a reload rebuilt;
  // anything else arrived while the reader was watching, and only that is
  // allowed to move.
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

      <WaitLog lines={view.lines} />

      <Text component="p" className={styles.elapsed} c="dimmed" size="sm" aria-live="off">
        <span className={styles.dot} aria-hidden="true" />
        <span aria-hidden="true">{view.elapsedSeconds} seconds elapsed</span>
      </Text>

      {state.kind === "finding" ? (
        <FindingCard finding={state.finding} arriving={arriving} />
      ) : null}

      {/* The retire line names where the same thing already is, so it is only
          true once a channel exists. A workspace that walked past Slack is told
          the other half of that story by the strip's degraded notice. */}
      {state.kind === "finding" && props.channelId !== null ? (
        <Text size="sm" c="dimmed">
          {STAGE_RETIRE_TEMPLATE.replaceAll("{channel}", props.channelId)}
        </Text>
      ) : null}
    </Stack>
  );
}
