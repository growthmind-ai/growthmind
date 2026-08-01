"use client";

// THE APPEND-ONLY LOG — AND THE ONLY THING THIS SURFACE SAYS OUT LOUD
// (O-008, FR-O18, FR-O29, UX §5's announcement table, storyboard T10).
//
// ###########################################################################
// # THIS IS THE WHOLE NARRATION FOR A NON-SIGHTED READER.
// #
// # The stage is the one place on this surface where meaningful content
// # arrives WITHOUT the reader acting. Silence there is the same failure as an
// # unlabelled spinner for a sighted one — and the naive fix makes it worse,
// # because wrapping the wait in a live region announces the elapsed counter
// # once a second, over the top of the very facts it was meant to carry.
// #
// # So the split is exact: THIS list announces, `aria-relevant="additions"`
// # keeps a re-render from re-reading the lines already on it, and the elapsed
// # readout beside it is silent. Each fact is read once, as it becomes true.
// ###########################################################################
//
// ── T13: A REBUILT LINE MUST NOT ANIMATE ────────────────────────────────────
//
// Every line here was rebuilt from a persisted stamp, so on a hard reload the
// whole log mounts at once. Animating that would claim three things had just
// happened when they happened before the reader arrived — a lie told in motion.
// The count present at mount is remembered, and only lines beyond it appear.
//
// This component authors no sentence. Every line's text is a shipped past-tense
// fact composed by `renderStageView`, and its stamp is a measurement.
import { Text } from "@mantine/core";
import { useRef } from "react";

import type { StageLogLine } from "@growthmind/shared";

import styles from "./first-run.module.css";

const lineClass = (index: number, replayed: number): string =>
  index >= replayed ? `${styles.line} ${styles.appear}` : styles.line;

interface WaitLogProps {
  readonly lines: readonly StageLogLine[];
}

export function WaitLog({ lines }: WaitLogProps) {
  // Read once, at mount, and never written again — the boundary between what
  // was rebuilt and what arrived while the reader watched.
  const replayed = useRef(lines.length);

  return (
    <ol aria-live="polite" aria-relevant="additions" className={styles.log}>
      {lines.map((line, index) => (
        <li key={line.text} className={lineClass(index, replayed.current)}>
          <Text span size="sm" c="dimmed" className={styles.stamp}>
            +{line.atSeconds}s
          </Text>
          <Text span size="sm">
            {line.text}
          </Text>
        </li>
      ))}
    </ol>
  );
}
