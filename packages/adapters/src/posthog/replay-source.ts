import { Buffer } from "node:buffer";

import type {
  ReplayEventsResult,
  ReplayFailure,
  ReplayFailureCode,
  ReplayListRequest,
  ReplayListResult,
  ReplayRecordingSummary,
  ReplaySourceValidation,
  RrwebEvent,
  SourceFailure,
  SourceFailureCode,
} from "@growthmind/shared";
import { REPLAY_FAILURE_MESSAGES } from "@growthmind/shared";

import { scrubSecrets } from "../http/scrub";
import type { ReplayPullOptions, ReplaySource } from "../replay-source";
import {
  MAX_BLOB_CHUNKS_PER_PULL,
  MAX_BLOB_KEY_SPAN,
  MAX_PAGES_PER_RUN,
  MAX_PULL_BYTES,
  POSTHOG_REPLAY_SOURCE_KIND,
  RECORDINGS_PAGE_LIMIT,
} from "./constants";
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
// A cursor this source wrote on an earlier pull is a blob key. Anything else is ignored rather
// than trusted, so a corrupt or foreign value restarts the recording instead of skipping it.
function resumeBlobKey(resumeFrom: string | null | undefined): number | null {
  if (resumeFrom === null || resumeFrom === undefined) return null;

  const key = Number(resumeFrom);
  return Number.isSafeInteger(key) && key >= 0 ? key : null;
}

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

    async pullEvents(
      recordingId: string,
      options?: ReplayPullOptions,
    ): Promise<ReplayEventsResult> {
      const sourcesResponse = await client.getSnapshotSources(client.snapshotsUrl(recordingId));
      if (!sourcesResponse.ok) {
        return {
          ok: false,
          failure: toReplayFailure(sourcesResponse.failure, "snapshots"),
          partialEvents: [],
          resumeCursor: null,
          bytesReceived: 0,
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
          bytesReceived: 0,
          pagesFetched: 1,
          droppedMalformed: sourcesPage.droppedMalformed,
          eventsReceived: 0,
        };
      }

      const events: RrwebEvent[] = [];
      let pagesFetched = 1;
      let bytesReceived = 0;
      // A gzip failure loses an event exactly like a shape failure does, and the shared
      // result type carries no separate field for it — the caller's signal is just
      // "we did not get everything", so it folds into the same count.
      let droppedMalformed = sourcesPage.droppedMalformed;

      const endBlobKey = Number(range.end);
      const resumeAt = resumeBlobKey(options?.resumeFrom);
      let chunkStart =
        resumeAt === null ? Number(range.start) : Math.max(Number(range.start), resumeAt);
      let chunksFetched = 0;

      while (chunkStart <= endBlobKey) {
        if (chunksFetched >= MAX_BLOB_CHUNKS_PER_PULL) {
          return {
            ok: true,
            events,
            stop: "page_cap",
            resumeCursor: String(chunkStart),
            bytesReceived,
            pagesFetched,
            droppedMalformed,
            eventsReceived: events.length,
          };
        }

        // Soft by one chunk, bounded above by MAX_RESPONSE_BYTES: a hard cap needs a
        // streamed body, which readTextBody does not give.
        if (bytesReceived >= MAX_PULL_BYTES) {
          return {
            ok: true,
            events,
            stop: "byte_cap",
            resumeCursor: String(chunkStart),
            bytesReceived,
            pagesFetched,
            droppedMalformed,
            eventsReceived: events.length,
          };
        }

        const chunkEnd = Math.min(chunkStart + MAX_BLOB_KEY_SPAN, endBlobKey);
        const blobResponse = await client.getSnapshotBlob(
          client.snapshotBlobUrl(recordingId, String(chunkStart), String(chunkEnd)),
        );
        pagesFetched += 1;
        chunksFetched += 1;

        if (!blobResponse.ok) {
          return {
            ok: false,
            failure: toReplayFailure(blobResponse.failure, "snapshots"),
            partialEvents: events,
            resumeCursor: String(chunkStart),
            bytesReceived,
            pagesFetched,
            droppedMalformed,
            eventsReceived: events.length,
          };
        }

        bytesReceived += Buffer.byteLength(blobResponse.value, "utf8");

        const jsonl = parseSnapshotJsonl(blobResponse.value);
        droppedMalformed += jsonl.droppedMalformed + jsonl.decompressionFailures;
        events.push(...jsonl.events);

        chunkStart = chunkEnd + 1;
      }

      return {
        ok: true,
        events,
        stop: "exhausted",
        resumeCursor: null,
        bytesReceived,
        pagesFetched,
        droppedMalformed,
        eventsReceived: events.length,
      };
    },
  };
}
