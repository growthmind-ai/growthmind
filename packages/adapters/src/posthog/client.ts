import type { SourceFailure } from "@growthmind/shared";

import { computeBackoffDelayMs, parseRetryAfterSeconds } from "./backoff";
import {
  eventsUrl,
  MAX_RATE_LIMIT_ATTEMPTS,
  MAX_RESPONSE_BYTES,
  MAX_RESPONSE_CHUNKS,
  personsUrl,
  REQUEST_TIMEOUT_MS,
} from "./constants";
import { isSameOriginAsHost } from "./host-guard";
import type { PostHogSourceConfig, PostHogSourceDeps } from "./deps";
import { mapFailure } from "./errors";
import { assertPostHogInstant } from "./instant";

export type PostHogEndpoint = "events" | "persons";

export type ClientResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: SourceFailure };

export interface PostHogClient {
  firstEventsPageUrl(params: {
    after: string | null;
    before: string | null;
    limit: number;
  }): string;

  getEventsPage(url: string): Promise<ClientResult<unknown>>;

  getPerson(distinctId: string): Promise<ClientResult<unknown>>;

  rateLimitAttempts(endpoint: PostHogEndpoint): number;
}

async function readJsonBody(response: Response): Promise<unknown> {
  try {
    const declared = Number(response.headers.get("content-length") ?? Number.NaN);
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) return null;

    const body = response.body;
    if (!body) return (await response.json()) as unknown;

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    let readsRemaining = MAX_RESPONSE_CHUNKS;
    while (readsRemaining > 0) {
      readsRemaining -= 1;
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    if (readsRemaining === 0) {
      await reader.cancel();
      return null;
    }

    const joined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(joined)) as unknown;
  } catch {
    return null;
  }
}

export function createPostHogClient(
  config: PostHogSourceConfig,
  deps: PostHogSourceDeps,
): PostHogClient {
  const attemptsSpent: Record<PostHogEndpoint, number> = { events: 0, persons: 0 };

  const authorization = `Bearer ${config.personalApiKey}`;

  async function requestJson(
    endpoint: PostHogEndpoint,
    url: string,
  ): Promise<ClientResult<unknown>> {
    for (let attempt = 1; attempt <= MAX_RATE_LIMIT_ATTEMPTS; attempt += 1) {
      if (attemptsSpent[endpoint] >= MAX_RATE_LIMIT_ATTEMPTS) {
        return { ok: false, failure: mapFailure(429, null, [config.personalApiKey]) };
      }

      if (!isSameOriginAsHost(url, config.host)) {
        return { ok: false, failure: mapFailure(0, null, [config.personalApiKey]) };
      }

      let response: Response;
      try {
        response = await deps.fetch(url, {
          headers: { authorization, accept: "application/json" },

          redirect: "manual",

          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        return { ok: false, failure: mapFailure(0, null, [config.personalApiKey]) };
      }

      if (response.ok) {
        return { ok: true, value: await readJsonBody(response) };
      }

      const body = await readJsonBody(response);

      const failure = mapFailure(response.status, body, [config.personalApiKey]);
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

    return { ok: false, failure: mapFailure(429, null, [config.personalApiKey]) };
  }

  return {
    firstEventsPageUrl(params: { after: string | null; before: string | null; limit: number }) {
      const search = new URLSearchParams();
      search.set("limit", String(params.limit));
      if (params.after !== null) {
        assertPostHogInstant(params.after);
        search.set("after", params.after);
      }
      if (params.before !== null) {
        assertPostHogInstant(params.before);
        search.set("before", params.before);
      }
      return `${eventsUrl(config.host, config.sourceProjectId)}?${search.toString()}`;
    },

    getEventsPage(url: string) {
      return requestJson("events", url);
    },

    getPerson(distinctId: string) {
      const search = new URLSearchParams({ distinct_id: distinctId });
      return requestJson(
        "persons",
        `${personsUrl(config.host, config.sourceProjectId)}?${search.toString()}`,
      );
    },

    rateLimitAttempts(endpoint: PostHogEndpoint) {
      return attemptsSpent[endpoint];
    },
  };
}
