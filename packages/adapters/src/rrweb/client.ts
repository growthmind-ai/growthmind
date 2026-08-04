import type { ReplayFailure } from "@growthmind/shared";

import { computeBackoffDelayMs, parseRetryAfterSeconds } from "../http/backoff";
import { isSameOriginAsHost } from "../http/origin";
import { readJsonBody } from "../http/read-json-body";
import { MAX_RATE_LIMIT_ATTEMPTS, REQUEST_TIMEOUT_MS } from "./constants";
import type { RrwebSourceConfig, RrwebSourceDeps } from "./deps";
import { mapRrwebFailure } from "./errors";

export type RrwebEndpoint = "recordings" | "events";

export type ClientResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: ReplayFailure };

export interface RrwebClient {
  getRecordingsPage(url: string): Promise<ClientResult<unknown>>;

  getEventsPage(url: string): Promise<ClientResult<unknown>>;

  rateLimitAttempts(endpoint: RrwebEndpoint): number;
}

const CONTEXT_FOR_ENDPOINT: Record<RrwebEndpoint, "validate" | "events"> = {
  recordings: "validate",
  events: "events",
};

export function createRrwebClient(config: RrwebSourceConfig, deps: RrwebSourceDeps): RrwebClient {
  // One 429 bucket per endpoint, deliberately: a throttled recordings walk must not spend the
  // events walk's allowance. Every loop below is bounded — this package forbids unbounded
  // loops and asserts it with a structural test.
  const attemptsSpent: Record<RrwebEndpoint, number> = { recordings: 0, events: 0 };

  const authorization = `Bearer ${config.apiKey}`;

  async function requestJson(endpoint: RrwebEndpoint, url: string): Promise<ClientResult<unknown>> {
    const context = CONTEXT_FOR_ENDPOINT[endpoint];

    for (let attempt = 1; attempt <= MAX_RATE_LIMIT_ATTEMPTS; attempt += 1) {
      if (attemptsSpent[endpoint] >= MAX_RATE_LIMIT_ATTEMPTS) {
        return { ok: false, failure: mapRrwebFailure(429, null, context, [config.apiKey]) };
      }

      if (!isSameOriginAsHost(url, config.host)) {
        return { ok: false, failure: mapRrwebFailure(0, null, context, [config.apiKey]) };
      }

      let response: Response;
      try {
        response = await deps.fetch(url, {
          headers: { authorization, accept: "application/json" },

          redirect: "manual",

          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        return { ok: false, failure: mapRrwebFailure(0, null, context, [config.apiKey]) };
      }

      if (response.ok) {
        return { ok: true, value: await readJsonBody(response) };
      }

      const body = await readJsonBody(response);

      const failure = mapRrwebFailure(response.status, body, context, [config.apiKey]);
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

    return { ok: false, failure: mapRrwebFailure(429, null, context, [config.apiKey]) };
  }

  return {
    getRecordingsPage(url: string) {
      return requestJson("recordings", url);
    },

    getEventsPage(url: string) {
      return requestJson("events", url);
    },

    rateLimitAttempts(endpoint: RrwebEndpoint) {
      return attemptsSpent[endpoint];
    },
  };
}
