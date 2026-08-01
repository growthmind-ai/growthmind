"use client";

// THE PAYOFF (O-008, FR-O20, EC-O5, UX Checklist row 20, storyboard T11).
//
// A founder broke something in their own product and watched us narrate it.
// This is the card that has to survive them CHECKING IT.
//
// ###########################################################################
// # IT IS ANNOUNCED ONCE, FROM ONE CONTAINER.
// #
// # `role="status"` is polite: it will not interrupt whatever a reader is
// # being read mid-sentence, which `role="alert"` would. There is exactly ONE
// # such container, and that is the whole reason the seven parts below are
// # plain elements — a `role="status"` on each of them would read the finding
// # out seven times.
// ###########################################################################
//
// ── THIS FILE DOES NO ARITHMETIC AND AUTHORS NO SENTENCE ────────────────────
//
// `toFindingView` selects and substitutes; the counts arrive as finished
// sentences carrying their own numerator, denominator, unit and page, and a
// zero denominator arrives as the shipped no-rate sentence rather than as a
// division nobody could perform. A founder checking our numbers has to be
// checking THE PIPELINE'S numbers — a card that recomputed anything would be a
// second place for the arithmetic to be wrong, and they cannot see which of the
// two they are reading.
//
// The window is the one thing rendered from raw values, and it is rendered as
// two moments rather than as a sentence about them: there is no shipped
// sentence for a window, and authoring one here would put a claim in front of a
// founder that the copy audit never saw.
import { Box, Paper, Stack, Text } from "@mantine/core";
import { useEffect, useState } from "react";

import { toFindingView, type OnboardingFinding } from "@growthmind/shared";

import styles from "./first-run.module.css";

/** Short enough to sit twice on a 375px line, long enough to name the day. */
const WINDOW_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: "short", timeStyle: "short" };

/**
 * One end of the window, in the reader's own locale and timezone.
 *
 * Re-read through the constructor because this value crossed a JSON boundary on
 * every poll after the first: the route sent a `Date`, the wire carries an ISO
 * string, and one of the two shapes reaches here depending on whether the card
 * was server-rendered or polled. Coercing at the boundary is D5's rule; the
 * alternative is a `.toLocaleString is not a function` on the payoff screen.
 */
const moment = (at: Date): string => new Date(at).toLocaleString(undefined, WINDOW_FORMAT);

interface FindingCardProps {
  readonly finding: OnboardingFinding;
  /** True when this landed while the reader watched. See the note below. */
  readonly arriving: boolean;
}

export function FindingCard(props: FindingCardProps) {
  const { finding, arriving } = props;
  const view = toFindingView(finding);

  // T11 / T13, in one flag. A card that was already persisted when the page
  // loaded mounts SETTLED and transitions nothing; one that lands while the
  // reader is watching mounts un-settled and is moved into place a frame later,
  // so the motion is a transition between two declared states rather than an
  // entrance that replays on every reload.
  const [arrived, setArrived] = useState(!arriving);

  useEffect(() => {
    const settle = setTimeout(() => setArrived(true), 0);
    return () => clearTimeout(settle);
  }, []);

  const shell = arrived ? `${styles.finding} ${styles.arrived}` : styles.finding;

  return (
    // THE ROLE IS WRITTEN OUT, AND THE LINT RULE BELOW IS THE PRICE OF THAT.
    // `jsx-a11y` would rather this were an `<output>`, whose implicit role is
    // `status`. It is not one: `<output>` is a form-associated element for the
    // result of a calculation, and this is a self-contained composition a
    // reader can carry away — `<article>`. The explicit role is also the one
    // thing here that survives a later tag change, on the single element whose
    // announcement is a P0 checklist row.
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
    <article role="status" className={shell}>
      <Paper withBorder radius="sm" p="md">
        <Stack gap="xs">
          <Text size="xs" tt="uppercase" fw={700} c="dimmed">
            {view.classSentence}
          </Text>

          <Text fw={700}>{view.headline}</Text>

          {view.contextLines.map((context) => (
            <Text key={context} size="sm">
              {context}
            </Text>
          ))}

          <Box className={styles.counts}>
            <Stack gap={4}>
              {view.counts.map((count) => (
                <Text key={count.sentence} size="sm">
                  {count.sentence}
                </Text>
              ))}
            </Stack>
          </Box>

          <Text size="sm" c="dimmed" suppressHydrationWarning>
            {moment(view.windowStart)} – {moment(view.windowEnd)}
          </Text>

          <Text size="sm" c="dimmed">
            {view.confidenceSentence}
          </Text>

          <Text size="sm" c="dimmed">
            {view.sourceSentence}
          </Text>
        </Stack>
      </Paper>
    </article>
  );
}
