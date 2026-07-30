/**
 * Scheduler tuning and the onboarding multi-pass plan (O-003 D-7).
 *
 * `resolvePollPlan` is PURE — no clock, no I/O, no randomness. `now` is a
 * parameter precisely so the onboarding window is testable without waiting
 * for one.
 *
 * TYPED STUB (O-003 scaffold): the constants are REAL and final;
 * `resolvePollPlan`'s signature is final and its body throws.
 */

/**
 * Connections claimed per cron tick. Bounds the work one worker slot can be
 * holding at once; the atomic claim makes overlapping ticks safe, so the
 * remainder simply waits for the next one.
 */
export const MAX_CONNECTIONS_PER_RUN = 10;

/**
 * The cron line fires every minute, so a run must finish inside a minute with
 * headroom. Checked BETWEEN passes and BETWEEN connections — never mid-walk,
 * because abandoning a walk halfway would waste the pages already fetched.
 * On exceed the run completes normally and the remainder waits for the next
 * tick.
 */
export const MAX_RUN_DURATION_MS = 55_000;

/**
 * How long after `connected_at` a connection stays on the accelerated
 * cadence. Long enough to cover someone finishing onboarding and looking at
 * the counter; short enough that the acceleration is not a permanent cost.
 */
export const ONBOARDING_WINDOW_MINUTES = 15;

/** The effective interval inside the onboarding window. */
export const ONBOARDING_POLL_INTERVAL_SECONDS = 15;

/**
 * Passes per cron tick inside the window: four 15-second passes fill one
 * minute, which is exactly one tick. Never more, so a slot is never held past
 * the next tick's arrival.
 */
export const MAX_ONBOARDING_PASSES = 4;

export interface PollPlan {
  /** How many pull passes this tick should make for this connection. */
  readonly passes: number;
  /** How long to wait between passes. `0` when `passes` is 1. */
  readonly sleepMsBetween: number;
}

/**
 * Inside `ONBOARDING_WINDOW_MINUTES` of `connectedAt`: up to
 * `MAX_ONBOARDING_PASSES` passes, sleeping
 * `ONBOARDING_POLL_INTERVAL_SECONDS` between them, so a brand-new connection
 * surfaces its first events in seconds rather than at the next minute
 * boundary. Outside the window: exactly one pass, `sleepMsBetween: 0`.
 *
 * Each pass writes its OWN poll-run row — four passes are four runs, not one
 * run with a hidden loop inside it.
 */
export function resolvePollPlan(_input: {
  connectedAt: Date;
  now: Date;
  pollIntervalSeconds: number;
}): PollPlan {
  throw new Error("TYPED STUB (O-003 scaffold): resolvePollPlan");
}
