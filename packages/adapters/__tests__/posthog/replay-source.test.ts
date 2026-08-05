import type { IdentityHmacKey } from "@growthmind/shared";
import { deriveIdentityHmacKey } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import type { PostHogSourceConfig, PostHogSourceDeps } from "../../src/posthog/deps";
import { createPostHogReplaySource } from "../../src/posthog/replay-source";
import type { ReplaySource } from "../../src/replay-source";

const AD_HOST = "https://ph.ad-fake.invalid";
const AD_SOURCE_PROJECT_ID = "424242";
const AD_PERSONAL_KEY = "phx_ad-fake-not-a-real-key-0000000000";

const AD_CONFIG: PostHogSourceConfig = {
  host: AD_HOST,
  sourceProjectId: AD_SOURCE_PROJECT_ID,
  personalApiKey: AD_PERSONAL_KEY,
};

const AD_IDENTITY_HMAC_KEY: IdentityHmacKey = deriveIdentityHmacKey({
  bytes: new Uint8Array(32).fill(0x42),
});

const FAKE_NOW = new Date("2026-08-05T18:00:00.000Z");

const RECORDINGS_BASE = `${AD_HOST}/api/projects/${AD_SOURCE_PROJECT_ID}/session_recordings`;
const NEXT_RECORDINGS_PAGE_2 = `${RECORDINGS_BASE}?limit=100&offset=100`;
const NEXT_RECORDINGS_PAGE_3 = `${RECORDINGS_BASE}?limit=100&offset=200`;

interface FakeResponseSpec {
  readonly status?: number;
  readonly body?: unknown;
  // Raw text bypasses JSON.stringify: the snapshot-blob endpoint answers jsonl, not json.
  readonly rawBody?: string;
  readonly headers?: Record<string, string>;
  readonly networkError?: boolean;
}

interface FakeFetch {
  readonly fetch: PostHogSourceDeps["fetch"];
  readonly requests: string[];
}

function createFakeFetch(respond: (url: string, callIndex: number) => FakeResponseSpec): FakeFetch {
  const requests: string[] = [];

  const handler = async (input: string | URL | Request): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requests.push(url);

    const spec = respond(url, requests.length - 1);
    if (spec.networkError === true) {
      throw new TypeError("ad-fake transport fault: connection refused");
    }
    const text =
      spec.rawBody !== undefined
        ? spec.rawBody
        : spec.body === undefined
          ? ""
          : JSON.stringify(spec.body);
    return new Response(text, {
      status: spec.status ?? 200,
      headers: { "content-type": "application/json", ...spec.headers },
    });
  };

  return { fetch: handler as unknown as PostHogSourceDeps["fetch"], requests };
}

// Clamps to the last supplied page for any call beyond the array's length, so a single
// terminal failure entry exhausts every remaining request regardless of how many the
// adapter still intends to make.
function createPagedFetch(pages: readonly FakeResponseSpec[]): FakeFetch {
  return createFakeFetch((_url, index) => {
    const spec = pages[Math.min(index, pages.length - 1)];
    return spec ?? { status: 200, body: recordingsPage([]) };
  });
}

function createDeps(fetchImpl: PostHogSourceDeps["fetch"]): { deps: PostHogSourceDeps } {
  return {
    deps: {
      fetch: fetchImpl,
      sleep: async () => {},
      now: () => FAKE_NOW,
      random: () => 0,
      identityHmacKey: AD_IDENTITY_HMAC_KEY,
    },
  };
}

function buildSource(fetchImpl: PostHogSourceDeps["fetch"]): ReplaySource {
  const { deps } = createDeps(fetchImpl);
  return createPostHogReplaySource(AD_CONFIG, deps);
}

interface RecordingItemOverrides {
  readonly id?: string;
  readonly startedAt?: string;
  readonly lastActivityAt?: string;
  readonly omitStartedAt?: boolean;
}

function recordingItem(overrides: RecordingItemOverrides = {}): Record<string, unknown> {
  const item: Record<string, unknown> = { id: overrides.id ?? "rec-default" };
  if (overrides.omitStartedAt !== true) {
    item.start_time = overrides.startedAt ?? "2026-08-01T00:00:00.000Z";
  }
  item.end_time = overrides.lastActivityAt ?? "2026-08-01T00:05:00.000Z";
  return item;
}

function recordingsPage(
  items: readonly unknown[],
  next: string | null = null,
): Record<string, unknown> {
  return { results: items, next };
}

function snapshotSourcesBody(blobKeys: readonly string[]): Record<string, unknown> {
  return { sources: blobKeys.map((blobKey) => ({ source: "blob_v2", blob_key: blobKey })) };
}

interface JsonlEventSpec {
  readonly windowId: string;
  readonly type: number;
  readonly timestamp: number;
  readonly data?: unknown;
  readonly cv?: string;
}

function snapshotJsonl(events: readonly JsonlEventSpec[]): string {
  return events
    .map((event) =>
      JSON.stringify([
        event.windowId,
        { type: event.type, timestamp: event.timestamp, data: event.data ?? {}, cv: event.cv },
      ]),
    )
    .join("\n");
}

describe("createPostHogReplaySource", () => {
  test("kind is the literal posthog", () => {
    const fake = createFakeFetch(() => ({ status: 200, body: recordingsPage([]) }));
    expect(buildSource(fake.fetch).kind).toBe("posthog");
  });

  describe("#validate", () => {
    test("a 200 limit-1 recordings page returns ok:true with a checkedAt", async () => {
      const fake = createFakeFetch(() => ({
        status: 200,
        body: recordingsPage([recordingItem()]),
      }));

      const result = await buildSource(fake.fetch).validate();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.checkedAt).toEqual(FAKE_NOW);
      expect(fake.requests[0]).toContain("limit=1");
    });

    test("a 404 (wrong project) returns ok:false with failure.code misconfigured", async () => {
      const fake = createFakeFetch(() => ({
        status: 404,
        body: { type: "invalid_request", code: "not_found", detail: "Project not found." },
      }));

      const result = await buildSource(fake.fetch).validate();

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.code).toBe("misconfigured");
      expect(result.checkedAt).toEqual(FAKE_NOW);
      expect(result.failure.message).not.toContain(AD_PERSONAL_KEY);
    });
  });

  describe("#listRecordings", () => {
    test("stops with exhausted when the final page's next is null", async () => {
      const fake = createPagedFetch([
        {
          status: 200,
          body: recordingsPage([recordingItem({ id: "rec-1" })], NEXT_RECORDINGS_PAGE_2),
        },
        { status: 200, body: recordingsPage([recordingItem({ id: "rec-2" })], null) },
      ]);

      const result = await buildSource(fake.fetch).listRecordings({ sinceAt: null, maxPages: 10 });

      expect(fake.requests).toHaveLength(2);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.stop).toBe("exhausted");
      expect(result.resumeCursor).toBeNull();
      expect(result.recordings.map((recording) => recording.recordingId)).toEqual([
        "rec-1",
        "rec-2",
      ]);
      expect(result.pagesFetched).toBe(2);
    });

    test("stops with page_cap and a resumeCursor set to the next-unfetched page URL", async () => {
      const fake = createPagedFetch([
        {
          status: 200,
          body: recordingsPage([recordingItem({ id: "rec-1" })], NEXT_RECORDINGS_PAGE_2),
        },
        {
          status: 200,
          body: recordingsPage([recordingItem({ id: "rec-2" })], NEXT_RECORDINGS_PAGE_3),
        },
        { status: 200, body: recordingsPage([recordingItem({ id: "rec-3" })], null) },
      ]);

      const result = await buildSource(fake.fetch).listRecordings({ sinceAt: null, maxPages: 2 });

      expect(fake.requests).toHaveLength(2);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.stop).toBe("page_cap");
      expect(result.resumeCursor).toBe(NEXT_RECORDINGS_PAGE_3);
      expect(result.recordings.map((recording) => recording.recordingId)).toEqual([
        "rec-1",
        "rec-2",
      ]);
    });

    test("stops with watermark when a page crosses sinceAt, excluding the at-or-before recording", async () => {
      const sinceAt = new Date("2026-08-01T00:03:00.000Z");
      const fake = createPagedFetch([
        {
          status: 200,
          body: recordingsPage(
            [
              recordingItem({ id: "rec-1", startedAt: "2026-08-01T00:10:00.000Z" }),
              recordingItem({ id: "rec-2", startedAt: "2026-08-01T00:02:00.000Z" }),
            ],
            NEXT_RECORDINGS_PAGE_2,
          ),
        },
      ]);

      const result = await buildSource(fake.fetch).listRecordings({ sinceAt, maxPages: 10 });

      expect(fake.requests).toHaveLength(1);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.stop).toBe("watermark");
      expect(result.recordings.map((recording) => recording.recordingId)).toEqual(["rec-1"]);
    });

    test("filters every at-or-before-sinceAt recording out of the page, not just the last item", async () => {
      const sinceAt = new Date("2026-08-01T00:05:00.000Z");
      const fake = createPagedFetch([
        {
          status: 200,
          body: recordingsPage(
            [
              recordingItem({ id: "rec-a", startedAt: "2026-08-01T00:10:00.000Z" }),
              recordingItem({ id: "rec-mid-stale", startedAt: "2026-08-01T00:01:00.000Z" }),
              recordingItem({ id: "rec-b", startedAt: "2026-08-01T00:20:00.000Z" }),
            ],
            null,
          ),
        },
      ]);

      const result = await buildSource(fake.fetch).listRecordings({ sinceAt, maxPages: 10 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.stop).toBe("exhausted");
      expect(result.recordings.map((recording) => recording.recordingId)).toEqual([
        "rec-a",
        "rec-b",
      ]);
    });

    test("retains a startedAt:null recording even under a set sinceAt, since unknown age is not evidence of being old", async () => {
      const sinceAt = new Date("2026-08-01T00:05:00.000Z");
      const fake = createPagedFetch([
        {
          status: 200,
          body: recordingsPage(
            [recordingItem({ id: "rec-unknown-age", omitStartedAt: true })],
            null,
          ),
        },
      ]);

      const result = await buildSource(fake.fetch).listRecordings({ sinceAt, maxPages: 10 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.stop).toBe("exhausted");
      expect(result.recordings.map((recording) => recording.recordingId)).toEqual([
        "rec-unknown-age",
      ]);
    });

    test("an oldest-first page ordering does not cause a silent single-page watermark stop that loses newer recordings", async () => {
      const sinceAt = new Date("2026-08-01T00:05:00.000Z");
      const fake = createPagedFetch([
        {
          status: 200,
          body: recordingsPage(
            [
              recordingItem({ id: "rec-old-1", startedAt: "2026-07-01T00:00:00.000Z" }),
              recordingItem({ id: "rec-old-2", startedAt: "2026-07-01T00:01:00.000Z" }),
            ],
            NEXT_RECORDINGS_PAGE_2,
          ),
        },
        {
          status: 200,
          body: recordingsPage(
            [recordingItem({ id: "rec-new-1", startedAt: "2026-08-02T00:00:00.000Z" })],
            null,
          ),
        },
      ]);

      const result = await buildSource(fake.fetch).listRecordings({ sinceAt, maxPages: 10 });

      expect(fake.requests).toHaveLength(2);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.stop).toBe("exhausted");
      expect(result.recordings.map((recording) => recording.recordingId)).toEqual(["rec-new-1"]);
    });

    test("a mid-walk failure returns ok:false with failure, partialRecordings, and telemetry", async () => {
      const fake = createPagedFetch([
        {
          status: 200,
          body: recordingsPage([recordingItem({ id: "rec-1" })], NEXT_RECORDINGS_PAGE_2),
        },
        { networkError: true },
      ]);

      const result = await buildSource(fake.fetch).listRecordings({ sinceAt: null, maxPages: 10 });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.code).toBe("unreachable");
      expect(result.partialRecordings.map((recording) => recording.recordingId)).toEqual(["rec-1"]);
      expect(result.pagesFetched).toBe(1);
    });
  });

  describe("#pullEvents", () => {
    test("happy path parses the ranged blob into rrweb events", async () => {
      const fake = createPagedFetch([
        { status: 200, body: snapshotSourcesBody(["100", "200"]) },
        {
          status: 200,
          rawBody: snapshotJsonl([
            { windowId: "win-1", type: 4, timestamp: 1722600000000 },
            { windowId: "win-1", type: 3, timestamp: 1722600001000, data: { source: 2 } },
          ]),
        },
      ]);

      const result = await buildSource(fake.fetch).pullEvents("rec-1");

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.events.map((event) => event.type)).toEqual([4, 3]);
      expect(result.stop).toBe("exhausted");
      expect(result.resumeCursor).toBeNull();
      expect(result.pagesFetched).toBe(2);
      expect(result.eventsReceived).toBe(2);

      expect(fake.requests[1]).toContain("start_blob_key=100");
      expect(fake.requests[1]).toContain("end_blob_key=200");
    });

    test("an empty source list returns ok:true with zero events, not a failure", async () => {
      const fake = createPagedFetch([{ status: 200, body: snapshotSourcesBody([]) }]);

      const result = await buildSource(fake.fetch).pullEvents("rec-empty");

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.events).toEqual([]);
      expect(result.pagesFetched).toBe(1);
      expect(fake.requests).toHaveLength(1);
    });

    test("a decompression failure folds into droppedMalformed instead of being silently dropped", async () => {
      const goodLine = JSON.stringify([
        "win-1",
        { type: 4, timestamp: 1722600000000, data: { source: 0 } },
      ]);
      const badGzipLine = JSON.stringify([
        "win-1",
        { type: 3, timestamp: 1722600001000, cv: "2024-04", data: "not-valid-gzip-bytes" },
      ]);
      const fake = createPagedFetch([
        { status: 200, body: snapshotSourcesBody(["100"]) },
        { status: 200, rawBody: `${goodLine}\n${badGzipLine}\n` },
      ]);

      const result = await buildSource(fake.fetch).pullEvents("rec-1");

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.events.map((event) => event.type)).toEqual([4]);
      expect(result.droppedMalformed).toBe(1);
    });

    test("a 404 on the sources call maps to recording_not_found, not misconfigured", async () => {
      const fake = createFakeFetch(() => ({
        status: 404,
        body: { type: "invalid_request", code: "not_found", detail: "Recording not found." },
      }));

      const result = await buildSource(fake.fetch).pullEvents("rec-missing");

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.code).toBe("recording_not_found");
      expect(result.partialEvents).toEqual([]);
    });

    test("a mid-walk failure on the blob fetch returns ok:false with empty partialEvents and both requests counted", async () => {
      const fake = createPagedFetch([
        { status: 200, body: snapshotSourcesBody(["100"]) },
        { networkError: true },
      ]);

      const result = await buildSource(fake.fetch).pullEvents("rec-1");

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.code).toBe("unreachable");
      expect(result.partialEvents).toEqual([]);
      expect(result.pagesFetched).toBe(2);
      expect(fake.requests).toHaveLength(2);
    });
  });
});
