"use client";

import { Box, Paper, Stack, Text } from "@mantine/core";
import { useEffect, useState } from "react";

import { toFindingView, type OnboardingFinding } from "@growthmind/shared";

import styles from "./first-run.module.css";

const WINDOW_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: "short", timeStyle: "short" };

const moment = (at: Date): string => new Date(at).toLocaleString(undefined, WINDOW_FORMAT);

interface FindingCardProps {
  readonly finding: OnboardingFinding;

  readonly arriving: boolean;
}

export function FindingCard(props: FindingCardProps) {
  const { finding, arriving } = props;
  const view = toFindingView(finding);

  const [arrived, setArrived] = useState(!arriving);

  useEffect(() => {
    const settle = setTimeout(() => setArrived(true), 0);
    return () => clearTimeout(settle);
  }, []);

  const shell = arrived ? `${styles.finding} ${styles.arrived}` : styles.finding;

  return (
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
