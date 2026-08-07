// The route behind the replay player. It is driven through its exported `handle` with injected
// ports, so no network and no database are involved: what is under test is the refusal shape and
// the partial-result behaviour, not the adapter. The list route it used to sit beside is gone —
// the screen reads the database directly through lib/replay/read.ts.
import type { ScopedDb } from "@growthmind/db";
import type { ReplayEventsResult, TenantContext } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { handle as handleEvents } from "../../../app/api/replays/[recordingId]/events/route";
import type { ReplayRouteDeps, ReplaySourceResolution } from "../../../lib/replay/deps";

const AD_CTX: TenantContext = {
  userId: "ad-user-1",
  organizationId: "ad-org-1",
  organizationName: "Ad Org",
  role: "owner",
};

const AD_RECORDING_ID = "ad-recording-1";

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

function sourceReturning(input: { events?: ReplayEventsResult }): ReplaySourceResolution {
  return {
    ok: true,
    source: {
      kind: "posthog",
      validate: () => Promise.resolve({ ok: true as const, checkedAt: new Date() }),
      listRecordings: () =>
        Promise.resolve({
          ok: true,
          recordings: [],
          stop: "exhausted",
          resumeCursor: null,
          pagesFetched: 1,
          droppedMalformed: 0,
          eventsReceived: 0,
        }),
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
