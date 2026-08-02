import { deriveIdentityHmacKey } from "@growthmind/shared";
import type { IdentityHmacKey } from "@growthmind/shared";

import type { ClientResult, PostHogClient, PostHogEndpoint } from "../../src/posthog/client";
import type { FetchLike, PostHogSourceConfig, PostHogSourceDeps } from "../../src/posthog/deps";

export const AD_HOST = "https://ph.ad-fake.invalid";
export const AD_SOURCE_PROJECT_ID = "424242";

export const AD_FAKE_PERSONAL_KEY = "phx_ad-fake-not-a-real-key-0000000000";

export const AD_FAKE_ENCODABLE_KEY = "phx_ad-fake+encoded/key=0000000000000000";

export const AD_CONFIG: PostHogSourceConfig = {
  host: AD_HOST,
  sourceProjectId: AD_SOURCE_PROJECT_ID,
  personalApiKey: AD_FAKE_PERSONAL_KEY,
};

export const AD_EVENTS_URL = `${AD_HOST}/api/projects/${AD_SOURCE_PROJECT_ID}/events?limit=200`;

export interface FakeResponseSpec {
  readonly status?: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;

  readonly networkError?: boolean;
}

export interface RecordedRequest {
  readonly url: string;
  readonly authorization: string | null;
}

export interface FakeFetch {
  readonly fetch: FetchLike;
  readonly requests: RecordedRequest[];
}

export function createFakeFetch(
  respond: (url: string, callIndex: number) => FakeResponseSpec,
): FakeFetch {
  const requests: RecordedRequest[] = [];

  const handler = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    requests.push({ url, authorization: headers.get("authorization") });

    const spec = respond(url, requests.length - 1);
    if (spec.networkError === true) {
      throw new TypeError("ad-fake transport fault: connection refused");
    }
    return new Response(spec.body === undefined ? "" : JSON.stringify(spec.body), {
      status: spec.status ?? 200,
      headers: { "content-type": "application/json", ...spec.headers },
    });
  };

  return {
    fetch: Object.assign(handler, { preconnect: globalThis.fetch.preconnect }),
    requests,
  };
}

export function createPagedFetch(pages: readonly FakeResponseSpec[]): FakeFetch {
  return createFakeFetch((_url, index) => {
    const spec = pages[Math.min(index, pages.length - 1)];
    return spec ?? { status: 200, body: { next: null, results: [] } };
  });
}

export const AD_NOW = new Date("2026-07-30T18:00:00.000Z");

export const AD_IDENTITY_HMAC_KEY: IdentityHmacKey = deriveIdentityHmacKey({
  bytes: new Uint8Array(32).fill(0x42),
});

export interface FakeDeps {
  readonly deps: PostHogSourceDeps;

  readonly sleeps: number[];
}

export function createFakeDeps(
  fetchImpl: FetchLike,
  options?: { now?: Date; random?: number },
): FakeDeps {
  const sleeps: number[] = [];
  const now = options?.now ?? AD_NOW;
  const random = options?.random ?? 0;

  return {
    deps: {
      fetch: fetchImpl,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
      now: () => now,
      random: () => random,
      identityHmacKey: AD_IDENTITY_HMAC_KEY,
    },
    sleeps,
  };
}

export interface AdEventItemOverrides {
  readonly id?: string;
  readonly event?: string;
  readonly distinct_id?: string | null;
  readonly timestamp?: string;
  readonly properties?: Record<string, unknown>;
}

export function adEventItem(overrides: AdEventItemOverrides = {}): Record<string, unknown> {
  return {
    id: overrides.id ?? "019fb42c-fc4b-70e5-b634-4af26cb7b6b7",
    distinct_id: overrides.distinct_id === undefined ? "ad-distinct-1" : overrides.distinct_id,
    properties: overrides.properties ?? { $lib: "ad-fake-probe" },
    event: overrides.event ?? "ad_probe_event",
    timestamp: overrides.timestamp ?? "2026-07-30T17:57:49.891000+00:00",
    person: null,
    elements: [],
    elements_chain: "",
  };
}

export function adEventsPage(
  results: readonly unknown[],
  next: string | null = null,
): Record<string, unknown> {
  return { next, results };
}

export interface FakePersonsClient {
  readonly client: PostHogClient;

  readonly personCalls: string[];
}

export function createFakePersonsClient(
  respond: (distinctId: string) => ClientResult<unknown>,
): FakePersonsClient {
  const personCalls: string[] = [];
  const attempts: Record<PostHogEndpoint, number> = { events: 0, persons: 0 };

  const client: PostHogClient = {
    firstEventsPageUrl: () => {
      throw new Error("ad-fake persons client: firstEventsPageUrl must not be called");
    },
    getEventsPage: () => {
      throw new Error("ad-fake persons client: getEventsPage must not be called");
    },
    getPerson: async (distinctId: string) => {
      personCalls.push(distinctId);
      return respond(distinctId);
    },
    rateLimitAttempts: (endpoint: PostHogEndpoint) => attempts[endpoint],
  };

  return { client, personCalls };
}

export function adPersonsBody(email: string | null): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    name: "ad-fake person",
    $browser: "Chrome",
    $pathname: "/ad-fake/path",
  };
  if (email !== null) {
    properties.email = email;
  }
  return { results: [{ id: "ad-person-1", distinct_id: "ad-distinct-1", properties }] };
}
