import type {
  ReplayEventsResult,
  ReplayFailure,
  ReplayFailureCode,
  ReplayListRequest,
  ReplayListResult,
  ReplayRecordingSummary,
  ReplaySourceValidation,
  SourceFailure,
  SourceFailureCode,
} from "@growthmind/shared";
import { REPLAY_FAILURE_MESSAGES } from "@growthmind/shared";

import { scrubSecrets } from "../http/scrub";
import type { ReplaySource } from "../replay-source";
import { MAX_PAGES_PER_RUN, POSTHOG_REPLAY_SOURCE_KIND, RECORDINGS_PAGE_LIMIT } from "./constants";
import type { PostHogSourceConfig, PostHogSourceDeps } from "./deps";
import { createPostHogReplayClient } from "./replay-client";
import {
  blobKeyRange,
  parseRecordingsPage,
  parseSnapshotJsonl,
  parseSnapshotSources,
} from "./replay-parse";

type ReplayFailureContext = "recordings" | "snapshots";

// The client's mapFailure answers every 404 as project_not_found, because it has no
// way to know which resource was being asked for. The caller does: a 404 against the
// recordings list means the project id is wrong, a 404 against one recording's
// snapshots means that recording is gone. Only that distinction has no equivalent on
// the session-source SourceFailureCode, so it is drawn here rather than in the client.
function toReplayFailureCode(
  code: SourceFailureCode,
  context: ReplayFailureContext,
): ReplayFailureCode {
  if (code === "project_not_found") {
    return context === "snapshots" ? "recording_not_found" : "misconfigured";
  }
  return code;
}

export function createPostHogReplaySource(
  config: PostHogSourceConfig,
  deps: PostHogSourceDeps,
): ReplaySource {
  const client = createPostHogReplayClient(config, deps);
  const secrets = [config.personalApiKey];

  function toReplayFailure(failure: SourceFailure, context: ReplayFailureContext): ReplayFailure {
    const code = toReplayFailureCode(failure.code, context);
    return { code, message: scrubSecrets(REPLAY_FAILURE_MESSAGES[code], secrets) };
  }

  return {
    kind: POSTHOG_REPLAY_SOURCE_KIND,

    async validate(): Promise<ReplaySourceValidation> {
      const result = await client.getRecordingsPage(client.recordingsUrl(1));
      if (!result.ok) {
        return {
          ok: false,
          checkedAt: deps.now(),
          failure: toReplayFailure(result.failure, "recordings"),
        };
      }
      return { ok: true, checkedAt: deps.now() };
    },

    async listRecordings(request: ReplayListRequest): Promise<ReplayListResult> {
      const pageCap = Math.min(request.maxPages, MAX_PAGES_PER_RUN);
      const sinceAt = request.sinceAt;

      const recordings: ReplayRecordingSummary[] = [];
      let pagesFetched = 0;
      let droppedMalformed = 0;

      let cursor: string | null = client.recordingsUrl(RECORDINGS_PAGE_LIMIT);

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
            failure: toReplayFailure(response.failure, "recordings"),
            partialRecordings: recordings,
            pagesFetched,
            droppedMalformed,
            eventsReceived: 0,
          };
        }
        pagesFetched += 1;

        const page = parseRecordingsPage(response.value);
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

        // PostHog's list order (newest-first vs oldest-first) is UNVERIFIED. The stop
        // below only fires when a page's first item is after sinceAt and its last is
        // at-or-before it; an oldest-first page that is entirely stale cannot produce
        // that shape, so a reversed order falls through to the page_cap/exhausted stops
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

    async pullEvents(recordingId: string): Promise<ReplayEventsResult> {
      const sourcesResponse = await client.getSnapshotSources(client.snapshotsUrl(recordingId));
      if (!sourcesResponse.ok) {
        return {
          ok: false,
          failure: toReplayFailure(sourcesResponse.failure, "snapshots"),
          partialEvents: [],
          pagesFetched: 1,
          droppedMalformed: 0,
          eventsReceived: 0,
        };
      }

      const sourcesPage = parseSnapshotSources(sourcesResponse.value);
      const range = blobKeyRange(sourcesPage.sources);

      // A recording with nothing stored is a real state, not a failure: nothing to
      // range a blob request over, so there is nothing more to fetch.
      if (range === null) {
        return {
          ok: true,
          events: [],
          stop: "exhausted",
          resumeCursor: null,
          pagesFetched: 1,
          droppedMalformed: sourcesPage.droppedMalformed,
          eventsReceived: 0,
        };
      }

      const blobResponse = await client.getSnapshotBlob(
        client.snapshotBlobUrl(recordingId, range.start, range.end),
      );
      if (!blobResponse.ok) {
        return {
          ok: false,
          failure: toReplayFailure(blobResponse.failure, "snapshots"),
          partialEvents: [],
          pagesFetched: 2,
          droppedMalformed: sourcesPage.droppedMalformed,
          eventsReceived: 0,
        };
      }

      const jsonl = parseSnapshotJsonl(blobResponse.value);
      // A gzip failure loses an event exactly like a shape failure does, and the shared
      // result type carries no separate field for it — the caller's signal is just
      // "we did not get everything", so it folds into the same count.
      const droppedMalformed =
        sourcesPage.droppedMalformed + jsonl.droppedMalformed + jsonl.decompressionFailures;

      // One ranged request covers the whole recording, so there is no cap to hit here —
      // every other exit above is a failure, and this is the sole success path.
      return {
        ok: true,
        events: jsonl.events,
        stop: "exhausted",
        resumeCursor: null,
        pagesFetched: 2,
        droppedMalformed,
        eventsReceived: jsonl.events.length,
      };
    },
  };
}
