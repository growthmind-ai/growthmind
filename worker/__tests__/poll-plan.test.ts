// item 114, `resolvePollPlan`.
//
// The onboarding acceleration is a pure function precisely so the window is testable
// without waiting for one: `now` is a parameter, there is no clock read, no I/O, and no
// randomness. These tests never sleep.
import { expect, test } from "bun:test";

import {
  MAX_ONBOARDING_PASSES,
  ONBOARDING_POLL_INTERVAL_SECONDS,
  ONBOARDING_WINDOW_MINUTES,
  resolvePollPlan,
} from "../src/tasks/poll-plan";

const CONNECTED_AT = new Date("2026-07-30T12:00:00.000Z");

function at(minutesAfterConnect: number): Date {
  return new Date(CONNECTED_AT.getTime() + minutesAfterConnect * 60_000);
}

test("inside the onboarding window the plan makes multiple passes on the accelerated interval", () => {
  const plan = resolvePollPlan({
    connectedAt: CONNECTED_AT,
    now: at(1),
    pollIntervalSeconds: 60,
  });

  expect(plan.passes).toBe(MAX_ONBOARDING_PASSES);
  expect(plan.sleepMsBetween).toBe(ONBOARDING_POLL_INTERVAL_SECONDS * 1000);
});

test("outside the onboarding window the plan is exactly one pass with no sleep", () => {
  const plan = resolvePollPlan({
    connectedAt: CONNECTED_AT,
    now: at(ONBOARDING_WINDOW_MINUTES + 1),
    pollIntervalSeconds: 60,
  });

  expect(plan.passes).toBe(1);
  expect(plan.sleepMsBetween).toBe(0);
});

test("the moment of connection is inside the window", () => {
  // The glue moment: someone who has just finished onboarding step 2 is staring at the
  // counter. This is the case the acceleration exists for.
  const plan = resolvePollPlan({
    connectedAt: CONNECTED_AT,
    now: CONNECTED_AT,
    pollIntervalSeconds: 60,
  });

  expect(plan.passes).toBe(MAX_ONBOARDING_PASSES);
});

test("the window boundary is exclusive — exactly ONBOARDING_WINDOW_MINUTES elapsed is outside", () => {
  // Stated rather than left to the implementation, so the boundary can never drift
  // silently between the scheduler and a future test.
  const justInside = resolvePollPlan({
    connectedAt: CONNECTED_AT,
    now: new Date(at(ONBOARDING_WINDOW_MINUTES).getTime() - 1),
    pollIntervalSeconds: 60,
  });
  const atBoundary = resolvePollPlan({
    connectedAt: CONNECTED_AT,
    now: at(ONBOARDING_WINDOW_MINUTES),
    pollIntervalSeconds: 60,
  });

  expect(justInside.passes).toBe(MAX_ONBOARDING_PASSES);
  expect(atBoundary.passes).toBe(1);
});

test("four accelerated passes fill one cron tick and never overrun it", () => {
  // The reason MAX_ONBOARDING_PASSES is what it is: the cron line fires every minute,
  // so the passes plus the sleeps between them must not hold a worker slot past the
  // next tick's arrival.
  const plan = resolvePollPlan({
    connectedAt: CONNECTED_AT,
    now: at(2),
    pollIntervalSeconds: 60,
  });

  expect((plan.passes - 1) * plan.sleepMsBetween).toBeLessThan(60_000);
});

test("a connection whose own interval is already fast is not slowed by the plan", () => {
  // `poll_interval_seconds` is per-connection and changeable without a deploy. Outside
  // the window the plan is one pass regardless of that value. The interval governs when
  // the claim makes it due, not how many passes a tick makes.
  const plan = resolvePollPlan({
    connectedAt: CONNECTED_AT,
    now: at(ONBOARDING_WINDOW_MINUTES + 5),
    pollIntervalSeconds: 15,
  });

  expect(plan.passes).toBe(1);
  expect(plan.sleepMsBetween).toBe(0);
});

test("resolvePollPlan is pure — the same inputs yield an identical plan every time", () => {
  const input = { connectedAt: CONNECTED_AT, now: at(3), pollIntervalSeconds: 60 };

  expect(resolvePollPlan(input)).toEqual(resolvePollPlan(input));
});
