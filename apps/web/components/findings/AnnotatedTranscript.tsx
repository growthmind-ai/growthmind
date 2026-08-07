import { Badge, Box, Group, Paper, Stack, Text, VisuallyHidden } from "@mantine/core";

import { beatsAreCited, claimRows, FINDINGS_MESSAGES } from "@growthmind/shared";
import type { BeatView, ClaimView } from "@growthmind/shared";

import { AnchorLink } from "@/components/ui/Links";

import classes from "./findings.module.css";

interface AnnotatedTranscriptProps {
  readonly beats: readonly BeatView[];
  readonly claims: readonly ClaimView[];
  readonly droppedClaims: number;
}

function BeatRow({ beat, cited }: { readonly beat: BeatView; readonly cited: boolean }) {
  return (
    <Group
      className={classes.beat}
      gap="sm"
      wrap="nowrap"
      align="flex-start"
      py={2}
      pl="sm"
      style={{
        borderLeft: cited
          ? "2px solid var(--mantine-primary-color-filled)"
          : "2px solid transparent",
      }}
    >
      <Text
        ff="monospace"
        size="xs"
        c="dimmed"
        fw={beat.notable ? 700 : 400}
        style={{ flexShrink: 0 }}
      >
        {beat.at}
      </Text>
      <Box className={classes.beatLine}>
        <Text
          span
          ff="monospace"
          size="xs"
          c={beat.notable ? "bright" : "dimmed"}
          fw={beat.notable ? 700 : 400}
        >
          {beat.text}
        </Text>
        {beat.attempt === null ? null : (
          <Badge component="span" variant="default" size="xs" radius="sm" ml="xs">
            {`attempt ${String(beat.attempt)}`}
          </Badge>
        )}
      </Box>
    </Group>
  );
}

export function AnnotatedTranscript({ beats, claims, droppedClaims }: AnnotatedTranscriptProps) {
  const rows = claimRows(claims);

  return (
    <Box className={classes.annotated}>
      {beats.map((beat) => (
        <BeatRow key={beat.index} beat={beat} cited={beatsAreCited(claims, beat.index)} />
      ))}

      {claims.map((claim, index) => (
        <Box
          key={claim.statement}
          className={classes.note}
          // A custom property rather than `gridRow`: an inline value would beat the media
          // query that unpins these notes on a narrow screen.
          style={{ "--note-row": String(rows[index] ?? 1) } as React.CSSProperties}
          mb="xs"
        >
          <Paper withBorder radius="sm" p="xs" bg="var(--mantine-color-default)">
            <Text size="sm">{claim.statement}</Text>
            {claim.citesHref === null ? (
              <Text size="xs" c="dimmed" mt={4}>
                {claim.citesLabel}
              </Text>
            ) : (
              <AnchorLink
                href={claim.citesHref}
                target="_blank"
                rel="noopener noreferrer"
                size="xs"
                mt={4}
                className={classes.citation}
              >
                {claim.citesLabel}
                <VisuallyHidden> (opens the replay in a new tab)</VisuallyHidden>
              </AnchorLink>
            )}
          </Paper>
        </Box>
      ))}

      {droppedClaims === 0 ? null : (
        <Box
          className={classes.note}
          style={{ "--note-row": String((rows.at(-1) ?? 0) + 1) } as React.CSSProperties}
        >
          <Text size="xs" c="dimmed" fs="italic">
            {FINDINGS_MESSAGES.claimDropped}
          </Text>
        </Box>
      )}

      {claims.length > 0 ? null : (
        <Box className={classes.note} style={{ "--note-row": "1" } as React.CSSProperties}>
          <Stack gap={4}>
            <Text size="sm" c="dimmed">
              {FINDINGS_MESSAGES.noClaims}
            </Text>
          </Stack>
        </Box>
      )}
    </Box>
  );
}
