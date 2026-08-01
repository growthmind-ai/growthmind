// THE LIVE STEP'S CARD (O-008, UX §3).
//
// ###########################################################################
// # A LIVE STEP IS A CARD; A STUB IS A NOTE IN THE MARGIN.
// #
// # That contrast is the whole visual grammar of the sequence, and it is the
// # reason this component and `StubStep` are two files rather than one with a
// # branch: the difference is not a variant, it is the presence or absence of
// # a surface. A `state` prop on one renderer would make "no card" one setting
// # away from "a disabled card", which is the failure the stub contract exists
// # to make impossible.
// #
// # `open` AND `state` ARE SEPARATE PROPS ON PURPOSE (AD-19's `StepView`). UX
// # row 8 requires step 2 to flip to done AND STAY OPEN — a done-and-collapsed
// # row throws both confirmations away at the exact moment they are the proof
// # the connection worked. One field cannot say both.
// #
// # THE BODY IS `children`. This file owns the frame and the ordinal column;
// # it knows nothing about forms, counters or receipts, so a later step's body
// # is a new child rather than a new branch in here.
// ###########################################################################
import { Group, Paper, Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";

import type { StepState } from "@growthmind/shared";

/** Matching `StubStep`'s column exactly, so the ordinals line up down the page. */
const ORDINAL_COLUMN = { width: 20, flexShrink: 0 };

/** `minWidth: 0` is what lets a long label wrap instead of forcing a scrollbar. */
const CONTENT_COLUMN = { flex: 1, minWidth: 0 };

/**
 * The resolved-state mark, and there are only two.
 *
 * `skipped` gets a neutral middot rather than a cross or a warning colour: it
 * is a legitimate finished answer (deviation 2), not a failure, and colouring
 * it as one would tell a founder they had broken something by choosing the
 * option we offered them.
 */
const STATE_GLYPH: Partial<Record<StepState, string>> = {
  done: "✓",
  skipped: "·",
};

interface StepRowProps {
  readonly ordinal: number;
  readonly title: string;
  /** The sentence under the title, or `null` when the step has none. */
  readonly helper?: string | null;
  readonly state: StepState;
  /** The body renders. Separate from `state` — see the header. */
  readonly open: boolean;
  readonly children?: ReactNode;
}

// The destructure is split across two lines DELIBERATELY, and joining them
// breaks a guard: the render-purity scan reads a run of six or more words on
// one line as an inline sentence, and six shorthand names separated by commas
// is exactly that shape. Two threes, not one six.
export function StepRow(props: StepRowProps) {
  const { ordinal, title, helper } = props;
  const { state, open, children } = props;
  const glyph = STATE_GLYPH[state];

  return (
    <Paper withBorder radius="sm" p="md">
      <Group align="flex-start" gap="sm" wrap="nowrap">
        <Text c="dimmed" fw={700} aria-hidden style={ORDINAL_COLUMN}>
          {ordinal}
        </Text>
        <Stack gap="xs" style={CONTENT_COLUMN}>
          <Group justify="space-between" align="flex-start" gap="sm" wrap="nowrap">
            <Text fw={700}>{title}</Text>
            {glyph === undefined ? null : (
              <Text c={state === "done" ? "band.4" : "dimmed"} fw={700} aria-hidden>
                {glyph}
              </Text>
            )}
          </Group>
          {helper === null || helper === undefined ? null : (
            <Text c="dimmed" size="sm">
              {helper}
            </Text>
          )}
          {open ? children : null}
        </Stack>
      </Group>
    </Paper>
  );
}
