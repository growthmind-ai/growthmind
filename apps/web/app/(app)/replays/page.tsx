import { Stack } from "@mantine/core";

import { ReplayList } from "@/components/replay/ReplayList";
import { PageHeader } from "@/components/ui/Page";

export const dynamic = "force-dynamic";

export default function ReplaysPage() {
  return (
    <Stack gap="lg">
      <PageHeader title="Recordings">
        What people actually did, from the analytics you already connected. Nothing extra to
        install.
      </PageHeader>

      <ReplayList />
    </Stack>
  );
}
