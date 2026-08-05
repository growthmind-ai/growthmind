import type { SourceFailure } from "@growthmind/shared";

import { computeBackoffDelayMs, parseRetryAfterSeconds } from "../http/backoff";
import { isSameOriginAsHost } from "../http/origin";
import { readJsonBody } from "../http/read-json-body";
import { readTextBody } from "../http/read-text-body";
import { MAX_RATE_LIMIT_ATTEMPTS, REQUEST_TIMEOUT_MS } from "./constants";
import type { PostHogSourceConfig, PostHogSourceDeps } from "./deps";
import { mapFailure } from "./errors";

export type PostHogReplayEndpoint = "recordings" | "snapshots";

export type ClientResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: SourceFailure };

export interface PostHogReplayClient {
  recordingsUrl(limit: number): string;
  snapshotsUrl(recordingId: string): string;
  snapshotBlobUrl(recordingId: string, startBlobKey: string, endBlobKey: string): string;

  getRecordingsPage(url: string): Promise<ClientResult<unknown>>;
  getSnapshotSources(url: string): Promise<ClientResult<unknown>>;
  getSnapshotBlob(url: string): Promise<ClientResult<string>>;

  rateLimitAttempts(endpoint: PostHogReplayEndpoint): number;
}

function trimHost(host: string): string {
  return host.replace(/\/+$/, "");
}

function sessionRecordingsBaseUrl(host: string, sourceProjectId: string): string {
  return `${trimHost(host)}/api/projects/${encodeURIComponent(sourceProjectId)}/session_recordings`;
}

// recordingId is vendor data (a listing result's own id), encoded the same way
// posthog/constants.ts encodes sourceProjectId.
function recordingSnapshotsUrl(host: string, sourceProjectId: string, recordingId: string): string {
  return `${sessionRecordingsBaseUrl(host, sourceProjectId)}/${encodeURIComponent(recordingId)}/snapshots`;
}

// A body-read failure under a 200 must not surface as look-alike data: readTextBody's
// null (over-cap, truncated stream) becomes "", which a downstream jsonl parse reads as
// zero lines rather than as content that looks real.
async function readBlobBody(response: Response): Promise<string> {
  return (await readTextBody(response)) ?? "";
}

export function createPostHogReplayClient(
  config: PostHogSourceConfig,
  deps: PostHogSourceDeps,
): PostHogReplayClient {
  // One 429 bucket per endpoint, deliberately: a throttled recordings walk must not spend
  // a snapshot fetch's allowance. Every loop below is bounded — this package forbids
  // unbounded loops and asserts it with a structural test.
  const attemptsSpent: Record<PostHogReplayEndpoint, number> = { recordings: 0, snapshots: 0 };

  const authorization = `Bearer ${config.personalApiKey}`;
  const secrets = [config.personalApiKey];

  async function request<T>(
    endpoint: PostHogReplayEndpoint,
    url: string,
    readBody: (response: Response) => Promise<T>,
  ): Promise<ClientResult<T>> {
    for (let attempt = 1; attempt <= MAX_RATE_LIMIT_ATTEMPTS; attempt += 1) {
      if (attemptsSpent[endpoint] >= MAX_RATE_LIMIT_ATTEMPTS) {
        return { ok: false, failure: mapFailure(429, null, secrets) };
      }

      if (!isSameOriginAsHost(url, config.host)) {
        return { ok: false, failure: mapFailure(0, null, secrets) };
      }

      let response: Response;
      try {
        response = await deps.fetch(url, {
          headers: { authorization, accept: "application/json" },

          redirect: "manual",

          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        return { ok: false, failure: mapFailure(0, null, secrets) };
      }

      if (response.ok) {
        return { ok: true, value: await readBody(response) };
      }

      const body = await readJsonBody(response);

      const failure = mapFailure(response.status, body, secrets);
      if (failure.code !== "rate_limited") {
        return { ok: false, failure };
      }

      attemptsSpent[endpoint] += 1;
      if (attemptsSpent[endpoint] >= MAX_RATE_LIMIT_ATTEMPTS) {
        return { ok: false, failure };
      }

      const delayMs = computeBackoffDelayMs({
        attempt: attemptsSpent[endpoint],
        retryAfterSeconds: parseRetryAfterSeconds(response.headers.get("retry-after")),
        random: deps.random(),
      });

      if (deps.deadlineExceededAfter?.(delayMs) === true) {
        return { ok: false, failure };
      }

      await deps.sleep(delayMs);
    }

    return { ok: false, failure: mapFailure(429, null, secrets) };
  }

  return {
    recordingsUrl(limit: number) {
      const search = new URLSearchParams({ limit: String(limit) });
      return `${sessionRecordingsBaseUrl(config.host, config.sourceProjectId)}?${search.toString()}`;
    },

    snapshotsUrl(recordingId: string) {
      return recordingSnapshotsUrl(config.host, config.sourceProjectId, recordingId);
    },

    snapshotBlobUrl(recordingId: string, startBlobKey: string, endBlobKey: string) {
      const search = new URLSearchParams({
        source: "blob_v2",
        start_blob_key: startBlobKey,
        end_blob_key: endBlobKey,
      });
      return `${recordingSnapshotsUrl(config.host, config.sourceProjectId, recordingId)}?${search.toString()}`;
    },

    getRecordingsPage(url: string) {
      return request("recordings", url, readJsonBody);
    },

    getSnapshotSources(url: string) {
      return request("snapshots", url, readJsonBody);
    },

    getSnapshotBlob(url: string) {
      return request("snapshots", url, readBlobBody);
    },

    rateLimitAttempts(endpoint: PostHogReplayEndpoint) {
      return attemptsSpent[endpoint];
    },
  };
}
