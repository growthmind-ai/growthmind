import { Anchor, Stack, Text } from "@mantine/core";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  COMPANY_SESSION_NO_RECORDING,
  RECORDING_SUMMARY_HELD,
  RECORDING_SUMMARY_PENDING,
} from "@growthmind/shared";

import { SurfaceCard } from "@/components/ui/SurfaceCard";
import type { CompanySessionDTO } from "@/lib/companies/dto";
import { truncate } from "@/lib/replay/label";

function storyLine(story: CompanySessionDTO["story"]): ReactNode {
  if (story.kind === "resolved") {
    return (
      <>
        <Text fw={700}>{story.headline}</Text>
        {story.context.map((line) => (
          <Text key={line}>{line}</Text>
        ))}
      </>
    );
  }

  if (story.kind === "held") {
    return <Text c="dimmed">{RECORDING_SUMMARY_HELD}</Text>;
  }

  if (story.kind === "pending") {
    return <Text c="dimmed">{RECORDING_SUMMARY_PENDING}</Text>;
  }

  return <Text c="dimmed">{COMPANY_SESSION_NO_RECORDING}</Text>;
}

export function CompanySessionRow({ session }: { readonly session: CompanySessionDTO }) {
  return (
    <SurfaceCard>
      <Stack gap="xs">
        <Text size="xs" c="dimmed">
          {new Date(session.startedAt).toLocaleString()}
          {session.entryUrlPath === null ? null : ` · ${truncate(session.entryUrlPath)}`}
        </Text>

        {storyLine(session.story)}

        {session.recordingId === null ? null : (
          <Anchor component={Link} href={`/replays/${session.recordingId}`} size="sm">
            Watch this recording
          </Anchor>
        )}
      </Stack>
    </SurfaceCard>
  );
}
