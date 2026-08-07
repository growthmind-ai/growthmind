"use client";

import { Anchor, Badge, Group, Stack, Text } from "@mantine/core";
import Link from "next/link";

import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { recordingLabel, timeOnPage } from "@/lib/replay/label";

export interface ListedRecording {
  readonly recordingId: string;
  readonly startedAt: string | null;
  readonly meta: Record<string, unknown>;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function plural(value: number, noun: string): string {
  return value === 1 ? `1 ${noun}` : `${value} ${noun}s`;
}

export function ReplayRow({ recording }: { recording: ListedRecording }) {
  const label = recordingLabel(recording.meta.start_url, recording.recordingId);

  // Wall-clock counts the tab someone left open; active time does not.
  const time = timeOnPage(recording.meta);
  const clicks = count(recording.meta.click_count);
  const typed = count(recording.meta.keypress_count);
  const errors = count(recording.meta.console_error_count);

  return (
    <Link
      href={`/replays/${recording.recordingId}`}
      style={{ textDecoration: "none", color: "inherit", display: "block" }}
    >
      <SurfaceCard>
        <Group justify="space-between" gap="md" wrap="wrap" align="flex-start">
          <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
            <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
              <Anchor component="span" fw={600} truncate="end">
                {label.text}
              </Anchor>
              {label.source === null ? null : (
                <Badge variant="light" color="gray" size="sm" style={{ flexShrink: 0 }}>
                  from {label.source}
                </Badge>
              )}
            </Group>
            <Text size="xs" c="dimmed">
              {recording.startedAt === null
                ? "Time not recorded"
                : new Date(recording.startedAt).toLocaleString()}
              {time?.total == null ? null : ` · ${time.total} on the page`}
            </Text>
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
          </Group>
        </Group>
      </SurfaceCard>
    </Link>
  );
}
