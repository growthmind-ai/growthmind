"use client";

// THE PERSISTENT STRIP (O-008, FR-O13, FR-O14, UX Checklist row 17).
//
// ###########################################################################
// # THE COUNTER KEEPS MOVING THROUGH THE WHOLE WAIT, AND THAT IS ITS JOB.
// #
// # It is the only honest motion source this surface has: a real measurement
// # of a real number, not a proportion of a total nobody measured. Keeping it
// # on screen is what makes the wait read as WATCHED rather than as spun —
// # which is why the strip survives the fold instead of leaving with phase A.
// #
// # IT IS NOT A DASHBOARD AND MUST NEVER BECOME ONE. One line of dimmed text,
// # no tiles, no chart, no history. Deviation 1 says this surface exists once,
// # during install, and holds nothing to come back and check.
// ###########################################################################
//
// ── THE DEGRADED NOTICE RIDES HERE FOREVER AFTER (FR-O14) ───────────────────
//
// It is handed down already derived from the persisted ABSENCE of an active
// Slack connection — never from a session flag — so it survives a reload by
// construction, and a workspace that connects later stops seeing it without
// anybody clearing anything.
//
// The channel is read from the stored connection row upstream and never
// accepted from a payload: a caller that could name a channel could put this
// workspace's announcement in one it does not own.
import { Box, Button, Stack, Text } from "@mantine/core";

import {
  COUNTER_LABELS,
  ONBOARDING_MESSAGES,
  STRIP_COUNTED_TEMPLATE,
  STRIP_LEAD,
  STRIP_POSTING_TO_TEMPLATE,
  STRIP_SEEN_TEMPLATE,
  type OnboardingCounterView,
} from "@growthmind/shared";

import { tapTargetStyle } from "@/components/ui/tap-target";

import styles from "./first-run.module.css";

/** Between the parts. Not a word, so it needs no home in the copy tables. */
const SEPARATOR = "·";

const withCount = (template: string, count: number): string =>
  template.replaceAll("{count}", String(count));

const withChannel = (template: string, channel: string): string =>
  template.replaceAll("{channel}", channel);

/**
 * One counter row's number, found by its SHIPPED LABEL rather than by its
 * position — a positional index is a silent mis-read the first time a row is
 * added upstream, and this strip would then quietly report the wrong figure
 * beside the right word.
 */
const rowValue = (counter: OnboardingCounterView, label: string): number =>
  counter.rows.find((row) => row.label === label)?.value ?? 0;

interface StripProps {
  readonly counter: OnboardingCounterView;
  /** `null` when nobody attached a channel. */
  readonly channelId: string | null;
  /** FR-O14's degraded line, already derived. `null` when Slack is connected. */
  readonly notice: string | null;
  readonly reopened: boolean;
  readonly onToggle: () => void;
}

export function Strip(props: StripProps) {
  const { counter, channelId, notice } = props;

  const seen = withCount(STRIP_SEEN_TEMPLATE, rowValue(counter, COUNTER_LABELS.totalReceived));
  const counted = withCount(STRIP_COUNTED_TEMPLATE, rowValue(counter, COUNTER_LABELS.kept));
  const posting = channelId === null ? [] : [withChannel(STRIP_POSTING_TO_TEMPLATE, channelId)];

  const parts = [STRIP_LEAD, seen, counted, ...posting];

  return (
    <Stack gap="xs">
      {/* Ambient proof, not an event: it changes on every poll, so announcing
          it would talk over the log. The block carries a name instead. */}
      <Box component="section" aria-label={STRIP_LEAD} aria-live="off" className={styles.strip}>
        {parts.map((part, index) => (
          <Text key={part} span size="sm" c="dimmed">
            {index === 0 ? part : `${SEPARATOR} ${part}`}
          </Text>
        ))}
      </Box>

      {notice === null ? null : (
        <Text size="sm" c="dimmed">
          {notice}
        </Text>
      )}

      {/* T7. A toggle, not navigation — the address never changes and Back is
          unaffected, because there is nowhere on this surface to go back to. */}
      <Button
        variant="default"
        aria-expanded={props.reopened}
        onClick={props.onToggle}
        className={`${styles.action} ${styles.reopen}`}
        style={tapTargetStyle}
        w={{ base: "100%", xs: "auto" }}
      >
        {ONBOARDING_MESSAGES.stripReopen}
      </Button>
    </Stack>
  );
}
