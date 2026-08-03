import { describe, expect, test } from "bun:test";

import { describeLandingLiveness, describeSince } from "../../src/onboarding/liveness";
import {
  LANDING_LIVENESS_DISCONNECTED,
  LANDING_LIVENESS_FAILING,
  LANDING_LIVENESS_FIRST_CHECK_PENDING,
  LANDING_LIVENESS_NOT_CONNECTED,
  LANDING_LIVENESS_VALIDATING,
  SINCE_MOMENTS_AGO,
} from "../../src/onboarding/messages";
import type { EventsSeenCounter } from "../../src/counter/types";
import type { ConnectionState } from "../../src/session-source/types";

const NOW = new Date("2026-08-03T12:00:00.000Z");
const NOW_MS = NOW.getTime();

const CONNECTION = {
  id: "s0-connection",
  sourceKind: "posthog",
  host: "https://eu.i.posthog.com",
  sourceProjectId: "s0-source-project",
  connectedAt: new Date("2026-08-01T00:00:00.000Z"),
  health: "healthy",
  pollIntervalSeconds: 60,
} as const;

function stateOf(status: ConnectionState["status"]): ConnectionState {
  if (status === "not_connected") return { status };
  return { status, connection: CONNECTION } as ConnectionState;
}

function counterOf(overrides: Partial<EventsSeenCounter> = {}): EventsSeenCounter {
  return {
    state: stateOf("connected_receiving"),
    totalReceived: 340,
    kept: 340,
    setAside: [],
    keptIdentityUnverified: 0,
    droppedUnreadable: 0,
    asOf: new Date(NOW_MS - 4 * 60 * 60 * 1_000),
    windowStatement: "s0-window",
    completenessStatement: "s0-completeness",
    expectedLag: { typicalSeconds: 85, worstCaseSeconds: 280, statement: "s0-lag" },
    ...overrides,
  };
}

describe("describeSince", () => {
  test("reads as the present under one minute", () => {
    expect(describeSince(new Date(NOW_MS - 30_000), NOW_MS)).toBe(SINCE_MOMENTS_AGO);
  });

  test("singular at exactly one minute, plural after", () => {
    expect(describeSince(new Date(NOW_MS - 60_000), NOW_MS)).toBe("1 minute ago");
    expect(describeSince(new Date(NOW_MS - 120_000), NOW_MS)).toBe("2 minutes ago");
  });

  test("switches to hours at exactly one hour and days at exactly one day", () => {
    expect(describeSince(new Date(NOW_MS - 3_600_000), NOW_MS)).toBe("1 hour ago");
    expect(describeSince(new Date(NOW_MS - 86_400_000), NOW_MS)).toBe("1 day ago");
  });

  test("a timestamp ahead of now reads as the present, never a negative age", () => {
    expect(describeSince(new Date(NOW_MS + 600_000), NOW_MS)).toBe(SINCE_MOMENTS_AGO);
  });
});

describe("describeLandingLiveness", () => {
  test("names the count, its denominator and when we last looked", () => {
    const line = describeLandingLiveness({ counter: counterOf(), nowMs: NOW_MS });

    expect(line).toBe("340 of 340 events counted as real people. Last checked 4 hours ago.");
  });

  test("carries the denominator when traffic was set aside", () => {
    const counter = counterOf({
      kept: 300,
      totalReceived: 340,
      setAside: [{ reason: "internal_domain", count: 40, label: "Your own team" }],
    });

    expect(describeLandingLiveness({ counter, nowMs: NOW_MS })).toContain("300 of 340 events");
  });

  test("a quiet product says so rather than reporting zero counted", () => {
    const counter = counterOf({
      state: stateOf("connected_no_events_yet"),
      kept: 0,
      totalReceived: 0,
    });
    const line = describeLandingLiveness({ counter, nowMs: NOW_MS });

    expect(line).toContain("Nothing has come through yet");
    expect(line).toContain("4 hours ago");
  });

  test("a failing connection is stated, never left as silence", () => {
    const counter = counterOf({ state: stateOf("failing") });

    expect(describeLandingLiveness({ counter, nowMs: NOW_MS })).toBe(LANDING_LIVENESS_FAILING);
  });

  test("every connection state resolves to a non-empty sentence", () => {
    const statuses: ConnectionState["status"][] = [
      "not_connected",
      "validating",
      "connected_never_polled",
      "connected_no_events_yet",
      "connected_receiving",
      "failing",
      "disconnected",
    ];

    for (const status of statuses) {
      const line = describeLandingLiveness({
        counter: counterOf({ state: stateOf(status) }),
        nowMs: NOW_MS,
      });

      expect(line.length).toBeGreaterThan(0);
      expect(line).not.toContain("{");
    }
  });

  test("the expected sentence maps to each non-counting state", () => {
    const cases: [ConnectionState["status"], string][] = [
      ["not_connected", LANDING_LIVENESS_NOT_CONNECTED],
      ["validating", LANDING_LIVENESS_VALIDATING],
      ["connected_never_polled", LANDING_LIVENESS_FIRST_CHECK_PENDING],
      ["disconnected", LANDING_LIVENESS_DISCONNECTED],
    ];

    for (const [status, expected] of cases) {
      expect(
        describeLandingLiveness({ counter: counterOf({ state: stateOf(status) }), nowMs: NOW_MS }),
      ).toBe(expected);
    }
  });

  test("a connection that has never completed a check does not claim a last check", () => {
    const counter = counterOf({ asOf: null, kept: 0, totalReceived: 0 });

    expect(describeLandingLiveness({ counter, nowMs: NOW_MS })).toBe(
      LANDING_LIVENESS_FIRST_CHECK_PENDING,
    );
  });
});
