import { Group, Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";

import { ensureProject } from "@growthmind/db";
import {
  calibrationSentence,
  coverageSentences,
  FINDING_GROUPS,
  GROUP_TITLES,
  rowsInGroup,
} from "@growthmind/shared";
import type { FindingGroup, FindingRow } from "@growthmind/shared";

import { LiveRefresh } from "@/components/live/LiveRefresh";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { ListRow } from "@/components/ui/ListRow";
import { ClosingNote, PageHeader } from "@/components/ui/Page";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { getDb } from "@/lib/db";
import { readLiveOverview } from "@/lib/findings/read";
import { getTenantContext } from "@/lib/tenant";
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
    <ListRow
      href={findingPath(row.id)}
      leading={<Count row={row} />}
      heading={row.headline}
      detail={
        <>
          {row.context}
          {row.aside === null ? null : ` ${row.aside}`}
        </>
      }
      trailing={row.observedOn}
    />
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

export default async function FindingsPage() {
  const ctx = await getTenantContext();
  if (ctx === null) {
    return null;
  }

  const db = getDb();
  const { projectId } = await ensureProject(db, ctx);
  const overview = await readLiveOverview(db, ctx, projectId);

  return (
    <Stack gap="lg">
      <LiveRefresh topics={["findings"]} />

      <PageHeader title="Everything we’ve seen in your product">
        {overview.window} · not a queue, and nothing here needs you today
      </PageHeader>

      <SurfaceCard>
        <Stack gap="xs">
          <Text>{coverageSentences(overview.coverage).join(" ")}</Text>
          <Text>{calibrationSentence(overview.calibration)}</Text>
        </Stack>
      </SurfaceCard>

      <Stack gap="lg">
        {FINDING_GROUPS.map((group) => (
          <GroupBlock key={group} group={group} rows={rowsInGroup(overview.rows, group)} />
        ))}
      </Stack>

      <ClosingNote>
        Nothing here needs you today. What&apos;s worth acting on arrives in your channel, one at a
        time. If you find yourself checking this page every morning, tell us — we built it wrong.
      </ClosingNote>
    </Stack>
  );
}
