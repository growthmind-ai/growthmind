"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { LIVE_EVENT_NAME, LIVE_STREAM_PATH, type LiveTopic } from "@growthmind/shared";

// A narration pass publishes once per recording, so one topic can arrive a dozen times in a
// second. Trailing edge: the last event of a burst is the one worth re-reading for.
const COALESCE_MS = 250;

function topicOf(data: string): string | null {
  try {
    const parsed: unknown = JSON.parse(data);
    const topic = (parsed as { topic?: unknown }).topic;
    return typeof topic === "string" ? topic : null;
  } catch {
    return null;
  }
}

// One open stream, told when something changed. Nothing here asks the server: the only timer
// coalesces a burst. A change published while the stream was down reaches no listener and the
// stream carries no id to replay from, so every reconnect after the first re-fires (D4).
export function useLiveTopics(
  topics: readonly LiveTopic[],
  onChange: (topic: LiveTopic) => void,
  onConnection?: (connected: boolean) => void,
) {
  // Read through a ref so an inline handler does not tear the stream down on every render.
  const handler = useRef(onChange);
  handler.current = onChange;

  const connection = useRef(onConnection);
  connection.current = onConnection;

  const wanted = topics.join(",");

  useEffect(() => {
    const listening = new Set(wanted.split(",").filter((topic) => topic !== ""));
    const source = new EventSource(LIVE_STREAM_PATH);
    const pending = new Map<string, ReturnType<typeof setTimeout>>();

    const fire = (topic: string): void => {
      const queued = pending.get(topic);
      if (queued !== undefined) clearTimeout(queued);
      pending.set(
        topic,
        setTimeout(() => {
          pending.delete(topic);
          handler.current(topic as LiveTopic);
        }, COALESCE_MS),
      );
    };

    const take = (event: MessageEvent<string>): void => {
      const topic = topicOf(event.data);
      if (topic !== null && listening.has(topic)) fire(topic);
    };

    let connected = false;
    const opened = (): void => {
      if (connected) for (const topic of listening) fire(topic);
      connected = true;
      connection.current?.(true);
    };

    // EventSource reconnects on its own, so this is "not hearing right now", never a
    // terminal failure — and it is the only signal that the screen may be behind.
    const dropped = (): void => {
      if (source.readyState !== EventSource.OPEN) connection.current?.(false);
    };

    source.addEventListener(LIVE_EVENT_NAME, take);
    source.addEventListener("open", opened);
    source.addEventListener("error", dropped);

    return () => {
      for (const queued of pending.values()) clearTimeout(queued);
      pending.clear();
      source.removeEventListener(LIVE_EVENT_NAME, take);
      source.removeEventListener("open", opened);
      source.removeEventListener("error", dropped);
      source.close();
    };
  }, [wanted]);
}

interface LiveRefreshProps {
  // Only the changes this page shows; anything wider refetches for things it does not.
  readonly topics: readonly LiveTopic[];

  // For a screen that has to say when it may be behind. Omitted everywhere the answer is
  // "it re-reads on load anyway", which is most places.
  readonly onConnection?: (connected: boolean) => void;
}

// The server holds the truth, so hearing it changed is enough: `router.refresh()` re-reads it.
export function LiveRefresh({ topics, onConnection }: LiveRefreshProps) {
  const router = useRouter();

  useLiveTopics(
    topics,
    () => {
      router.refresh();
    },
    onConnection,
  );

  return null;
}
