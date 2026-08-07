"use client";

import { Box, Button, Group, Stack, Text, VisuallyHidden } from "@mantine/core";
import {
  MARK_ALL_READ_LABEL,
  NOTIFICATION_EMPTY_STATE_MESSAGES,
  NOTIFICATION_POPOVER_HEADING,
  UNREAD_ROW_SCREEN_READER_PREFIX,
} from "@growthmind/shared";
import { Anchor } from "@mantine/core";
import Link from "next/link";
import { useState } from "react";

import { AnchorLink } from "@/components/ui/Links";
import type { BellRowViewModel, BellViewModel } from "@/lib/notifications/bell";
import { ROUTES } from "@/lib/routes";

const CONNECT_SLACK_LABEL = "Connect Slack";

// Recording that someone read a row must never sit between them and the page they pressed:
// the write is sent and abandoned, and a lost one costs a dot, not a navigation.
function recordRead(notificationId: string): void {
  void fetch("/api/notifications/bell/read", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ notificationId }),
  }).catch(() => undefined);
}

function markAllRead(): void {
  void fetch("/api/notifications/bell/read-all", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  }).catch(() => undefined);
}

// The empty state is a primary state at this volume — three findings a week means an empty
// popover is the common one, so it onboards rather than apologises.
function EmptyState({ variant }: { readonly variant: BellViewModel["emptyVariant"] }) {
  if (variant === null) {
    return null;
  }

  const sentence = NOTIFICATION_EMPTY_STATE_MESSAGES[variant];

  if (variant !== "nothing_new_no_slack") {
    return (
      <Text size="sm" c="dimmed" p="md">
        {sentence}
      </Text>
    );
  }

  const [before, after] = sentence.split(CONNECT_SLACK_LABEL);

  return (
    <Text size="sm" c="dimmed" p="md">
      {before}
      <AnchorLink href={ROUTES.settings} size="sm">
        {CONNECT_SLACK_LABEL}
      </AnchorLink>
      {after}
    </Text>
  );
}

function Row({ row }: { readonly row: BellRowViewModel }) {
  return (
    <Box px="md" py="sm" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
      <Group wrap="nowrap" align="flex-start" gap="sm">
        <Box
          aria-hidden
          style={{
            width: 7,
            height: 7,
            marginTop: 7,
            flexShrink: 0,
            borderRadius: 99,
            background: row.unread ? "var(--mantine-primary-color-4)" : "transparent",
            border: row.unread ? undefined : "1px solid var(--mantine-color-default-border)",
          }}
        />
        <Box style={{ minWidth: 0 }}>
          {/* The dot is the sighted reader's unread fact; this is the same fact spoken. */}
          {row.unread ? <VisuallyHidden>{UNREAD_ROW_SCREEN_READER_PREFIX}</VisuallyHidden> : null}

          <Anchor
            component={Link}
            href={row.subjectHref}
            size="sm"
            underline="never"
            c="var(--mantine-color-text)"
            onClick={() => {
              recordRead(row.id);
            }}
          >
            {row.sentence}
          </Anchor>

          <Group gap="xs" mt={4} wrap="wrap">
            <Text size="xs" c="dimmed">
              {row.timeLabel}
            </Text>

            {/* A sibling of the row link, never nested inside it: attending to a delivery
                problem is a different destination from reading the thing itself. */}
            {row.chip === null ? null : row.chip.href === null ? (
              <Text size="xs" c="dimmed">
                {row.chip.label}
              </Text>
            ) : (
              <AnchorLink href={row.chip.href} size="xs" c="stamp.4">
                {row.chip.label}
              </AnchorLink>
            )}
          </Group>
        </Box>
      </Group>
    </Box>
  );
}

// Exported apart from the Popover chrome: Mantine mounts a dropdown in a portal, and the
// content has to be renderable on its own for anything to assert against it.
export function BellPopoverBody({ bell }: { readonly bell: BellViewModel }) {
  // Optimistic for one interaction only: the next server render carries the same fact from
  // the watermark, so this never becomes a second home for read state.
  const [clearedAll, setClearedAll] = useState(false);

  const anyUnread = !clearedAll && bell.rows.some((row) => row.unread);

  return (
    <Stack gap={0} style={{ width: 360, maxWidth: "100%" }}>
      <Group justify="space-between" align="baseline" px="md" py="sm" wrap="nowrap">
        <Text size="sm" fw={700}>
          {NOTIFICATION_POPOVER_HEADING}
        </Text>
        {bell.rows.length > 0 ? (
          <Button
            variant="subtle"
            size="compact-xs"
            disabled={!anyUnread}
            onClick={() => {
              markAllRead();
              setClearedAll(true);
            }}
          >
            {MARK_ALL_READ_LABEL}
          </Button>
        ) : null}
      </Group>

      {bell.rows.length === 0 ? (
        <EmptyState variant={bell.emptyVariant} />
      ) : (
        bell.rows.map((row) => (
          <Row key={row.id} row={clearedAll ? { ...row, unread: false } : row} />
        ))
      )}
    </Stack>
  );
}
