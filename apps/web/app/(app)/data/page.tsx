import { Group, Stack } from "@mantine/core";

import { createSessionSetAsideService } from "@growthmind/db";
import { logger, type TenantContext } from "@growthmind/shared";

import { DataGroups } from "@/components/data/DataGroups";
import {
  dataPageText,
  DATA_PAGE_CLOSING,
  DATA_PAGE_LEDE,
  DATA_PAGE_TITLE,
  type CountsView,
} from "@/components/data/statements";
import { CopyBlock } from "@/components/ui/CopyBlock";
import { ClosingNote, PageHeader } from "@/components/ui/Page";
import { getDb } from "@/lib/db";
import { requireTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

// The rules are the page and the counts are corroboration, so a count that cannot be read
// degrades to a stated rule with nothing to press rather than taking the disclosure down.
async function readCounts(ctx: TenantContext): Promise<CountsView | null> {
  try {
    return await createSessionSetAsideService(getDb(), ctx).read();
  } catch (error) {
    logger.error("data page: the set-aside count could not be read", { error });
    return null;
  }
}

export default async function DataPage() {
  const ctx = await requireTenantContext();
  const counts = await readCounts(ctx);

  return (
    <Stack gap="lg">
      <PageHeader title={DATA_PAGE_TITLE}>{DATA_PAGE_LEDE}</PageHeader>

      <DataGroups counts={counts} />

      <Group>
        <CopyBlock value={dataPageText(counts)} label="Copy as text" />
      </Group>

      <ClosingNote>{DATA_PAGE_CLOSING}</ClosingNote>
    </Stack>
  );
}
