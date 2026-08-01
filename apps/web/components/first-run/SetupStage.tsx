"use client";

// THE STAGE BEFORE THERE IS ANYTHING TO WATCH (design-shotgun variant 3).
//
// ###########################################################################
// # THIS PANEL IS AT THE TOP OF THE SCREEN FROM THE FIRST PAINT, AND ITS ONE
// # JOB IS TO NEVER BE EMPTY.
// #
// # The screen this replaces put the payoff LAST — an untitled, bodiless card
// # numbered 5, under two forms and two "not built yet" rows. A founder read
// # down the page and met the product's whole reason for existing as a blank
// # box. The fix is not a better empty state for that box; it is putting the
// # box first and giving it something true to say at every moment.
// #
// # WHICH ONLY WORKS IF THE SENTENCE IS ALWAYS THERE. A panel in the best
// # position on the page saying nothing is worse than the card it replaced,
// # because it costs more room to say it. So this component renders a blocker
// # or it renders the shipped stage, and there is no third branch — no
// # "loading", no null return, no empty frame. `nextBlocker` is total over the
// # facts by construction, and that totality is what this file is spending.
// #
// # IT DERIVES NOTHING. The chain lives in `@growthmind/shared` as a pure
// # function with its own suite; this file asks it one question and renders
// # the answer. A second opinion in here about which sentence applies is a
// # second place for the screen and its tests to disagree.
// ###########################################################################
//
// ── THE ARM BUTTON LIVES HERE, AND THAT IS THE TRAP BEING CLOSED ────────────
//
// The shipped screen rendered "Start watching" unconditionally, at the bottom,
// below everything. Pressing it with nothing connected stamped a persisted
// origin and started a clock over a product we had no way to read: a wait that
// could never end, offered as the page's primary action. It is now rendered by
// the one component that knows whether a watch could see anything, gated on
// `canArm`, and sitting inside the sentence that explains what pressing it
// does.
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

/** Between the counts. Not a word, so it needs no home in the copy tables. */
const SEPARATOR = "·";

/**
 * One counter row's number, found by its SHIPPED LABEL rather than by position
 * — the same rule `Strip` keeps, and for the same reason: a positional index
 * silently reports the wrong figure beside the right word the first time a row
 * is added upstream.
 */
const rowValue = (counter: OnboardingCounterView, label: string): number =>
  counter.rows.find((row) => row.label === label)?.value ?? 0;

const withCount = (template: string, count: number): string =>
  template.replaceAll("{count}", String(count));

interface SetupStageProps {
  /** The persisted facts the chain reads. Never a client flag. */
  readonly facts: SetupFacts;
  readonly counter: OnboardingCounterView;
  /** Whether the counts mean anything yet — false before a connection exists. */
  readonly attached: boolean;
  readonly pending: boolean;
  readonly onArm: () => void;
}

export function SetupStage(props: SetupStageProps) {
  const blocker = nextBlocker(props.facts);

  // The caller renders the shipped `Stage` once the chain is clear, so this is
  // unreachable rather than a fallback. Returning null keeps the impossible
  // branch honest instead of inventing a sentence for it.
  if (blocker === null) {
    return null;
  }

  const seen = withCount(STRIP_SEEN_TEMPLATE, rowValue(props.counter, COUNTER_LABELS.totalReceived));
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
