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
// TYPED STUB (O-003 scaffold): the types are final; the body throws.
import type { SourceFailure } from "@growthmind/shared";

import type { PostHogSourceConfig, PostHogSourceDeps } from "./deps";

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

export function createPostHogClient(
  _config: PostHogSourceConfig,
  _deps: PostHogSourceDeps,
): PostHogClient {
  throw new Error("TYPED STUB (O-003 scaffold): createPostHogClient");
}
