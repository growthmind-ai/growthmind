import { Stack } from "@mantine/core";

import { RecordingSummary } from "@/components/replay/RecordingSummary";
import { ReplayPlayer } from "@/components/replay/ReplayPlayer";
import { AnchorLink } from "@/components/ui/Links";
import { PageHeader } from "@/components/ui/Page";
import { ROUTES } from "@/lib/routes";

export const dynamic = "force-dynamic";

export default async function ReplayDetailPage({
  params,
}: {
  params: Promise<{ recordingId: string }>;
}) {
  const { recordingId } = await params;

  return (
    <Stack gap="lg">
      <PageHeader title="Recording">
        <AnchorLink href={ROUTES.replays}>Back to all recordings</AnchorLink>
      </PageHeader>

      <RecordingSummary recordingId={recordingId} />

      <ReplayPlayer recordingId={recordingId} />
    </Stack>
  );
}
