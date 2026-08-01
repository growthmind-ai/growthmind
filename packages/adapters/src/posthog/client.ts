// The impure fetch wrapper: Bearer auth, per-endpoint 429 handling, and a bounded
// give-up.
//
// Per-endpoint state is the load-bearing part. PostHog's throttle bucket is
// per-endpoint (row 5: while session recordings were throttled, the events list still
// returned 200), so backoff attempt counters live per endpoint for the lifetime of one
// poll run. A 429 from persons therefore exhausts the identity budget and leaves the
// remaining sessions `unresolved`. It does not pause the events walk.
//
// There is no unbounded retry loop here or anywhere else in this package: on
// `MAX_RATE_LIMIT_ATTEMPTS` the client gives up with `rate_limited` and the run
// terminates `failed` with a plain-English reason on both the run row and the
// connection's health.
import type { SourceFailure } from "@growthmind/shared";

import { computeBackoffDelayMs, parseRetryAfterSeconds } from "./backoff";
import { eventsUrl, MAX_RATE_LIMIT_ATTEMPTS, personsUrl, REQUEST_TIMEOUT_MS } from "./constants";
import { isSameOriginAsHost } from "./host-guard";
import type { PostHogSourceConfig, PostHogSourceDeps } from "./deps";
import { mapFailure } from "./errors";
import { assertPostHogInstant } from "./instant";
// The body reader lives in its own module because `discovery.ts` needs the same three
// bounds. One implementation, two consumers; a second copy here would drift.
import { readJsonBody } from "./read-json-body";

/** The two endpoints this adapter touches. Each keeps its own attempt counter. That
 * separation IS the per-endpoint bucket. */
export type PostHogEndpoint = "events" | "persons";

export type ClientResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: SourceFailure };

export interface PostHogClient {
  /**
   * Builds the first page's url. Subsequent pages follow `next` verbatim. The cursor is
   * never reconstructed, because the server has already encoded the filter and the
   * exclusive `before` into it.
   *
   * `after` and `before` are both exclusive of the boundary instant, and both must
   * already have passed `assertPostHogInstant`.
   */
  firstEventsPageUrl(params: {
    after: string | null;
    before: string | null;
    limit: number;
  }): string;

  /** Fetches one events page by absolute url. Page 1's built url, or a `next` cursor
   * followed verbatim. Returns the decoded JSON body. */
  getEventsPage(url: string): Promise<ClientResult<unknown>>;

  /** One budgeted persons lookup. Its 429s never pause the events walk. */
  getPerson(distinctId: string): Promise<ClientResult<unknown>>;

  /** Attempts spent on each endpoint in this run, for the poll-run row. */
  rateLimitAttempts(endpoint: PostHogEndpoint): number;
}

export function createPostHogClient(
  config: PostHogSourceConfig,
  deps: PostHogSourceDeps,
): PostHogClient {
  // Per-endpoint state, scoped to this client. I.e. to one poll run. An `/events` 429
  // never pauses `/persons` and vice versa (row 5).
  const attemptsSpent: Record<PostHogEndpoint, number> = { events: 0, persons: 0 };

  // Built once. The key is a Bearer credential and never reaches a returned reason:
  // every message on the failure path comes from the shared messages module, never from
  // a url and never from the response body.
  const authorization = `Bearer ${config.personalApiKey}`;

  /**
   * One request, with the bounded 429 loop around it.
   *
   * Bounded twice, deliberately. The `for` counter bounds this call, and
   * `attemptsSpent` bounds the endpoint across the whole run, so an endpoint already
   * given up on costs no further requests. There is no unbounded loop and no recursion
   * here; a grep test asserts that for the whole package.
   */
  async function requestJson(
    endpoint: PostHogEndpoint,
    url: string,
  ): Promise<ClientResult<unknown>> {
    for (let attempt = 1; attempt <= MAX_RATE_LIMIT_ATTEMPTS; attempt += 1) {
      // The run-lifetime give-up. Checked before the request, so an exhausted endpoint
      // stops costing requests rather than merely stopping retries.
      if (attemptsSpent[endpoint] >= MAX_RATE_LIMIT_ATTEMPTS) {
        return { ok: false, failure: mapFailure(429, null, [config.personalApiKey]) };
      }

      // Ssrf containment (audit C-1/C-2). Checked per request, not once at connect: the
      // stored row outlives its validation, and the pagination cursor supplies a fresh
      // url on every hop.
      if (!isSameOriginAsHost(url, config.host)) {
        return { ok: false, failure: mapFailure(0, null, [config.personalApiKey]) };
      }

      let response: Response;
      try {
        response = await deps.fetch(url, {
          headers: { authorization, accept: "application/json" },
          // : a 302 goes wherever the upstream points and would toctou the origin
          // check above. Treat a redirect as a response, not a hop.
          redirect: "manual",
          // : without this a host that accepts the connection and never answers
          // hangs the poll indefinitely. The run budget is only checked between passes,
          // never inside a request.
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        // A transport fault carries no envelope at all, so it takes the status-only
        // fallback and lands on `unreachable`. Distinct from wrong-credentials and
        // wrong-project.
        return { ok: false, failure: mapFailure(0, null, [config.personalApiKey]) };
      }

      if (response.ok) {
        return { ok: true, value: await readJsonBody(response) };
      }

      const body = await readJsonBody(response);
      // The key is threaded in as a `scrubSecrets` secret on every constructed failure
      // (`mapFailure` / `errors.ts`). Belt-and-braces, since `body`'s `detail` is never
      // actually read into the message, but the guard is then live rather than a
      // comment's unenforced promise.
      const failure = mapFailure(response.status, body, [config.personalApiKey]);
      if (failure.code !== "rate_limited") {
        return { ok: false, failure };
      }

      attemptsSpent[endpoint] += 1;
      if (attemptsSpent[endpoint] >= MAX_RATE_LIMIT_ATTEMPTS) {
        // A terminal, named give-up with a plain-English reason, never a stuck "still
        // trying" and never a silent zero-rows success.
        return { ok: false, failure };
      }

      const delayMs = computeBackoffDelayMs({
        attempt: attemptsSpent[endpoint],
        retryAfterSeconds: parseRetryAfterSeconds(response.headers.get("retry-after")),
        random: deps.random(),
      });

      // The run budget is checked only between passes and between connections, never
      // inside a walk, so without this a throttled connection could sleep through its
      // own claim (up to 4 x RETRY_AFTER_CAP_MS on /events plus the same again on
      // /persons, ~8 minutes) while the every-minute cron re-claims the same row. That
      // manufactures concurrent runs on one connection, draws more 429s, and with
      // concurrency 5 lets a handful of throttled tenants consume every worker slot.
      // Giving up as `rate_limited` before overrunning the deadline is the safe
      // direction: the next tick retries cleanly. (edge sweep, /.)
      if (deps.deadlineExceededAfter?.(delayMs) === true) {
        return { ok: false, failure };
      }

      await deps.sleep(delayMs);
    }

    // Unreachable while the loop bound and the run bound are the same constant; kept so
    // the bound is total rather than inferred.
    return { ok: false, failure: mapFailure(429, null, [config.personalApiKey]) };
  }

  return {
    firstEventsPageUrl(params: { after: string | null; before: string | null; limit: number }) {
      const search = new URLSearchParams();
      search.set("limit", String(params.limit));
      if (params.after !== null) {
        // Gated before it can reach the wire: a malformed time value returns HTTP 200
        // with zero rows, which would read as "caught up" forever (row 2). The throw is
        // caught by the walk and mapped to a named `misconfigured` failure.
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
      // The url arrives either from `firstEventsPageUrl` or as a `next` cursor followed
      // verbatim. Nothing here rebuilds it: the server already encoded the filter and
      // the exclusive `before` (row 1).
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
