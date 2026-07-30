// Effect injection for the PostHog source (O-003 D-8).
//
// Re-implemented from scripts/spikes/lib/trial.ts's `TrialDeps` shape — never
// imported. Tests advance a fake clock only via `sleep`, so a 429 sequence is
// asserted with zero wall-clock waiting, and `random` makes both jitter
// branches exactly assertable at `random = 0` and `random = 1`.
import type { IdentityHmacKey } from "@growthmind/shared";

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
  /**
   * Security audit M-1. The keyed HMAC key `hashIdentityKey` uses to hash
   * every `distinct_id` before it crosses the port boundary — derived ONCE
   * by the composition root (`deriveIdentityHmacKey`, `@growthmind/shared`,
   * from the installation's `GROWTHMIND_ENCRYPTION_KEY` via HKDF) and handed
   * in here, never read from an env var by this package directly. Required,
   * not optional: an adapter with no identity key would have no safe way to
   * hash a distinct id at all, and silently falling back to an unkeyed
   * scheme is the exact defect this fix closes.
   */
  readonly identityHmacKey: IdentityHmacKey;
  /**
   * True when sleeping `ms` would overrun the caller's run budget.
   *
   * Optional so existing callers and tests are unaffected; when absent the
   * adapter backs off exactly as before. The worker supplies it because its
   * budget is otherwise only checked between passes — a throttled connection
   * could sleep for minutes THROUGH its own claim, letting the every-minute
   * cron re-claim the same row and run it concurrently with itself
   * (O-003 edge sweep, D4/D6).
   */
  readonly deadlineExceededAfter?: (ms: number) => boolean;
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
