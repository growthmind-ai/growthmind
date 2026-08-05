"use client";

import { Anchor, Badge, Group, Skeleton, Stack, Text } from "@mantine/core";
import Link from "next/link";
import { useEffect, useState } from "react";

import { REPLAY_LIST_TRUNCATED, REPLAY_LIST_UNREADABLE, REPLAY_NONE_YET } from "@growthmind/shared";

import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { recordingLabel, timeOnPage } from "@/lib/replay/label";

interface Listed {
  readonly recordingId: string;
  readonly startedAt: string | null;
  readonly meta: Record<string, unknown>;
}

type Load =
  | { readonly state: "loading" }
  | {
      readonly state: "ready";
      readonly recordings: Listed[];
      readonly message: string | null;
      readonly truncated: boolean;
    }
  | { readonly state: "failed"; readonly message: string };

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function plural(value: number, noun: string): string {
  return value === 1 ? `1 ${noun}` : `${value} ${noun}s`;
}

export function ReplayList() {
  const [load, setLoad] = useState<Load>({ state: "loading" });

  useEffect(() => {
    const abort = new AbortController();

    async function read(): Promise<void> {
      try {
        const response = await fetch("/api/replays", { signal: abort.signal });
        const body = (await response.json()) as {
          recordings?: Listed[];
          message?: string;
          truncated?: boolean;
        };

        if (!response.ok) {
          setLoad({ state: "failed", message: body.message ?? REPLAY_LIST_UNREADABLE });
          return;
        }

        setLoad({
          state: "ready",
          recordings: body.recordings ?? [],
          message: body.message ?? null,
          truncated: body.truncated === true,
        });
      } catch {
        if (abort.signal.aborted) return;
        setLoad({ state: "failed", message: REPLAY_LIST_UNREADABLE });
      }
    }

    void read();
    return () => abort.abort();
  }, []);

  if (load.state === "loading") {
    return (
      <Stack gap="sm">
        <Skeleton height={72} radius="md" />
        <Skeleton height={72} radius="md" />
      </Stack>
    );
  }

  if (load.state === "failed") {
    return <Text c="dimmed">{load.message}</Text>;
  }

  // The not-connected case arrives here too, carrying its own sentence: an empty list
  // with a reason beats an error page for a state that is simply "not set up yet".
  if (load.recordings.length === 0) {
    return <Text c="dimmed">{load.message ?? REPLAY_NONE_YET}</Text>;
  }

  // A shortened list without its sentence reads as "that is all there is". A partial
  // failure outranks the page cap: both stop the list early, one of them is worse.
  const note = load.message ?? (load.truncated ? REPLAY_LIST_TRUNCATED : null);

  return (
    <Stack gap="sm">
      {load.recordings.map((recording) => {
        const label = recordingLabel(recording.meta.start_url, recording.recordingId);

        // Wall-clock counts the tab someone left open; active time does not.
        const time = timeOnPage(recording.meta);
        const clicks = count(recording.meta.click_count);
        const typed = count(recording.meta.keypress_count);
        const errors = count(recording.meta.console_error_count);

        return (
          <SurfaceCard key={recording.recordingId}>
            <Group justify="space-between" gap="md" wrap="wrap" align="flex-start">
              <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
                <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                  <Anchor
                    component={Link}
                    href={`/replays/${recording.recordingId}`}
                    fw={600}
                    truncate="end"
                  >
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
        );
      })}

      {note === null ? null : (
        <Text size="sm" c="dimmed">
          {note}
        </Text>
      )}
    </Stack>
  );
}
