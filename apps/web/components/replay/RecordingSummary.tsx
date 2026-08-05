import { Stack, Text } from "@mantine/core";

import { createRecordingSummariesRepo, ensureProject } from "@growthmind/db";
import {
  RECORDING_SUMMARY_HELD,
  RECORDING_SUMMARY_PENDING,
  RECORDING_SUMMARY_SOURCE_MESSAGES,
  logger,
} from "@growthmind/shared";

import { Eyebrow } from "@/components/ui/Eyebrow";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { getDb } from "@/lib/db";
import { getTenantContext } from "@/lib/tenant";

function Quiet({ children }: { readonly children: string }) {
  return (
    <SurfaceCard>
      <Stack gap="xs">
        <Eyebrow>What happened</Eyebrow>
        <Text c="dimmed">{children}</Text>
      </Stack>
    </SurfaceCard>
  );
}

export async function RecordingSummary({ recordingId }: { readonly recordingId: string }) {
  const ctx = await getTenantContext();
  if (ctx === null) {
    return null;
  }

  const db = getDb();

  let record;
  try {
    const { projectId } = await ensureProject(db, ctx);
    record = await createRecordingSummariesRepo(db, ctx).findFor(projectId, recordingId);
  } catch (error) {
    // The player is the page's main flow; a summary that cannot be read must not take it
    // down with it (D8).
    logger.error("recording summary: the summary for this recording could not be read", { error });
    return <Quiet>{RECORDING_SUMMARY_PENDING}</Quiet>;
  }

  if (record === null) {
    return <Quiet>{RECORDING_SUMMARY_PENDING}</Quiet>;
  }

  if (record.text.held) {
    return <Quiet>{RECORDING_SUMMARY_HELD}</Quiet>;
  }

  const provenance = RECORDING_SUMMARY_SOURCE_MESSAGES[record.summarySource];

  return (
    <SurfaceCard>
      <Stack gap="xs">
        <Eyebrow>What happened</Eyebrow>
        <Text fw={700}>{record.text.headline}</Text>

        {record.text.context.map((line) => (
          <Text key={line}>{line}</Text>
        ))}

        <Text size="xs" c="dimmed">
          {provenance}
        </Text>
      </Stack>
    </SurfaceCard>
  );
}
