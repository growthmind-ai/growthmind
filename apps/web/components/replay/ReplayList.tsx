"use client";

import { Anchor, Badge, Group, Skeleton, Stack, Text } from "@mantine/core";
import Link from "next/link";
import { useEffect, useState } from "react";

import { REPLAY_LIST_UNREADABLE, REPLAY_NONE_YET } from "@growthmind/shared";

import { SurfaceCard } from "@/components/ui/SurfaceCard";

interface Listed {
  readonly recordingId: string;
  readonly startedAt: string | null;
  readonly meta: Record<string, unknown>;
}

type Load =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly recordings: Listed[]; readonly message: string | null }
  | { readonly state: "failed"; readonly message: string };

function seconds(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  const minutes = Math.floor(value / 60);
  return minutes > 0 ? `${minutes}m ${Math.round(value % 60)}s` : `${Math.round(value)}s`;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
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
        };

        if (!response.ok) {
          setLoad({ state: "failed", message: body.message ?? REPLAY_LIST_UNREADABLE });
          return;
        }

        setLoad({
          state: "ready",
          recordings: body.recordings ?? [],
          message: body.message ?? null,
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

  return (
    <Stack gap="sm">
      {load.recordings.map((recording) => {
        const duration = seconds(recording.meta.recording_duration);
        const errors = count(recording.meta.console_error_count);
        const clicks = count(recording.meta.click_count);
        const startUrl = recording.meta.start_url;

        return (
          <SurfaceCard key={recording.recordingId}>
            <Group justify="space-between" gap="md" wrap="wrap">
              <Stack gap={2}>
                <Anchor component={Link} href={`/replays/${recording.recordingId}`} fw={600}>
                  {typeof startUrl === "string" && startUrl !== ""
                    ? startUrl
                    : recording.recordingId}
                </Anchor>
                <Text size="xs" c="dimmed">
                  {recording.startedAt === null
                    ? "Time not recorded"
                    : new Date(recording.startedAt).toLocaleString()}
                </Text>
              </Stack>

              <Group gap="xs">
                {duration === null ? null : (
                  <Badge variant="light" color="gray">
                    {duration}
                  </Badge>
                )}
                {clicks === null ? null : (
                  <Badge variant="light" color="gray">
                    {clicks} clicks
                  </Badge>
                )}
                {errors === null ? null : (
                  <Badge variant="light" color="red">
                    {errors} errors
                  </Badge>
                )}
              </Group>
            </Group>
          </SurfaceCard>
        );
      })}
    </Stack>
  );
}
