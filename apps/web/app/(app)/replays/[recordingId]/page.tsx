import { Anchor, Stack } from "@mantine/core";
import Link from "next/link";

import { ReplayPlayer } from "@/components/replay/ReplayPlayer";
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
        <Anchor component={Link} href={ROUTES.replays}>
          Back to all recordings
        </Anchor>
      </PageHeader>

      <ReplayPlayer recordingId={recordingId} />
    </Stack>
  );
}
