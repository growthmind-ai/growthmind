// Effect injection for the Slack delivery adapter, following `../posthog/deps.ts`: the
// only impure thing this adapter can reach is handed to it, so every test drives the
// real implementation with zero network.
//
// NO `sleep`, NO `now`, NO `random`. The PostHog source needs all three because it
// retries a throttled poll inside one job. This adapter deliberately does not retry:
// `isRetryablePostFailure` (the port, `@growthmind/shared`) exists so the caller
// schedules the next attempt, and an adapter that slept through a worker job's claim
// would reproduce the / hazard `../posthog/client.ts` documents. A job sleeping past
// its own claim while the cron re-claims the same row and runs it concurrently with
// itself. A delivery lane wants that decision in the scheduler, where the budget lives,
// not buried in a poster.

/**
 * The subset of `fetch` this adapter uses, taken from the platform's own signature so a
 * real `fetch` and a fake are interchangeable without a cast.
 *
 * Deliberately module-local rather than exported. `../posthog/deps.ts` already declares
 * this identical one-line alias and the package barrel already exports that name; a
 * second exported `FetchLike` would give one platform type two names in one barrel,
 * which is how a "which one do I import?" question starts. Importing the PostHog
 * module's copy instead would be worse. It would make the Slack adapter depend on the
 * PostHog adapter, coupling two vendors that share nothing but a global.
 */
type FetchLike = typeof globalThis.fetch;

export interface SlackPosterConfig {
  /**
   * The workspace's bot token, decrypted for the lifetime of one delivery attempt.
   * Presented as a Bearer credential and never surfaced: every sentence this adapter
   * can return comes from the fixed table in `./errors.ts`, which is reachable only
   * through a `PostFailureCode` and so has no channel through which a token, a url, or
   * a response body could reach a customer-facing string.
   * `__tests__/slack/poster.test.ts` pins that.
   */
  readonly botToken: string;
}

export interface SlackPosterDeps {
  readonly fetch: FetchLike;
}
