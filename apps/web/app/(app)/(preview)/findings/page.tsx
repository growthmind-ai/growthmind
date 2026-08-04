import { Box, Group, Stack, Text } from "@mantine/core";
import Link from "next/link";
import type { ReactNode } from "react";

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
import { Eyebrow } from "@/components/ui/Eyebrow";
import { ClosingNote, PageHeader } from "@/components/ui/Page";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { readOverview, readRow } from "@/lib/preview/findings";
import { readPreviewState } from "@/lib/preview/session";
import { findingPath } from "@/lib/paths";

export const dynamic = "force-dynamic";

function CountedHeading({ title, count }: { readonly title: ReactNode; readonly count: number }) {
  return (
    <Group
      justify="space-between"
      pb={4}
      style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
    >
      <Eyebrow>{title}</Eyebrow>
      <Text size="xs" fw={700} c="dimmed" ff="monospace">
        {count}
      </Text>
    </Group>
  );
}

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
    <Link href={findingPath(row.id)} className={classes.rowLink}>
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

function GroupBlock({
  group,
  rows,
}: {
  readonly group: FindingGroup;
  readonly rows: readonly FindingRow[];
}) {
  if (rows.length === 0) return null;

  return (
    <Stack gap={0}>
      <CountedHeading title={GROUP_TITLES[group]} count={rows.length} />
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
      <PageHeader title="Everything we’ve seen in your product">
        {overview.window} · not a queue, and nothing here needs you today
      </PageHeader>

      <SurfaceCard>
        <Stack gap="xs">
          <Text>{coverageSentences(overview.coverage).join(" ")}</Text>
          <Text>{calibrationSentence(overview.calibration)}</Text>
          <Text>{overview.recalibration}</Text>
        </Stack>
      </SurfaceCard>

      <Stack gap="lg">
        {FINDING_GROUPS.map((group) => (
          <GroupBlock key={group} group={group} rows={rowsInGroup(overview.rows, group)} />
        ))}
      </Stack>

      {dismissed.size === 0 ? null : (
        <Stack gap={0}>
          <CountedHeading title="You told us these were not useful" count={dismissed.size} />
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

      <ClosingNote>
        Nothing here needs you today. What&apos;s worth acting on arrives in your channel, one at a
        time. If you find yourself checking this page every morning, tell us — we built it wrong.
      </ClosingNote>
    </Stack>
  );
}
