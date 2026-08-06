import { Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";

import {
  RECORDING_SUMMARY_HELD,
  RECORDING_SUMMARY_NOT_CONFIGURED,
  RECORDING_SUMMARY_NO_SOURCE,
  RECORDING_SUMMARY_NO_SOURCE_LINK,
  RECORDING_SUMMARY_PARTIAL,
  RECORDING_SUMMARY_PENDING,
  RECORDING_SUMMARY_READ_FAILED,
  RECORDING_SUMMARY_SOURCE_MESSAGES,
} from "@growthmind/shared";

import { Eyebrow } from "@/components/ui/Eyebrow";
import { AnchorLink } from "@/components/ui/Links";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import type { RecordingSummaryStory } from "@/lib/replay/summary-story";
import { ROUTES } from "@/lib/routes";

function Quiet({ children }: { readonly children: ReactNode }) {
  return (
    <SurfaceCard>
      <Stack gap="xs">
        <Eyebrow>What happened</Eyebrow>
        {children}
      </Stack>
    </SurfaceCard>
  );
}

function Sentence({ children }: { readonly children: string }) {
  return <Text c="dimmed">{children}</Text>;
}

export function RecordingSummaryCard({ story }: { readonly story: RecordingSummaryStory }) {
  switch (story.kind) {
    case "queued":
      return (
        <Quiet>
          <Sentence>{RECORDING_SUMMARY_PENDING}</Sentence>
        </Quiet>
      );

    case "no_source":
      return (
        <Quiet>
          <Sentence>{RECORDING_SUMMARY_NO_SOURCE}</Sentence>
          <AnchorLink href={ROUTES.settings} size="sm">
            {RECORDING_SUMMARY_NO_SOURCE_LINK}
          </AnchorLink>
        </Quiet>
      );

    // No link: this install has no key at all, and /settings cannot supply one.
    case "not_configured":
      return (
        <Quiet>
          <Sentence>{RECORDING_SUMMARY_NOT_CONFIGURED}</Sentence>
        </Quiet>
      );

    case "read_failed":
      return (
        <Quiet>
          <Sentence>{RECORDING_SUMMARY_READ_FAILED}</Sentence>
        </Quiet>
      );

    case "held":
      return (
        <Quiet>
          <Sentence>{RECORDING_SUMMARY_HELD}</Sentence>
        </Quiet>
      );

    case "resolved":
      return (
        <Quiet>
          <Text fw={700}>{story.headline}</Text>

          {/* By position: the model can write the same sentence twice, and keying by text
              collapses the pair into one line. Nothing reorders or filters this list. */}
          {story.context.map((line, position) => (
            // oxlint-disable-next-line react/no-array-index-key
            <Text key={position}>{line}</Text>
          ))}

          <Text size="xs" c="dimmed">
            {RECORDING_SUMMARY_SOURCE_MESSAGES[story.summarySource]}
          </Text>

          {story.partial ? (
            <Text size="xs" c="dimmed">
              {RECORDING_SUMMARY_PARTIAL}
            </Text>
          ) : null}
        </Quiet>
      );

    // A seventh kind would otherwise widen the return to `undefined` and the card would
    // vanish with nothing failing. Read_failed, not pending: this arm is what ships the day
    // someone adds a case, so it claims the least.
    default:
      story satisfies never;
      return (
        <Quiet>
          <Sentence>{RECORDING_SUMMARY_READ_FAILED}</Sentence>
        </Quiet>
      );
  }
}
