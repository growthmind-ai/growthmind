import type {
  ReplayEventsResult,
  ReplayListRequest,
  ReplayListResult,
  ReplayRecordingSummary,
  ReplaySourceValidation,
  RrwebEvent,
} from "@growthmind/shared";

import type { ReplayPullOptions, ReplaySource } from "../replay-source";
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

// A stored cursor is a page URL, so it is honoured only when it still addresses the host this
// connection is configured for — a moved or tampered host restarts the recording instead.
function resumeUrl(host: string, resumeFrom: string | null | undefined): string | null {
  if (resumeFrom === null || resumeFrom === undefined) return null;

  return resumeFrom.startsWith(`${host.replace(/\/+$/, "")}/`) ? resumeFrom : null;
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
          const isAtOrBeforeWatermark =
            sinceAt !== null &&
            recording.startedAt !== null &&
            recording.startedAt.getTime() <= sinceAt.getTime();
          if (!isAtOrBeforeWatermark) {
            recordings.push(recording);
          }
        }

        // Recording order (newest-first vs oldest-first) is UNVERIFIED — see
        // scripts/spikes/notes/rrweb-read-api.md. The stop below only fires when a
        // page's first item is after sinceAt and its last is at-or-before it; an
        // oldest-first page that is entirely stale cannot produce that shape, so a
        // reversed order falls through to MAX_PAGES_PER_RUN's stop: "page_cap"
        // rather than a false "watermark" that would silently drop every later page.
        if (sinceAt !== null) {
          const firstOnPage = page.recordings[0];
          const lastOnPage = page.recordings[page.recordings.length - 1];
          const crossesWatermark =
            firstOnPage !== undefined &&
            firstOnPage.startedAt !== null &&
            firstOnPage.startedAt.getTime() > sinceAt.getTime() &&
            lastOnPage !== undefined &&
            lastOnPage.startedAt !== null &&
            lastOnPage.startedAt.getTime() <= sinceAt.getTime();
          if (crossesWatermark) {
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

    // bytesReceived is 0 on every arm below: this source reads parsed JSON pages, so it has
    // no body size to report and a number here would be an invented one.
    async pullEvents(
      recordingId: string,
      options?: ReplayPullOptions,
    ): Promise<ReplayEventsResult> {
      const events: RrwebEvent[] = [];
      let pagesFetched = 0;
      let droppedMalformed = 0;

      const firstPage = withLimit(recordingEventsUrl(config.host, recordingId), PAGE_LIMIT);
      let cursor: string | null = resumeUrl(config.host, options?.resumeFrom) ?? firstPage;

      while (cursor !== null) {
        if (pagesFetched >= MAX_EVENT_PAGES) {
          return {
            ok: true,
            events,
            stop: "page_cap",
            resumeCursor: cursor,
            bytesReceived: 0,
            pagesFetched,
            droppedMalformed,
            eventsReceived: events.length,
          };
        }

        const response = await client.getEventsPage(cursor);
        if (!response.ok) {
          return {
            ok: false,
            failure: response.failure,
            partialEvents: events,
            resumeCursor: cursor,
            bytesReceived: 0,
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
        stop: "exhausted",
        resumeCursor: null,
        bytesReceived: 0,
        pagesFetched,
        droppedMalformed,
        eventsReceived: events.length,
      };
    },
  };
}
