import { Stack, Text } from "@mantine/core";

import { StartInChannel } from "@/components/preview/StartInChannel";
import { ClosingNote, PageHeader } from "@/components/ui/Page";
import { ListRow } from "@/components/ui/ListRow";
import { fixPath } from "@/lib/paths";
import { readFixes } from "@/lib/preview/readers";
import { checkSummary, tallyChecks } from "@/lib/preview/summaries";
import type { FixView } from "@/lib/preview/types";

export const dynamic = "force-dynamic";

function Row({ fix }: { readonly fix: FixView }) {
  const tally = tallyChecks(fix.checks);

  return (
    <ListRow
      href={fixPath(fix.findingId)}
      leading={
        <Text ff="monospace" fw={700} ta="right" style={{ lineHeight: 1.3 }}>
          {tally.confirmed}
          <Text span ff="monospace" size="xs" fw={400} c="dimmed">
            /{fix.checks.length}
          </Text>
        </Text>
      }
      heading={fix.title}
      detail={`${checkSummary(tally)} · sent to ${fix.dispatchedTo} on ${fix.dispatchedOn}`}
      trailing={`reads out ${fix.readoutDue}`}
    />
  );
}

export default function FixesPage() {
  const fixes = readFixes();

  if (fixes.length === 0) {
    return (
      <StartInChannel title="Nothing has been sent to your agent yet">
        A fix appears here once you ask for one.
      </StartInChannel>
    );
  }

  return (
    <Stack gap="lg">
      <PageHeader title="Fixes we sent to your agent">
        What was asked for, what came back, and what we checked rather than took on trust.
      </PageHeader>

      <Stack gap={0}>
        {fixes.map((fix) => (
          <Row key={fix.id} fix={fix} />
        ))}
      </Stack>

      <ClosingNote>
        A tick is something we confirmed ourselves. Your agent reporting success is not a tick.
      </ClosingNote>
    </Stack>
  );
}
