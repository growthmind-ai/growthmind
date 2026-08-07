import { Stack } from "@mantine/core";

import { REPLAY_FILTER_BAR_LABEL, replayFiltersOf } from "@growthmind/shared";
import type { ReplaySearchParams } from "@growthmind/shared";

import { replayDescriptors } from "@/components/replay/filters/descriptors";
import { ReplayListBody } from "@/components/replay/ReplayListBody";
import { ReplayScreen } from "@/components/replay/ReplayScreen";
import { PageHeader } from "@/components/ui/Page";
import { resolveReplayDeps } from "@/lib/replay/deps";
import { readReplayScreen } from "@/lib/replay/read";

export const dynamic = "force-dynamic";

interface ReplaysPageProps {
  readonly searchParams: Promise<ReplaySearchParams>;
}

// The list and the pills are both rendered here, from one parse and one read, so a pasted
// filtered URL paints its filtered state in the first byte with no client fetch to wait on.
export default async function ReplaysPage({ searchParams }: ReplaysPageProps) {
  const filters = replayFiltersOf(await searchParams);

  const deps = resolveReplayDeps();
  const screen = await readReplayScreen(deps, await deps.tenant(), filters);

  const body = <ReplayListBody screen={screen} filters={filters} />;

  return (
    <Stack gap="lg">
      <PageHeader title="Replays">
        What people actually did, from the analytics you already connected. Nothing extra to
        install.
      </PageHeader>

      {screen.kind === "screen" ? (
        <ReplayScreen
          descriptors={replayDescriptors(screen.facets, filters)}
          filters={filters}
          label={REPLAY_FILTER_BAR_LABEL}
        >
          {body}
        </ReplayScreen>
      ) : (
        body
      )}
    </Stack>
  );
}
