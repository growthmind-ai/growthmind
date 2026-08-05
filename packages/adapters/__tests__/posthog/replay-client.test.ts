import type { IdentityHmacKey } from "@growthmind/shared";
import { deriveIdentityHmacKey } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { MAX_RATE_LIMIT_ATTEMPTS } from "../../src/posthog/constants";
import type { PostHogSourceConfig, PostHogSourceDeps } from "../../src/posthog/deps";
import type { ClientResult } from "../../src/posthog/replay-client";
import { createPostHogReplayClient } from "../../src/posthog/replay-client";

const AD_HOST = "https://ph.ad-fake.invalid";
const AD_SOURCE_PROJECT_ID = "424242";
const AD_PERSONAL_KEY = "phx_ad-fake-not-a-real-key-0000000000";
const AD_CONFIG: PostHogSourceConfig = {
  host: AD_HOST,
  sourceProjectId: AD_SOURCE_PROJECT_ID,
  personalApiKey: AD_PERSONAL_KEY,
};

// Deliberately has a character encodeURIComponent must escape, so the url-building
// assertions prove the recordingId is actually encoded and not just copied through.
const AD_RECORDING_ID = "ad-fake rec/1";

const AD_IDENTITY_HMAC_KEY: IdentityHmacKey = deriveIdentityHmacKey({
  bytes: new Uint8Array(32).fill(0x42),
});

const AD_THROTTLED_BODY = {
  type: "throttled_error",
  code: "throttled",
  detail: "Request was throttled. Expected available in 59 seconds.",
  attr: null,
};

interface FakeResponseSpec {
  readonly status?: number;
  readonly body?: unknown;
  // Raw text bypasses JSON.stringify: the snapshot-blob endpoint answers jsonl, not json.
  readonly rawBody?: string;
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
  readonly fetch: PostHogSourceDeps["fetch"];
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

function createFakeDeps(
  fetchImpl: PostHogSourceDeps["fetch"],
  options?: { deadlineExceededAfter?: (ms: number) => boolean },
): { deps: PostHogSourceDeps; sleeps: number[] } {
  const sleeps: number[] = [];
  return {
    deps: {
      fetch: fetchImpl,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
      now: () => new Date("2026-08-05T18:00:00.000Z"),
      random: () => 0,
      identityHmacKey: AD_IDENTITY_HMAC_KEY,
      ...(options?.deadlineExceededAfter !== undefined
        ? { deadlineExceededAfter: options.deadlineExceededAfter }
        : {}),
    },
    sleeps,
  };
}

describe("createPostHogReplayClient url building", () => {
  test("builds the recordings, snapshot-sources, and snapshot-blob urls the live endpoints expect", () => {
    const { deps } = createFakeDeps(createFakeFetch(() => ({ status: 200 })).fetch);
    const client = createPostHogReplayClient(AD_CONFIG, deps);

    expect(client.recordingsUrl(50)).toBe(
      `${AD_HOST}/api/projects/${AD_SOURCE_PROJECT_ID}/session_recordings?limit=50`,
    );

    expect(client.snapshotsUrl(AD_RECORDING_ID)).toBe(
      `${AD_HOST}/api/projects/${AD_SOURCE_PROJECT_ID}/session_recordings/` +
        `${encodeURIComponent(AD_RECORDING_ID)}/snapshots`,
    );

    const blobUrl = client.snapshotBlobUrl(AD_RECORDING_ID, "blob-start", "blob-end");
    const parsed = new URL(blobUrl);
    expect(parsed.pathname).toBe(
      `/api/projects/${AD_SOURCE_PROJECT_ID}/session_recordings/` +
        `${encodeURIComponent(AD_RECORDING_ID)}/snapshots`,
    );
    expect(parsed.searchParams.get("source")).toBe("blob_v2");
    // Both keys always travel together: PostHog answers 400 "Must provide both start blob
    // key and end blob key" for the single-key form.
    expect(parsed.searchParams.get("start_blob_key")).toBe("blob-start");
    expect(parsed.searchParams.get("end_blob_key")).toBe("blob-end");
  });
});

describe("createPostHogReplayClient requests", () => {
  test("sends Bearer authorization, an application/json accept header, and refuses to follow redirects", async () => {
    const fake = createFakeFetch(() => ({ status: 200, body: { results: [] } }));
    const { deps } = createFakeDeps(fake.fetch);
    const client = createPostHogReplayClient(AD_CONFIG, deps);

    await client.getRecordingsPage(client.recordingsUrl(50));

    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]?.authorization).toBe(`Bearer ${AD_PERSONAL_KEY}`);
    expect(fake.requests[0]?.accept).toBe("application/json");
    expect(fake.requests[0]?.redirect).toBe("manual");
  });

  test("returns the raw jsonl blob body as a string rather than parsing it as json", async () => {
    const jsonl = '{"type":2,"timestamp":1}\n{"type":3,"timestamp":2}\n';
    const fake = createFakeFetch(() => ({
      status: 200,
      rawBody: jsonl,
      headers: { "content-type": "application/jsonl" },
    }));
    const { deps } = createFakeDeps(fake.fetch);
    const client = createPostHogReplayClient(AD_CONFIG, deps);

    const result: ClientResult<string> = await client.getSnapshotBlob(
      client.snapshotBlobUrl(AD_RECORDING_ID, "a", "b"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(jsonl);
  });

  test("maps a 404 (recording not found) through the existing posthog failure mapping", async () => {
    const fake = createFakeFetch(() => ({
      status: 404,
      body: { type: "invalid_request", code: "not_found", detail: "Recording not found" },
    }));
    const { deps } = createFakeDeps(fake.fetch);
    const client = createPostHogReplayClient(AD_CONFIG, deps);

    const result = await client.getSnapshotSources(client.snapshotsUrl(AD_RECORDING_ID));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("project_not_found");
    expect(result.failure.message.length).toBeGreaterThan(0);
    expect(result.failure.message).not.toContain(AD_PERSONAL_KEY);
  });

  test("honours Retry-After on a 429, retries, and gives up at the attempt budget", async () => {
    const fake = createFakeFetch(() => ({
      status: 429,
      body: AD_THROTTLED_BODY,
      headers: { "retry-after": "59" },
    }));
    const { deps, sleeps } = createFakeDeps(fake.fetch);
    const client = createPostHogReplayClient(AD_CONFIG, deps);

    const result = await client.getRecordingsPage(client.recordingsUrl(50));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("rate_limited");

    expect(client.rateLimitAttempts("recordings")).toBe(MAX_RATE_LIMIT_ATTEMPTS);
    expect(fake.requests.length).toBeLessThanOrEqual(MAX_RATE_LIMIT_ATTEMPTS);
    expect(fake.requests.length).toBeGreaterThan(1);

    expect(sleeps.length).toBeGreaterThan(0);
    expect(sleeps.length).toBeLessThan(MAX_RATE_LIMIT_ATTEMPTS);
    for (const ms of sleeps) {
      expect(ms).toBeGreaterThanOrEqual(59_000);
    }
  });

  test("recordings and snapshots keep separate 429 attempt budgets", async () => {
    const fake = createFakeFetch((url) => {
      if (url.includes("/session_recordings?")) {
        return { status: 429, body: AD_THROTTLED_BODY, headers: { "retry-after": "59" } };
      }
      return { status: 200, body: { result: [] } };
    });
    const { deps } = createFakeDeps(fake.fetch);
    const client = createPostHogReplayClient(AD_CONFIG, deps);

    const recordingsResult = await client.getRecordingsPage(client.recordingsUrl(50));
    expect(recordingsResult.ok).toBe(false);
    expect(client.rateLimitAttempts("recordings")).toBe(MAX_RATE_LIMIT_ATTEMPTS);

    const snapshotsResult = await client.getSnapshotSources(client.snapshotsUrl(AD_RECORDING_ID));
    expect(snapshotsResult.ok).toBe(true);
    expect(client.rateLimitAttempts("snapshots")).toBe(0);
  });

  test("refuses a url that is not same-origin with config.host, without ever calling fetch", async () => {
    const fake = createFakeFetch(() => ({ status: 200, body: {} }));
    const { deps } = createFakeDeps(fake.fetch);
    const client = createPostHogReplayClient(AD_CONFIG, deps);

    const result = await client.getRecordingsPage(
      "https://attacker.ad-fake.invalid/session_recordings",
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("unreachable");
    expect(fake.requests).toHaveLength(0);
  });

  test("a network-level fetch failure maps to unreachable without retrying", async () => {
    const fake = createFakeFetch(() => ({ networkError: true }));
    const { deps, sleeps } = createFakeDeps(fake.fetch);
    const client = createPostHogReplayClient(AD_CONFIG, deps);

    const result = await client.getSnapshotSources(client.snapshotsUrl(AD_RECORDING_ID));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("unreachable");
    expect(fake.requests).toHaveLength(1);
    expect(sleeps).toHaveLength(0);
  });
});
