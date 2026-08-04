import { describe, expect, test } from "bun:test";

import type { ReplaySource } from "../../src/replay-source";
import type { FetchLike, RrwebSourceConfig, RrwebSourceDeps } from "../../src/rrweb/deps";
import { createRrwebReplaySource } from "../../src/rrweb/replay-source";

const RRWEB_HOST = "https://api.rrweb.com";
const RRWEB_API_KEY = "rrweb_sk_test_fake_0000000000000000";

const RRWEB_CONFIG: RrwebSourceConfig = { host: RRWEB_HOST, apiKey: RRWEB_API_KEY };

const FAKE_NOW = new Date("2026-08-04T12:00:00.000Z");

const RECORDING_ID = "rec-1";

const NEXT_RECORDINGS_PAGE_2 = `${RRWEB_HOST}/recordings?cursor=rrweb-fake-recordings-cursor-2`;
const NEXT_RECORDINGS_PAGE_3 = `${RRWEB_HOST}/recordings?cursor=rrweb-fake-recordings-cursor-3`;
const NEXT_EVENTS_PAGE_2 = `${RRWEB_HOST}/recordings/${RECORDING_ID}/events?cursor=rrweb-fake-events-cursor-2`;

interface FakeResponseSpec {
  readonly status?: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  readonly networkError?: boolean;
}

interface FakeFetch {
  readonly fetch: FetchLike;
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
      throw new TypeError("rrweb-fake transport fault: connection refused");
    }
    return new Response(spec.body === undefined ? "" : JSON.stringify(spec.body), {
      status: spec.status ?? 200,
      headers: { "content-type": "application/json", ...spec.headers },
    });
  };

  return {
    fetch: Object.assign(handler, { preconnect: globalThis.fetch.preconnect }) as FetchLike,
    requests,
  };
}

// Clamps to the last supplied page for any call beyond the array's length, so a single
// terminal 429 entry exhausts every retry attempt regardless of the adapter's exact budget.
function createPagedFetch(pages: readonly FakeResponseSpec[]): FakeFetch {
  return createFakeFetch((_url, index) => {
    const spec = pages[Math.min(index, pages.length - 1)];
    return spec ?? { status: 200, body: { recordings: [], next: null } };
  });
}

function createDeps(fetchImpl: FetchLike): { deps: RrwebSourceDeps; sleeps: number[] } {
  const sleeps: number[] = [];
  return {
    deps: {
      fetch: fetchImpl,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
      now: () => FAKE_NOW,
      random: () => 0,
    },
    sleeps,
  };
}

function buildSource(fetchImpl: FetchLike): ReplaySource {
  const { deps } = createDeps(fetchImpl);
  return createRrwebReplaySource(RRWEB_CONFIG, deps);
}

interface RecordingItemOverrides {
  readonly id?: string;
  readonly startedAt?: string;
  readonly lastActivityAt?: string;
}

function recordingItem(overrides: RecordingItemOverrides = {}): Record<string, unknown> {
  return {
    id: overrides.id ?? "rec-default",
    startedAt: overrides.startedAt ?? "2026-08-01T00:00:00.000Z",
    lastActivityAt: overrides.lastActivityAt ?? "2026-08-01T00:05:00.000Z",
  };
}

function recordingsPage(items: readonly unknown[], next: string | null = null): Record<string, unknown> {
  return { recordings: items, next };
}

interface EventItemOverrides {
  readonly type?: number;
  readonly timestamp?: number;
  readonly data?: unknown;
}

function eventItem(overrides: EventItemOverrides = {}): Record<string, unknown> {
  return {
    type: overrides.type ?? 2,
    timestamp: overrides.timestamp ?? 1722600000000,
    data: overrides.data ?? { source: 0 },
  };
}

function eventsPage(items: readonly unknown[], next: string | null = null): Record<string, unknown> {
  return { events: items, next };
}

describe("createRrwebReplaySource", () => {
  test("kind is the literal rrweb", () => {
    const fake = createFakeFetch(() => ({ status: 200, body: recordingsPage([]) }));
    expect(buildSource(fake.fetch).kind).toBe("rrweb");
  });

  describe("#validate", () => {
    test("a 200 limit-1 recordings page returns ok:true with a checkedAt", async () => {
      const fake = createFakeFetch(() => ({ status: 200, body: recordingsPage([recordingItem()]) }));

      const result = await buildSource(fake.fetch).validate();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.checkedAt).toEqual(FAKE_NOW);
    });

    test("a 401 missing-scope body returns ok:false with failure.code missing_read_scope", async () => {
      const fake = createFakeFetch(() => ({
        status: 401,
        body: { error: "missing scope: read:recordingMetadata" },
      }));

      const result = await buildSource(fake.fetch).validate();

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.code).toBe("missing_read_scope");
      expect(result.checkedAt).toEqual(FAKE_NOW);
    });
  });

  describe("#listRecordings", () => {
    test("stops with exhausted when the final page's cursor is null", async () => {
      const fake = createPagedFetch([
        { status: 200, body: recordingsPage([recordingItem({ id: "rec-1" })], NEXT_RECORDINGS_PAGE_2) },
        { status: 200, body: recordingsPage([recordingItem({ id: "rec-2" })], null) },
      ]);

      const result = await buildSource(fake.fetch).listRecordings({ sinceAt: null, maxPages: 10 });

      expect(fake.requests).toHaveLength(2);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.stop).toBe("exhausted");
      expect(result.resumeCursor).toBeNull();
      expect(result.recordings.map((recording) => recording.recordingId)).toEqual(["rec-1", "rec-2"]);
      expect(result.pagesFetched).toBe(2);
    });

    test("stops with page_cap and a resumeCursor set to the next-unfetched page URL", async () => {
      const fake = createPagedFetch([
        { status: 200, body: recordingsPage([recordingItem({ id: "rec-1" })], NEXT_RECORDINGS_PAGE_2) },
        { status: 200, body: recordingsPage([recordingItem({ id: "rec-2" })], NEXT_RECORDINGS_PAGE_3) },
        { status: 200, body: recordingsPage([recordingItem({ id: "rec-3" })], null) },
      ]);

      const result = await buildSource(fake.fetch).listRecordings({ sinceAt: null, maxPages: 2 });

      expect(fake.requests).toHaveLength(2);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.stop).toBe("page_cap");
      expect(result.resumeCursor).toBe(NEXT_RECORDINGS_PAGE_3);
      expect(result.recordings.map((recording) => recording.recordingId)).toEqual(["rec-1", "rec-2"]);
    });

    test("stops with watermark when the oldest recording on a page is at or before sinceAt", async () => {
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
      expect(result.recordings.map((recording) => recording.recordingId)).toEqual(["rec-1", "rec-2"]);
    });

    test("telemetry (pagesFetched, droppedMalformed, eventsReceived) is populated on the exhausted arm", async () => {
      const fake = createPagedFetch([
        {
          status: 200,
          body: recordingsPage([recordingItem({ id: "rec-1" }), { garbage: true }], null),
        },
      ]);

      const result = await buildSource(fake.fetch).listRecordings({ sinceAt: null, maxPages: 10 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.pagesFetched).toBe(1);
      expect(result.droppedMalformed).toBe(1);
      expect(result.eventsReceived).toBe(0);
    });

    test("a mid-walk failure returns ok:false with failure, partialRecordings, and telemetry", async () => {
      const fake = createPagedFetch([
        { status: 200, body: recordingsPage([recordingItem({ id: "rec-1" })], NEXT_RECORDINGS_PAGE_2) },
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
    test("concatenates event pages and returns events in wire order", async () => {
      const fake = createPagedFetch([
        {
          status: 200,
          body: eventsPage([eventItem({ type: 4, timestamp: 1722600000000 })], NEXT_EVENTS_PAGE_2),
        },
        { status: 200, body: eventsPage([eventItem({ type: 2, timestamp: 1722600001000 })], null) },
      ]);

      const result = await buildSource(fake.fetch).pullEvents(RECORDING_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.events.map((event) => event.type)).toEqual([4, 2]);
      expect(result.events.map((event) => event.timestamp)).toEqual([1722600000000, 1722600001000]);
      expect(result.pagesFetched).toBe(2);
    });

    test("a zero-event recording returns ok:true with an empty events array, not a failure", async () => {
      const fake = createPagedFetch([{ status: 200, body: eventsPage([], null) }]);

      const result = await buildSource(fake.fetch).pullEvents(RECORDING_ID);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.events).toEqual([]);
      expect(result.pagesFetched).toBe(1);
    });

    test("a mid-walk 429 exhaustion returns ok:false with partialEvents carrying pages already parsed", async () => {
      const fake = createPagedFetch([
        {
          status: 200,
          body: eventsPage([eventItem({ type: 4, timestamp: 1722600000000 })], NEXT_EVENTS_PAGE_2),
        },
        { status: 429, headers: { "retry-after": "1" }, body: { error: "rate limited" } },
      ]);

      const result = await buildSource(fake.fetch).pullEvents(RECORDING_ID);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.code).toBe("rate_limited");
      expect(result.partialEvents.map((event) => event.type)).toEqual([4]);
      expect(result.pagesFetched).toBe(1);
    });

    test("a 404 returns failure code recording_not_found", async () => {
      const fake = createFakeFetch(() => ({ status: 404, body: { error: "not found" } }));

      const result = await buildSource(fake.fetch).pullEvents("rec-missing");

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.code).toBe("recording_not_found");
      expect(result.partialEvents).toEqual([]);
    });
  });
});
