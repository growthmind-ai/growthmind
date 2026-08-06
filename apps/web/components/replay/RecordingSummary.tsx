import { createRecordingSummariesRepo, ensureProject } from "@growthmind/db";
import { logger } from "@growthmind/shared";

import { RecordingSummaryCard } from "@/components/replay/RecordingSummaryCard";
import { getDb } from "@/lib/db";
import { resolveRecordingSourceState } from "@/lib/replay/deps";
import {
  resolveRecordingSummaryStory,
  type RecordingSummaryRead,
} from "@/lib/replay/summary-story";
import { getTenantContext } from "@/lib/tenant";

export async function RecordingSummary({ recordingId }: { readonly recordingId: string }) {
  const ctx = await getTenantContext();
  if (ctx === null) {
    return null;
  }

  const db = getDb();

  let read: RecordingSummaryRead;
  try {
    const { projectId } = await ensureProject(db, ctx);
    const record = await createRecordingSummariesRepo(db, ctx).findFor(projectId, recordingId);

    read =
      record === null
        ? { kind: "no_row", source: await resolveRecordingSourceState(db)({ ctx, projectId }) }
        : { kind: "row", record };
  } catch (error) {
    // The player is the page's main flow; a summary that cannot be read must not take it
    // down with it (D8).
    logger.error("recording summary: the summary for this recording could not be read", { error });
    read = { kind: "read_failed" };
  }

  return <RecordingSummaryCard story={resolveRecordingSummaryStory(read)} />;
}
