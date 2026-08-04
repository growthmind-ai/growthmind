import type {
  ReplayEventsResult,
  ReplayListRequest,
  ReplayListResult,
  ReplayRecordingSummary,
  ReplaySourceValidation,
  RrwebEvent,
} from "@growthmind/shared";

import type { ReplaySource } from "../replay-source";
import { createRrwebClient } from "./client";
import {
  MAX_EVENT_PAGES,
  MAX_PAGES_PER_RUN,
  PAGE_LIMIT,
  recordingEventsUrl,
  recordingsUrl,
  RRWEB_SOURCE_KIND,
} from "./constants";
import type { RrwebSourceConfig, RrwebSourceDeps } from "./deps";
import { parseEventsPage, parseRecordingsPage } from "./parse";

function withLimit(url: string, limit: number): string {
  const search = new URLSearchParams({ limit: String(limit) });
  return `${url}?${search.toString()}`;
}

export function createRrwebReplaySource(
  config: RrwebSourceConfig,
  deps: RrwebSourceDeps,
): ReplaySource {
  const client = createRrwebClient(config, deps);

  return {
    kind: RRWEB_SOURCE_KIND,

    async validate(): Promise<ReplaySourceValidation> {
      const result = await client.getRecordingsPage(withLimit(recordingsUrl(config.host), 1));
      if (!result.ok) {
        return { ok: false, checkedAt: deps.now(), failure: result.failure };
      }
      return { ok: true, checkedAt: deps.now() };
    },

    async listRecordings(request: ReplayListRequest): Promise<ReplayListResult> {
      const pageCap = Math.min(request.maxPages, MAX_PAGES_PER_RUN);
      const sinceAt = request.sinceAt;

      const recordings: ReplayRecordingSummary[] = [];
      let pagesFetched = 0;
      let droppedMalformed = 0;

      let cursor: string | null = withLimit(recordingsUrl(config.host), PAGE_LIMIT);

      while (cursor !== null) {
        if (pagesFetched >= pageCap) {
          return {
            ok: true,
            recordings,
            stop: "page_cap",
            resumeCursor: cursor,
            pagesFetched,
            droppedMalformed,
            eventsReceived: 0,
          };
        }

        const response = await client.getRecordingsPage(cursor);
        if (!response.ok) {
          return {
            ok: false,
            failure: response.failure,
            partialRecordings: recordings,
            pagesFetched,
            droppedMalformed,
            eventsReceived: 0,
          };
        }
        pagesFetched += 1;

        const page = parseRecordingsPage(response.value, config.host);
        droppedMalformed += page.droppedMalformed;
        for (const recording of page.recordings) {
          recordings.push(recording);
        }

        // Pages arrive newest-first, so the last item on a page is the oldest seen so far.
        if (sinceAt !== null) {
          const oldestOnPage = page.recordings[page.recordings.length - 1];
          if (
            oldestOnPage !== undefined &&
            oldestOnPage.startedAt !== null &&
            oldestOnPage.startedAt.getTime() <= sinceAt.getTime()
          ) {
            return {
              ok: true,
              recordings,
              stop: "watermark",
              resumeCursor: null,
              pagesFetched,
              droppedMalformed,
              eventsReceived: 0,
            };
          }
        }

        cursor = page.next;
      }

      return {
        ok: true,
        recordings,
        stop: "exhausted",
        resumeCursor: null,
        pagesFetched,
        droppedMalformed,
        eventsReceived: 0,
      };
    },

    async pullEvents(recordingId: string): Promise<ReplayEventsResult> {
      const events: RrwebEvent[] = [];
      let pagesFetched = 0;
      let droppedMalformed = 0;

      let cursor: string | null = withLimit(
        recordingEventsUrl(config.host, recordingId),
        PAGE_LIMIT,
      );

      while (cursor !== null && pagesFetched < MAX_EVENT_PAGES) {
        const response = await client.getEventsPage(cursor);
        if (!response.ok) {
          return {
            ok: false,
            failure: response.failure,
            partialEvents: events,
            pagesFetched,
            droppedMalformed,
            eventsReceived: events.length,
          };
        }
        pagesFetched += 1;

        const page = parseEventsPage(response.value, config.host);
        droppedMalformed += page.droppedMalformed;
        for (const event of page.events) {
          events.push(event);
        }

        cursor = page.next;
      }

      return {
        ok: true,
        events,
        pagesFetched,
        droppedMalformed,
        eventsReceived: events.length,
      };
    },
  };
}
