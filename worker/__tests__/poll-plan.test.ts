import { readFileSync } from "node:fs";

import { expect, test } from "bun:test";

import {
  isInsideOnboardingWindow,
  MAX_ONBOARDING_PASSES,
  ONBOARDING_POLL_INTERVAL_SECONDS,
  ONBOARDING_WINDOW_MINUTES,
  resolvePollPlan,
} from "../src/tasks/poll-plan";

const CONNECTED_AT = new Date("2026-07-30T12:00:00.000Z");

const WINDOW_MS = ONBOARDING_WINDOW_MINUTES * 60_000;

function at(minutesAfterConnect: number): Date {
  return new Date(CONNECTED_AT.getTime() + minutesAfterConnect * 60_000);
}

test("inside the onboarding window the plan makes multiple passes on the accelerated interval", () => {
  const plan = resolvePollPlan({
    connectedAt: CONNECTED_AT,
    armedAt: null,
    now: at(1),
    pollIntervalSeconds: 60,
  });

  expect(plan.passes).toBe(MAX_ONBOARDING_PASSES);
  expect(plan.sleepMsBetween).toBe(ONBOARDING_POLL_INTERVAL_SECONDS * 1000);
});

test("outside the onboarding window the plan is exactly one pass with no sleep", () => {
  const plan = resolvePollPlan({
    connectedAt: CONNECTED_AT,
    armedAt: null,
    now: at(ONBOARDING_WINDOW_MINUTES + 1),
    pollIntervalSeconds: 60,
  });

  expect(plan.passes).toBe(1);
  expect(plan.sleepMsBetween).toBe(0);
});

test("the moment of connection is inside the window", () => {
  const plan = resolvePollPlan({
    connectedAt: CONNECTED_AT,
    armedAt: null,
    now: CONNECTED_AT,
    pollIntervalSeconds: 60,
  });

  expect(plan.passes).toBe(MAX_ONBOARDING_PASSES);
});

test("the window boundary is exclusive — exactly ONBOARDING_WINDOW_MINUTES elapsed is outside", () => {
  const justInside = resolvePollPlan({
    connectedAt: CONNECTED_AT,
    armedAt: null,
    now: new Date(at(ONBOARDING_WINDOW_MINUTES).getTime() - 1),
    pollIntervalSeconds: 60,
  });
  const atBoundary = resolvePollPlan({
    connectedAt: CONNECTED_AT,
    armedAt: null,
    now: at(ONBOARDING_WINDOW_MINUTES),
    pollIntervalSeconds: 60,
  });

  expect(justInside.passes).toBe(MAX_ONBOARDING_PASSES);
  expect(atBoundary.passes).toBe(1);
});

test("four accelerated passes fill one cron tick and never overrun it", () => {
  const plan = resolvePollPlan({
    connectedAt: CONNECTED_AT,
    armedAt: null,
    now: at(2),
    pollIntervalSeconds: 60,
  });

  expect((plan.passes - 1) * plan.sleepMsBetween).toBeLessThan(60_000);
});

test("a connection whose own interval is already fast is not slowed by the plan", () => {
  const plan = resolvePollPlan({
    connectedAt: CONNECTED_AT,
    armedAt: null,
    now: at(ONBOARDING_WINDOW_MINUTES + 5),
    pollIntervalSeconds: 15,
  });

  expect(plan.passes).toBe(1);
  expect(plan.sleepMsBetween).toBe(0);
});

test("resolvePollPlan is pure — the same inputs yield an identical plan every time", () => {
  const input = { connectedAt: CONNECTED_AT, armedAt: null, now: at(3), pollIntervalSeconds: 60 };

  expect(resolvePollPlan(input)).toEqual(resolvePollPlan(input));
});

test("a connection older than the window with a fresh arm clock gets the onboarding plan", () => {
  const now = at(30);

  const plan = resolvePollPlan({
    connectedAt: CONNECTED_AT,
    armedAt: now,
    now,
    pollIntervalSeconds: 60,
  });

  expect(plan.passes).toBe(MAX_ONBOARDING_PASSES);
  expect(plan.sleepMsBetween).toBe(ONBOARDING_POLL_INTERVAL_SECONDS * 1000);
});

test("a connection inside the window with no arm clock still gets the onboarding plan", () => {
  const plan = resolvePollPlan({
    connectedAt: CONNECTED_AT,
    armedAt: null,
    now: at(1),
    pollIntervalSeconds: 60,
  });

  expect(plan.passes).toBe(MAX_ONBOARDING_PASSES);
  expect(plan.sleepMsBetween).toBe(ONBOARDING_POLL_INTERVAL_SECONDS * 1000);
});

test("a project past both the connect bound and the arm bound falls back to a single pass", () => {
  const now = at(30);

  const plan = resolvePollPlan({
    connectedAt: CONNECTED_AT,
    armedAt: new Date(now.getTime() - 30 * 60_000),
    now,
    pollIntervalSeconds: 60,
  });

  expect(plan).toEqual({ passes: 1, sleepMsBetween: 0 });
});

test("a null arm clock never widens the window", () => {
  const plan = resolvePollPlan({
    connectedAt: CONNECTED_AT,
    armedAt: null,
    now: at(30),
    pollIntervalSeconds: 60,
  });

  expect(plan.passes).toBe(1);
  expect(plan.sleepMsBetween).toBe(0);
});

test("the plan is a pure function of its inputs and reads no clock of its own", () => {
  const input = {
    connectedAt: CONNECTED_AT,
    armedAt: at(28),
    now: at(30),
    pollIntervalSeconds: 60,
  };

  expect(resolvePollPlan(input)).toEqual(resolvePollPlan(input));

  const source = readFileSync(new URL("../src/tasks/poll-plan.ts", import.meta.url), "utf8");

  expect(source).not.toContain("Date.now");
  expect(source).not.toContain("new Date(");
});

test("an arm clock in the future expires at its own bound and never becomes permanent", () => {
  const now = at(30);
  const armedAt = new Date(now.getTime() + 5 * 60_000);

  const inside = resolvePollPlan({
    connectedAt: CONNECTED_AT,
    armedAt,
    now,
    pollIntervalSeconds: 60,
  });

  const expired = resolvePollPlan({
    connectedAt: CONNECTED_AT,
    armedAt,
    now: new Date(armedAt.getTime() + WINDOW_MS),
    pollIntervalSeconds: 60,
  });

  expect(inside.passes).toBe(MAX_ONBOARDING_PASSES);
  expect(expired.passes).toBe(1);
  expect(expired.sleepMsBetween).toBe(0);
});

test("the window boundary is exclusive on both clocks", () => {
  const connectedAt = CONNECTED_AT;
  const armedAt = at(30);

  expect(
    isInsideOnboardingWindow(connectedAt, new Date(connectedAt.getTime() + WINDOW_MS - 1)),
  ).toBe(true);
  expect(isInsideOnboardingWindow(connectedAt, new Date(connectedAt.getTime() + WINDOW_MS))).toBe(
    false,
  );

  expect(isInsideOnboardingWindow(armedAt, new Date(armedAt.getTime() + WINDOW_MS - 1))).toBe(true);
  expect(isInsideOnboardingWindow(armedAt, new Date(armedAt.getTime() + WINDOW_MS))).toBe(false);

  const armJustInside = resolvePollPlan({
    connectedAt,
    armedAt,
    now: new Date(armedAt.getTime() + WINDOW_MS - 1),
    pollIntervalSeconds: 60,
  });
  const armAtBoundary = resolvePollPlan({
    connectedAt,
    armedAt,
    now: new Date(armedAt.getTime() + WINDOW_MS),
    pollIntervalSeconds: 60,
  });

  expect(armJustInside.passes).toBe(MAX_ONBOARDING_PASSES);
  expect(armAtBoundary.passes).toBe(1);
});

test("the window question has one home", () => {
  const now = at(60);
  const offsetsMs = [0, WINDOW_MS - 1, WINDOW_MS, 2 * WINDOW_MS];

  const armStamps: readonly (Date | null)[] = [
    null,
    ...offsetsMs.map((offset) => new Date(now.getTime() - offset)),
  ];

  for (const offset of offsetsMs) {
    const connectedAt = new Date(now.getTime() - offset);

    for (const armedAt of armStamps) {
      const insideEitherClock =
        isInsideOnboardingWindow(connectedAt, now) || isInsideOnboardingWindow(armedAt, now);

      const plan = resolvePollPlan({ connectedAt, armedAt, now, pollIntervalSeconds: 60 });

      expect(plan.passes === MAX_ONBOARDING_PASSES).toBe(insideEitherClock);
    }
  }
});
