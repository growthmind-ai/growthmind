// The impure fetch wrapper: Bearer auth, per-endpoint 429 handling, and a
// bounded give-up (O-003 D-8).
//
// PER-ENDPOINT STATE is the load-bearing part. PostHog's throttle bucket is
// per-endpoint (ROW 5: while session recordings were throttled, the events
// list still returned 200), so backoff attempt counters live per endpoint for
// the lifetime of one poll run. A 429 from persons therefore exhausts the
// identity budget and leaves the remaining sessions `unresolved` — it does
// NOT pause the events walk.
//
// There is no unbounded retry loop here or anywhere else in this package: on
// `MAX_RATE_LIMIT_ATTEMPTS` the client gives up with `rate_limited` and the
// run terminates `failed` with a plain-English reason on both the run row and
// the connection's health.
//
import type { SourceFailure } from "@growthmind/shared";

import { computeBackoffDelayMs, parseRetryAfterSeconds } from "./backoff";
import {
  eventsUrl,
  MAX_RATE_LIMIT_ATTEMPTS,
  MAX_RESPONSE_BYTES,
  personsUrl,
  REQUEST_TIMEOUT_MS,
} from "./constants";
import { isSameOriginAsHost } from "./host-guard";
import type { PostHogSourceConfig, PostHogSourceDeps } from "./deps";
import { mapFailure } from "./errors";
import { assertPostHogInstant } from "./instant";

/** The two endpoints this adapter touches. Each keeps its own attempt
 * counter — that separation IS the per-endpoint bucket. */
export type PostHogEndpoint = "events" | "persons";

export type ClientResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: SourceFailure };

export interface PostHogClient {
  /**
   * Builds the FIRST page's url. Subsequent pages follow `next` verbatim —
   * the cursor is never reconstructed, because the server has already encoded
   * the filter and the exclusive `before` into it.
   *
   * `after` and `before` are both EXCLUSIVE of the boundary instant, and both
   * must already have passed `assertPostHogInstant`.
   */
  firstEventsPageUrl(params: {
    after: string | null;
    before: string | null;
    limit: number;
  }): string;

  /** Fetches one events page by absolute url — page 1's built url, or a
   * `next` cursor followed verbatim. Returns the decoded JSON body. */
  getEventsPage(url: string): Promise<ClientResult<unknown>>;

  /** One budgeted persons lookup. Its 429s never pause the events walk. */
  getPerson(distinctId: string): Promise<ClientResult<unknown>>;

  /** Attempts spent on each endpoint in this run, for the poll-run row. */
  rateLimitAttempts(endpoint: PostHogEndpoint): number;
}

/**
 * Reads a JSON body without ever throwing across this boundary. A proxy's
 * HTML error page, an empty 204-shaped body, or a truncated response all
 * degrade to `null`, which `mapFailure` then classifies from the status alone.
 */
async function readJsonBody(response: Response): Promise<unknown> {
  try {
    // H-2: `MAX_PAGES_PER_RUN` bounds the request COUNT, not the bytes — so an
    // unbounded body means a hostile host can OOM the worker 25 times over.
    // Reject on the declared length first (cheap), then guard the undeclared
    // case by reading with a byte counter that aborts past the cap.
    const declared = Number(response.headers.get("content-length") ?? Number.NaN);
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) return null;

    const body = response.body;
    if (!body) return (await response.json()) as unknown;

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
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
  // PER-ENDPOINT STATE, scoped to this client — i.e. to one poll run. An
  // `/events` 429 never pauses `/persons` and vice versa (ROW 5).
  const attemptsSpent: Record<PostHogEndpoint, number> = { events: 0, persons: 0 };

  // Built once. The key is a Bearer credential and never reaches a returned
  // reason: every message on the failure path comes from the shared messages
  // module, never from a url and never from the response body.
  const authorization = `Bearer ${config.personalApiKey}`;

  /**
   * One request, with the bounded 429 loop around it.
   *
   * BOUNDED TWICE, deliberately. The `for` counter bounds this call, and
   * `attemptsSpent` bounds the endpoint across the whole run — so an endpoint
   * already given up on costs no further requests. There is no unbounded loop
   * and no recursion here; a grep test asserts that for the whole package.
   */
  async function requestJson(
    endpoint: PostHogEndpoint,
    url: string,
  ): Promise<ClientResult<unknown>> {
    for (let attempt = 1; attempt <= MAX_RATE_LIMIT_ATTEMPTS; attempt += 1) {
      // The run-lifetime give-up. Checked BEFORE the request, so an exhausted
      // endpoint stops costing requests rather than merely stopping retries.
      if (attemptsSpent[endpoint] >= MAX_RATE_LIMIT_ATTEMPTS) {
        return { ok: false, failure: mapFailure(429, null, [config.personalApiKey]) };
      }

      // SSRF containment (audit C-1/C-2). Checked per REQUEST, not once at
      // connect: the stored row outlives its validation, and the pagination
      // cursor supplies a fresh url on every hop.
      if (!isSameOriginAsHost(url, config.host)) {
        return { ok: false, failure: mapFailure(0, null, [config.personalApiKey]) };
      }

      let response: Response;
      try {
        response = await deps.fetch(url, {
          headers: { authorization, accept: "application/json" },
          // H-3: a 302 goes wherever the upstream points and would TOCTOU the
          // origin check above. Treat a redirect as a response, not a hop.
          redirect: "manual",
          // H-1: without this a host that accepts the connection and never
          // answers hangs the poll indefinitely — the run budget is only
          // checked BETWEEN passes, never inside a request.
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        // A transport fault carries no envelope at all, so it takes the
        // status-only fallback and lands on `unreachable` — distinct from
        // wrong-credentials and wrong-project (FR-9).
        return { ok: false, failure: mapFailure(0, null, [config.personalApiKey]) };
      }

      if (response.ok) {
        return { ok: true, value: await readJsonBody(response) };
      }

      const body = await readJsonBody(response);
      // CR-6: the key is threaded in as a `scrubSecrets` secret on every
      // constructed failure (`mapFailure` / `errors.ts`) — belt-and-braces,
      // since `body`'s `detail` is never actually read into the message, but
      // the guard is then live rather than a comment's unenforced promise.
      const failure = mapFailure(response.status, body, [config.personalApiKey]);
      if (failure.code !== "rate_limited") {
        return { ok: false, failure };
      }

      attemptsSpent[endpoint] += 1;
      if (attemptsSpent[endpoint] >= MAX_RATE_LIMIT_ATTEMPTS) {
        // A terminal, named give-up with a plain-English reason — never a
        // stuck "still trying" and never a silent zero-rows success.
        return { ok: false, failure };
      }

      const delayMs = computeBackoffDelayMs({
        attempt: attemptsSpent[endpoint],
        retryAfterSeconds: parseRetryAfterSeconds(response.headers.get("retry-after")),
        random: deps.random(),
      });

      // The run budget is checked only BETWEEN passes and BETWEEN connections,
      // never inside a walk — so without this a throttled connection could
      // sleep through its own claim (up to 4 x RETRY_AFTER_CAP_MS on /events
      // plus the same again on /persons, ~8 minutes) while the every-minute
      // cron re-claims the same row. That manufactures concurrent runs on one
      // connection, draws MORE 429s, and with concurrency 5 lets a handful of
      // throttled tenants consume every worker slot. Giving up as
      // `rate_limited` before overrunning the deadline is the safe direction:
      // the next tick retries cleanly. (O-003 edge sweep, D4/D6.)
      if (deps.deadlineExceededAfter?.(delayMs) === true) {
        return { ok: false, failure };
      }

      await deps.sleep(delayMs);
    }

    // Unreachable while the loop bound and the run bound are the same
    // constant; kept so the bound is total rather than inferred.
    return { ok: false, failure: mapFailure(429, null, [config.personalApiKey]) };
  }

  return {
    firstEventsPageUrl(params: { after: string | null; before: string | null; limit: number }) {
      const search = new URLSearchParams();
      search.set("limit", String(params.limit));
      if (params.after !== null) {
        // Gated BEFORE it can reach the wire: a malformed time value returns
        // HTTP 200 with zero rows, which would read as "caught up" forever
        // (ROW 2). The throw is caught by the walk and mapped to a named
        // `misconfigured` failure.
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
      // The url arrives either from `firstEventsPageUrl` or as a `next` cursor
      // followed VERBATIM. Nothing here rebuilds it: the server already
      // encoded the filter and the exclusive `before` (ROW 1).
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
