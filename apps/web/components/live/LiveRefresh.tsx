"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { LIVE_EVENT_NAME, LIVE_STREAM_PATH, type LiveTopic } from "@growthmind/shared";

function topicOf(data: string): string | null {
  try {
    const parsed: unknown = JSON.parse(data);
    const topic = (parsed as { topic?: unknown }).topic;
    return typeof topic === "string" ? topic : null;
  } catch {
    return null;
  }
}

// One open stream, told when something changed. Nothing here runs on a timer: EventSource
// reconnects on its own when a connection drops, and every page renders from the database on
// load, so a change that happened while the stream was down is already on screen by the time
// it comes back (D4).
export function useLiveTopics(topics: readonly LiveTopic[], onChange: (topic: LiveTopic) => void) {
  // The handler is read through a ref so a caller passing an inline function does not tear
  // the stream down and open a new one on every render.
  const handler = useRef(onChange);
  handler.current = onChange;

  const wanted = topics.join(",");

  useEffect(() => {
    const listening = new Set(wanted.split(","));
    const source = new EventSource(LIVE_STREAM_PATH);

    const take = (event: MessageEvent<string>): void => {
      const topic = topicOf(event.data);
      if (topic !== null && listening.has(topic)) handler.current(topic as LiveTopic);
    };

    source.addEventListener(LIVE_EVENT_NAME, take);

    return () => {
      source.removeEventListener(LIVE_EVENT_NAME, take);
      source.close();
    };
  }, [wanted]);
}

interface LiveRefreshProps {
  // Which changes this page cares about. A page re-rendering on every change in the
  // organization would refetch itself for things it does not show.
  readonly topics: readonly LiveTopic[];
}

// Mounted beside a server-rendered page: the server holds the truth, so hearing that it
// changed is enough — `router.refresh()` re-renders it from the database. There is no client
// cache here to invalidate.
export function LiveRefresh({ topics }: LiveRefreshProps) {
  const router = useRouter();

  useLiveTopics(topics, () => {
    router.refresh();
  });

  return null;
}
