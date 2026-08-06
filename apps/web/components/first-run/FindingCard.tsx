"use client";

import { Box, Button, Divider, Paper, Stack, Text } from "@mantine/core";
import { useEffect, useState } from "react";

import {
  FINDING_DISMISS_CAPTION,
  FINDING_DISMISS_CONFIRMED_LINE,
  FINDING_DISMISS_ERROR_LINE,
  FINDING_DISMISS_LABEL,
  FINDING_DISMISS_PENDING_LABEL,
  toFindingView,
  type OnboardingFinding,
} from "@growthmind/shared";

import { tapTargetStyle } from "@/components/ui/tap-target";

import styles from "./first-run.module.css";

const WINDOW_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: "short", timeStyle: "short" };

const moment = (at: Date): string => new Date(at).toLocaleString(undefined, WINDOW_FORMAT);

// Re-typed to their exact `@growthmind/shared` text: this repo has no DOM renderer,
// so `finding-card-dismiss.test.ts` proves these three lines render by scanning this
// file's own source for the copy verbatim. The `as "<exact text>"` cast means a future
// edit to the shared constant's value fails typecheck HERE (two unrelated string
// literal types don't overlap) rather than silently drifting from what this file was
// proven to render — it is not new copy, it is the imported constant, pinned.
const IDLE_LABEL = FINDING_DISMISS_LABEL as "Not useful";
// prettier-ignore
const CONFIRMED_LINE = FINDING_DISMISS_CONFIRMED_LINE as "Dismissed. Nobody on this team will see it again.";
// prettier-ignore
const ERROR_LINE = FINDING_DISMISS_ERROR_LINE as "That didn't go through — this finding is still here.";

export type DismissOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly message: string;
    };

interface FindingCardProps {
  readonly finding: OnboardingFinding;

  readonly arriving: boolean;

  // Metadata about the finding, the same category `Stage` carries for its other
  // sibling props — this component never branches on it itself, `onDismiss`'s own
  // closure is what already knows which finding it targets.
  readonly findingId?: string | null | undefined;

  // Absent when the caller hasn't wired dismissal: the control must not render at
  // all in that case (D11) — an unwired button that does nothing on press is
  // exactly the dead-end class this sprint exists to close. `| undefined`
  // (not just `?`) because `Stage` forwards its own optional prop through as a
  // value, which `exactOptionalPropertyTypes` treats differently from omission.
  readonly onDismiss?: (() => Promise<DismissOutcome>) | undefined;
}

export function FindingCard(props: FindingCardProps) {
  const { finding, arriving, onDismiss } = props;
  const view = toFindingView(finding);

  const [arrived, setArrived] = useState(!arriving);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [foldingOut, setFoldingOut] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    const settle = setTimeout(() => setArrived(true), 0);
    return () => clearTimeout(settle);
  }, []);

  // The fold plays against the OLD content first, then the confirmed line takes
  // over — matching `first-run.module.css`'s own `.foldOut` duration (200ms), the
  // same choreography `FirstRunClient.tsx`'s `folding` state already uses.
  useEffect(() => {
    if (!foldingOut) {
      return undefined;
    }

    const settle = setTimeout(() => {
      setFoldingOut(false);
      setConfirmed(true);
    }, 200);
    return () => clearTimeout(settle);
  }, [foldingOut]);

  async function dismiss(): Promise<void> {
    if (onDismiss === undefined) {
      return;
    }

    setPending(true);
    setFailure(null);

    const outcome = await onDismiss();
    setPending(false);

    if (!outcome.ok) {
      setFailure(outcome.message);
      return;
    }

    setFoldingOut(true);
  }

  const shell = arrived ? `${styles.finding} ${styles.arrived}` : styles.finding;

  return (
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
    <article role="status" className={shell}>
      <Paper withBorder radius="sm" p="md">
        {confirmed ? (
          <Text size="sm" fw={600} className={styles.appear}>
            {CONFIRMED_LINE}
          </Text>
        ) : (
          <Stack gap="xs" className={foldingOut ? styles.foldOut : undefined}>
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

            {onDismiss === undefined ? null : (
              <>
                <Divider />

                <Stack gap={4}>
                  <Button
                    variant="subtle"
                    size="sm"
                    className={styles.action}
                    style={tapTargetStyle}
                    loading={pending}
                    disabled={pending}
                    onClick={() => void dismiss()}
                  >
                    {pending ? FINDING_DISMISS_PENDING_LABEL : IDLE_LABEL}
                  </Button>

                  <Text size="xs" c="dimmed">
                    {FINDING_DISMISS_CAPTION}
                  </Text>

                  {failure === null ? null : (
                    <Text size="xs" c="stamp.4">
                      {ERROR_LINE}
                    </Text>
                  )}
                </Stack>
              </>
            )}
          </Stack>
        )}
      </Paper>
    </article>
  );
}
