// Wave 0b lane L2 test doubles. Fakes, never mocks: a fake fetch that serves
// canned pages and records what was asked for, a fake deps bundle whose
// `sleep` records instead of waiting, and a fake `PostHogClient` for the
// identity tests.
//
// NOTHING HERE TOUCHES THE NETWORK. `sleep` resolves immediately, so a 429
// sequence is asserted with zero wall-clock waiting (O-003 D-8).
//
// FIXTURE SEED PREFIX: `ad-`. Every value that could collide with another
// suite carries it. Every host, project id, and key below is an obviously-fake
// placeholder — this repo is public.
import { deriveIdentityHmacKey } from "@growthmind/shared";
import type { IdentityHmacKey } from "@growthmind/shared";

import type { ClientResult, PostHogClient, PostHogEndpoint } from "../../src/posthog/client";
import type { FetchLike, PostHogSourceConfig, PostHogSourceDeps } from "../../src/posthog/deps";

/** `.invalid` is reserved by RFC 2606 and can never resolve. */
export const AD_HOST = "https://ph.ad-fake.invalid";
export const AD_SOURCE_PROJECT_ID = "424242";

/** Obviously fake. Shaped to match `POSTHOG_KEY_PATTERN`. */
export const AD_FAKE_PERSONAL_KEY = "phx_ad-fake-not-a-real-key-0000000000";

/**
 * A second fake key carrying characters that percent-encode. Its
 * pattern-matchable run (`ad-fake`, 7 chars) is SHORTER than the 16-char
 * minimum, so `POSTHOG_KEY_PATTERN` cannot catch it — only the exact-value
 * pass and its encoded variants can. That is what makes the URL-encoded
 * scrubbing test discriminating rather than incidentally green.
 */
export const AD_FAKE_ENCODABLE_KEY = "phx_ad-fake+encoded/key=0000000000000000";

export const AD_CONFIG: PostHogSourceConfig = {
  host: AD_HOST,
  sourceProjectId: AD_SOURCE_PROJECT_ID,
  personalApiKey: AD_FAKE_PERSONAL_KEY,
};

/** An absolute events-page url of the pinned shape, for calls that take one
 * directly rather than through the (stubbed) builder. */
export const AD_EVENTS_URL = `${AD_HOST}/api/projects/${AD_SOURCE_PROJECT_ID}/events?limit=200`;

// ---------------------------------------------------------------------------
// Fake fetch
// ---------------------------------------------------------------------------

export interface FakeResponseSpec {
  readonly status?: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  /** Simulates a transport-level fault: `fetch` itself rejects. */
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

/**
 * `respond` is called with the requested url and the 0-based call index, so a
 * test can serve a page sequence, route by endpoint, or return the same 429
 * forever.
 *
 * `preconnect` is carried over from the real `fetch` purely to satisfy
 * `FetchLike` (see the BLOCKER note in this lane's report) — it is never
 * called, so no connection is ever opened.
 */
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

/** Serves a fixed page sequence in order; every call past the end repeats the
 * last spec, so an over-walking implementation is visible in `requests`. */
export function createPagedFetch(pages: readonly FakeResponseSpec[]): FakeFetch {
  return createFakeFetch((_url, index) => {
    const spec = pages[Math.min(index, pages.length - 1)];
    return spec ?? { status: 200, body: { next: null, results: [] } };
  });
}

// ---------------------------------------------------------------------------
// Fake deps
// ---------------------------------------------------------------------------

export const AD_NOW = new Date("2026-07-30T18:00:00.000Z");

/**
 * Security audit M-1. A fixed, obviously-fake 32-byte root key run through
 * the REAL `deriveIdentityHmacKey` — not a hand-rolled stand-in — so a test
 * asserting on `hashIdentityKey` output exercises the same derivation path
 * production does. Every test that needs a `PostHogSourceDeps` gets this
 * through `createFakeDeps` below; a test that needs to assert on the exact
 * digest imports this constant directly rather than re-deriving its own.
 */
export const AD_IDENTITY_HMAC_KEY: IdentityHmacKey = deriveIdentityHmacKey({
  bytes: new Uint8Array(32).fill(0x42),
});

export interface FakeDeps {
  readonly deps: PostHogSourceDeps;
  /** Every `sleep` duration requested, in order. Nothing actually waits. */
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

// ---------------------------------------------------------------------------
// PostHog event fixtures — the pinned wire shape (Addendum A ROW 3 / ROW 4 /
// ROW 6). Top-level keys are exactly the eight the probe observed, including
// `person`, which is present and ALWAYS `null` (165/165).
// ---------------------------------------------------------------------------

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

/** The `{next, results}` envelope. No `count`, no `previous` — that envelope
 * belongs to a different endpoint and must never be generalised here. */
export function adEventsPage(
  results: readonly unknown[],
  next: string | null = null,
): Record<string, unknown> {
  return { next, results };
}

// ---------------------------------------------------------------------------
// Fake PostHogClient — persons only. The events methods throw loudly, so an
// identity resolver that reaches for the events walk fails visibly rather than
// silently passing.
// ---------------------------------------------------------------------------

export interface FakePersonsClient {
  readonly client: PostHogClient;
  /** Distinct ids actually looked up, in call order. */
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

/** A persons response of the pinned shape: `results[0].properties.email`. */
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
