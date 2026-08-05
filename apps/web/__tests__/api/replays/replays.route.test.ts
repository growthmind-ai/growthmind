// The two routes behind the recordings viewer. They are driven through their exported
// `handle` with injected ports, so no network and no database are involved: what is under
// test is the refusal shape and the partial-result behaviour, not the adapter.
import type { ScopedDb } from "@growthmind/db";
import type {
  ReplayEventsResult,
  ReplayListResult,
  ReplayRecordingSummary,
  TenantContext,
} from "@growthmind/shared";
import { REPLAY_FAILURE_MESSAGES, REPLAY_NO_CONNECTION } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { handle as handleEvents } from "../../../app/api/replays/[recordingId]/events/route";
import { handle as handleList } from "../../../app/api/replays/route";
import type { ReplayRouteDeps, ReplaySourceResolution } from "../../../lib/replay/deps";

const AD_CTX: TenantContext = {
  userId: "ad-user-1",
  organizationId: "ad-org-1",
  organizationName: "Ad Org",
  role: "owner",
};

const AD_RECORDING_ID = "ad-recording-1";

const AD_SUMMARY: ReplayRecordingSummary = {
  recordingId: AD_RECORDING_ID,
  startedAt: new Date("2026-08-05T10:00:00.000Z"),
  lastActivityAt: null,
  meta: { start_url: "https://ad-fake.invalid/pricing", console_error_count: 2 },
};

const AD_EVENT = { type: 4, timestamp: 1785924111227, data: { href: "https://ad-fake.invalid/" } };

function depsWith(
  resolution: ReplaySourceResolution,
  ctx: TenantContext | null = AD_CTX,
): ReplayRouteDeps {
  return {
    db: {} as ScopedDb,
    tenant: () => Promise.resolve(ctx),
    sourceFor: () => Promise.resolve(resolution),
  };
}

function sourceReturning(input: {
  list?: ReplayListResult;
  events?: ReplayEventsResult;
}): ReplaySourceResolution {
  return {
    ok: true,
    source: {
      kind: "posthog",
      validate: () => Promise.resolve({ ok: true as const, checkedAt: new Date() }),
      listRecordings: () =>
        Promise.resolve(
          input.list ?? {
            ok: true,
            recordings: [],
            stop: "exhausted",
            resumeCursor: null,
            pagesFetched: 1,
            droppedMalformed: 0,
            eventsReceived: 0,
          },
        ),
      pullEvents: () =>
        Promise.resolve(
          input.events ?? {
            ok: true,
            events: [],
            stop: "exhausted",
            resumeCursor: null,
            bytesReceived: 0,
            pagesFetched: 1,
            droppedMalformed: 0,
            eventsReceived: 0,
          },
        ),
    },
  };
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("GET /api/replays", () => {
  test("a signed-out caller is refused and no source is ever built", async () => {
    let built = false;
    const deps: ReplayRouteDeps = {
      db: {} as ScopedDb,
      tenant: () => Promise.resolve(null),
      sourceFor: () => {
        built = true;
        return Promise.resolve(sourceReturning({}));
      },
    };

    const response = await handleList(new Request("https://ad.invalid/api/replays"), deps);

    expect(response.status).toBe(401);
    expect(built).toBe(false);
  });

  // Not an error status: an org that has not connected analytics is a state of the page,
  // and a 5xx here would render a failure screen over what is really an invitation.
  test("an org with no connection gets an empty list and the sentence that says why", async () => {
    const response = await handleList(
      new Request("https://ad.invalid/api/replays"),
      depsWith({ ok: false, code: "no_connection" }),
    );

    expect(response.status).toBe(200);
    const body = await bodyOf(response);
    expect(body.recordings).toEqual([]);
    expect(body.connected).toBe(false);
    expect(body.message).toBe(REPLAY_NO_CONNECTION);
  });

  test("an installation with no credential key refuses rather than reporting no recordings", async () => {
    const response = await handleList(
      new Request("https://ad.invalid/api/replays"),
      depsWith({ ok: false, code: "not_configured" }),
    );

    expect(response.status).toBe(503);
    expect((await bodyOf(response)).message).toBe(REPLAY_FAILURE_MESSAGES.misconfigured);
  });

  test("recordings cross as ISO strings with the adapter's allowlisted meta intact", async () => {
    const response = await handleList(
      new Request("https://ad.invalid/api/replays"),
      depsWith(
        sourceReturning({
          list: {
            ok: true,
            recordings: [AD_SUMMARY],
            stop: "exhausted",
            resumeCursor: null,
            pagesFetched: 1,
            droppedMalformed: 0,
            eventsReceived: 0,
          },
        }),
      ),
    );

    const body = await bodyOf(response);
    expect(body.recordings).toEqual([
      {
        recordingId: AD_RECORDING_ID,
        startedAt: "2026-08-05T10:00:00.000Z",
        lastActivityAt: null,
        meta: { start_url: "https://ad-fake.invalid/pricing", console_error_count: 2 },
      },
    ]);
  });

  // D8: a rate limit part-way through is a shorter list, not an error page over rows we
  // already hold.
  test("a failure carrying partial rows returns those rows and says the list is short", async () => {
    const response = await handleList(
      new Request("https://ad.invalid/api/replays"),
      depsWith(
        sourceReturning({
          list: {
            ok: false,
            failure: { code: "rate_limited", message: "slow down" },
            partialRecordings: [AD_SUMMARY],
            pagesFetched: 1,
            droppedMalformed: 0,
            eventsReceived: 0,
          },
        }),
      ),
    );

    expect(response.status).toBe(200);
    const body = await bodyOf(response);
    expect((body.recordings as unknown[]).length).toBe(1);
    expect(body.truncated).toBe(true);
    expect(body.message).toBe(REPLAY_FAILURE_MESSAGES.rate_limited);
  });

  test("a failure carrying nothing at all is reported as a failure", async () => {
    const response = await handleList(
      new Request("https://ad.invalid/api/replays"),
      depsWith(
        sourceReturning({
          list: {
            ok: false,
            failure: { code: "invalid_credentials", message: "no" },
            partialRecordings: [],
            pagesFetched: 1,
            droppedMalformed: 0,
            eventsReceived: 0,
          },
        }),
      ),
    );

    expect(response.status).toBe(502);
    expect((await bodyOf(response)).message).toBe(REPLAY_FAILURE_MESSAGES.invalid_credentials);
  });

  test("a source that throws is a refusal, never an unhandled rejection", async () => {
    const deps = depsWith({
      ok: true,
      source: {
        kind: "posthog",
        validate: () => Promise.reject(new Error("ad-boom")),
        listRecordings: () => Promise.reject(new Error("ad-boom")),
        pullEvents: () => Promise.reject(new Error("ad-boom")),
      },
    });

    const response = await handleList(new Request("https://ad.invalid/api/replays"), deps);

    expect(response.status).toBe(503);
  });
});

describe("GET /api/replays/[recordingId]/events", () => {
  test("a signed-out caller is refused", async () => {
    const response = await handleEvents(
      new Request("https://ad.invalid/api/replays/x/events"),
      AD_RECORDING_ID,
      depsWith(sourceReturning({}), null),
    );

    expect(response.status).toBe(401);
  });

  test("a blank recording id is refused before any call is made", async () => {
    let called = false;
    const deps = depsWith({
      ok: true,
      source: {
        kind: "posthog",
        validate: () => Promise.resolve({ ok: true as const, checkedAt: new Date() }),
        listRecordings: () => Promise.reject(new Error("ad-unreached")),
        pullEvents: () => {
          called = true;
          return Promise.reject(new Error("ad-unreached"));
        },
      },
    });

    const response = await handleEvents(
      new Request("https://ad.invalid/api/replays//events"),
      "   ",
      deps,
    );

    expect(response.status).toBe(404);
    expect(called).toBe(false);
  });

  test("events cross whole for a recording that answers", async () => {
    const response = await handleEvents(
      new Request("https://ad.invalid/api/replays/x/events"),
      AD_RECORDING_ID,
      depsWith(
        sourceReturning({
          events: {
            ok: true,
            events: [AD_EVENT],
            stop: "exhausted",
            resumeCursor: null,
            bytesReceived: 0,
            pagesFetched: 1,
            droppedMalformed: 0,
            eventsReceived: 1,
          },
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect((await bodyOf(response)).events).toEqual([AD_EVENT]);
  });

  test("a recording that does not exist is a 404, not a 502", async () => {
    const response = await handleEvents(
      new Request("https://ad.invalid/api/replays/x/events"),
      AD_RECORDING_ID,
      depsWith(
        sourceReturning({
          events: {
            ok: false,
            failure: { code: "recording_not_found", message: "gone" },
            partialEvents: [],
            resumeCursor: null,
            bytesReceived: 0,
            pagesFetched: 1,
            droppedMalformed: 0,
            eventsReceived: 0,
          },
        }),
      ),
    );

    expect(response.status).toBe(404);
  });

  test("events already in hand still play when the tail failed", async () => {
    const response = await handleEvents(
      new Request("https://ad.invalid/api/replays/x/events"),
      AD_RECORDING_ID,
      depsWith(
        sourceReturning({
          events: {
            ok: false,
            failure: { code: "rate_limited", message: "slow down" },
            partialEvents: [AD_EVENT],
            resumeCursor: null,
            bytesReceived: 0,
            pagesFetched: 1,
            droppedMalformed: 0,
            eventsReceived: 1,
          },
        }),
      ),
    );

    expect(response.status).toBe(200);
    const body = await bodyOf(response);
    expect(body.events).toEqual([AD_EVENT]);
    expect(body.truncated).toBe(true);
  });
});
