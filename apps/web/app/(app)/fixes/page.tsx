import { Stack, Text } from "@mantine/core";

import { ensureProject } from "@growthmind/db";

import { EmptyState } from "@/components/fixes/EmptyState";
import { FixRows } from "@/components/fixes/FixRows";
import { ClosingNote, PageHeader } from "@/components/ui/Page";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { getDb } from "@/lib/db";
import { readOpenFixes } from "@/lib/fixes/read";
import {
  LIST_UNAVAILABLE_BODY,
  LIST_UNAVAILABLE_HEADING,
  NOTHING_MEASURED_ACTION,
  NOTHING_MEASURED_BODY,
  NOTHING_MEASURED_HEADING,
  NOTHING_OPENED_ACTION,
  NOTHING_OPENED_BODY,
  NOTHING_OPENED_HEADING,
  NOTHING_OPENED_UNCHECKED_ACTION,
  NOTHING_OPENED_UNCHECKED_BODY,
  NOTHING_OPENED_UNCHECKED_HEADING,
  ORDERING_LEAD,
  ORDERING_SENTENCE,
  tailSentence,
  truncationSentence,
} from "@/lib/fixes/view";
import { ROUTES } from "@/lib/routes";
import { requireTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

interface EmptyCopy {
  readonly heading: string;
  readonly body: string;
  readonly href?: string;
  readonly action?: string;
}

// Four ways this page can hold no rows, and only three of them are a statement about the
// workspace. The fourth carries no action because it is ours to fix, not the reader's.
const WITHOUT_ROWS: Readonly<
  Record<
    "nothing_opened" | "nothing_measured" | "nothing_opened_unchecked" | "unavailable",
    EmptyCopy
  >
> = {
  nothing_opened: {
    heading: NOTHING_OPENED_HEADING,
    body: NOTHING_OPENED_BODY,
    href: ROUTES.findings,
    action: NOTHING_OPENED_ACTION,
  },
  nothing_measured: {
    heading: NOTHING_MEASURED_HEADING,
    body: NOTHING_MEASURED_BODY,
    href: ROUTES.settings,
    action: NOTHING_MEASURED_ACTION,
  },
  nothing_opened_unchecked: {
    heading: NOTHING_OPENED_UNCHECKED_HEADING,
    body: NOTHING_OPENED_UNCHECKED_BODY,
    href: ROUTES.settings,
    action: NOTHING_OPENED_UNCHECKED_ACTION,
  },
  unavailable: { heading: LIST_UNAVAILABLE_HEADING, body: LIST_UNAVAILABLE_BODY },
};

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
    const empty = WITHOUT_ROWS[view.kind];

    return (
      <Stack gap="lg">
        <Header />
        <EmptyState heading={empty.heading} href={empty.href} action={empty.action}>
          {empty.body}
        </EmptyState>
      </Stack>
    );
  }

  const truncation = truncationSentence(view.rows.length, view.totalOpen);
  const tail = tailSentence(view.lateCount, view.rows.length);

  // Once every row is past its date, "no answer" in bold is the whole page and the sentence
  // that explains why sits in the faintest text under the fold. It moves up to the card the
  // eye already reads first rather than being softened where it is.
  const allLate = view.lateCount > 0 && view.lateCount === view.rows.length;

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
        {allLate ? <Text mt="sm">{tail}</Text> : null}
      </SurfaceCard>

      <FixRows rows={view.rows} />

      {allLate ? null : <ClosingNote>{tail}</ClosingNote>}
    </Stack>
  );
}
