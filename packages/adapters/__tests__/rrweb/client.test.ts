import { describe, expect, test } from "bun:test";

import { RETRY_AFTER_CAP_MS } from "../../src/http/constants";
import type { ClientResult } from "../../src/rrweb/client";
import { createRrwebClient } from "../../src/rrweb/client";
import { MAX_RATE_LIMIT_ATTEMPTS } from "../../src/rrweb/constants";
import type { RrwebSourceConfig, RrwebSourceDeps } from "../../src/rrweb/deps";

const AD_HOST = "https://rr.ad-fake.invalid";
const AD_API_KEY = "rrw_ad-fake-not-a-real-key-0000000000";
const AD_CONFIG: RrwebSourceConfig = { host: AD_HOST, apiKey: AD_API_KEY };

const AD_RECORDINGS_URL = `${AD_HOST}/recordings?limit=50`;
const AD_EVENTS_URL = `${AD_HOST}/events?limit=200`;

const AD_THROTTLED_BODY = {
  error: "throttled",
  message: "Too many requests. Retry after 59 seconds.",
};

interface FakeResponseSpec {
  readonly status?: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  readonly networkError?: boolean;
}

interface RecordedRequest {
  readonly url: string;
  readonly authorization: string | null;
  readonly accept: string | null;
  readonly redirect: RequestInit["redirect"] | undefined;
}

interface FakeFetch {
  readonly fetch: RrwebSourceDeps["fetch"];
  readonly requests: RecordedRequest[];
}

function createFakeFetch(respond: (url: string, callIndex: number) => FakeResponseSpec): FakeFetch {
  const requests: RecordedRequest[] = [];

  const handler = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    requests.push({
      url,
      authorization: headers.get("authorization"),
      accept: headers.get("accept"),
      redirect: init?.redirect,
    });

    const spec = respond(url, requests.length - 1);
    if (spec.networkError === true) {
      throw new TypeError("ad-fake transport fault: connection refused");
    }
    return new Response(spec.body === undefined ? "" : JSON.stringify(spec.body), {
      status: spec.status ?? 200,
      headers: { "content-type": "application/json", ...spec.headers },
    });
  };

  return { fetch: handler as unknown as RrwebSourceDeps["fetch"], requests };
}

function createFakeDeps(
  fetchImpl: RrwebSourceDeps["fetch"],
  options?: { deadlineExceededAfter?: (ms: number) => boolean },
): { deps: RrwebSourceDeps; sleeps: number[] } {
  const sleeps: number[] = [];
  const deadlineExceededAfter = options?.deadlineExceededAfter;
  return {
    deps: {
      fetch: fetchImpl,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
      now: () => new Date("2026-08-04T18:00:00.000Z"),
      random: () => 0,
      ...(deadlineExceededAfter !== undefined ? { deadlineExceededAfter } : {}),
    },
    sleeps,
  };
}

describe("createRrwebClient", () => {
  test("sends Bearer authorization, an application/json accept header, and refuses to follow redirects", async () => {
    const fake = createFakeFetch(() => ({ status: 200, body: { recordings: [] } }));
    const { deps } = createFakeDeps(fake.fetch);
    const client = createRrwebClient(AD_CONFIG, deps);

    await client.getRecordingsPage(AD_RECORDINGS_URL);

    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]?.authorization).toBe(`Bearer ${AD_API_KEY}`);
    expect(fake.requests[0]?.accept).toBe("application/json");
    expect(fake.requests[0]?.redirect).toBe("manual");
  });

  test("a 200 response returns ok:true with the parsed JSON body", async () => {
    const body = { recordings: [{ id: "ad-rec-1" }], next: null };
    const fake = createFakeFetch(() => ({ status: 200, body }));
    const { deps } = createFakeDeps(fake.fetch);
    const client = createRrwebClient(AD_CONFIG, deps);

    const result: ClientResult<unknown> = await client.getRecordingsPage(AD_RECORDINGS_URL);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(body);
  });

  test("honours Retry-After on a 429, caps the recorded delay, and gives up at the attempt budget", async () => {
    const fake = createFakeFetch(() => ({
      status: 429,
      body: AD_THROTTLED_BODY,
      headers: { "retry-after": "999999" },
    }));
    const { deps, sleeps } = createFakeDeps(fake.fetch);
    const client = createRrwebClient(AD_CONFIG, deps);

    const result = await client.getRecordingsPage(AD_RECORDINGS_URL);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("rate_limited");

    expect(client.rateLimitAttempts("recordings")).toBe(MAX_RATE_LIMIT_ATTEMPTS);
    expect(fake.requests.length).toBeLessThanOrEqual(MAX_RATE_LIMIT_ATTEMPTS);
    expect(fake.requests.length).toBeGreaterThan(1);

    expect(sleeps.length).toBeGreaterThan(0);
    expect(sleeps.length).toBeLessThan(MAX_RATE_LIMIT_ATTEMPTS);
    for (const ms of sleeps) {
      expect(ms).toBe(RETRY_AFTER_CAP_MS);
    }
  });

  test("recordings and events keep separate 429 attempt budgets", async () => {
    const fake = createFakeFetch((url) => {
      if (url.includes("/recordings")) {
        return { status: 429, body: AD_THROTTLED_BODY, headers: { "retry-after": "59" } };
      }
      return { status: 200, body: { events: [{ type: 3, timestamp: 1, data: {} }], next: null } };
    });
    const { deps } = createFakeDeps(fake.fetch);
    const client = createRrwebClient(AD_CONFIG, deps);

    const recordingsResult = await client.getRecordingsPage(AD_RECORDINGS_URL);
    expect(recordingsResult.ok).toBe(false);
    expect(client.rateLimitAttempts("recordings")).toBe(MAX_RATE_LIMIT_ATTEMPTS);

    const eventsResult = await client.getEventsPage(AD_EVENTS_URL);
    expect(eventsResult.ok).toBe(true);
    expect(client.rateLimitAttempts("events")).toBe(0);
  });

  test("refuses a URL that is not same-origin with config.host, without ever calling fetch", async () => {
    const fake = createFakeFetch(() => ({ status: 200, body: {} }));
    const { deps } = createFakeDeps(fake.fetch);
    const client = createRrwebClient(AD_CONFIG, deps);

    const result = await client.getRecordingsPage("https://attacker.ad-fake.invalid/recordings");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("unreachable");
    expect(fake.requests).toHaveLength(0);
  });

  test("a network-level fetch failure maps to unreachable without retrying", async () => {
    const fake = createFakeFetch(() => ({ networkError: true }));
    const { deps, sleeps } = createFakeDeps(fake.fetch);
    const client = createRrwebClient(AD_CONFIG, deps);

    const result = await client.getEventsPage(AD_EVENTS_URL);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("unreachable");
    expect(fake.requests).toHaveLength(1);
    expect(sleeps).toHaveLength(0);
  });

  test("gives up with the rate_limited failure instead of sleeping once the deadline is exceeded", async () => {
    const fake = createFakeFetch(() => ({
      status: 429,
      body: AD_THROTTLED_BODY,
      headers: { "retry-after": "5" },
    }));
    const { deps, sleeps } = createFakeDeps(fake.fetch, { deadlineExceededAfter: () => true });
    const client = createRrwebClient(AD_CONFIG, deps);

    const result = await client.getRecordingsPage(AD_RECORDINGS_URL);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("rate_limited");
    expect(sleeps).toHaveLength(0);
    expect(fake.requests).toHaveLength(1);
  });
});
