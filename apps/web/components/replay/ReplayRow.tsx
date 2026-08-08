"use client";

import { Anchor, Badge, Code, Group, Stack, Text } from "@mantine/core";
import Link from "next/link";

import { fill, type ReplayListRow, type ReplayRowStory } from "@growthmind/core";
import {
  REPLAY_ROW_HELD_HINT,
  REPLAY_ROW_MORE_PAGES_TEMPLATE,
  REPLAY_ROW_UNNARRATED_HINT,
  REPLAY_SIMULATED_BADGE,
} from "@growthmind/shared";

import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { timeOnPage } from "@/lib/replay/label";
import { ROUTES } from "@/lib/routes";

const STARTED_AT_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: "short", timeStyle: "short" };

const NARRATION_HINTS: Record<Exclude<ReplayRowStory["narration"], "written">, string> = {
  held: REPLAY_ROW_HELD_HINT,
  none: REPLAY_ROW_UNNARRATED_HINT,
};

// null is unmeasured and renders nothing; 0 is a measurement and renders its badge. Coalescing
// the two would report a session nobody measured as one where nothing happened.
function count(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 ? value : null;
}

function plural(value: number, noun: string): string {
  return value === 1 ? `1 ${noun}` : `${value} ${noun}s`;
}

export function ReplayRow({ row, story }: { row: ReplayListRow; story: ReplayRowStory }) {
  // Wall-clock counts the tab someone left open; active time does not.
  const time = timeOnPage(row);
  const clicks = count(row.clickCount);
  const typed = count(row.keypressCount);
  const errors = count(row.consoleErrorCount);

  return (
    <Link
      href={`${ROUTES.replays}/${row.recordingId}`}
      style={{ textDecoration: "none", color: "inherit", display: "block" }}
    >
      <SurfaceCard style={row.lane === "real" ? undefined : { borderStyle: "dashed" }}>
        <Group justify="space-between" gap="md" wrap="wrap" align="flex-start">
          <Stack gap={6} style={{ minWidth: 0, flex: 1 }}>
            <Anchor component="span" fw={600} lineClamp={2}>
              {story.title}
            </Anchor>

            {/* Formatted in the viewer's timezone rather than the server's: this is a client
                component, so the pre-render is replaced instead of reconciled. */}
            <Text size="xs" c="dimmed" suppressHydrationWarning>
              {new Date(row.startedAt).toLocaleString(undefined, STARTED_AT_FORMAT)}
              {row.companyDomain === null ? null : ` · ${row.companyDomain}`}
              {time?.total == null ? null : ` · ${time.total} on the page`}
              {story.narration === "written" ? null : ` · ${NARRATION_HINTS[story.narration]}`}
            </Text>

            {/* Every page the write-up saw, not just the one they landed on — the row's title is
                a sentence now, so nothing else on the card carries a path. */}
            {story.pages.length === 0 ? null : (
              <Group gap={4} wrap="wrap">
                {/* Code rather than Badge: a path is a literal, and the badge row to the right
                    is the meta's vocabulary alone. */}
                {story.pages.map((page) => (
                  <Code key={page}>{page}</Code>
                ))}
                {story.morePages === 0 ? null : (
                  <Text size="xs" c="dimmed">
                    {fill(REPLAY_ROW_MORE_PAGES_TEMPLATE, { count: String(story.morePages) })}
                  </Text>
                )}
              </Group>
            )}
          </Stack>

          <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
            {time === null ? null : (
              <Badge variant="light" color="gray">
                {time.badge}
              </Badge>
            )}
            {clicks === null ? null : (
              <Badge variant="light" color="gray">
                {plural(clicks, "click")}
              </Badge>
            )}
            {typed === null ? null : (
              <Badge variant="light" color="gray">
                {plural(typed, "keystroke")}
              </Badge>
            )}
            {errors === null ? null : (
              <Badge variant="light" color="red">
                {plural(errors, "error")}
              </Badge>
            )}
            {row.lane === "simulated" ? (
              <Badge variant="light" color="gray">
                {REPLAY_SIMULATED_BADGE}
              </Badge>
            ) : null}
            {row.exclusionLabel === null ? null : (
              <Badge variant="light" color="gray">
                {row.exclusionLabel}
              </Badge>
            )}
          </Group>
        </Group>
      </SurfaceCard>
    </Link>
  );
}
