// Effect injection for the PostHog source (O-003 D-8).
//
// Re-implemented from scripts/spikes/lib/trial.ts's `TrialDeps` shape — never
// imported. Tests advance a fake clock only via `sleep`, so a 429 sequence is
// asserted with zero wall-clock waiting, and `random` makes both jitter
// branches exactly assertable at `random = 0` and `random = 1`.

/** The subset of `fetch` this adapter uses. Typed from the platform's own
 * signature so a real `fetch` and a fake are interchangeable without a cast. */
export type FetchLike = typeof globalThis.fetch;

export interface PostHogSourceDeps {
  readonly fetch: FetchLike;
  /** The ONLY way time advances in this adapter. Nothing sleeps by any other
   * route, so a fake clock in a test is total rather than best-effort. */
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => Date;
  /** Returns a value in `[0, 1)`. */
  readonly random: () => number;
}

export interface PostHogSourceConfig {
  /** The customer's region URL, e.g. `https://eu.posthog.com`. Trailing
   * slashes are trimmed by the URL builders, not by the caller. */
  readonly host: string;
  /** PostHog's numeric project id, held as opaque text. */
  readonly sourceProjectId: string;
  /**
   * The customer's personal API key, decrypted for the lifetime of one poll
   * run. It is presented as a Bearer credential and must never appear in a
   * returned reason, a persisted row, or a log line. `client.ts` threads it
   * through as a `scrubSecrets` (`./scrub.ts`) secret on every `mapFailure`
   * call (`./errors.ts`) — a belt-and-braces pass, since `mapFailure`'s
   * messages are a fixed, hand-written set that never interpolates response
   * content today, but the guard is live rather than a comment's unenforced
   * promise (CR-6). `scrubSecrets` and friends are barrel-exported from
   * `@growthmind/adapters` so `packages/db` and `worker/` can apply the same
   * guard to whatever reason/log strings they build from this adapter's
   * output.
   */
  readonly personalApiKey: string;
}
