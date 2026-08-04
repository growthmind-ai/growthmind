import { Box, Stack, Text } from "@mantine/core";
import Link from "next/link";

import { StartInChannel } from "@/components/preview/StartInChannel";
import classes from "@/components/preview/preview.module.css";
import { ClosingNote, PageHeader } from "@/components/ui/Page";
import { experimentPath } from "@/lib/paths";
import { readVerdicts } from "@/lib/preview/readers";
import { outcomeWordOf } from "@/lib/preview/summaries";
import type { VerdictView } from "@/lib/preview/types";

export const dynamic = "force-dynamic";

function Row({ verdict }: { readonly verdict: VerdictView }) {
  return (
    <Link href={experimentPath(verdict.findingId)} className={classes.rowLink}>
      <Text ff="monospace" size="xs" fw={700} ta="right" style={{ lineHeight: 1.6 }}>
        {outcomeWordOf(verdict.verdict)}
      </Text>
      <Box style={{ minWidth: 0 }}>
        <Text fw={600} style={{ lineHeight: 1.4 }}>
          {verdict.title}
        </Text>
        <Text size="sm" c="dimmed" style={{ lineHeight: 1.45 }}>
          {verdict.measurement}
        </Text>
      </Box>
      <Text ff="monospace" size="xs" c="dimmed">
        {verdict.measuredOn.replace(/^On\s+/u, "").replace(/\s+we measured$/u, "")}
      </Text>
    </Link>
  );
}

export default function ExperimentsPage() {
  const verdicts = readVerdicts();

  if (verdicts.length === 0) {
    return (
      <StartInChannel title="Nothing has been read out yet">
        A verdict appears here once a fix reaches its readout date.
      </StartInChannel>
    );
  }

  return (
    <Stack gap="lg">
      <PageHeader title="What we said would happen, and what did">
        Every call, kept or killed, with the criterion that was set before it ran.
      </PageHeader>

      <Stack gap={0}>
        {verdicts.map((verdict) => (
          <Row key={verdict.findingId} verdict={verdict} />
        ))}
      </Stack>

      <ClosingNote>
        The bar was set before the measurement, and it is on the page beside it. Nothing here was
        scored after the fact.
      </ClosingNote>
    </Stack>
  );
}
