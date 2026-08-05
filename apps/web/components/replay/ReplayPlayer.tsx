"use client";

import { Alert, Box, Skeleton, Text } from "@mantine/core";
import { useEffect, useRef, useState } from "react";

import { REPLAY_EMPTY_RECORDING, REPLAY_LIST_UNREADABLE } from "@growthmind/shared";

import "rrweb-player/dist/style.css";

interface ReplayPlayerProps {
  readonly recordingId: string;
}

type Load =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly events: unknown[]; readonly message: string | null }
  | { readonly state: "failed"; readonly message: string };

// rrweb needs at least a full snapshot and one thing after it before there is any motion
// to show; below that the player renders a blank frame and looks broken rather than empty.
const MIN_PLAYABLE_EVENTS = 2;

export function ReplayPlayer({ recordingId }: ReplayPlayerProps) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const abort = new AbortController();

    async function read(): Promise<void> {
      try {
        const response = await fetch(`/api/replays/${encodeURIComponent(recordingId)}/events`, {
          signal: abort.signal,
        });
        const body = (await response.json()) as { events?: unknown[]; message?: string };

        if (!response.ok) {
          setLoad({ state: "failed", message: body.message ?? REPLAY_LIST_UNREADABLE });
          return;
        }

        setLoad({
          state: "ready",
          events: body.events ?? [],
          message: body.message ?? null,
        });
      } catch {
        if (abort.signal.aborted) return;
        setLoad({ state: "failed", message: REPLAY_LIST_UNREADABLE });
      }
    }

    void read();
    return () => abort.abort();
  }, [recordingId]);

  useEffect(() => {
    const mount = mountRef.current;
    if (load.state !== "ready" || mount === null || load.events.length < MIN_PLAYABLE_EVENTS) {
      return;
    }

    let player: { $destroy?: () => void } | null = null;

    // Imported here rather than at module scope: the package reaches for `document` as it
    // initialises, so a top-level import breaks the server render of any page holding this.
    void import("rrweb-player").then(({ default: RrwebPlayer }) => {
      if (mountRef.current === null) return;
      player = new RrwebPlayer({
        target: mount,
        props: { events: load.events as never, autoPlay: false, width: mount.clientWidth },
      }) as { $destroy?: () => void };
    });

    return () => {
      player?.$destroy?.();
      mount.replaceChildren();
    };
  }, [load]);

  if (load.state === "loading") {
    return <Skeleton height={480} radius="md" />;
  }

  if (load.state === "failed") {
    return (
      <Alert color="red" variant="light">
        {load.message}
      </Alert>
    );
  }

  if (load.events.length < MIN_PLAYABLE_EVENTS) {
    return <Text c="dimmed">{REPLAY_EMPTY_RECORDING}</Text>;
  }

  return (
    <>
      {load.message === null ? null : (
        <Alert color="yellow" variant="light" mb="sm">
          {load.message}
        </Alert>
      )}
      <Box ref={mountRef} />
    </>
  );
}
