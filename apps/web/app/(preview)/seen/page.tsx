import { Box, Group, Paper, Stack, Text, Title } from "@mantine/core";
import Link from "next/link";

import {
  calibrationSentence,
  coverageSentences,
  FINDING_GROUPS,
  GROUP_TITLES,
  rowsInGroup,
} from "@growthmind/shared";
import type { FindingGroup, FindingRow } from "@growthmind/shared";

import classes from "@/components/preview/preview.module.css";
import { RestoreButton } from "@/components/preview/RestoreButton";
import { readOverview, readRow } from "@/lib/preview/findings";
import { readPreviewState } from "@/lib/preview/session";
import { seenPath } from "@/lib/preview/tabs";

export const dynamic = "force-dynamic";

function Count({ row }: { readonly row: FindingRow }) {
  if (row.numerator === null) {
    return (
      <Text ff="monospace" size="sm" c="dimmed" ta="right">
        —
      </Text>
    );
  }

  return (
    <Text ff="monospace" fw={700} ta="right" style={{ lineHeight: 1.3 }}>
      {row.numerator}
      {row.denominator === null ? null : (
        <Text span ff="monospace" size="xs" fw={400} c="dimmed">
          /{row.denominator}
        </Text>
      )}
    </Text>
  );
}

function Row({ row }: { readonly row: FindingRow }) {
  return (
    <Link href={seenPath(row.id)} className={classes.rowLink}>
      <Count row={row} />
      <Box style={{ minWidth: 0 }}>
        <Text fw={600} style={{ lineHeight: 1.4 }}>
          {row.headline}
        </Text>
        <Text size="sm" c="dimmed" style={{ lineHeight: 1.45 }}>
          {row.context}
          {row.aside === null ? null : ` ${row.aside}`}
        </Text>
      </Box>
      <Text ff="monospace" size="xs" c="dimmed">
        {row.observedOn}
      </Text>
    </Link>
  );
}

function GroupBlock({ group, rows }: { readonly group: FindingGroup; readonly rows: readonly FindingRow[] }) {
  if (rows.length === 0) return null;

  return (
    <Stack gap={0}>
      <Group
        justify="space-between"
        pb={4}
        style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
      >
        <Text size="xs" fw={700} tt="uppercase" c="dimmed">
          {GROUP_TITLES[group]}
        </Text>
        <Text size="xs" fw={700} c="dimmed" ff="monospace">
          {rows.length}
        </Text>
      </Group>
      {rows.map((row) => (
        <Row key={row.id} row={row} />
      ))}
    </Stack>
  );
}

export default async function SeenPage() {
  const state = await readPreviewState();
  const dismissed = new Set(Object.keys(state.dismissed));
  const overview = readOverview(dismissed);

  return (
    <Stack gap="lg">
      <Stack gap={2}>
        <Title order={1} size="h3">
          Everything we&apos;ve seen in your product
        </Title>
        <Text size="sm" c="dimmed">
          {overview.window} · not a queue, and nothing here needs you today
        </Text>
      </Stack>

      {/* The account of ourselves, before any claim about them. It stays prose with the
          denominators inside sentences — as figures in boxes it becomes a dashboard. */}
      <Paper withBorder radius="sm" p="md" bg="var(--mantine-color-default)">
        <Stack gap="xs">
          <Text>{coverageSentences(overview.coverage).join(" ")}</Text>
          <Text>{calibrationSentence(overview.calibration)}</Text>
          <Text>{overview.recalibration}</Text>
        </Stack>
      </Paper>

      <Stack gap="lg">
        {FINDING_GROUPS.map((group) => (
          <GroupBlock key={group} group={group} rows={rowsInGroup(overview.rows, group)} />
        ))}
      </Stack>

      {dismissed.size === 0 ? null : (
        <Stack gap={0}>
          <Group
            justify="space-between"
            pb={4}
            style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
          >
            <Text size="xs" fw={700} tt="uppercase" c="dimmed">
              You told us these were not useful
            </Text>
            <Text size="xs" fw={700} c="dimmed" ff="monospace">
              {dismissed.size}
            </Text>
          </Group>
          {[...dismissed].map((id) => {
            const row = readRow(id);
            if (row === null) return null;

            return (
              <Group key={id} justify="space-between" wrap="nowrap" py="xs" gap="md">
                <Text size="sm" c="dimmed">
                  {row.headline} — &ldquo;{state.dismissed[id]}&rdquo;
                </Text>
                <RestoreButton id={id} />
              </Group>
            );
          })}
        </Stack>
      )}

      <Text size="sm" c="dimmed" pt="sm" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
        Nothing here needs you today. What&apos;s worth acting on arrives in your channel, one at a
        time. If you find yourself checking this page every morning, tell us — we built it wrong.
      </Text>
    </Stack>
  );
}
