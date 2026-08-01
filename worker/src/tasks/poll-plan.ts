/**
 * Scheduler tuning and the onboarding multi-pass plan (O-003 D-7).
 *
 * `resolvePollPlan` is PURE — no clock, no I/O, no randomness. `now` is a
 * parameter precisely so the onboarding window is testable without waiting
 * for one.
 *
 * THE DIVISION OF RESPONSIBILITY, because two mechanisms decide how often a
 * connection is polled and only one of them lives here:
 *
 *   - THE CLAIM owns the TICK CADENCE. `claimDuePollableConnections` advances
 *     `next_poll_at` by that connection's own `poll_interval_seconds` column,
 *     and the cron line fires at most once a minute.
 *   - THIS FILE owns what happens INSIDE one tick — how many passes, spaced
 *     how far apart.
 *
 * THE INVARIANT THE TWO OWE EACH OTHER:
 *
 *     passes × sleepSeconds ≤ the claim's advance for this connection
 *
 * At the column default (60 s) this holds exactly: 4 × 15 s = 60 s = one
 * tick. THE EXPENSIVE MISTAKE, named so the next reader inherits it rather
 * than discovers it: making the claim advance by `ONBOARDING_POLL_INTERVAL_SECONDS`
 * (15 s) while this plan still returns four passes polls a customer's
 * analytics project FOUR TIMES harder in exactly the window we already poll
 * hardest. The FR-6 dedup index absorbs the duplicated events, so it does not
 * corrupt data — it surfaces as inflated `pages_fetched` and vendor 429s, and
 * costs a day to find. Change one side and you must change the other.
 *
 * KNOWN UNCOVERED QUADRANT, documented rather than decided here: a connection
 * whose `poll_interval_seconds` is ABOVE 60 is made due only every Nth tick,
 * so the onboarding acceleration fires every N minutes instead of every
 * minute — the column silently throttles the window it was meant to
 * accelerate. Whether the claim's advance should become window-aware is a
 * product/scheduling decision for a human, not something this file picks.
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

/**
 * How far apart the passes WITHIN one tick are spaced. Deliberately not
 * described as "the effective poll interval": the effective interval is
 * whatever the claim allows — roughly `max(poll_interval_seconds, this)` —
 * because nothing here can make a connection due sooner than the claim
 * re-arms it. This constant governs spacing inside a tick and nothing else.
 */
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
 * run with a hidden loop inside it. "Up to" is literal: the handler stops
 * early once a pass has actually seen events (the acceleration exists to
 * catch the FIRST ones), on any failure, and on the run-duration cap.
 *
 * `pollIntervalSeconds` is ACCEPTED AND DELIBERATELY NOT CONSUMED. That
 * column governs WHEN the claim makes a connection due — not how many passes
 * a tick makes — so a connection on a faster cadence is neither accelerated
 * nor slowed by this plan. It stays in the signature because the invariant at
 * the top of this file is a relationship between the two, and a caller
 * holding the plan should be holding the interval it belongs to.
 *
 * The window comparison has NO lower bound on purpose. `connected_at` ahead
 * of the poll clock means either a connection attached seconds ago or a
 * skewed clock; both are "freshly attached", which is what the acceleration
 * is for. The cost of being wrong is bounded twice over — by
 * `MAX_RUN_DURATION_MS` inside the tick and by the claim's cadence between
 * ticks.
 */
export function resolvePollPlan(input: {
  connectedAt: Date;
  now: Date;
  pollIntervalSeconds: number;
}): PollPlan {
  const elapsedMs = input.now.getTime() - input.connectedAt.getTime();

  // EXCLUSIVE at the boundary: exactly `ONBOARDING_WINDOW_MINUTES` elapsed is
  // outside. Stated here rather than left to the arithmetic so it can never
  // drift silently between the scheduler and anything reasoning about it.
  if (elapsedMs < ONBOARDING_WINDOW_MINUTES * 60_000) {
    return {
      passes: MAX_ONBOARDING_PASSES,
      sleepMsBetween: ONBOARDING_POLL_INTERVAL_SECONDS * 1000,
    };
  }

  return { passes: 1, sleepMsBetween: 0 };
}

/**
 * Is this the accelerated onboarding plan, or the ordinary steady-state one?
 * (O-008 AD-11a.)
 *
 * THE POINT IS THAT IT READS THE PLAN RATHER THAN RE-DERIVING THE WINDOW. The
 * onboarding analysis trigger fires only on a pass that ran under this plan, and
 * the call site already holds the plan `resolvePollPlan` handed it. A second
 * copy of `now - connectedAt < ONBOARDING_WINDOW_MINUTES` at that call site
 * would be a D11 wire waiting to be severed: change the window here and the
 * trigger would silently keep firing on the old one — and a trigger firing
 * outside the window spends an analysis on ordinary steady-state traffic, on
 * every connection, forever.
 *
 * So the boundary is not restated here either. `resolvePollPlan` decides it
 * (exclusive: exactly `ONBOARDING_WINDOW_MINUTES` elapsed is OUTSIDE), and this
 * predicate reads the answer off `passes` — the field that field exists to
 * carry. The two cannot drift because there is only one comparison.
 *
 * Pure: no clock, no I/O.
 */
export function isOnboardingPlan(plan: PollPlan): boolean {
  return plan.passes === MAX_ONBOARDING_PASSES;
}
