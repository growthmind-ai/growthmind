import { Stack, Text } from "@mantine/core";

import { ensureProject } from "@growthmind/db";

import { EmptyState } from "@/components/fixes/EmptyState";
import { FixRows } from "@/components/fixes/FixRows";
import { ClosingNote, PageHeader } from "@/components/ui/Page";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { getDb } from "@/lib/db";
import { readOpenFixes } from "@/lib/fixes/read";
import {
  NOTHING_MEASURED_ACTION,
  NOTHING_MEASURED_BODY,
  NOTHING_MEASURED_HEADING,
  NOTHING_OPENED_ACTION,
  NOTHING_OPENED_BODY,
  NOTHING_OPENED_HEADING,
  ORDERING_LEAD,
  ORDERING_SENTENCE,
  tailSentence,
  truncationSentence,
} from "@/lib/fixes/view";
import { ROUTES } from "@/lib/routes";
import { requireTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

function Header() {
  return (
    <PageHeader title="Open fixes">
      Growth problems in your product that are waiting to be fixed. Your coding assistant reads the
      same list.
    </PageHeader>
  );
}

export default async function FixesPage() {
  const ctx = await requireTenantContext();
  const db = getDb();
  const { projectId } = await ensureProject(db, ctx);

  const view = await readOpenFixes(db, ctx, projectId, new Date());

  if (view.kind !== "rows") {
    const measured = view.kind === "nothing_opened";

    return (
      <Stack gap="lg">
        <Header />
        <EmptyState
          heading={measured ? NOTHING_OPENED_HEADING : NOTHING_MEASURED_HEADING}
          href={measured ? ROUTES.findings : ROUTES.settings}
          action={measured ? NOTHING_OPENED_ACTION : NOTHING_MEASURED_ACTION}
        >
          {measured ? NOTHING_OPENED_BODY : NOTHING_MEASURED_BODY}
        </EmptyState>
      </Stack>
    );
  }

  const truncation = truncationSentence(view.rows.length, view.totalOpen);

  return (
    <Stack gap="lg">
      <Header />

      {/* Painted above the rows rather than under them: it changes how they should be read. */}
      <SurfaceCard>
        <Text>
          <Text span fw={700}>
            {`${ORDERING_LEAD} `}
          </Text>
          {ORDERING_SENTENCE}
        </Text>
        {truncation === null ? null : (
          <Text size="sm" c="dimmed" mt="xs">
            {truncation}
          </Text>
        )}
      </SurfaceCard>

      <FixRows rows={view.rows} />

      <ClosingNote>{tailSentence(view.lateCount, view.rows.length)}</ClosingNote>
    </Stack>
  );
}
