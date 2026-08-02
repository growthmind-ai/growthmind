import type { SourceFailure } from "@growthmind/shared";

import { computeBackoffDelayMs, parseRetryAfterSeconds } from "./backoff";
import { eventsUrl, MAX_RATE_LIMIT_ATTEMPTS, personsUrl, REQUEST_TIMEOUT_MS } from "./constants";
import { isSameOriginAsHost } from "./host-guard";
import type { PostHogSourceConfig, PostHogSourceDeps } from "./deps";
import { mapFailure } from "./errors";
import { assertPostHogInstant } from "./instant";
// Own module because `discovery.ts` needs the same three bounds; a second copy would drift.
import { readJsonBody } from "./read-json-body";

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

export function createPostHogClient(
  config: PostHogSourceConfig,
  deps: PostHogSourceDeps,
): PostHogClient {
  // One 429 bucket per endpoint, deliberately: a throttled events walk must not spend the
  // persons lookup's allowance. Every loop below is bounded — this package forbids
  // unbounded loops and asserts it with a structural test.
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
