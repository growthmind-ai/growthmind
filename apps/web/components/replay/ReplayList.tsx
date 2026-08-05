"use client";

import { Skeleton, Stack, Text } from "@mantine/core";
import { useEffect, useState } from "react";

import { REPLAY_LIST_TRUNCATED, REPLAY_LIST_UNREADABLE, REPLAY_NONE_YET } from "@growthmind/shared";

import { ReplayRow, type ListedRecording } from "@/components/replay/ReplayRow";

type Load =
  | { readonly state: "loading" }
  | {
      readonly state: "ready";
      readonly recordings: ListedRecording[];
      readonly message: string | null;
      readonly truncated: boolean;
    }
  | { readonly state: "failed"; readonly message: string };

export function ReplayList() {
  const [load, setLoad] = useState<Load>({ state: "loading" });

  useEffect(() => {
    const abort = new AbortController();

    async function read(): Promise<void> {
      try {
        const response = await fetch("/api/replays", { signal: abort.signal });
        const body = (await response.json()) as {
          recordings?: ListedRecording[];
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
      {load.recordings.map((recording) => (
        <ReplayRow key={recording.recordingId} recording={recording} />
      ))}

      {note === null ? null : (
        <Text size="sm" c="dimmed">
          {note}
        </Text>
      )}
    </Stack>
  );
}
