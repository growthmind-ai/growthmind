import { ensureProject } from "@growthmind/db";
import { Stack, Text } from "@mantine/core";

import {
  ConnectionBanner,
  DismissalsUnavailable,
  EmptyRecord,
  LaneUnavailable,
  RecordUnavailable,
} from "@/components/channel/ChannelStates";
import { DeliveryRecord } from "@/components/channel/DeliveryRecord";
import { LaneStatus } from "@/components/channel/LaneStatus";
import { readChannelView } from "@/components/channel/read";
import { healthSentence } from "@/components/channel/view";
import { ClosingNote, PageHeader } from "@/components/ui/Page";
import { getDb } from "@/lib/db";
import { requireTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

interface ChannelPageProps {
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

export default async function ChannelPage({ searchParams }: ChannelPageProps) {
  const ctx = await requireTenantContext();

  const db = getDb();
  const { projectId } = await ensureProject(db, ctx);

  // The clock is read once, here, and every derived instant travels as a formatted string —
  // so nothing below re-reads it during a render.
  const view = await readChannelView({ db, ctx, projectId, nowMs: Date.now() });

  const asked = (await searchParams).receipt;
  const receipt = typeof asked === "string" ? asked : null;
  const deepLinkId = view.cards.some((card) => card.id === receipt) ? receipt : null;

  const health = healthSentence(view.counts, view.connection);

  return (
    <Stack gap="lg">
      <PageHeader title="Everything we sent you, and whether it arrived">
        You do not need to read this. It is here so you can check us.
      </PageHeader>

      {health === null ? null : (
        <Text size="sm">
          <Text span fw={700} inherit>
            {health.arrived}
          </Text>{" "}
          {view.counts.total === 1 ? "finding" : "findings"} reached{" "}
          <Text span fw={700} inherit>
            {health.where}
          </Text>
          .{health.extras.length === 0 ? null : ` ${health.extras.join(" ")}`}
        </Text>
      )}

      {view.unread.lane ? <LaneUnavailable /> : null}

      {view.lane === null ? null : (
        <LaneStatus
          line={view.lane}
          history={view.laneHistory}
          historyUnread={view.unread.laneHistory}
        />
      )}

      <ConnectionBanner connection={view.connection} recordUnread={view.unread.record} />

      {/* Three outcomes, not two: a record we could not read is neither a record nor an
          absence, and the empty state is the one sentence it must never borrow. */}
      {view.unread.record ? (
        <RecordUnavailable />
      ) : view.cards.length === 0 ? (
        <EmptyRecord connection={view.connection} />
      ) : (
        <DeliveryRecord cards={view.cards} deepLinkId={deepLinkId} />
      )}

      {view.unread.dismissals ? <DismissalsUnavailable /> : null}

      {view.truncatedAt === null ? null : (
        <Text size="sm" c="dimmed">
          Showing the {view.truncatedAt} most recent. The counts above are over these, not over
          everything we have ever sent.
        </Text>
      )}

      <ClosingNote>
        Nothing on this page needs an answer. The answering happens in Slack, where it arrived. If
        you find yourself opening this page to find out what is new, we have built it wrong — tell
        us.
      </ClosingNote>
    </Stack>
  );
}
